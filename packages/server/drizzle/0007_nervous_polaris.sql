CREATE TABLE "app_webhook_attempts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app_webhook_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"delivery_id" integer NOT NULL,
	"attempt" integer NOT NULL,
	"lease_token" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"request_url" varchar(512),
	"response_status" integer,
	"error_message" text,
	CONSTRAINT "app_webhook_attempts_delivery_attempt_unique" UNIQUE("delivery_id","attempt")
);
--> statement-breakpoint
ALTER TABLE "app_webhook_deliveries" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "app_webhook_deliveries" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_webhook_attempts" ADD CONSTRAINT "app_webhook_attempts_delivery_id_app_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."app_webhook_deliveries"("id") ON DELETE cascade ON UPDATE no action;