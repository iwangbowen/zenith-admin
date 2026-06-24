CREATE TYPE "public"."mp_broadcast_status" AS ENUM('draft', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."mp_broadcast_target" AS ENUM('all', 'tag');--> statement-breakpoint
CREATE TYPE "public"."mp_broadcast_type" AS ENUM('text', 'image', 'mpnews');--> statement-breakpoint
CREATE TYPE "public"."mp_qrcode_type" AS ENUM('temporary', 'permanent');--> statement-breakpoint
CREATE TABLE "mp_broadcasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"msg_type" "mp_broadcast_type" DEFAULT 'text' NOT NULL,
	"target" "mp_broadcast_target" DEFAULT 'all' NOT NULL,
	"tag_id" integer,
	"content" text,
	"media_id" varchar(128),
	"status" "mp_broadcast_status" DEFAULT 'draft' NOT NULL,
	"wechat_msg_id" varchar(64),
	"error_msg" text,
	"sent_at" timestamp,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_qrcodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"type" "mp_qrcode_type" DEFAULT 'permanent' NOT NULL,
	"scene_str" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"ticket" varchar(256),
	"url" varchar(512),
	"expire_seconds" integer,
	"scan_count" integer DEFAULT 0 NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mp_broadcasts" ADD CONSTRAINT "mp_broadcasts_account_id_mp_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_broadcasts" ADD CONSTRAINT "mp_broadcasts_tag_id_mp_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."mp_tags"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_broadcasts" ADD CONSTRAINT "mp_broadcasts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_broadcasts" ADD CONSTRAINT "mp_broadcasts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_broadcasts" ADD CONSTRAINT "mp_broadcasts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_qrcodes" ADD CONSTRAINT "mp_qrcodes_account_id_mp_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_qrcodes" ADD CONSTRAINT "mp_qrcodes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_qrcodes" ADD CONSTRAINT "mp_qrcodes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_qrcodes" ADD CONSTRAINT "mp_qrcodes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mp_broadcasts_account_idx" ON "mp_broadcasts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "mp_broadcasts_account_status_idx" ON "mp_broadcasts" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "mp_qrcodes_account_idx" ON "mp_qrcodes" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "mp_qrcodes_account_scene_idx" ON "mp_qrcodes" USING btree ("account_id","scene_str");