CREATE TYPE "public"."frontend_error_type" AS ENUM('js_error', 'promise_rejection', 'resource_error', 'console_error');--> statement-breakpoint
CREATE TABLE "frontend_errors" (
	"id" serial PRIMARY KEY NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"error_type" "frontend_error_type" NOT NULL,
	"message" text NOT NULL,
	"stack" text,
	"source_url" varchar(512),
	"line_no" integer,
	"col_no" integer,
	"page_url" varchar(512),
	"user_agent" varchar(512),
	"user_id" integer,
	"username" varchar(64),
	"tenant_id" integer,
	"session_id" varchar(36),
	"count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "frontend_errors" ADD CONSTRAINT "frontend_errors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;