CREATE TABLE "workflow_instance_migrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"instance_id" integer NOT NULL,
	"definition_id" integer NOT NULL,
	"from_version" integer NOT NULL,
	"to_version" integer NOT NULL,
	"node_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'done' NOT NULL,
	"note" text,
	"created_by" integer,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_instance_migrations" ADD CONSTRAINT "workflow_instance_migrations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instance_migrations" ADD CONSTRAINT "workflow_instance_migrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wf_inst_migration_idx" ON "workflow_instance_migrations" USING btree ("instance_id");