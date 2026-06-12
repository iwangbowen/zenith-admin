ALTER TABLE "terminal_recordings" ADD COLUMN "size_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- 回填历史录屏的字节大小（以 events JSON 文本长度估算），便于容量统计与自动清理
UPDATE "terminal_recordings" SET "size_bytes" = length("events"::text) WHERE "size_bytes" = 0;
