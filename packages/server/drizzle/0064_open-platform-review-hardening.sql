CREATE TABLE "open_quota_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"dimension" varchar(20) NOT NULL,
	"period" varchar(16) NOT NULL,
	"threshold" integer NOT NULL,
	"used" bigint NOT NULL,
	"quota_limit" bigint NOT NULL,
	"plan_code" varchar(64) NOT NULL,
	"event_id" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "open_quota_alerts_dedupe_unique" UNIQUE("client_id","dimension","period","threshold")
);
--> statement-breakpoint
ALTER TABLE "oauth2_tokens" ADD COLUMN "family_id" varchar(64);--> statement-breakpoint
CREATE INDEX "open_quota_alerts_status_idx" ON "open_quota_alerts" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "oauth2_tokens_family_idx" ON "oauth2_tokens" USING btree ("family_id");--> statement-breakpoint
ALTER TABLE "app_webhook_deliveries" ADD CONSTRAINT "app_webhook_deliveries_subscription_event_unique" UNIQUE("subscription_id","event_id");