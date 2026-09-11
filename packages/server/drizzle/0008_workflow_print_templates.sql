CREATE TYPE "public"."report_print_source_type" AS ENUM('dataset', 'entity');--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD COLUMN "print_template_id" integer;--> statement-breakpoint
ALTER TABLE "report_print_templates" ADD COLUMN "source_type" "report_print_source_type" DEFAULT 'dataset' NOT NULL;--> statement-breakpoint
ALTER TABLE "report_print_templates" ADD COLUMN "entity_kind" varchar(32);--> statement-breakpoint
ALTER TABLE "report_print_templates" ADD COLUMN "entity_ref_id" integer;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_print_template_fk" FOREIGN KEY ("print_template_id") REFERENCES "public"."report_print_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_print_templates_entity_idx" ON "report_print_templates" USING btree ("entity_kind","entity_ref_id");