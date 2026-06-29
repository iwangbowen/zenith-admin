CREATE TABLE "rule_test_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_id" integer NOT NULL,
	"name" varchar(64) NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expected" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rule_test_cases_name_uniq" UNIQUE("table_id","name")
);
--> statement-breakpoint
ALTER TABLE "rule_test_cases" ADD CONSTRAINT "rule_test_cases_table_id_rule_decision_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."rule_decision_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_test_cases" ADD CONSTRAINT "rule_test_cases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_test_cases" ADD CONSTRAINT "rule_test_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_test_cases" ADD CONSTRAINT "rule_test_cases_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;