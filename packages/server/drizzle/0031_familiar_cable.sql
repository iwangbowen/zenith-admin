ALTER TABLE "report_alert_rules" ALTER COLUMN "webhook_url" SET DATA TYPE varchar(1024);--> statement-breakpoint
ALTER TABLE "report_dashboard_subscriptions" ALTER COLUMN "webhook_url" SET DATA TYPE varchar(1024);--> statement-breakpoint
ALTER TABLE "report_alert_rules" ADD COLUMN "tenant_id" integer;--> statement-breakpoint
ALTER TABLE "report_dashboard_categories" ADD COLUMN "tenant_id" integer;--> statement-breakpoint
ALTER TABLE "report_dashboard_shares" ADD COLUMN "token_encrypted" varchar(256);--> statement-breakpoint
ALTER TABLE "report_dashboard_subscriptions" ADD COLUMN "tenant_id" integer;--> statement-breakpoint
ALTER TABLE "report_dashboards" ADD COLUMN "tenant_id" integer;--> statement-breakpoint
ALTER TABLE "report_datasets" ADD COLUMN "tenant_id" integer;--> statement-breakpoint
ALTER TABLE "report_datasources" ADD COLUMN "tenant_id" integer;--> statement-breakpoint
ALTER TABLE "report_print_templates" ADD COLUMN "tenant_id" integer;--> statement-breakpoint
ALTER TABLE "report_alert_rules" ADD CONSTRAINT "report_alert_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_categories" ADD CONSTRAINT "report_dashboard_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_subscriptions" ADD CONSTRAINT "report_dashboard_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboards" ADD CONSTRAINT "report_dashboards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_datasets" ADD CONSTRAINT "report_datasets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_datasources" ADD CONSTRAINT "report_datasources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_print_templates" ADD CONSTRAINT "report_print_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_alert_rules_tenant_idx" ON "report_alert_rules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "report_dashboard_categories_tenant_idx" ON "report_dashboard_categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "report_dashboard_subscriptions_tenant_idx" ON "report_dashboard_subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "report_dashboard_subscriptions_dashboard_idx" ON "report_dashboard_subscriptions" USING btree ("dashboard_id");--> statement-breakpoint
CREATE INDEX "report_dashboards_tenant_idx" ON "report_dashboards" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "report_dashboards_category_idx" ON "report_dashboards" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "report_datasets_tenant_idx" ON "report_datasets" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "report_datasets_datasource_idx" ON "report_datasets" USING btree ("datasource_id");--> statement-breakpoint
CREATE INDEX "report_datasources_tenant_idx" ON "report_datasources" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "report_print_templates_tenant_idx" ON "report_print_templates" USING btree ("tenant_id");