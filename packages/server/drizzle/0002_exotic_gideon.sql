CREATE TABLE "workflow_decision_executions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_decision_executions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"instance_id" integer NOT NULL,
	"decision_id" varchar(64) NOT NULL,
	"node_key" varchar(64) NOT NULL,
	"branch_path" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parent_token_id" integer,
	"ref_kind" varchar(16) NOT NULL,
	"rule_key" varchar(64) NOT NULL,
	"rule_version" integer,
	"matched" boolean DEFAULT false NOT NULL,
	"reason" varchar(64),
	"used_fallback" boolean,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_decision_executions_decision_id_unique" UNIQUE("decision_id")
);
--> statement-breakpoint
ALTER TABLE "workflow_decision_executions" ADD CONSTRAINT "workflow_decision_executions_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_decision_executions" ADD CONSTRAINT "workflow_decision_executions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_decision_executions" ADD CONSTRAINT "workflow_decision_executions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_decision_executions" ADD CONSTRAINT "workflow_decision_executions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_decision_executions_instance_node_idx" ON "workflow_decision_executions" USING btree ("instance_id","node_key");