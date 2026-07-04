CREATE TABLE "payment_report_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"stat_date" varchar(10) NOT NULL,
	"channel" varchar(16) DEFAULT '' NOT NULL,
	"biz_type" varchar(64) DEFAULT '' NOT NULL,
	"gross" integer DEFAULT 0 NOT NULL,
	"fee" integer DEFAULT 0 NOT NULL,
	"refund" integer DEFAULT 0 NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_report_daily" ADD CONSTRAINT "payment_report_daily_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_report_daily_date_idx" ON "payment_report_daily" USING btree ("stat_date");