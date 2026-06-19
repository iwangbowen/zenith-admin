ALTER TABLE "ssh_profiles" ADD COLUMN "group_name" varchar(128);--> statement-breakpoint
ALTER TABLE "ssh_profiles" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;