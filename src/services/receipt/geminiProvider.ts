// Using global fetch (Node 18+)

export interface GeminiItemRaw {
  descriptionOriginal: string;
  quantity?: number;
  unitPrice?: string;
  lineTotal?: string;
  currency?: string;
}

export interface GeminiParseResult {
  detectedLanguage?: string;
  currency?: string;
  items: GeminiItemRaw[];
  subtotal?: string;
  tax?: string;
  total?: string;
  warnings?: string[];
  rawJson: any;
  rawTextCombined?: string;
}

const DEFAULT_PARSE_MODEL =
  process.env.GEMINI_MODEL_PARSE || "gemini-1.5-flash";
const DEFAULT_TRANSLATE_MODEL =
  process.env.GEMINI_MODEL_TRANSLATE || DEFAULT_PARSE_MODEL;

function buildParsePrompt(targetLangHint?: string, receiptLangHint?: string) {
  return `You are a strict JSON receipt parser.\nTasks:\n1. Extract items exactly as written (do NOT translate).\n2. Provide detected_language (ISO 639-1 guess).\n3. Each item: descriptionOriginal, quantity (infer or 1), unitPrice (string 2 decimals if price seen), lineTotal (string 2 decimals).\n4. Provide currency (ISO 4217 if visible).\n5. Provide subtotal, tax, total if present.\n6. Provide warnings[] for anomalies.\n7. Return ONLY valid JSON.\n${
    receiptLangHint ? `Possible receipt language hint: ${receiptLangHint}` : ""
  }\n${
    targetLangHint
      ? `User interface target language (for later translation): ${targetLangHint}`
      : ""
  }\nJSON schema: {\n  \"detected_language\": \"en\",\n  \"currency\": \"USD\",\n  \"items\": [ { \"descriptionOriginal\": \"Coca-Cola 0.5L\", \"quantity\": 2, \"unitPrice\": \"1.50\", \"lineTotal\": \"3.00\" } ],\n  \"subtotal\": \"3.00\",\n  \"tax\": \"0.24\",\n  \"total\": \"3.24\",\n  \"warnings\": []\n}`;
}

function buildTranslatePrompt(targetLang: string, items: string[]) {
  return `Translate each receipt item description into language: ${targetLang}.\nRules:\n- Preserve brand names.\n- Keep units and numbers.\n- Return ONLY JSON array of translated strings, same order and length.\nInput: ${JSON.stringify(
    items
  )}\nOutput example: [\"Item A\", \"Item B\"]`;
}

async function callGeminiRaw(model: string, prompt: string, imageUrl?: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");

  // Using Google Generative Language API (text-only for now). For image we would need multipart; placeholder.
  const endpoint = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;
  const parts: any[] = [{ text: prompt }];
  if (imageUrl) {
    // NOTE: For actual image support with Gemini multimodal, you'd send inlineData or file reference.
    parts.push({ text: `IMAGE_URL: ${imageUrl}` });
  }
  const body = { contents: [{ parts }] };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${t}`);
  }
  const json = await res.json();
  const text =
    json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("\n") ||
    "";
  return { raw: json, text };
}

function extractJson(text: string): any {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1) throw new Error("No JSON braces found");
  const slice = text.substring(first, last + 1);
  return JSON.parse(slice);
}

export async function parseReceiptWithGemini(
  imageUrl: string,
  targetLang?: string,
  receiptLangHint?: string
): Promise<GeminiParseResult> {
  const prompt =
    buildParsePrompt(targetLang, receiptLangHint) + `\nIMAGE: ${imageUrl}`;
  const { raw, text } = await callGeminiRaw(
    DEFAULT_PARSE_MODEL,
    prompt,
    imageUrl
  );
  let data: any;
  try {
    data = extractJson(text);
  } catch (e) {
    // retry once with stricter instruction
    const retryPrompt = prompt + "\nREMINDER: Return ONLY JSON.";
    const retry = await callGeminiRaw(
      DEFAULT_PARSE_MODEL,
      retryPrompt,
      imageUrl
    );
    data = extractJson(retry.text);
  }

  const items: GeminiItemRaw[] = Array.isArray(data.items)
    ? data.items
        .filter((i: any) => i && i.descriptionOriginal)
        .map((i: any) => ({
          descriptionOriginal: String(i.descriptionOriginal),
          quantity: Number(i.quantity || 1),
          unitPrice: i.unitPrice ? String(i.unitPrice) : undefined,
          lineTotal: i.lineTotal ? String(i.lineTotal) : undefined,
          currency: i.currency ? String(i.currency) : undefined,
        }))
    : [];
  return {
    detectedLanguage: data.detected_language,
    currency: data.currency,
    subtotal: data.subtotal,
    tax: data.tax,
    total: data.total,
    warnings: data.warnings || [],
    items,
    rawJson: data,
    rawTextCombined: text,
  };
}

export async function translateDescriptionsWithGemini(
  targetLang: string,
  originals: string[]
): Promise<{ translations: string[] }> {
  const prompt = buildTranslatePrompt(targetLang, originals);
  const { text } = await callGeminiRaw(DEFAULT_TRANSLATE_MODEL, prompt);
  // Expect JSON array
  const first = text.indexOf("[");
  const last = text.lastIndexOf("]");
  if (first === -1 || last === -1)
    throw new Error("No JSON array in translation output");
  const arr = JSON.parse(text.substring(first, last + 1));
  if (!Array.isArray(arr) || arr.length !== originals.length) {
    throw new Error("Translation array length mismatch");
  }
  return { translations: arr.map(String) };
}
