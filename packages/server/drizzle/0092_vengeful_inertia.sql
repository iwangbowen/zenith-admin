ALTER TABLE "cms_contents" ADD COLUMN "has_image" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "has_video" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "has_attachment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_tags" ADD COLUMN "group_name" varchar(50);