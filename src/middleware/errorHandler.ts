import type { Request, Response, NextFunction } from "express";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const status =
    (typeof err === "object" && err && (err as any).statusCode) ||
    (typeof err === "object" && err && (err as any).status) ||
    500;

  const message =
    typeof err === "object" && err && (err as any).message
      ? String((err as any).message)
      : "Internal Server Error";

  if (status >= 500) {
    // Log server errors with stack when available
    // eslint-disable-next-line no-console
    console.error("Unhandled error:", err);
  }

  return res.status(Number(status)).json({
    success: false,
    error: message,
    code: Number(status),
  });
}
