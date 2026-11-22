ALTER TABLE "payment_contracts" ADD COLUMN "plan_amount_snapshot" integer;--> statement-breakpoint
ALTER TABLE "payment_contracts" ADD COLUMN "plan_period_snapshot" "payment_deduct_period";--> statement-breakpoint
ALTER TABLE "payment_contracts" ADD COLUMN "plan_custom_days_snapshot" integer;--> statement-breakpoint
ALTER TABLE "payment_contracts" ADD COLUMN "plan_max_retries_snapshot" integer;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN "fee_rule_snapshot" jsonb;