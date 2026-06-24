CREATE TYPE "public"."channel_audience" AS ENUM('broadcast', 'targeted');--> statement-breakpoint
CREATE TYPE "public"."channel_message_type" AS ENUM('text', 'card');--> statement-breakpoint
CREATE TYPE "public"."channel_type" AS ENUM('system', 'business');--> statement-breakpoint
CREATE TABLE "channel_message_targets" (
	"message_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "channel_message_targets_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "channel_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"audience_type" "channel_audience" DEFAULT 'broadcast' NOT NULL,
	"type" "channel_message_type" DEFAULT 'text' NOT NULL,
	"title" varchar(200),
	"content" text NOT NULL,
	"extra" jsonb,
	"published_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_subscriptions" (
	"channel_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"last_read_at" timestamp with time zone,
	"is_muted" boolean DEFAULT false NOT NULL,
	"subscribed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channel_subscriptions_channel_id_user_id_pk" PRIMARY KEY("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"avatar" varchar(256),
	"description" varchar(255),
	"type" "channel_type" DEFAULT 'system' NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channels_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "channel_message_targets" ADD CONSTRAINT "channel_message_targets_message_id_channel_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."channel_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_message_targets" ADD CONSTRAINT "channel_message_targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_subscriptions" ADD CONSTRAINT "channel_subscriptions_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_subscriptions" ADD CONSTRAINT "channel_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "is_bot";