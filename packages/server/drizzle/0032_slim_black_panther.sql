CREATE TABLE "report_dataset_execution_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"dataset_id" integer,
	"datasource_id" integer,
	"user_id" integer,
	"scene" varchar(32) NOT NULL,
	"source_ref_id" varchar(64),
	"duration_ms" integer NOT NULL,
	"row_count" integer,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"error_code" integer,
	"error_message" varchar(512),
	"param_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_dataset_execution_logs" ADD CONSTRAINT "report_dataset_execution_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dataset_execution_logs" ADD CONSTRAINT "report_dataset_execution_logs_dataset_id_report_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."report_datasets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dataset_execution_logs" ADD CONSTRAINT "report_dataset_execution_logs_datasource_id_report_datasources_id_fk" FOREIGN KEY ("datasource_id") REFERENCES "public"."report_datasources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dataset_execution_logs" ADD CONSTRAINT "report_dataset_execution_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_dataset_execution_logs_dataset_idx" ON "report_dataset_execution_logs" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "report_dataset_execution_logs_datasource_idx" ON "report_dataset_execution_logs" USING btree ("datasource_id");--> statement-breakpoint
CREATE INDEX "report_dataset_execution_logs_scene_idx" ON "report_dataset_execution_logs" USING btree ("scene");--> statement-breakpoint
CREATE INDEX "report_dataset_execution_logs_user_idx" ON "report_dataset_execution_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "report_dataset_execution_logs_executed_idx" ON "report_dataset_execution_logs" USING btree ("executed_at");