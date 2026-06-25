CREATE TABLE "workflow_event_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" varchar(64) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"instance_id" integer,
	"definition_id" integer,
	"task_id" integer,
	"payload" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"next_retry_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_event_outbox_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "workflow_event_outbox" ADD CONSTRAINT "workflow_event_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_event_outbox_status_idx" ON "workflow_event_outbox" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX "workflow_event_outbox_instance_idx" ON "workflow_event_outbox" USING btree ("instance_id");