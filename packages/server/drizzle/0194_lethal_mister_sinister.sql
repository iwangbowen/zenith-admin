CREATE TABLE "rule_decision_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_key" varchar(64) NOT NULL,
	"table_id" integer,
	"instance_id" integer,
	"node_key" varchar(64),
	"source" varchar(16) DEFAULT 'runtime' NOT NULL,
	"matched" boolean DEFAULT false NOT NULL,
	"hit_policy" "rule_hit_policy" DEFAULT 'first' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"matched_row_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" integer,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rule_decision_executions" ADD CONSTRAINT "rule_decision_executions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_executions" ADD CONSTRAINT "rule_decision_executions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rule_exec_instance_idx" ON "rule_decision_executions" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "rule_exec_table_idx" ON "rule_decision_executions" USING btree ("table_id");