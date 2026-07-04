CREATE TABLE "payment_apps" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"app_key" varchar(64) NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"wechat_config_id" integer,
	"alipay_config_id" integer,
	"unionpay_config_id" integer,
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_apps_app_key_unique" UNIQUE("app_key")
);
--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN "app_id" integer;--> statement-breakpoint
ALTER TABLE "payment_apps" ADD CONSTRAINT "payment_apps_wechat_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("wechat_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_apps" ADD CONSTRAINT "payment_apps_alipay_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("alipay_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_apps" ADD CONSTRAINT "payment_apps_unionpay_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("unionpay_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_apps" ADD CONSTRAINT "payment_apps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_apps" ADD CONSTRAINT "payment_apps_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_apps" ADD CONSTRAINT "payment_apps_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_app_id_payment_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."payment_apps"("id") ON DELETE set null ON UPDATE no action;