import type { Readable } from "node:stream";
import { GoogleGenerativeAI } from "@google/generative-ai";

/** Shape returned to the route */
export interface ParsedReceiptItem {
  id: string;
  name: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  kind?: string | null;
}

export interface ParseResult {
  items: ParsedReceiptItem[];
  summary: { grandTotal: number };
  rawModelText?: string;
  model?: string;
  durationMs?: number;
  source: "gemini" | "mock";
  usedModelVersion?: string;
  modelsTried?: Array<{
    model: string;
    version: string;
    status: string;
    httpStatus?: number;
    durationMs?: number;
    chars?: number;
    errorMessage?: string;
    errorCode?: string;
  }>;
}

export interface ParseOptions {
  language: string;
  sessionName: string;
  mimeType: string;
  imageBase64: string;
}

// --- Configuration ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL_PARSE = process.env.GEMINI_MODEL_PARSE || "gemini-1.5-flash";
const GEMINI_MODEL_FALLBACKS = (process.env.GEMINI_MODEL_FALLBACKS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const MODEL_CANDIDATES = Array.from(
  new Set([
    GEMINI_MODEL_PARSE,
    ...GEMINI_MODEL_FALLBACKS,
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash-001",
    "gemini-1.5-pro",
    "gemini-1.5-pro-latest",
  ])
);

const DEBUG_PARSE = process.env.DEBUG_PARSE === "1";
let cachedModel: { model: string; version: string } | null = null;

// --- Parsing instruction ---
const EXTRACTION_INSTRUCTIONS = `You are a receipt parser. Return ONLY valid JSON with this shape:
{
  "items": [
    { "id": "string", "name": "string", "unitPrice": number, "quantity": number, "totalPrice": number, "kind": "fee|tip|discount|item|other|null" }
  ],
  "summary": { "grandTotal": number }
}
Rules:
- Numbers must use dot as decimal separator.
- id: generate short stable IDs like "1", "2"... or semantic unique IDs.
- quantity >= 1.
- totalPrice = unitPrice * quantity (round to 2 decimals).
- Include service/tips/fees as separate items with kind set.
- Ignore currency symbols.
- grandTotal = sum of totalPrice values.`;

// --- Helpers ---
function safeParseJson(text: string): { ok: boolean; data?: ParseResult } {
  try {
    const cleaned = unwrapMarkdown(text);
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1) return { ok: false };
    const jsonSlice = cleaned.slice(firstBrace, lastBrace + 1);
    const raw = JSON.parse(jsonSlice);
    if (!raw || typeof raw !== "object") return { ok: false };
    if (!Array.isArray(raw.items) || !raw.summary) return { ok: false };

    const items: ParsedReceiptItem[] = raw.items.map((it: any, idx: number) => {
      const q = Number(it.quantity ?? 1) || 1;
      const unit = Number(it.unitPrice ?? it.price ?? 0) || 0;
      const total = Number(it.totalPrice ?? unit * q) || 0;
      return {
        id: String(it.id ?? idx + 1),
        name: String(it.name ?? "Item"),
        unitPrice: round2(unit),
        quantity: q,
        totalPrice: round2(total),
        kind: it.kind ? String(it.kind) : undefined,
      };
    });

    const grandTotal = round2(
      items.reduce((s, i) => s + (i.totalPrice || 0), 0)
    );
    return {
      ok: true,
      data: { items, summary: { grandTotal }, source: "gemini" },
    };
  } catch {
    return { ok: false };
  }
}

function unwrapMarkdown(t: string): string {
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fence && fence[1] ? fence[1].trim() : t.trim();
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function mockParse(): ParseResult {
  const items: ParsedReceiptItem[] = [
    {
      id: "1001",
      name: "Кола 0.5L",
      unitPrice: 2,
      quantity: 6,
      totalPrice: 12,
    },
    {
      id: "1002",
      name: "Кола (стакан)",
      unitPrice: 2.5,
      quantity: 1,
      totalPrice: 2.5,
    },
    {
      id: "FEE1",
      name: "Сервис",
      unitPrice: 1.2,
      quantity: 1,
      totalPrice: 1.2,
      kind: "fee",
    },
  ];
  const grandTotal = items.reduce((s, i) => s + i.totalPrice, 0);
  return { items, summary: { grandTotal }, source: "mock" };
}

// --- Main function ---
export async function parseReceipt(
  options: ParseOptions
): Promise<ParseResult> {
  if (!GEMINI_API_KEY) {
    if (DEBUG_PARSE)
      console.warn("[parseReceipt] Missing GEMINI_API_KEY, using mock");
    return mockParse();
  }

  if (!/^AIza[0-9A-Za-z_-]{10,}$/.test(GEMINI_API_KEY)) {
    console.warn(
      "[parseReceipt] Warning: GEMINI_API_KEY format unexpected (should start with 'AIza')"
    );
  }

  const prompt = `${EXTRACTION_INSTRUCTIONS}\nLanguage: ${options.language}\nSession: ${options.sessionName}`;
  const imagePart = { data: options.imageBase64, mimeType: options.mimeType };
  const modelsTried: NonNullable<ParseResult["modelsTried"]> = [];

  for (const modelName of MODEL_CANDIDATES) {
    const start = Date.now();
    try {
      if (DEBUG_PARSE) console.log(`[parseReceipt] Trying model: ${modelName}`);
      const text = await generateViaRest(
        modelName,
        prompt,
        imagePart.data,
        imagePart.mimeType
      );
      const parsed = safeParseJson(text);

      if (parsed.ok && parsed.data) {
        const duration = Date.now() - start;
        return {
          ...parsed.data,
          model: modelName,
          durationMs: duration,
          usedModelVersion: "v1",
          modelsTried,
        };
      }

      modelsTried.push({
        model: modelName,
        version: "v1",
        status: "parse_fail",
      });
    } catch (err: any) {
      const httpStatus = err?.status || err?.statusCode;
      modelsTried.push({
        model: modelName,
        version: "v1",
        status: "http_error",
        httpStatus,
        errorMessage: err?.message,
      });
      if (DEBUG_PARSE)
        console.warn(`[parseReceipt] Error with ${modelName}: ${err.message}`);
      continue;
    }
  }

  console.error("[parseReceipt] All Gemini models failed, using mock");
  return mockParse();
}

// --- Actual Gemini API call ---
async function generateViaRest(
  model: string,
  prompt: string,
  base64: string,
  mime: string
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${encodeURIComponent(
    GEMINI_API_KEY as string
  )}`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: `${prompt}\nOUTPUT ONLY RAW JSON. NO MARKDOWN.` },
          { inlineData: { data: base64, mimeType: mime } },
        ],
      },
    ],
    generationConfig: { temperature: 0.1 },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    let error: any = txt;
    try {
      const parsed = JSON.parse(txt);
      error = parsed.error || parsed;
    } catch {}
    throw Object.assign(new Error(error?.message || `HTTP ${resp.status}`), {
      status: resp.status,
      apiError: error,
    });
  }

  const json = await resp.json();
  const texts: string[] = [];
  if (Array.isArray(json.candidates)) {
    for (const cand of json.candidates) {
      const parts = cand?.content?.parts || cand?.parts || [];
      for (const p of parts) if (p.text) texts.push(p.text);
    }
  }

  return texts.join("\n").trim();
}
