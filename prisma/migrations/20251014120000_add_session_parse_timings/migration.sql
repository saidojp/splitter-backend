-- Add parsing timing fields to Session
ALTER TABLE "Session"
  ADD COLUMN "parseAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "parseRequestSentAt" TIMESTAMP(3),
  ADD COLUMN "parseResponseAt" TIMESTAMP(3),
  ADD COLUMN "parseResultReturnedAt" TIMESTAMP(3);

-- Optional: index on response time for later analytics
CREATE INDEX IF NOT EXISTS "Session_parseResponseAt_idx" ON "Session"("parseResponseAt");
