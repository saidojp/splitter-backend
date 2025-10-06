import type { Readable } from "node:stream";
import { GoogleGenerativeAI } from "@google/generative-ai";

/** Shape returned to the route */
export interface ParsedReceiptItem {
  id: string; // stable within this response (not DB id)
  name: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number; // unitPrice * quantity (model can supply; we'll verify)
  kind?: string | null; // e.g. fee/tip/discount
}

export interface ParseResult {
  items: ParsedReceiptItem[];
  summary: { grandTotal: number };
  rawModelText?: string | undefined; // for debugging (only when DEBUG_PARSE=1)
  model?: string | undefined; // which model was used
  durationMs?: number | undefined;
  source: "gemini" | "mock";
}

export interface ParseOptions {
  language: string; // BCP-47 like ru-RU, en-US
  sessionName: string;
  mimeType: string;
  imageBase64: string; // no data: prefix, raw base64
}

// Environment-driven configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION || "v1";
const GEMINI_MODEL_PARSE = process.env.GEMINI_MODEL_PARSE || "gemini-1.5-flash";
const GEMINI_MODEL_FALLBACKS = (process.env.GEMINI_MODEL_FALLBACKS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const MODEL_CANDIDATES = Array.from(
  new Set([
    GEMINI_MODEL_PARSE,
    ...GEMINI_MODEL_FALLBACKS,
    // existing fallbacks
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash-001",
    "gemini-1.5-pro",
    "gemini-1.5-pro-latest",
    // legacy / vision capable older names that might still be enabled
    "gemini-pro-vision",
    "gemini-1.0-pro-vision-latest",
    "gemini-pro",
    "gemini-1.0-pro-latest",
  ])
);
const DEBUG_PARSE = process.env.DEBUG_PARSE === "1";

// Extraction JSON schema instruction (lightweight, we rely on LLM following examples)
const EXTRACTION_INSTRUCTIONS = `You are a receipt parser. Return ONLY valid JSON with this shape:
{
  "items": [
    { "id": "string", "name": "string", "unitPrice": number, "quantity": number, "totalPrice": number, "kind": "fee|tip|discount|item|other|null" }
  ],
  "summary": { "grandTotal": number }
}
Rules:
- Numbers must use dot as decimal separator.
- id: generate short stable IDs like "1", "2"... or semantic (e.g. FEE1) unique within list.
- quantity >= 1.
- totalPrice = unitPrice * quantity (round to 2 decimals).
- Include service/tips/fees as separate items with kind set.
- If currency symbol present ignore it (store numeric only).
- grandTotal = sum of item totalPrice values (after any discounts).`;

function safeParseJson(text: string): { ok: boolean; data?: ParseResult } {
  try {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1) return { ok: false };
    const jsonSlice = text.slice(firstBrace, lastBrace + 1);
    const raw = JSON.parse(jsonSlice);
    if (!raw || typeof raw !== "object") return { ok: false };
    if (!Array.isArray(raw.items) || !raw.summary) return { ok: false };
    // Basic normalization
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
      items.reduce((s, i) => s + (Number(i.totalPrice) || 0), 0)
    );
    return {
      ok: true,
      data: { items, summary: { grandTotal }, source: "gemini" } as ParseResult,
    };
  } catch {
    return { ok: false };
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Fallback deterministic mock when API key missing or parse fails */
function mockParse(): ParseResult {
  const items: ParsedReceiptItem[] = [
    {
      id: "1001",
      name: "Кола 0.5L",
      unitPrice: 2.0,
      quantity: 6,
      totalPrice: 12.0,
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

export async function parseReceipt(
  options: ParseOptions
): Promise<ParseResult> {
  if (!GEMINI_API_KEY) {
    if (DEBUG_PARSE)
      console.warn("[parseReceipt] Using mock: GEMINI_API_KEY not set");
    return mockParse();
  }

  if (DEBUG_PARSE && !/^AIza[0-9A-Za-z_-]{10,}$/.test(GEMINI_API_KEY)) {
    console.warn(
      "[parseReceipt] GEMINI_API_KEY format unexpected (should usually start with 'AIza')."
    );
  }
  if (DEBUG_PARSE) {
    console.log(
      `[parseReceipt] REST mode; preferred version=${GEMINI_API_VERSION}; candidates=${MODEL_CANDIDATES.join(
        ","
      )}`
    );
  }
  const prompt = `${EXTRACTION_INSTRUCTIONS}\nLanguage context of receipt: ${options.language}\nSession Name: ${options.sessionName}`;
  const imagePart = {
    inlineData: {
      data: options.imageBase64,
      mimeType: options.mimeType,
    },
  } as const;

  let lastError: unknown = null;
  for (const modelName of MODEL_CANDIDATES) {
    const start = Date.now();
    try {
      if (DEBUG_PARSE) console.log(`[parseReceipt] Trying model: ${modelName}`);
      const text = await generateViaRest(
        modelName,
        prompt,
        imagePart.inlineData.data,
        imagePart.inlineData.mimeType
      );
      const parsed = safeParseJson(text);
      if (!parsed.ok || !parsed.data) {
        if (DEBUG_PARSE) {
          console.warn(
            `[parseReceipt] Model ${modelName} returned non-parseable JSON, length=${text.length}. Snippet=`,
            text.slice(0, 280)
          );
        }
        continue; // try next model
      }
      const durationMs = Date.now() - start;
      return {
        ...parsed.data,
        model: modelName,
        durationMs,
        rawModelText: DEBUG_PARSE ? text : undefined,
      } as ParseResult;
    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.statusCode;
      if (DEBUG_PARSE)
        console.warn(
          `[parseReceipt] Error with model ${modelName} (status=${status}) → ${
            err?.message || err
          }`
        );
      // For 404 continue; for 403/429 also continue to allow a fallback.
      continue;
    }
  }
  if (DEBUG_PARSE)
    console.error(
      "[parseReceipt] All model attempts failed, returning mock. Last error:",
      lastError
    );
  return mockParse();
}

async function generateViaRest(
  model: string,
  prompt: string,
  base64: string,
  mime: string
): Promise<string> {
  const order =
    GEMINI_API_VERSION === "v1beta" ? ["v1beta", "v1"] : ["v1", "v1beta"];
  let lastErr: any = null;
  for (const ver of order) {
    const url = `https://generativelanguage.googleapis.com/${ver}/models/${model}:generateContent?key=${encodeURIComponent(
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
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        if (DEBUG_PARSE)
          console.warn(
            `[generateViaRest] ${ver} ${model} -> HTTP ${resp.status} ${resp.statusText}`
          );
        lastErr = Object.assign(new Error("HTTP " + resp.status), {
          status: resp.status,
        });
        continue;
      }
      const json = await resp.json();
      const texts: string[] = [];
      if (Array.isArray(json.candidates)) {
        for (const cand of json.candidates) {
          const parts = cand?.content?.parts || cand?.parts || [];
          for (const p of parts) if (p.text) texts.push(p.text);
        }
      }
      const combined = texts.join("\n").trim();
      if (DEBUG_PARSE)
        console.log(
          `[generateViaRest] success via ${ver} model=${model} chars=${combined.length}`
        );
      return combined;
    } catch (e) {
      lastErr = e;
      if (DEBUG_PARSE)
        console.warn(`[generateViaRest] Error calling ${ver} ${model}:`, e);
      continue;
    }
  }
  throw lastErr || new Error("All versions failed");
}
