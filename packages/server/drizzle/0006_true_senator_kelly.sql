CREATE TABLE "event_consumer_attempts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_consumer_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"delivery_id" integer NOT NULL,
	"generation" integer NOT NULL,
	"attempt" integer NOT NULL,
	"lease_token" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "event_consumer_deliveries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_consumer_deliveries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" integer NOT NULL,
	"consumer_key" varchar(128) NOT NULL,
	"ordering_key" varchar(256) NOT NULL,
	"after" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lane" varchar(32) DEFAULT 'business' NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"last_error" text,
	"finished_at" timestamp with time zone,
	CONSTRAINT "event_consumer_deliveries_status_check" CHECK ("event_consumer_deliveries"."status" in ('pending','running','retrying','succeeded','skipped','dead'))
);
--> statement-breakpoint
CREATE TABLE "event_outbox" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_outbox_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" uuid NOT NULL,
	"domain" varchar(64) NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"tenant_id" integer,
	"business_key" varchar(256) NOT NULL,
	"ordering_key" varchar(256) NOT NULL,
	"subject_refs" jsonb NOT NULL,
	"scope" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trace_id" varchar(128),
	"parent_ref" varchar(256),
	CONSTRAINT "event_outbox_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "event_outbox_version_check" CHECK ("event_outbox"."schema_version" = 1)
);
--> statement-breakpoint
ALTER TABLE "event_consumer_attempts" ADD CONSTRAINT "event_consumer_attempts_delivery_id_event_consumer_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."event_consumer_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_consumer_deliveries" ADD CONSTRAINT "event_consumer_deliveries_event_id_event_outbox_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_outbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_consumer_attempts_delivery_generation_unique" ON "event_consumer_attempts" USING btree ("delivery_id","generation");--> statement-breakpoint
CREATE INDEX "event_consumer_attempts_delivery_idx" ON "event_consumer_attempts" USING btree ("delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_consumer_deliveries_event_consumer_unique" ON "event_consumer_deliveries" USING btree ("event_id","consumer_key");--> statement-breakpoint
CREATE INDEX "event_consumer_deliveries_claim_idx" ON "event_consumer_deliveries" USING btree ("lane","run_at","id") WHERE "event_consumer_deliveries"."status" in ('pending', 'retrying', 'running');--> statement-breakpoint
CREATE INDEX "event_consumer_deliveries_order_idx" ON "event_consumer_deliveries" USING btree ("consumer_key","ordering_key","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_outbox_tenant_business_unique" ON "event_outbox" USING btree ("tenant_id","event_type","business_key") WHERE "event_outbox"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "event_outbox_platform_business_unique" ON "event_outbox" USING btree ("event_type","business_key") WHERE "event_outbox"."tenant_id" is null;--> statement-breakpoint
CREATE INDEX "event_outbox_ordering_idx" ON "event_outbox" USING btree ("ordering_key","id");--> statement-breakpoint
CREATE INDEX "event_outbox_tenant_occurred_idx" ON "event_outbox" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "event_outbox_trace_idx" ON "event_outbox" USING btree ("trace_id");