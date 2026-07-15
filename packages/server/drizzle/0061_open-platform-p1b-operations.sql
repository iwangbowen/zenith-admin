ALTER TABLE "app_webhook_subscriptions" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_webhook_subscriptions" ADD COLUMN "auto_disabled_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "oauth2_tokens_client_idx" ON "oauth2_tokens" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth2_tokens_active_expiry_idx" ON "oauth2_tokens" USING btree ("revoked","expires_at");--> statement-breakpoint
CREATE INDEX "oauth2_user_grants_client_idx" ON "oauth2_user_grants" USING btree ("client_id");