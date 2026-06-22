ALTER TABLE "workflow_categories" DROP CONSTRAINT "workflow_categories_code_uniq";--> statement-breakpoint
ALTER TABLE "workflow_forms" DROP CONSTRAINT "workflow_forms_code_uniq";--> statement-breakpoint
ALTER TABLE "workflow_categories" ADD CONSTRAINT "workflow_categories_code_uniq" UNIQUE("tenant_id","code");--> statement-breakpoint
ALTER TABLE "workflow_forms" ADD CONSTRAINT "workflow_forms_code_uniq" UNIQUE("tenant_id","code");