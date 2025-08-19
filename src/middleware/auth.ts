import type { Request, Response, NextFunction } from "express";
import jwt, { type JwtPayload as LibJwtPayload } from "jsonwebtoken";

export interface JwtPayload {
  id: number;
  email: string;
  // optional fields from JWT standard
  iat?: number;
  exp?: number;
}

// Augment Express Request globally so req.user exists everywhere
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export interface AuthRequest extends Request {}

export function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const raw = req.headers["authorization"];
    if (typeof raw !== "string") {
      return res.status(401).json({ error: "Требуется авторизация" });
    }

    const [scheme, token] = raw.split(" ");
    if (!token || (scheme ?? "").toLowerCase() !== "bearer") {
      return res.status(401).json({ error: "Неверный формат токена" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error("JWT_SECRET не задан в .env");
    }

    const verified = jwt.verify(token, secret as string);
    const payload:
      | JwtPayload
      | (LibJwtPayload & { id?: unknown; email?: unknown }) =
      typeof verified === "string" ? ({} as any) : (verified as any);

    if (
      !payload ||
      typeof payload.id !== "number" ||
      typeof payload.email !== "string"
    ) {
      return res.status(401).json({ error: "Неверный токен" });
    }

    const userPayload: JwtPayload = { id: payload.id, email: payload.email };
    if (typeof payload.iat === "number") userPayload.iat = payload.iat;
    if (typeof payload.exp === "number") userPayload.exp = payload.exp;
    req.user = userPayload;
    next();
  } catch (err) {
    console.error("JWT verify error:", err);
    return res.status(401).json({ error: "Неверный или просроченный токен" });
  }
}
