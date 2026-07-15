ALTER TABLE "user_api_tokens" DROP CONSTRAINT "user_api_tokens_token_unique";--> statement-breakpoint
ALTER TABLE "user_api_tokens" ADD COLUMN "token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "user_api_tokens" ADD COLUMN "token_prefix" varchar(20);--> statement-breakpoint
ALTER TABLE "user_api_tokens" DROP COLUMN "token";--> statement-breakpoint
ALTER TABLE "user_api_tokens" ADD CONSTRAINT "user_api_tokens_token_hash_unique" UNIQUE("token_hash");