CREATE TYPE "public"."cms_distribution_conflict_strategy" AS ENUM('skip', 'overwrite', 'create-new');--> statement-breakpoint
CREATE TYPE "public"."cms_distribution_mode" AS ENUM('copy', 'mapping', 'scheduled');--> statement-breakpoint
CREATE TABLE "cms_distribution_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"source_site_id" integer NOT NULL,
	"source_channel_id" integer,
	"target_site_id" integer NOT NULL,
	"target_channel_id" integer NOT NULL,
	"mode" "cms_distribution_mode" DEFAULT 'copy' NOT NULL,
	"conflict_strategy" "cms_distribution_conflict_strategy" DEFAULT 'skip' NOT NULL,
	"filters" jsonb DEFAULT '{"statuses":["published"],"contentTypes":[],"keyword":null,"publishedFrom":null,"publishedTo":null}'::jsonb NOT NULL,
	"schedule_cron" varchar(100),
	"next_run_at" timestamp,
	"last_run_at" timestamp,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"remark" varchar(500),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_site_inheritances" (
	"site_id" integer PRIMARY KEY NOT NULL,
	"seo_title" boolean DEFAULT false NOT NULL,
	"seo_keywords" boolean DEFAULT false NOT NULL,
	"seo_description" boolean DEFAULT false NOT NULL,
	"static_mode" boolean DEFAULT false NOT NULL,
	"review_mode" boolean DEFAULT false NOT NULL,
	"webhook" boolean DEFAULT false NOT NULL,
	"cdn" boolean DEFAULT false NOT NULL,
	"theme" boolean DEFAULT false NOT NULL,
	"theme_config" boolean DEFAULT false NOT NULL,
	"templates" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "distribution_rule_id" integer;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "distribution_source_id" integer;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "distribution_source_version" integer;--> statement-breakpoint
ALTER TABLE "cms_sites" ADD COLUMN "parent_id" integer;--> statement-breakpoint
ALTER TABLE "cms_distribution_rules" ADD CONSTRAINT "cms_distribution_rules_source_site_id_cms_sites_id_fk" FOREIGN KEY ("source_site_id") REFERENCES "public"."cms_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_distribution_rules" ADD CONSTRAINT "cms_distribution_rules_source_channel_id_cms_channels_id_fk" FOREIGN KEY ("source_channel_id") REFERENCES "public"."cms_channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_distribution_rules" ADD CONSTRAINT "cms_distribution_rules_target_site_id_cms_sites_id_fk" FOREIGN KEY ("target_site_id") REFERENCES "public"."cms_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_distribution_rules" ADD CONSTRAINT "cms_distribution_rules_target_channel_id_cms_channels_id_fk" FOREIGN KEY ("target_channel_id") REFERENCES "public"."cms_channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_distribution_rules" ADD CONSTRAINT "cms_distribution_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_distribution_rules" ADD CONSTRAINT "cms_distribution_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_site_inheritances" ADD CONSTRAINT "cms_site_inheritances_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_site_inheritances" ADD CONSTRAINT "cms_site_inheritances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_site_inheritances" ADD CONSTRAINT "cms_site_inheritances_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cms_distribution_rules_source_idx" ON "cms_distribution_rules" USING btree ("source_site_id","source_channel_id","status");--> statement-breakpoint
CREATE INDEX "cms_distribution_rules_target_idx" ON "cms_distribution_rules" USING btree ("target_site_id","target_channel_id","status");--> statement-breakpoint
CREATE INDEX "cms_distribution_rules_due_idx" ON "cms_distribution_rules" USING btree ("mode","status","next_run_at");--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_distribution_rule_id_cms_distribution_rules_id_fk" FOREIGN KEY ("distribution_rule_id") REFERENCES "public"."cms_distribution_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_distribution_source_id_cms_contents_id_fk" FOREIGN KEY ("distribution_source_id") REFERENCES "public"."cms_contents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_sites" ADD CONSTRAINT "cms_sites_parent_id_cms_sites_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."cms_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cms_contents_distribution_source_idx" ON "cms_contents" USING btree ("distribution_rule_id","distribution_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_contents_distribution_materialization_uq" ON "cms_contents" USING btree ("distribution_rule_id","distribution_source_id") WHERE "cms_contents"."distribution_rule_id" is not null and "cms_contents"."distribution_source_id" is not null and "cms_contents"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "cms_sites_parent_idx" ON "cms_sites" USING btree ("parent_id","sort","id");