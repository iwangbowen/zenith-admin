CREATE TYPE "public"."file_access_strategy" AS ENUM('proxy', 'presigned', 'public-object', 'public-bucket', 'public-domain');--> statement-breakpoint
CREATE TYPE "public"."file_bucket_acl" AS ENUM('private', 'public-read', 'public-read-write');--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "access_strategy" "file_access_strategy" DEFAULT 'proxy' NOT NULL;--> statement-breakpoint
UPDATE "file_storage_configs"
SET "access_strategy" = CASE "url_strategy"
  WHEN 'public' THEN 'public-object'::"file_access_strategy"
  WHEN 'presigned' THEN 'presigned'::"file_access_strategy"
  ELSE 'proxy'::"file_access_strategy"
END;--> statement-breakpoint
ALTER TABLE "file_storage_configs" DROP COLUMN "url_strategy";--> statement-breakpoint
DROP TYPE "public"."file_url_strategy";--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "bucket_acl" "file_bucket_acl";--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "bucket_block_public_access" boolean;--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "bucket_access_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "bucket_access_error" text;--> statement-breakpoint
ALTER TABLE "managed_files" ADD COLUMN "public_access" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "managed_files" ADD COLUMN "access_strategy" "file_access_strategy";--> statement-breakpoint
UPDATE "managed_files" SET "public_access" = true WHERE "object_acl" IN ('public-read', 'public-read-write');--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD COLUMN "public_access" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD COLUMN "access_strategy" "file_access_strategy";--> statement-breakpoint
UPDATE "upload_sessions" SET "public_access" = true WHERE "object_acl" IN ('public-read', 'public-read-write');
