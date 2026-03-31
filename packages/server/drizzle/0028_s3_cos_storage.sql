-- 扩展 file_storage_provider 枚举以支持 S3 和腾讯云 COS
ALTER TYPE "file_storage_provider" ADD VALUE 's3';--> statement-breakpoint
ALTER TYPE "file_storage_provider" ADD VALUE 'cos';--> statement-breakpoint

-- S3 兼容存储字段（AWS S3 / MinIO / Cloudflare R2 等）
ALTER TABLE "file_storage_configs" ADD COLUMN "s3_region" varchar(64);--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "s3_endpoint" varchar(256);--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "s3_bucket" varchar(128);--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "s3_access_key_id" varchar(128);--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "s3_secret_access_key" varchar(256);--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "s3_force_path_style" boolean DEFAULT false;--> statement-breakpoint

-- 腾讯云 COS 字段
ALTER TABLE "file_storage_configs" ADD COLUMN "cos_region" varchar(64);--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "cos_bucket" varchar(128);--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "cos_secret_id" varchar(128);--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "cos_secret_key" varchar(256);
