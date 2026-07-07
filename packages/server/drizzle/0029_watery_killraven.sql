CREATE TYPE "public"."chat_join_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."chat_message_type" ADD VALUE 'video';--> statement-breakpoint
CREATE TABLE "chat_custom_emojis" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"url" varchar(512) NOT NULL,
	"file_id" varchar(64),
	"name" varchar(64),
	"width" integer,
	"height" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_group_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"token" varchar(64) NOT NULL,
	"created_by" integer,
	"expires_at" timestamp with time zone,
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chat_group_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "chat_group_join_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"invite_id" integer,
	"status" "chat_join_request_status" DEFAULT 'pending' NOT NULL,
	"message" varchar(255),
	"handled_by" integer,
	"handled_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD COLUMN "join_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_custom_emojis" ADD CONSTRAINT "chat_custom_emojis_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_invites" ADD CONSTRAINT "chat_group_invites_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_invites" ADD CONSTRAINT "chat_group_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_join_requests" ADD CONSTRAINT "chat_group_join_requests_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_join_requests" ADD CONSTRAINT "chat_group_join_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_join_requests" ADD CONSTRAINT "chat_group_join_requests_invite_id_chat_group_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."chat_group_invites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_join_requests" ADD CONSTRAINT "chat_group_join_requests_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_custom_emojis_user_idx" ON "chat_custom_emojis" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_group_invites_conv_idx" ON "chat_group_invites" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "chat_group_join_requests_conv_status_idx" ON "chat_group_join_requests" USING btree ("conversation_id","status");--> statement-breakpoint
CREATE INDEX "chat_group_join_requests_user_idx" ON "chat_group_join_requests" USING btree ("user_id");