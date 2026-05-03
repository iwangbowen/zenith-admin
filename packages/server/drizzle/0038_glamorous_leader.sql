CREATE TYPE "public"."chat_member_role" AS ENUM('owner', 'member');--> statement-breakpoint
ALTER TABLE "chat_conversation_members" ADD COLUMN "role" "chat_member_role" DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD COLUMN "announcement" varchar(500);