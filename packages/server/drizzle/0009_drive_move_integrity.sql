ALTER TYPE "public"."drive_activity_action" ADD VALUE 'metadata_change';--> statement-breakpoint
ALTER TABLE "drive_nodes" ADD CONSTRAINT "drive_nodes_id_space_unique" UNIQUE("id","space_id");--> statement-breakpoint
ALTER TABLE "drive_nodes" ADD CONSTRAINT "drive_nodes_parent_space_fk" FOREIGN KEY ("parent_id","space_id") REFERENCES "public"."drive_nodes"("id","space_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drive_activities_id_idx" ON "drive_activities" USING btree ("id");