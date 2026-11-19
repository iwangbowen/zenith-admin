CREATE TYPE "public"."file_upload_mode" AS ENUM('server-proxy', 'browser-direct');--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "upload_mode" "file_upload_mode" DEFAULT 'server-proxy' NOT NULL;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD COLUMN "upload_mode" "file_upload_mode" DEFAULT 'server-proxy' NOT NULL;