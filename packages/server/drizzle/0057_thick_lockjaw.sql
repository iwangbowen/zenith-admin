CREATE TYPE "public"."payment_preauth_status" AS ENUM('pending', 'frozen', 'captured', 'released', 'failed');--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'wechat_preauth';--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'alipay_preauth';--> statement-breakpoint
CREATE TABLE "payment_preauths" (
	"id" serial PRIMARY KEY NOT NULL,
	"preauth_no" varchar(64) NOT NULL,
	"channel" "payment_channel" NOT NULL,
	"channel_config_id" integer,
	"channel_preauth_no" varchar(128),
	"biz_type" varchar(64) NOT NULL,
	"biz_id" varchar(128) NOT NULL,
	"subject" varchar(256) NOT NULL,
	"payer_account" varchar(128) NOT NULL,
	"frozen_amount" integer NOT NULL,
	"captured_amount" integer,
	"capture_order_no" varchar(64),
	"status" "payment_preauth_status" DEFAULT 'pending' NOT NULL,
	"error_message" varchar(512),
	"frozen_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"remark" varchar(256),
	"operator_id" integer,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_preauths_preauth_no_unique" UNIQUE("preauth_no")
);
--> statement-breakpoint
ALTER TABLE "payment_preauths" ADD CONSTRAINT "payment_preauths_channel_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("channel_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_preauths" ADD CONSTRAINT "payment_preauths_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_preauths" ADD CONSTRAINT "payment_preauths_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_preauths" ADD CONSTRAINT "payment_preauths_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_preauths" ADD CONSTRAINT "payment_preauths_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_preauths_active_biz_uq" ON "payment_preauths" USING btree ("biz_type","biz_id") WHERE "payment_preauths"."status" in ('pending', 'frozen');--> statement-breakpoint
CREATE INDEX "payment_preauths_status_idx" ON "payment_preauths" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_preauths_biz_idx" ON "payment_preauths" USING btree ("biz_type","biz_id");