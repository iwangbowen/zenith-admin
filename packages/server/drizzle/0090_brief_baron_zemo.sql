CREATE TYPE "public"."cms_resource_type" AS ENUM('image', 'video', 'audio', 'document', 'other');--> statement-breakpoint
CREATE TABLE "cms_resources" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"type" "cms_resource_type" DEFAULT 'image' NOT NULL,
	"name" varchar(255) NOT NULL,
	"url" varchar(500) NOT NULL,
	"thumb_url" varchar(500),
	"file_id" uuid,
	"size" integer DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"mime_type" varchar(128),
	"remark" varchar(200),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cms_resources" ADD CONSTRAINT "cms_resources_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_resources" ADD CONSTRAINT "cms_resources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_resources" ADD CONSTRAINT "cms_resources_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cms_resources_site_type_idx" ON "cms_resources" USING btree ("site_id","type");