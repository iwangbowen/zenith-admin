CREATE TYPE "public"."app_webhook_delivery_status" AS ENUM('pending', 'success', 'failed', 'retrying');--> statement-breakpoint
CREATE TYPE "public"."app_webhook_sign_mode" AS ENUM('hmacSha256', 'none');--> statement-breakpoint
CREATE TABLE "app_webhook_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_id" integer NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"event_id" varchar(64) NOT NULL,
	"payload" jsonb,
	"attempt" integer DEFAULT 0 NOT NULL,
	"status" "app_webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"request_url" varchar(512),
	"response_status" integer,
	"response_body" text,
	"error_message" text,
	"duration_ms" integer,
	"next_retry_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_webhook_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"url" varchar(512) NOT NULL,
	"secret_encrypted" text,
	"sign_mode" "app_webhook_sign_mode" DEFAULT 'hmacSha256' NOT NULL,
	"events" text[] DEFAULT '{}' NOT NULL,
	"headers" jsonb,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"last_delivery_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_webhook_deliveries" ADD CONSTRAINT "app_webhook_deliveries_subscription_id_app_webhook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."app_webhook_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_webhook_subscriptions" ADD CONSTRAINT "app_webhook_subscriptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_webhook_subscriptions" ADD CONSTRAINT "app_webhook_subscriptions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_webhook_deliveries_sub_idx" ON "app_webhook_deliveries" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "app_webhook_deliveries_client_idx" ON "app_webhook_deliveries" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "app_webhook_deliveries_status_idx" ON "app_webhook_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "app_webhook_deliveries_next_retry_idx" ON "app_webhook_deliveries" USING btree ("next_retry_at");--> statement-breakpoint
CREATE INDEX "app_webhook_deliveries_created_idx" ON "app_webhook_deliveries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "app_webhook_subscriptions_client_idx" ON "app_webhook_subscriptions" USING btree ("client_id");