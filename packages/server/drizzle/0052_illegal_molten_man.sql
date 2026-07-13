CREATE TYPE "public"."payment_contract_status" AS ENUM('pending', 'signed', 'paused', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."payment_deduct_period" AS ENUM('daily', 'weekly', 'monthly', 'custom');--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'wechat_papay';--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'alipay_cycle';--> statement-breakpoint
CREATE TABLE "payment_contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"contract_no" varchar(64) NOT NULL,
	"channel" "payment_channel" NOT NULL,
	"channel_config_id" integer,
	"plan_id" integer NOT NULL,
	"signer_account" varchar(128) NOT NULL,
	"signer_name" varchar(64),
	"status" "payment_contract_status" DEFAULT 'pending' NOT NULL,
	"channel_contract_no" varchar(128),
	"biz_type" varchar(64) NOT NULL,
	"biz_id" varchar(128) NOT NULL,
	"next_deduct_at" timestamp with time zone,
	"last_deduct_at" timestamp with time zone,
	"fail_count" integer DEFAULT 0 NOT NULL,
	"total_deduct_count" integer DEFAULT 0 NOT NULL,
	"last_order_no" varchar(64),
	"signed_at" timestamp with time zone,
	"terminated_at" timestamp with time zone,
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_contracts_contract_no_unique" UNIQUE("contract_no")
);
--> statement-breakpoint
CREATE TABLE "payment_deduct_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"period" "payment_deduct_period" DEFAULT 'monthly' NOT NULL,
	"custom_days" integer,
	"amount" integer NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_vip_renewals" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"order_no" varchar(64) NOT NULL,
	"contract_no" varchar(64),
	"amount" integer NOT NULL,
	"vip_expire_after" timestamp with time zone NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_vip_renewals_order_no_unique" UNIQUE("order_no")
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "vip_expire_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_contracts" ADD CONSTRAINT "payment_contracts_channel_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("channel_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_contracts" ADD CONSTRAINT "payment_contracts_plan_id_payment_deduct_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."payment_deduct_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_contracts" ADD CONSTRAINT "payment_contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_contracts" ADD CONSTRAINT "payment_contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_contracts" ADD CONSTRAINT "payment_contracts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_deduct_plans" ADD CONSTRAINT "payment_deduct_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_deduct_plans" ADD CONSTRAINT "payment_deduct_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_deduct_plans" ADD CONSTRAINT "payment_deduct_plans_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_vip_renewals" ADD CONSTRAINT "member_vip_renewals_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_contracts_active_biz_uq" ON "payment_contracts" USING btree ("biz_type","biz_id") WHERE "payment_contracts"."status" in ('pending', 'signed', 'paused');--> statement-breakpoint
CREATE INDEX "payment_contracts_status_idx" ON "payment_contracts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_contracts_next_deduct_idx" ON "payment_contracts" USING btree ("next_deduct_at");--> statement-breakpoint
CREATE INDEX "payment_contracts_biz_idx" ON "payment_contracts" USING btree ("biz_type","biz_id");--> statement-breakpoint
CREATE INDEX "member_vip_renewals_member_idx" ON "member_vip_renewals" USING btree ("member_id");