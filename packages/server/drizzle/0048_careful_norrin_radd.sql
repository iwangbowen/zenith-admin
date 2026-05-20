CREATE TYPE "public"."in_app_message_type" AS ENUM('info', 'success', 'warning', 'error');--> statement-breakpoint
CREATE TYPE "public"."send_source" AS ENUM('manual', 'test', 'system', 'api');--> statement-breakpoint
CREATE TYPE "public"."send_status" AS ENUM('pending', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sms_provider" AS ENUM('aliyun', 'tencent');--> statement-breakpoint
CREATE TABLE "email_send_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer,
	"to_email" varchar(256) NOT NULL,
	"subject" varchar(200) NOT NULL,
	"content" text NOT NULL,
	"status" "send_status" DEFAULT 'pending' NOT NULL,
	"error_msg" text,
	"source" "send_source" DEFAULT 'manual' NOT NULL,
	"user_id" integer,
	"ip" varchar(64),
	"tenant_id" integer,
	"sent_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(100) NOT NULL,
	"subject" varchar(200) NOT NULL,
	"content" text NOT NULL,
	"variables" text,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" text,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_templates_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "in_app_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer,
	"user_id" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"content" text NOT NULL,
	"type" "in_app_message_type" DEFAULT 'info' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"source" "send_source" DEFAULT 'system' NOT NULL,
	"sender_id" integer,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "in_app_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(100) NOT NULL,
	"title" varchar(200) NOT NULL,
	"content" text NOT NULL,
	"type" "in_app_message_type" DEFAULT 'info' NOT NULL,
	"variables" text,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" text,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "in_app_templates_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sms_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"provider" "sms_provider" NOT NULL,
	"access_key_id" varchar(256) DEFAULT '' NOT NULL,
	"access_key_secret" varchar(512) DEFAULT '' NOT NULL,
	"region" varchar(64),
	"sign_name" varchar(64) DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" text,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_send_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"config_id" integer,
	"template_id" integer,
	"provider" "sms_provider" NOT NULL,
	"phone" varchar(32) NOT NULL,
	"content" text NOT NULL,
	"status" "send_status" DEFAULT 'pending' NOT NULL,
	"error_msg" text,
	"biz_id" varchar(128),
	"delivery_status" varchar(32),
	"delivered_at" timestamp with time zone,
	"source" "send_source" DEFAULT 'manual' NOT NULL,
	"user_id" integer,
	"ip" varchar(64),
	"tenant_id" integer,
	"sent_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(100) NOT NULL,
	"template_code" varchar(100) DEFAULT '' NOT NULL,
	"sign_name" varchar(64),
	"content" text NOT NULL,
	"variables" text,
	"provider" "sms_provider" NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" text,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sms_templates_code_unique" UNIQUE("code")
);
--> statement-breakpoint
DROP TABLE "message_templates" CASCADE;--> statement-breakpoint
ALTER TABLE "email_send_logs" ADD CONSTRAINT "email_send_logs_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_send_logs" ADD CONSTRAINT "email_send_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_send_logs" ADD CONSTRAINT "email_send_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_messages" ADD CONSTRAINT "in_app_messages_template_id_in_app_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."in_app_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_messages" ADD CONSTRAINT "in_app_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_messages" ADD CONSTRAINT "in_app_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_messages" ADD CONSTRAINT "in_app_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_templates" ADD CONSTRAINT "in_app_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_configs" ADD CONSTRAINT "sms_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_send_logs" ADD CONSTRAINT "sms_send_logs_config_id_sms_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."sms_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_send_logs" ADD CONSTRAINT "sms_send_logs_template_id_sms_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."sms_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_send_logs" ADD CONSTRAINT "sms_send_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_send_logs" ADD CONSTRAINT "sms_send_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_templates" ADD CONSTRAINT "sms_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DROP TYPE "public"."message_channel";