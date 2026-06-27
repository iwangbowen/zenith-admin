ALTER TYPE "public"."report_datasource_type" ADD VALUE 'sqlserver';--> statement-breakpoint
ALTER TYPE "public"."report_datasource_type" ADD VALUE 'static';--> statement-breakpoint
ALTER TABLE "report_datasets" ADD COLUMN "materialize" jsonb DEFAULT '{}'::jsonb NOT NULL;