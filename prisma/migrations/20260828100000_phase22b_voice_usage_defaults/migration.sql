-- Backfill any existing NULL usage figures before enforcing NOT NULL (a fresh database has no
-- rows here yet; this only matters when applying on top of already-running Phase 22 data).
UPDATE "VoiceCall" SET "aiModelTokensUsed" = 0 WHERE "aiModelTokensUsed" IS NULL;
UPDATE "VoiceCall" SET "sttSecondsUsed" = 0 WHERE "sttSecondsUsed" IS NULL;
UPDATE "VoiceCall" SET "ttsCharactersUsed" = 0 WHERE "ttsCharactersUsed" IS NULL;

-- AlterTable
ALTER TABLE "VoiceCall" ALTER COLUMN "aiModelTokensUsed" SET NOT NULL,
ALTER COLUMN "aiModelTokensUsed" SET DEFAULT 0,
ALTER COLUMN "sttSecondsUsed" SET NOT NULL,
ALTER COLUMN "sttSecondsUsed" SET DEFAULT 0,
ALTER COLUMN "ttsCharactersUsed" SET NOT NULL,
ALTER COLUMN "ttsCharactersUsed" SET DEFAULT 0;

