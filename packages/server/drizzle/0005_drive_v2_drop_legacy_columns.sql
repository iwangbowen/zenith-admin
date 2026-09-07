ALTER TABLE "drive_nodes" DROP CONSTRAINT "drive_nodes_thumbnail_file_id_managed_files_id_fk";
--> statement-breakpoint
ALTER TABLE "drive_nodes" DROP COLUMN "thumbnail_file_id";--> statement-breakpoint
ALTER TABLE "drive_share_links" DROP COLUMN "permission";--> statement-breakpoint
DROP TYPE "public"."drive_share_permission";