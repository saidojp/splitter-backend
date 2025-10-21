-- CreateTable
CREATE TABLE "public"."SessionHistoryEntry" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "creatorId" INTEGER NOT NULL,
    "sessionName" TEXT,
    "payload" JSONB NOT NULL,
    "participantUniqueIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "grandTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionHistoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionHistoryEntry_sessionId_key" ON "public"."SessionHistoryEntry"("sessionId");

-- CreateIndex
CREATE INDEX "SessionHistoryEntry_creatorId_idx" ON "public"."SessionHistoryEntry"("creatorId");

-- CreateIndex
CREATE INDEX "SessionHistoryEntry_participantUniqueIds_idx" ON "public"."SessionHistoryEntry" USING GIN ("participantUniqueIds");

-- AddForeignKey
ALTER TABLE "public"."SessionHistoryEntry" ADD CONSTRAINT "SessionHistoryEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SessionHistoryEntry" ADD CONSTRAINT "SessionHistoryEntry_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
