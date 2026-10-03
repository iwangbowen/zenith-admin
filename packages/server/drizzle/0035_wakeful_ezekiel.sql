CREATE INDEX "directory_sync_runs_status_started_idx" ON "directory_sync_runs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "directory_sync_runs_status_finished_idx" ON "directory_sync_runs" USING btree ("status","finished_at");--> statement-breakpoint
CREATE INDEX "db_backups_status_started_idx" ON "db_backups" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "db_backups_status_created_idx" ON "db_backups" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "db_backups_status_completed_idx" ON "db_backups" USING btree ("status","completed_at");--> statement-breakpoint
CREATE INDEX "payment_events_status_created_idx" ON "payment_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "payment_events_status_processed_idx" ON "payment_events" USING btree ("status","processed_at");--> statement-breakpoint
CREATE INDEX "cms_telemetry_outbox_lease_idx" ON "cms_telemetry_outbox" USING btree ("delivered_at","dead_letter_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "cms_telemetry_outbox_delivered_idx" ON "cms_telemetry_outbox" USING btree ("delivered_at");--> statement-breakpoint
CREATE INDEX "cms_telemetry_outbox_dead_idx" ON "cms_telemetry_outbox" USING btree ("dead_letter_at");--> statement-breakpoint
CREATE INDEX "drive_node_renditions_status_updated_idx" ON "drive_node_renditions" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "entity_watch_events_claimed_idx" ON "entity_watch_events" USING btree ("claimed_at");