import type { Request, Response, NextFunction } from "express";

function maskSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSecrets);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (k.toLowerCase() === "password") out[k] = "***";
      else out[k] = maskSecrets(v);
    }
    return out;
  }
  return value;
}

export function logAuthAttempts(req: Request, _res: Response, next: NextFunction) {
  try {
    const ts = new Date().toISOString();
    const method = req.method;
    const url = req.originalUrl || req.url;
    const ip = req.ip;
    const ua = String(req.headers["user-agent"] || "");
    const maskedBody = maskSecrets(req.body);
    const bodyStr = (() => {
      try {
        return JSON.stringify(maskedBody);
      } catch {
        return "<unserializable>";
      }
    })();

    // eslint-disable-next-line no-console
    console.log(
      `[AUTH_ATTEMPT] ${ts} | method: ${method} | url: ${url} | ip: ${ip} | user-agent: ${ua} | body: ${bodyStr}`
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[AUTH_ATTEMPT] logger error:", e);
  }
  next();
}
