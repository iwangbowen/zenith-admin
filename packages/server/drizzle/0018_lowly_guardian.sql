CREATE TYPE "public"."azure_cloud" AS ENUM('public', 'china', 'us-government');--> statement-breakpoint
ALTER TABLE "drive_upload_bindings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "drive_upload_bindings" CASCADE;--> statement-breakpoint
ALTER TABLE "file_storage_configs" ALTER COLUMN "azure_cloud" SET DEFAULT 'public'::"public"."azure_cloud";--> statement-breakpoint
ALTER TABLE "file_storage_configs" ALTER COLUMN "azure_cloud" SET DATA TYPE "public"."azure_cloud" USING "azure_cloud"::"public"."azure_cloud";--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD COLUMN "module" varchar(64);--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD COLUMN "visibility" "file_visibility" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD COLUMN "expected_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD COLUMN "compute_hash" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD COLUMN "skip_type_check" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "upload_sessions_module_status_idx" ON "upload_sessions" USING btree ("module","status");