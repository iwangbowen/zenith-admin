CREATE TABLE "open_api_call_stats_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"stat_date" date NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"app_name" varchar(100),
	"path" varchar(256) NOT NULL,
	"total_calls" bigint DEFAULT 0 NOT NULL,
	"success_calls" bigint DEFAULT 0 NOT NULL,
	"failed_calls" bigint DEFAULT 0 NOT NULL,
	"duration_sum_ms" bigint DEFAULT 0 NOT NULL,
	"max_duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "open_api_call_stats_daily_unique" UNIQUE("stat_date","client_id","path")
);
--> statement-breakpoint
ALTER TABLE "oauth2_authorization_codes" DROP CONSTRAINT "oauth2_authorization_codes_code_unique";--> statement-breakpoint
ALTER TABLE "oauth2_authorization_codes" ADD COLUMN "code_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "oauth2_clients" ADD COLUMN "ip_allowlist" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX "open_api_call_stats_daily_date_idx" ON "open_api_call_stats_daily" USING btree ("stat_date");--> statement-breakpoint
CREATE INDEX "open_api_call_stats_daily_client_idx" ON "open_api_call_stats_daily" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "oauth2_authorization_codes" DROP COLUMN "code";--> statement-breakpoint
ALTER TABLE "oauth2_authorization_codes" ADD CONSTRAINT "oauth2_authorization_codes_code_hash_unique" UNIQUE("code_hash");