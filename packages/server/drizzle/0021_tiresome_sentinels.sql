CREATE TYPE "public"."payment_exception_status" AS ENUM('open', 'resolved', 'ignored');--> statement-breakpoint
CREATE TABLE "payment_exceptions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_exceptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" varchar(64) NOT NULL,
	"dedupe_key" varchar(160) NOT NULL,
	"order_no" varchar(64),
	"refund_no" varchar(64),
	"channel" "payment_channel",
	"channel_config_id" integer,
	"app_id" integer,
	"amount" integer,
	"currency" varchar(8),
	"message" varchar(512),
	"payload" jsonb,
	"status" "payment_exception_status" DEFAULT 'open' NOT NULL,
	"tenant_id" integer,
	"resolved_at" timestamp with time zone,
	"resolved_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_exceptions_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD COLUMN "channel_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD COLUMN "submit_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD COLUMN "last_query_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD COLUMN "unknown_since" timestamp with time zone;--> statement-breakpoint
-- 存量 processing 退款视为已提交过渠道，避免新恢复任务把历史退款再次提交。
UPDATE "payment_refunds" SET "channel_submitted_at" = COALESCE("updated_at", "created_at")
WHERE "channel_submitted_at" IS NULL AND "status" <> 'pending';--> statement-breakpoint
ALTER TABLE "payment_exceptions" ADD CONSTRAINT "payment_exceptions_channel_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("channel_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_exceptions" ADD CONSTRAINT "payment_exceptions_app_id_payment_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."payment_apps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_exceptions" ADD CONSTRAINT "payment_exceptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_exceptions" ADD CONSTRAINT "payment_exceptions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_exceptions_status_created_idx" ON "payment_exceptions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "payment_exceptions_tenant_status_idx" ON "payment_exceptions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "payment_exceptions_order_idx" ON "payment_exceptions" USING btree ("order_no");--> statement-breakpoint
CREATE INDEX "payment_orders_config_out_trade_idx" ON "payment_orders" USING btree ("channel_config_id","out_trade_no");--> statement-breakpoint
CREATE INDEX "payment_orders_status_created_idx" ON "payment_orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "payment_orders_status_paid_idx" ON "payment_orders" USING btree ("status","paid_at");--> statement-breakpoint
CREATE INDEX "payment_orders_tenant_created_idx" ON "payment_orders" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_refunds_status_created_idx" ON "payment_refunds" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "payment_refunds_tenant_created_idx" ON "payment_refunds" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refunds_out_refund_no_uq" ON "payment_refunds" USING btree ("out_refund_no");