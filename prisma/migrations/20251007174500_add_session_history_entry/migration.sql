-- Create table for finalized session snapshots
CREATE TABLE "SessionHistoryEntry" (
  "id" SERIAL PRIMARY KEY,
  "sessionId" INTEGER NOT NULL UNIQUE REFERENCES "Session"("id") ON DELETE CASCADE,
  "sessionName" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "status" TEXT NOT NULL,
  "ownerUserId" INTEGER REFERENCES "User"("id") ON DELETE SET NULL,
  "ownerUniqueId" TEXT,
  "ownerUsername" TEXT,
  "participantUniqueIds" TEXT[] NOT NULL,
  "participants" JSONB NOT NULL,
  "allocations" JSONB NOT NULL,
  "totals" JSONB NOT NULL
);

CREATE INDEX "SessionHistoryEntry_ownerUserId_idx" ON "SessionHistoryEntry" ("ownerUserId");
CREATE INDEX "SessionHistoryEntry_status_idx" ON "SessionHistoryEntry" ("status");
CREATE INDEX "SessionHistoryEntry_createdAt_idx" ON "SessionHistoryEntry" ("createdAt");
-- GIN index for array membership queries by participant uniqueId
CREATE INDEX "SessionHistoryEntry_participantUniqueIds_idx" ON "SessionHistoryEntry" USING GIN ("participantUniqueIds");