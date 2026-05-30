ALTER TABLE "menus" ADD COLUMN "query" varchar(512);--> statement-breakpoint
ALTER TABLE "menus" ADD COLUMN "is_external" boolean DEFAULT false NOT NULL;