ALTER TABLE "ip_access_logs" ADD COLUMN "matched_entry" varchar(64);--> statement-breakpoint
ALTER TABLE "ip_access_logs" ADD COLUMN "policy_version" integer;--> statement-breakpoint
ALTER TABLE "ip_access_logs" ADD COLUMN "correlation_id" varchar(64);