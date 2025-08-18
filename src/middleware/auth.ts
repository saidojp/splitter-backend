import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface JwtPayload {
  id: number;
  email: string;
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

export function authenticateToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Требуется авторизация" });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({ error: "Неверный формат токена" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error("JWT_SECRET не задан в .env");
    }

    const decoded = jwt.verify(
      token,
      secret as string
    ) as unknown as JwtPayload;
    req.user = decoded;

    next();
  } catch (err) {
    console.error("JWT verify error:", err);
    return res.status(401).json({ error: "Неверный или просроченный токен" });
  }
}
