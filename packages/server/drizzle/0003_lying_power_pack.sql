CREATE TABLE "analytics_saved_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"name" varchar(128) NOT NULL,
	"report_type" varchar(32) DEFAULT 'funnel' NOT NULL,
	"config" jsonb NOT NULL,
	"created_by" integer,
	"created_by_name" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_saved_reports" ADD CONSTRAINT "analytics_saved_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_saved_reports_tenant_idx" ON "analytics_saved_reports" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "analytics_saved_reports_type_idx" ON "analytics_saved_reports" USING btree ("report_type");