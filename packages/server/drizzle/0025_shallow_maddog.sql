CREATE TABLE "tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(50) NOT NULL,
	"logo" varchar(500),
	"contact_name" varchar(50),
	"contact_phone" varchar(20),
	"status" "status" DEFAULT 'active' NOT NULL,
	"expire_at" timestamp with time zone,
	"max_users" integer,
	"remark" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "departments" DROP CONSTRAINT "departments_code_unique";--> statement-breakpoint
ALTER TABLE "dicts" DROP CONSTRAINT "dicts_code_unique";--> statement-breakpoint
ALTER TABLE "positions" DROP CONSTRAINT "positions_code_unique";--> statement-breakpoint
ALTER TABLE "roles" DROP CONSTRAINT "roles_code_unique";--> statement-breakpoint
ALTER TABLE "system_configs" DROP CONSTRAINT "system_configs_config_key_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_username_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_email_unique";--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "tenant_id" integer;--> statement-breakpoint
ALTER TABLE "dicts" ADD COLUMN "tenant_id" integer;--> statement-breakpoint
ALTER TABLE "login_logs" ADD COLUMN "tenant_id" integer;--> statement-breakpoint
ALTER TABLE "managed_files" ADD COLUMN "tenant_id" integer;--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "tenant_id" integer;--> statement-breakpoint
ALTER TABLE "operation_logs" ADD COLUMN "tenant_id" integer;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "tenant_id" integer;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "tenant_id" integer;--> statement-breakpoint
ALTER TABLE "system_configs" ADD COLUMN "tenant_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tenant_id" integer;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dicts" ADD CONSTRAINT "dicts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_logs" ADD CONSTRAINT "login_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_files" ADD CONSTRAINT "managed_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_configs" ADD CONSTRAINT "system_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_code_unique" UNIQUE("tenant_id","code");--> statement-breakpoint
ALTER TABLE "dicts" ADD CONSTRAINT "dicts_tenant_code_unique" UNIQUE("tenant_id","code");--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_tenant_code_unique" UNIQUE("tenant_id","code");--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_code_unique" UNIQUE("tenant_id","code");--> statement-breakpoint
ALTER TABLE "system_configs" ADD CONSTRAINT "system_configs_tenant_key_unique" UNIQUE("tenant_id","config_key");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_username_unique" UNIQUE("tenant_id","username");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_email_unique" UNIQUE("tenant_id","email");