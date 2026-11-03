ALTER TABLE "api_access_logs" ADD COLUMN "member_id" integer;--> statement-breakpoint
ALTER TABLE "api_access_logs" ADD COLUMN "client_id" varchar(64);