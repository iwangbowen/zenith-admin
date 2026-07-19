CREATE TABLE "cms_pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"is_home" boolean DEFAULT false NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seo_title" varchar(255),
	"seo_keywords" varchar(500),
	"seo_description" varchar(500),
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(200),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cms_pages" ADD CONSTRAINT "cms_pages_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_pages" ADD CONSTRAINT "cms_pages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_pages" ADD CONSTRAINT "cms_pages_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_pages_site_slug_uq" ON "cms_pages" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX "cms_pages_site_idx" ON "cms_pages" USING btree ("site_id");