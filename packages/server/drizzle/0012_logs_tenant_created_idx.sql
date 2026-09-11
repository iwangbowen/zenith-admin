DROP INDEX "login_logs_tenant_idx";--> statement-breakpoint
DROP INDEX "operation_logs_tenant_idx";--> statement-breakpoint
CREATE INDEX "login_logs_tenant_created_idx" ON "login_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "operation_logs_tenant_created_idx" ON "operation_logs" USING btree ("tenant_id","created_at");