ALTER TABLE "in_app_messages" ADD COLUMN "dedupe_key" varchar(192);--> statement-breakpoint
ALTER TABLE "in_app_messages" ADD CONSTRAINT "in_app_messages_dedupe_key_unique" UNIQUE("dedupe_key");