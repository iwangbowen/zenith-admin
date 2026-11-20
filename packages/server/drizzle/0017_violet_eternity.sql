ALTER TABLE "file_storage_configs" ADD COLUMN "azure_tenant_id" varchar(64);--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "azure_client_id" varchar(64);--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "azure_client_secret" varchar(256);--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "azure_subscription_id" varchar(64);--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "azure_resource_group" varchar(128);--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "azure_cloud" varchar(32) DEFAULT 'public';