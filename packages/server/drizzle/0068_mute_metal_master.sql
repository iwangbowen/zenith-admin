ALTER TABLE "ai_messages" ADD COLUMN "reasoning" text;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "ttft_ms" integer;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "ai_prompt_templates" ADD COLUMN "usage_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_provider_configs" ADD COLUMN "price_input_per_m" integer;--> statement-breakpoint
ALTER TABLE "ai_provider_configs" ADD COLUMN "price_output_per_m" integer;