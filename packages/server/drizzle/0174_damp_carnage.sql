CREATE TABLE "report_print_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"dataset_id" integer,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"page_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "report_print_templates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "report_print_templates" ADD CONSTRAINT "report_print_templates_dataset_id_report_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."report_datasets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_print_templates" ADD CONSTRAINT "report_print_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_print_templates" ADD CONSTRAINT "report_print_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;