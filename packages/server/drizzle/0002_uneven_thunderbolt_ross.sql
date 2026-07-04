CREATE TABLE "error_alert_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"rule_id" integer,
	"rule_name" varchar(128) NOT NULL,
	"condition" "error_alert_condition" NOT NULL,
	"detail" text NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" varchar(16) DEFAULT 'cron' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "error_alert_logs" ADD CONSTRAINT "error_alert_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_alert_logs" ADD CONSTRAINT "error_alert_logs_rule_id_error_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."error_alert_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "error_alert_logs_created_idx" ON "error_alert_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "error_alert_logs_rule_idx" ON "error_alert_logs" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "error_alert_logs_tenant_idx" ON "error_alert_logs" USING btree ("tenant_id");