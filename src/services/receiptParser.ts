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
const GEMINI_MODEL_PARSE = process.env.GEMINI_MODEL_PARSE || "gemini-1.5-flash";
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
    return mockParse();
  }
  try {
    const client = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = client.getGenerativeModel({ model: GEMINI_MODEL_PARSE });
    const start = Date.now();

    const prompt = `${EXTRACTION_INSTRUCTIONS}\nLanguage context of receipt: ${options.language}\nSession Name: ${options.sessionName}`;

    const imagePart = {
      inlineData: {
        data: options.imageBase64,
        mimeType: options.mimeType,
      },
    } as const;

    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();

    const parsed = safeParseJson(text);
    if (!parsed.ok || !parsed.data) {
      return {
        ...mockParse(),
        rawModelText: DEBUG_PARSE ? text : undefined,
      } as ParseResult;
    }
    const durationMs = Date.now() - start;
    return {
      ...parsed.data,
      model: GEMINI_MODEL_PARSE,
      durationMs,
      rawModelText: DEBUG_PARSE ? text : undefined,
    } as ParseResult;
  } catch (err) {
    if (DEBUG_PARSE) console.error("Gemini parse error", err);
    return mockParse();
  }
}
