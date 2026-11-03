ALTER TABLE "api_access_logs" ADD COLUMN "accessor_id" varchar(128);--> statement-breakpoint
ALTER TABLE "api_access_logs" ADD COLUMN "accessor_name" varchar(64);--> statement-breakpoint
ALTER TABLE "api_access_logs" ADD COLUMN "accessor_type" varchar(24) DEFAULT 'anonymous' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_access_logs" ADD COLUMN "device_id" integer;--> statement-breakpoint
ALTER TABLE "api_access_logs" ADD COLUMN "credential_type" varchar(32) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_access_logs" DROP COLUMN "username";--> statement-breakpoint
ALTER TABLE "api_access_logs" DROP COLUMN "principal_type";--> statement-breakpoint
ALTER TABLE "api_access_logs" DROP COLUMN "auth_type";