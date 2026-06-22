-- 文件模块主键切换为 UUIDv7（应用层生成）。
-- 该迁移不保留旧的自增文件 ID 数据：清空文件记录、业务附件关联与备份记录中的文件引用。
ALTER TABLE "business_files" DROP CONSTRAINT IF EXISTS "business_files_file_id_managed_files_id_fk";--> statement-breakpoint
ALTER TABLE "db_backups" DROP CONSTRAINT IF EXISTS "db_backups_file_id_managed_files_id_fk";--> statement-breakpoint
TRUNCATE TABLE "business_files", "managed_files" RESTART IDENTITY CASCADE;--> statement-breakpoint
UPDATE "db_backups" SET "file_id" = NULL;--> statement-breakpoint
ALTER TABLE "managed_files" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "managed_files" ALTER COLUMN "id" SET DATA TYPE uuid USING NULL::uuid;--> statement-breakpoint
ALTER TABLE "business_files" ALTER COLUMN "file_id" SET DATA TYPE uuid USING NULL::uuid;--> statement-breakpoint
ALTER TABLE "db_backups" ALTER COLUMN "file_id" SET DATA TYPE uuid USING NULL::uuid;--> statement-breakpoint
DROP SEQUENCE IF EXISTS "managed_files_id_seq";--> statement-breakpoint
ALTER TABLE "business_files" ADD CONSTRAINT "business_files_file_id_managed_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."managed_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_backups" ADD CONSTRAINT "db_backups_file_id_managed_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."managed_files"("id") ON DELETE set null ON UPDATE no action;
