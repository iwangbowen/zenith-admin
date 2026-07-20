CREATE TYPE "public"."cms_device_type" AS ENUM('pc', 'mobile', 'bot');--> statement-breakpoint
CREATE TABLE "cms_ad_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"ad_id" integer NOT NULL,
	"stat_date" varchar(10) NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_search_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"keyword" varchar(64) NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"ip" varchar(64),
	"device_type" "cms_device_type" DEFAULT 'pc' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_visit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"path" varchar(500) NOT NULL,
	"page_kind" varchar(20) DEFAULT 'other' NOT NULL,
	"content_id" integer,
	"channel_code" varchar(50) DEFAULT 'pc' NOT NULL,
	"visitor_hash" varchar(32) NOT NULL,
	"ip" varchar(64),
	"device_type" "cms_device_type" DEFAULT 'pc' NOT NULL,
	"referrer_host" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cms_ads" ADD COLUMN "view_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_ad_stats" ADD CONSTRAINT "cms_ad_stats_ad_id_cms_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."cms_ads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_search_logs" ADD CONSTRAINT "cms_search_logs_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_visit_logs" ADD CONSTRAINT "cms_visit_logs_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_ad_stats_ad_date_uq" ON "cms_ad_stats" USING btree ("ad_id","stat_date");--> statement-breakpoint
CREATE INDEX "cms_search_logs_site_time_idx" ON "cms_search_logs" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "cms_search_logs_keyword_idx" ON "cms_search_logs" USING btree ("site_id","keyword");--> statement-breakpoint
CREATE INDEX "cms_visit_logs_site_time_idx" ON "cms_visit_logs" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "cms_visit_logs_content_idx" ON "cms_visit_logs" USING btree ("content_id") WHERE "cms_visit_logs"."content_id" is not null;