CREATE TABLE "report_share_access_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"share_id" integer NOT NULL,
	"dashboard_id" integer NOT NULL,
	"action" varchar(16) NOT NULL,
	"client_ip" varchar(64),
	"ok" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_alert_rules" ADD COLUMN "silence_mins" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "report_alert_rules" ADD COLUMN "notify_on_recover" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "report_alert_rules" ADD COLUMN "last_notified_at" timestamp;--> statement-breakpoint
ALTER TABLE "report_share_access_logs" ADD CONSTRAINT "report_share_access_logs_share_id_report_dashboard_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."report_dashboard_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_share_access_logs_share_idx" ON "report_share_access_logs" USING btree ("share_id");--> statement-breakpoint
CREATE INDEX "report_share_access_logs_created_idx" ON "report_share_access_logs" USING btree ("created_at");