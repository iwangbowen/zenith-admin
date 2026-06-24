CREATE TYPE "public"."channel_auto_reply_keyword_mode" AS ENUM('exact', 'contains');--> statement-breakpoint
CREATE TYPE "public"."channel_auto_reply_match" AS ENUM('subscribe', 'keyword', 'default');--> statement-breakpoint
CREATE TYPE "public"."channel_menu_type" AS ENUM('click', 'view');--> statement-breakpoint
CREATE TYPE "public"."channel_message_direction" AS ENUM('out', 'in');--> statement-breakpoint
CREATE TABLE "channel_auto_replies" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"match_type" "channel_auto_reply_match" DEFAULT 'keyword' NOT NULL,
	"keyword" varchar(100),
	"keyword_mode" "channel_auto_reply_keyword_mode" DEFAULT 'contains' NOT NULL,
	"reply_content" text NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_menus" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"parent_id" integer,
	"name" varchar(32) NOT NULL,
	"type" "channel_menu_type" DEFAULT 'click' NOT NULL,
	"value" varchar(500),
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_messages" ADD COLUMN "direction" "channel_message_direction" DEFAULT 'out' NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD COLUMN "sender_user_id" integer;--> statement-breakpoint
ALTER TABLE "channel_auto_replies" ADD CONSTRAINT "channel_auto_replies_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_menus" ADD CONSTRAINT "channel_menus_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;