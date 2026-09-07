CREATE TYPE "public"."file_gc_state" AS ENUM('live', 'orphan', 'deleting');--> statement-breakpoint
ALTER TYPE "public"."drive_activity_action" ADD VALUE 'collect_upload' BEFORE 'permission_change';--> statement-breakpoint
ALTER TABLE "managed_files" ADD COLUMN "gc_state" "file_gc_state" DEFAULT 'live' NOT NULL;--> statement-breakpoint
UPDATE "managed_files" SET "gc_state" = 'orphan', "orphaned_at" = now()
WHERE "visibility" = 'restricted' AND "ref_count" = 0;