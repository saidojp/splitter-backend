import type { Request } from "express";

// Standard password policy: min 8, uppercase, lowercase, number, special char
export function isStrongPassword(pw: string): boolean {
  if (typeof pw !== "string") return false;
  if (pw.length < 8) return false;
  const hasUpper = /[A-Z]/.test(pw);
  const hasLower = /[a-z]/.test(pw);
  const hasDigit = /\d/.test(pw);
  const hasSpecial = /[^A-Za-z0-9]/.test(pw);
  return hasUpper && hasLower && hasDigit && hasSpecial;
}

export const PASSWORD_POLICY_MESSAGE =
  "Password must be at least 8 characters and include uppercase, lowercase, number, and special character";

export function hasJsonContentType(req: Request): boolean {
  const ct = String(req.headers["content-type"] || "");
  return ct.includes("application/json");
}
