CREATE TYPE "public"."cms_content_type" AS ENUM('article', 'album', 'media', 'link');--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "content_type" "cms_content_type" DEFAULT 'article' NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "media_data" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "cover_thumb" varchar(500);