CREATE TYPE "public"."cms_collect_item_status" AS ENUM('success', 'skipped', 'failed');--> statement-breakpoint
CREATE TABLE "cms_collect_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_id" integer NOT NULL,
	"url" varchar(500) NOT NULL,
	"title" varchar(255),
	"status" "cms_collect_item_status" NOT NULL,
	"content_id" integer,
	"error" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_collect_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"channel_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"list_url" varchar(500) NOT NULL,
	"page_start" integer DEFAULT 1 NOT NULL,
	"page_end" integer DEFAULT 1 NOT NULL,
	"list_selector" varchar(200) NOT NULL,
	"title_selector" varchar(200) NOT NULL,
	"body_selector" varchar(200) NOT NULL,
	"summary_selector" varchar(200),
	"cover_selector" varchar(200),
	"remove_selectors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"auto_publish" boolean DEFAULT false NOT NULL,
	"localize_images" boolean DEFAULT false NOT NULL,
	"max_items" integer DEFAULT 50 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"last_run_at" timestamp,
	"remark" varchar(200),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cms_collect_items" ADD CONSTRAINT "cms_collect_items_rule_id_cms_collect_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."cms_collect_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_collect_items" ADD CONSTRAINT "cms_collect_items_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_collect_rules" ADD CONSTRAINT "cms_collect_rules_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_collect_rules" ADD CONSTRAINT "cms_collect_rules_channel_id_cms_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."cms_channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_collect_rules" ADD CONSTRAINT "cms_collect_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_collect_rules" ADD CONSTRAINT "cms_collect_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_collect_items_rule_url_uq" ON "cms_collect_items" USING btree ("rule_id","url");--> statement-breakpoint
CREATE INDEX "cms_collect_items_rule_idx" ON "cms_collect_items" USING btree ("rule_id","created_at");--> statement-breakpoint
CREATE INDEX "cms_collect_rules_site_idx" ON "cms_collect_rules" USING btree ("site_id");