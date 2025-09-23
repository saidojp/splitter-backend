# Receipt Splitter Backend

TypeScript + ESM Express API with Prisma (PostgreSQL), JWT auth, and Swagger docs.

## Features

- ESM everywhere (`package.json` `type: module`, TS `module: NodeNext`)
- Express 5, CORS, dotenv
- Prisma ORM (PostgreSQL)
- JWT auth middleware + request logging for `/auth/*`
- Swagger UI at `/api-docs`

## Requirements

- Node.js 18+
- PostgreSQL database

## Setup

1. Install deps

```bash
npm install
```

Note: `postinstall` runs `prisma generate`.

2. Configure environment

```bash
cp .env.example .env
# edit .env with your values
```

Env variables (minimum):

- `DATABASE_URL` — Prisma connection string
- `JWT_SECRET` — secret for signing JWTs
- `PORT` — HTTP port (defaults to `3001`)
- `CORS_ORIGINS` — comma-separated allowlist for production (e.g. `http://localhost:5173,http://localhost:3000`)
- `ALLOW_ALL_CORS=1` — permissive mode (`Access-Control-Allow-Origin: *`, credentials disabled)
- `DEBUG_AUTH=1` — verbose JWT verification logs
- `DEFAULT_AVATAR_URL` — fallback avatar URL (optional)

3. Prisma (first time or after schema changes)

```bash
npx prisma generate
npx prisma migrate dev --name init
```

## Run

- Dev (ts-node loader via script):

```bash
npm start
```

- Alternative dev:

```bash
npx ts-node --esm src/server.ts
```

Swagger UI: `GET /api-docs`

Health check: `GET /health` → `{ "status": "ok" }`

Auth routes mounted at `/auth` (`/auth/register`, `/auth/login`, `/auth/me`).

### Docker

Build image:

```bash
docker build -t splitter-backend:latest .
```

Run container (map port and pass envs):

```bash
docker run --rm -p 3001:3001 \
	-e PORT=3001 \
	-e JWT_SECRET=devsecret \
	-e DATABASE_URL=postgresql://user:pass@host:5432/db \
	-e ALLOW_ALL_CORS=1 \
	--name splitter-backend splitter-backend:latest
```

Notes:

- Container listens on `3001` (see `EXPOSE 3001` in Dockerfile).
- Prisma client is generated at build time; ensure `DATABASE_URL` is set at runtime for DB access.
- For production CORS, set `CORS_ORIGINS` instead of `ALLOW_ALL_CORS`.

## Architecture quickly

- Entry: `src/server.ts` wires JSON, CORS, Swagger, routes: `/auth`, `/user`, `/friends`, `/groups`, `/sessions`, `/users`, plus global `errorHandler`.
- Data: `src/config/prisma.ts` exports a singleton `prisma` (`@prisma/client`).
- Schema: `prisma/schema.prisma` includes models `User`, `Friendship`, `Group`, `Session`, `ReceiptItem`, `ItemAssignment` and enums (`FriendshipStatus`, `GroupRole`, `SessionStatus`).
- Auth: `src/middleware/auth.ts` verifies Bearer JWT and sets `req.user = { id, email }`; enable extra logs with `DEBUG_AUTH=1`.
- Logging: `src/middleware/logAuth.ts` logs masked bodies for `/auth/*`.
- Swagger: config in `src/config/swagger.ts`; scans JSDoc on `src/routes/*.ts`.

## Conventions and patterns

- NodeNext ESM: include `.js` in import specifiers from TS (e.g., `import { errorHandler } from "./middleware/errorHandler.js"`).
- `tsconfig` uses `verbatimModuleSyntax:true`; prefer `import type` for types. Add `@types/node` if you need Node globals.
- Auth endpoints require `Content-Type: application/json` and validate/coerce basic types.
- Protected routes use `authenticateToken`; access user via `req.user.id` only after the middleware.
- Always avoid returning `password`. Use Prisma `select` on reads (see `routes/auth.ts`, `routes/user.ts`).
- Handle Prisma errors: `P2002` (unique constraint), `P2025` (record not found).
- CORS: `ALLOW_ALL_CORS=1` → `origin: "*"` (no credentials). Otherwise, non-production reflects any origin; production restricts to `CORS_ORIGINS` allowlist.

## Useful Prisma commands

```bash
npx prisma studio        # Open data browser
npx prisma db push       # Sync schema without migration
npx prisma migrate dev   # Create/apply migrations in dev
```

## Folder overview

- `src/server.ts` — app bootstrap and route mounting
- `src/config/*` — Prisma client, Swagger, app utilities
- `src/middleware/*` — `authenticateToken`, `errorHandler`, `logAuth`
- `src/routes/*` — route modules with Swagger JSDoc
- `prisma/schema.prisma` — data model

## Notes / pitfalls

- Missing `.js` in import paths will break at runtime under NodeNext.
- Missing `JWT_SECRET` or `DATABASE_URL` will prevent startup/auth.

## License

MIT
