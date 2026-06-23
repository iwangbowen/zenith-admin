CREATE TYPE "public"."mp_message_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."mp_message_status" AS ENUM('received', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."mp_message_type" AS ENUM('text', 'image', 'voice', 'video', 'shortvideo', 'location', 'link', 'event');--> statement-breakpoint
CREATE TABLE "mp_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"openid" varchar(64) NOT NULL,
	"direction" "mp_message_direction" NOT NULL,
	"msg_type" "mp_message_type" DEFAULT 'text' NOT NULL,
	"content" text,
	"media_id" varchar(128),
	"media_url" varchar(1000),
	"event" varchar(32),
	"msg_id" varchar(64),
	"status" "mp_message_status" DEFAULT 'received' NOT NULL,
	"error_msg" text,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mp_messages" ADD CONSTRAINT "mp_messages_account_id_mp_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_messages" ADD CONSTRAINT "mp_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mp_messages_account_openid_idx" ON "mp_messages" USING btree ("account_id","openid");--> statement-breakpoint
CREATE INDEX "mp_messages_account_idx" ON "mp_messages" USING btree ("account_id");