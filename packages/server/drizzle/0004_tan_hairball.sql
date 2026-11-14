CREATE TABLE "export_presets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "export_presets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(64) NOT NULL,
	"entity" varchar(128) NOT NULL,
	"format" "export_job_format" NOT NULL,
	"columns" jsonb,
	"query" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"cron" varchar(100),
	"next_run_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"last_job_id" integer,
	"last_error" text,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "export_presets" ADD CONSTRAINT "export_presets_last_job_id_export_jobs_id_fk" FOREIGN KEY ("last_job_id") REFERENCES "public"."export_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_presets" ADD CONSTRAINT "export_presets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_presets" ADD CONSTRAINT "export_presets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_presets" ADD CONSTRAINT "export_presets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "export_presets_due_idx" ON "export_presets" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "export_presets_owner_idx" ON "export_presets" USING btree ("created_by");