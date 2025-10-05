-- Add cached counts columns to ReceiptParse
ALTER TABLE "ReceiptParse" ADD COLUMN "linesCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ReceiptParse" ADD COLUMN "itemsCount" INTEGER NOT NULL DEFAULT 0;

-- Optional backfill logic (PostgreSQL) to populate existing parses
UPDATE "ReceiptParse" rp
SET "linesCount" = sub.total_lines,
    "itemsCount" = sub.item_lines
FROM (
  SELECT rl."receiptParseId" AS pid,
         COUNT(*) AS total_lines,
         COUNT(*) FILTER (WHERE rl."isItem" = true) AS item_lines
  FROM "ReceiptLine" rl
  GROUP BY rl."receiptParseId"
) sub
WHERE rp.id = sub.pid;
