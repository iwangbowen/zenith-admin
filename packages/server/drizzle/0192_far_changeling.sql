CREATE TYPE "public"."rule_hit_policy" AS ENUM('first', 'unique', 'priority', 'collect', 'any');--> statement-breakpoint
CREATE TABLE "rule_decision_table_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_id" integer NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" text,
	"hit_policy" "rule_hit_policy" DEFAULT 'first' NOT NULL,
	"inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" integer,
	"tenant_id" integer,
	CONSTRAINT "rule_decision_table_versions_uniq" UNIQUE("table_id","version")
);
--> statement-breakpoint
CREATE TABLE "rule_decision_tables" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" text,
	"category_id" integer,
	"status" "workflow_definition_status" DEFAULT 'draft' NOT NULL,
	"hit_policy" "rule_hit_policy" DEFAULT 'first' NOT NULL,
	"inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rule_decision_tables_key_uniq" UNIQUE("tenant_id","key")
);
--> statement-breakpoint
ALTER TABLE "rule_decision_table_versions" ADD CONSTRAINT "rule_decision_table_versions_table_id_rule_decision_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."rule_decision_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_table_versions" ADD CONSTRAINT "rule_decision_table_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_table_versions" ADD CONSTRAINT "rule_decision_table_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_tables" ADD CONSTRAINT "rule_decision_tables_category_id_workflow_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."workflow_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_tables" ADD CONSTRAINT "rule_decision_tables_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_tables" ADD CONSTRAINT "rule_decision_tables_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_tables" ADD CONSTRAINT "rule_decision_tables_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;