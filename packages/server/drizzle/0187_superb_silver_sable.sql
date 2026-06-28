CREATE TYPE "public"."workflow_connector_invocation_source" AS ENUM('test', 'trigger', 'external', 'webhook', 'manual');--> statement-breakpoint
CREATE TABLE "workflow_connector_invocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"connector_id" integer NOT NULL,
	"source" "workflow_connector_invocation_source" DEFAULT 'manual' NOT NULL,
	"ok" boolean NOT NULL,
	"status" integer,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"request_url" varchar(1024),
	"error" varchar(1024),
	"tenant_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_event_subscriptions" ADD COLUMN "connector_id" integer;--> statement-breakpoint
ALTER TABLE "workflow_connector_invocations" ADD CONSTRAINT "workflow_connector_invocations_connector_id_workflow_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."workflow_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_connector_invocations_conn_idx" ON "workflow_connector_invocations" USING btree ("connector_id","created_at");--> statement-breakpoint
ALTER TABLE "workflow_event_subscriptions" ADD CONSTRAINT "workflow_event_subscriptions_connector_id_workflow_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."workflow_connectors"("id") ON DELETE set null ON UPDATE no action;