CREATE TYPE "public"."message_channel" AS ENUM('email', 'sms', 'in_app');--> statement-breakpoint
ALTER TYPE "public"."file_storage_provider" ADD VALUE 's3';--> statement-breakpoint
ALTER TYPE "public"."file_storage_provider" ADD VALUE 'cos';--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(100) NOT NULL,
	"channel" "message_channel" NOT NULL,
	"subject" varchar(200),
	"content" text NOT NULL,
	"variables" text,
	"status" "status" DEFAULT 'active' NOT NULL,
	"remark" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "message_templates_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "s3_region" varchar(64);--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "s3_endpoint" varchar(256);--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "s3_bucket" varchar(128);--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "s3_access_key_id" varchar(128);--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "s3_secret_access_key" varchar(256);--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "s3_force_path_style" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "cos_region" varchar(64);--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "cos_bucket" varchar(128);--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "cos_secret_id" varchar(128);--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "cos_secret_key" varchar(256);