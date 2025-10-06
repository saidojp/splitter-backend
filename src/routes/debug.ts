import { Router } from "express";

const router = Router();

/**
 * Simple Gemini probe endpoint.
 * Returns:
 *  - keyPresent: whether GEMINI_API_KEY env var is set
 *  - keyFormatValid: heuristic check (starts with AIza)
 *  - testModel: first model we tried
 *  - attempt: HTTP status / error body from a minimal generateContent call (no image)
 */
router.get("/gemini", async (req, res) => {
  const key = process.env.GEMINI_API_KEY;
  const testModel = (
    process.env.GEMINI_MODEL_PARSE || "gemini-1.5-flash"
  ).trim();
  if (!key) {
    return res.json({
      keyPresent: false,
      message: "GEMINI_API_KEY not set in env",
    });
  }
  const keyFormatValid = /^AIza[0-9A-Za-z_-]{10,}$/.test(key);
  const url = `https://generativelanguage.googleapis.com/v1/models/${testModel}:generateContent?key=${encodeURIComponent(
    key
  )}`;
  let attempt: any = {};
  try {
    const body = {
      contents: [
        {
          role: "user",
          parts: [{ text: "Respond with a single word: ok" }],
        },
      ],
      generationConfig: { temperature: 0 },
    };
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    attempt.httpStatus = resp.status;
    attempt.ok = resp.ok;
    const text = await resp.text();
    try {
      attempt.body = JSON.parse(text);
    } catch {
      attempt.body = text.slice(0, 500);
    }
  } catch (e: any) {
    attempt.error = e?.message || String(e);
  }
  res.json({ keyPresent: true, keyFormatValid, testModel, attempt });
});

export default router;
