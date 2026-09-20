CREATE TYPE "public"."entity_subject_role" AS ENUM('primary', 'related', 'source', 'target');--> statement-breakpoint
CREATE TABLE "operation_log_subjects" (
	"operation_log_id" integer NOT NULL,
	"tenant_id" integer,
	"entity_type" varchar(96) NOT NULL,
	"entity_key" varchar(512) NOT NULL,
	"role" "entity_subject_role" DEFAULT 'primary' NOT NULL,
	CONSTRAINT "operation_log_subjects_operation_log_id_entity_type_entity_key_role_pk" PRIMARY KEY("operation_log_id","entity_type","entity_key","role"),
	CONSTRAINT "operation_log_subjects_entity_type_check" CHECK (length("operation_log_subjects"."entity_type") > 0),
	CONSTRAINT "operation_log_subjects_entity_key_check" CHECK (length("operation_log_subjects"."entity_key") > 0)
);
--> statement-breakpoint
CREATE TABLE "domain_event_subjects" (
	"event_id" integer NOT NULL,
	"tenant_id" integer,
	"entity_type" varchar(96) NOT NULL,
	"entity_key" varchar(512) NOT NULL,
	"role" "entity_subject_role" DEFAULT 'related' NOT NULL,
	CONSTRAINT "domain_event_subjects_event_id_entity_type_entity_key_role_pk" PRIMARY KEY("event_id","entity_type","entity_key","role"),
	CONSTRAINT "domain_event_subjects_entity_type_check" CHECK (length("domain_event_subjects"."entity_type") > 0),
	CONSTRAINT "domain_event_subjects_entity_key_check" CHECK (length("domain_event_subjects"."entity_key") > 0)
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "domain_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"event_type" varchar(128) NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_type" varchar(96),
	"actor_key" varchar(512),
	"source_type" varchar(96),
	"source_key" varchar(512),
	"trace_id" varchar(64),
	"parent_ref" varchar(128),
	"dedupe_key" varchar(192),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_events_event_type_check" CHECK (length("domain_events"."event_type") > 0),
	CONSTRAINT "domain_events_schema_version_check" CHECK ("domain_events"."schema_version" > 0),
	CONSTRAINT "domain_events_actor_ref_pair_check" CHECK (("domain_events"."actor_type" is null) = ("domain_events"."actor_key" is null)),
	CONSTRAINT "domain_events_source_ref_pair_check" CHECK (("domain_events"."source_type" is null) = ("domain_events"."source_key" is null))
);
--> statement-breakpoint
CREATE TABLE "entity_relation_edges" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entity_relation_edges_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"source_type" varchar(96) NOT NULL,
	"source_key" varchar(512) NOT NULL,
	"relation_key" varchar(128) NOT NULL,
	"target_type" varchar(96) NOT NULL,
	"target_key" varchar(512) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_relation_edges_source_type_check" CHECK (length("entity_relation_edges"."source_type") > 0),
	CONSTRAINT "entity_relation_edges_source_key_check" CHECK (length("entity_relation_edges"."source_key") > 0),
	CONSTRAINT "entity_relation_edges_relation_key_check" CHECK (length("entity_relation_edges"."relation_key") > 0),
	CONSTRAINT "entity_relation_edges_target_type_check" CHECK (length("entity_relation_edges"."target_type") > 0),
	CONSTRAINT "entity_relation_edges_target_key_check" CHECK (length("entity_relation_edges"."target_key") > 0)
);
--> statement-breakpoint
ALTER TABLE "operation_log_subjects" ADD CONSTRAINT "operation_log_subjects_operation_log_id_operation_logs_id_fk" FOREIGN KEY ("operation_log_id") REFERENCES "public"."operation_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_log_subjects" ADD CONSTRAINT "operation_log_subjects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_event_subjects" ADD CONSTRAINT "domain_event_subjects_event_id_domain_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."domain_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_event_subjects" ADD CONSTRAINT "domain_event_subjects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_relation_edges" ADD CONSTRAINT "entity_relation_edges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_relation_edges" ADD CONSTRAINT "entity_relation_edges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operation_log_subjects_entity_idx" ON "operation_log_subjects" USING btree ("tenant_id","entity_type","entity_key","operation_log_id");--> statement-breakpoint
CREATE INDEX "operation_log_subjects_log_idx" ON "operation_log_subjects" USING btree ("operation_log_id");--> statement-breakpoint
CREATE INDEX "domain_event_subjects_entity_idx" ON "domain_event_subjects" USING btree ("tenant_id","entity_type","entity_key","event_id");--> statement-breakpoint
CREATE INDEX "domain_event_subjects_event_idx" ON "domain_event_subjects" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_events_tenant_dedupe_uq" ON "domain_events" USING btree ("tenant_id","dedupe_key") WHERE "domain_events"."tenant_id" is not null and "domain_events"."dedupe_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "domain_events_platform_dedupe_uq" ON "domain_events" USING btree ("dedupe_key") WHERE "domain_events"."tenant_id" is null and "domain_events"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "domain_events_tenant_occurred_idx" ON "domain_events" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "domain_events_type_occurred_idx" ON "domain_events" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "domain_events_trace_idx" ON "domain_events" USING btree ("trace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_relation_edges_tenant_uq" ON "entity_relation_edges" USING btree ("tenant_id","source_type","source_key","relation_key","target_type","target_key") WHERE "entity_relation_edges"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_relation_edges_platform_uq" ON "entity_relation_edges" USING btree ("source_type","source_key","relation_key","target_type","target_key") WHERE "entity_relation_edges"."tenant_id" is null;--> statement-breakpoint
CREATE INDEX "entity_relation_edges_source_idx" ON "entity_relation_edges" USING btree ("tenant_id","source_type","source_key","relation_key");--> statement-breakpoint
CREATE INDEX "entity_relation_edges_target_idx" ON "entity_relation_edges" USING btree ("tenant_id","target_type","target_key","relation_key");