CREATE TYPE "public"."payment_dispute_reply_author" AS ENUM('merchant', 'user', 'system');--> statement-breakpoint
CREATE TYPE "public"."payment_dispute_status" AS ENUM('pending', 'processing', 'resolved', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payment_dispute_type" AS ENUM('refund_request', 'service_issue', 'fraud_report', 'other');--> statement-breakpoint
CREATE TABLE "payment_dispute_replies" (
	"id" serial PRIMARY KEY NOT NULL,
	"dispute_id" integer NOT NULL,
	"author" "payment_dispute_reply_author" DEFAULT 'merchant' NOT NULL,
	"content" text NOT NULL,
	"operator_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_disputes" (
	"id" serial PRIMARY KEY NOT NULL,
	"dispute_no" varchar(64) NOT NULL,
	"channel_dispute_no" varchar(128),
	"channel" "payment_channel" NOT NULL,
	"order_no" varchar(64) NOT NULL,
	"complainant" varchar(128),
	"complainant_phone" varchar(32),
	"type" "payment_dispute_type" DEFAULT 'other' NOT NULL,
	"content" text NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"status" "payment_dispute_status" DEFAULT 'pending' NOT NULL,
	"deadline" timestamp with time zone,
	"refund_no" varchar(64),
	"resolved_at" timestamp with time zone,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_disputes_dispute_no_unique" UNIQUE("dispute_no")
);
--> statement-breakpoint
ALTER TABLE "payment_dispute_replies" ADD CONSTRAINT "payment_dispute_replies_dispute_id_payment_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."payment_disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_dispute_replies" ADD CONSTRAINT "payment_dispute_replies_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_dispute_replies_dispute_idx" ON "payment_dispute_replies" USING btree ("dispute_id");--> statement-breakpoint
CREATE INDEX "payment_disputes_status_idx" ON "payment_disputes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_disputes_order_no_idx" ON "payment_disputes" USING btree ("order_no");--> statement-breakpoint
CREATE INDEX "payment_disputes_deadline_idx" ON "payment_disputes" USING btree ("deadline");