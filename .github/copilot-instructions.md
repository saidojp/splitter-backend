# splitter-backend — AI coding agent instructions

Purpose: Help agents quickly understand structure, conventions, and workflows in this repository to implement features safely and productively.

## Big picture
- Stack: TypeScript (ESM, NodeNext) + Express 5 + Prisma (PostgreSQL) + JWT auth + Swagger UI.
- Entry point: `src/server.ts` — wires middleware (JSON, CORS), Swagger at `/api-docs`, routes (`/auth`, `/user`, `/friends`, `/groups`, `/sessions`, `/users`), health at `/health`, and global `errorHandler`.
- Data layer: `@prisma/client` via `src/config/prisma.ts` (singleton `prisma`). Schema in `prisma/schema.prisma` defines `User`, `Friendship`, `Group`, `Session`, `ReceiptItem`, `ItemAssignment` + enums.
- Auth: `src/middleware/auth.ts` verifies Bearer JWT, augments `req.user` with `{ id:number; email:string }`, and has verbose debug when `DEBUG_AUTH` is enabled.
- Observability: `src/middleware/logAuth.ts` logs masked bodies for `/auth/*` requests; global error handler returns consistent JSON.

## How to run (macOS, Node 18+)
- Install: `npm install` (also runs `prisma generate`).
- Env: copy `.env.example` (if present) → `.env`, set: `DATABASE_URL`, `JWT_SECRET`, optional `PORT`, `CORS_ORIGINS` (comma list) or `ALLOW_ALL_CORS=1`, `DEBUG_AUTH=1` for verbose JWT logs, `DEFAULT_AVATAR_URL` fallback.
- Dev: `npm start` (ts-node ESM) or `npx ts-node --esm src/server.ts`.
- DB: `npx prisma migrate dev --name <msg>`, inspect data with `npx prisma studio`.

## Conventions and patterns
- ESM + NodeNext imports: always include file extension `.js` in import specifiers from TS sources (e.g., `import { errorHandler } from "./middleware/errorHandler.js"`). Omitting `.js` will break at runtime.
- Types first: `tsconfig` uses `verbatimModuleSyntax:true` and strict mode. Prefer `import type ...` for types. Node types are not configured by default; add `@types/node` and tsconfig types if you need Node globals.
- Route modules (`src/routes/*.ts`): export a default `Router`; annotate with Swagger JSDoc. Swagger scans `./src/routes/*.ts`, so keep annotations close to handlers.
  - Public endpoints (e.g., `/auth/register`, `/auth/login`) explicitly opt out of security in Swagger: `security: []`.
  - Protected endpoints use `authenticateToken` and may use `type AuthRequest = Request & { user?: JwtPayload }` for typing (see `auth.ts`, `user.ts`). Access user via `req.user!.id` only after the middleware.
- Error handling: return JSON with `{ error: string }` on validation/auth failures (see `auth.ts`, `user.ts`). For thrown errors, prefer `next(err)`; the global `errorHandler` formats as `{ success:false, error, code }`.
- Prisma usage:
  - Import `prisma` from `src/config/prisma.ts` (single client). Avoid creating new `PrismaClient` instances.
  - Use `select` to avoid leaking `password` (e.g., `select: { id, email, username, uniqueId }`).
  - Handle known codes: `P2002` (unique constraint), `P2025` (record not found) — see `auth.ts` and `user.ts` for examples.
- CORS policy (`src/server.ts`):
  - `ALLOW_ALL_CORS=1` → permissive `origin:"*"` (credentials=false).
  - Otherwise in non-production: reflect any origin; in production: only allow origins in `CORS_ORIGINS` allowlist.
- IDs and formatting: `auth/register` generates a user `uniqueId` like `#1234` with collision retries.
- Defaults/utilities: `getDefaultAvatarUrl()` in `src/config/app.ts` provides a consistent avatar placeholder.

## Adding features safely (examples)
- Protect a new route: `router.get("/secure", authenticateToken, (req: AuthRequest, res) => { /* use req.user.id */ });`
- Swagger for a protected handler: add `@swagger` block with `security: - bearerAuth: []` and tag under an existing group (e.g., `User`, `Auth`) or create a new tag.
- Return shapes: never include `password`; prefer `{ id, email, username, uniqueId }` for `User` response bodies.

## Mount points and cross-module contracts
- `src/server.ts` mounts: `/auth` (with `logAuthAttempts`), `/user`, `/friends`, `/groups`, `/sessions`, `/users`; health at `/health`; Swagger UI at `/api-docs` using `src/config/swagger.ts`.
- Middleware contract: `authenticateToken` populates `req.user` or sends a `401`. Do not assume `req.user` exists without the middleware.

## Common pitfalls
- Missing `.js` in import paths with NodeNext ESM.
- Missing `JWT_SECRET` or `DATABASE_URL` → startup/auth errors.
- Wrong `Content-Type`: auth endpoints expect `application/json` and enforce it.

If anything here seems off or incomplete for your task (e.g., details for `friends/groups/sessions` routes), ask to refine this guide and we’ll update it.