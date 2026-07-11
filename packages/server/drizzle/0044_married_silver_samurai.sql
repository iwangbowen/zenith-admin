CREATE TABLE "analytics_sites" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"site_key" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"app_id" varchar(50) NOT NULL,
	"allowed_origins" jsonb,
	"daily_event_quota" integer,
	"status" "analytics_event_override_status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(500),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_sites" ADD CONSTRAINT "analytics_sites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_sites" ADD CONSTRAINT "analytics_sites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_sites" ADD CONSTRAINT "analytics_sites_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_sites_site_key_uq" ON "analytics_sites" USING btree ("site_key");--> statement-breakpoint
CREATE INDEX "analytics_sites_tenant_idx" ON "analytics_sites" USING btree ("tenant_id");