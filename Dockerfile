## Multi-stage Dockerfile for splitter-backend (NodeNext ESM + Prisma)

### Stage 1: build
FROM node:18-bullseye-slim AS builder
WORKDIR /app

# Install deps with caching
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source
COPY . .

# Generate Prisma client (no DB needed for generate)
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Prune dev deps
RUN npm prune --production

### Stage 2: runtime
FROM node:18-bullseye-slim
WORKDIR /app
ENV NODE_ENV=production

# Copy production deps and built artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/package*.json ./

# The app defaults to port 3001
EXPOSE 3001

# Start the server
CMD ["node", "dist/server.js"]
