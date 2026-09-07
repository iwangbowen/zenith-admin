CREATE TYPE "public"."drive_rendition_kind" AS ENUM('thumbnail', 'text', 'pdf', 'preview');--> statement-breakpoint
CREATE TYPE "public"."drive_rendition_status" AS ENUM('pending', 'ready', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."drive_share_capability" AS ENUM('preview', 'download', 'upload');--> statement-breakpoint
CREATE TYPE "public"."drive_share_kind" AS ENUM('share', 'collect');--> statement-breakpoint
CREATE TABLE "drive_node_renditions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drive_node_renditions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"node_id" integer NOT NULL,
	"version" integer NOT NULL,
	"kind" "drive_rendition_kind" NOT NULL,
	"status" "drive_rendition_status" DEFAULT 'pending' NOT NULL,
	"file_id" uuid,
	"meta" jsonb,
	"error" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "drive_node_renditions_node_kind_unique" UNIQUE("node_id","kind")
);
--> statement-breakpoint
-- drive_activities / drive_share_access_logs 在 0005_drive_partitions.sql 整表重建为分区表（含主键移除与索引），此处不再单独处理。
ALTER TABLE "managed_files" ADD COLUMN "ref_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "managed_files" ADD COLUMN "orphaned_at" timestamp;--> statement-breakpoint
ALTER TABLE "drive_nodes" ADD COLUMN "acl_chain_ids" integer[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "drive_nodes" ADD COLUMN "acl_open" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "drive_share_links" ADD COLUMN "kind" "drive_share_kind" DEFAULT 'share' NOT NULL;--> statement-breakpoint
ALTER TABLE "drive_share_links" ADD COLUMN "capabilities" "drive_share_capability"[] DEFAULT '{"preview"}' NOT NULL;--> statement-breakpoint
ALTER TABLE "drive_share_links" ADD COLUMN "max_download_count" integer;--> statement-breakpoint
ALTER TABLE "drive_share_links" ADD COLUMN "upload_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "drive_node_renditions" ADD CONSTRAINT "drive_node_renditions_node_id_drive_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."drive_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_node_renditions" ADD CONSTRAINT "drive_node_renditions_file_id_managed_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."managed_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drive_node_renditions_file_idx" ON "drive_node_renditions" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "drive_node_renditions_status_idx" ON "drive_node_renditions" USING btree ("status","kind");--> statement-breakpoint
CREATE INDEX "managed_files_orphaned_idx" ON "managed_files" USING btree ("orphaned_at") WHERE "managed_files"."orphaned_at" is not null;--> statement-breakpoint
CREATE INDEX "drive_node_texts_content_trgm_idx" ON "drive_node_texts" USING gin ("content" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "drive_nodes_acl_chain_gin_idx" ON "drive_nodes" USING gin ("acl_chain_ids");--> statement-breakpoint
INSERT INTO "drive_node_renditions" ("node_id", "version", "kind", "status", "file_id")
SELECT "id", "current_version", 'thumbnail', 'ready', "thumbnail_file_id"
FROM "drive_nodes" WHERE "thumbnail_file_id" IS NOT NULL;--> statement-breakpoint
UPDATE "drive_share_links"
SET "capabilities" = CASE WHEN "permission" = 'download'
THEN ARRAY['preview', 'download']::drive_share_capability[]
ELSE ARRAY['preview']::drive_share_capability[] END;--> statement-breakpoint
WITH RECURSIVE chain AS (
  SELECT id, ARRAY[]::integer[] AS ids, inherit_permissions AS open
  FROM drive_nodes WHERE parent_id IS NULL
  UNION ALL
  SELECT n.id,
    CASE WHEN n.inherit_permissions THEN p.ids || p.id ELSE ARRAY[]::integer[] END,
    n.inherit_permissions AND p.open
  FROM drive_nodes n JOIN chain p ON n.parent_id = p.id
)
UPDATE drive_nodes n SET acl_chain_ids = c.ids, acl_open = c.open FROM chain c WHERE n.id = c.id;--> statement-breakpoint
UPDATE managed_files f SET ref_count = (
  SELECT count(*) FROM (
    SELECT file_id FROM drive_file_versions
    UNION ALL SELECT file_id FROM drive_node_renditions WHERE file_id IS NOT NULL
  ) refs WHERE refs.file_id = f.id
);
