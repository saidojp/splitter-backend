# Receipt Splitter Backend

TypeScript + ESM Express API with Prisma, JWT auth, and Swagger docs.

## Features

- ESM everywhere (package.json "type": "module", TS "module": "NodeNext")
- Express 5, CORS, dotenv
- Prisma ORM (PostgreSQL)
- JWT auth middleware
- Swagger UI at /api-docs

## Requirements

- Node.js 18+
- PostgreSQL database

## Setup

1. Install deps

```bash
npm install
```

2. Configure environment

```bash
cp .env.example .env
# edit .env with your values
```

Variables:

- PORT: HTTP port (defaults to 3001 in code if not set)
- JWT_SECRET: secret for signing JWTs
- DATABASE_URL: Prisma connection string
- CORS_ORIGINS: список разрешенных источников через запятую, например "http://localhost:5173,http://localhost:3000"

3. Prisma

```bash
npx prisma generate
npx prisma migrate dev --name init
```

## Run

Two common ways:

- Dev (ts-node):

```bash
npm i -D ts-node
npx ts-node --esm src/server.ts
```

- Build then run:

```bash
npx tsc -p tsconfig.json
node dist/server.js
```

Endpoints:

- GET /health → { status: "ok" }
- Swagger UI → GET /api-docs
- Auth routes mounted at /auth

## Useful Prisma commands

```bash
npx prisma studio        # Open data browser
npx prisma db push       # Sync schema without migration
npx prisma migrate dev   # Create/apply migrations in dev
```

## Notes

- Using verbatimModuleSyntax: import types with `import type { ... } from "module"`.
- If you see module/type errors for swagger-jsdoc, install it:

```bash
npm i swagger-jsdoc
```

If type defs are missing, add a lightweight declaration file or use default import.

## License

MIT
