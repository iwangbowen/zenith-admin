CREATE TABLE "workflow_forms" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"code" varchar(64),
	"description" text,
	"category_id" integer,
	"schema" jsonb,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_forms_code_uniq" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "workflow_definition_versions" ADD COLUMN "form_id" integer;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD COLUMN "form_id" integer;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "form_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_forms" ADD CONSTRAINT "workflow_forms_category_id_workflow_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."workflow_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_forms" ADD CONSTRAINT "workflow_forms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_forms" ADD CONSTRAINT "workflow_forms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_forms" ADD CONSTRAINT "workflow_forms_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_form_id_workflow_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."workflow_forms"("id") ON DELETE set null ON UPDATE no action;