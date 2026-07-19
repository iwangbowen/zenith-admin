CREATE TYPE "public"."cms_channel_type" AS ENUM('list', 'page', 'link');--> statement-breakpoint
CREATE TYPE "public"."cms_content_status" AS ENUM('draft', 'pending', 'published', 'offline', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."cms_field_type" AS ENUM('text', 'textarea', 'richtext', 'number', 'date', 'datetime', 'image', 'file', 'select', 'radio', 'checkbox', 'switch');--> statement-breakpoint
CREATE TYPE "public"."cms_fragment_type" AS ENUM('html', 'text', 'image', 'json');--> statement-breakpoint
CREATE TYPE "public"."cms_static_mode" AS ENUM('dynamic', 'hybrid', 'static');--> statement-breakpoint
CREATE TABLE "cms_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"parent_id" integer DEFAULT 0 NOT NULL,
	"model_id" integer,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"path" varchar(255) NOT NULL,
	"type" "cms_channel_type" DEFAULT 'list' NOT NULL,
	"link_url" varchar(500),
	"list_template" varchar(50),
	"detail_template" varchar(50),
	"page_size" integer DEFAULT 20 NOT NULL,
	"page_content" text,
	"seo_title" varchar(255),
	"seo_keywords" varchar(500),
	"seo_description" varchar(500),
	"image" varchar(500),
	"visible" boolean DEFAULT true NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_content_tags" (
	"content_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "cms_content_tags_content_id_tag_id_pk" PRIMARY KEY("content_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "cms_contents" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"channel_id" integer NOT NULL,
	"model_id" integer,
	"title" varchar(255) NOT NULL,
	"slug" varchar(255),
	"summary" text,
	"cover_image" varchar(500),
	"author" varchar(50),
	"source" varchar(100),
	"body" text,
	"extend" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_link" varchar(500),
	"is_top" boolean DEFAULT false NOT NULL,
	"is_recommend" boolean DEFAULT false NOT NULL,
	"is_hot" boolean DEFAULT false NOT NULL,
	"status" "cms_content_status" DEFAULT 'draft' NOT NULL,
	"reject_reason" varchar(500),
	"published_at" timestamp,
	"scheduled_at" timestamp,
	"view_count" integer DEFAULT 0 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"seo_title" varchar(255),
	"seo_keywords" varchar(500),
	"seo_description" varchar(500),
	"search_vector" "tsvector",
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_fragments" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" "cms_fragment_type" DEFAULT 'html' NOT NULL,
	"content" text,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_friend_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"url" varchar(500) NOT NULL,
	"logo" varchar(500),
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"remark" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_model_fields" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_id" integer NOT NULL,
	"name" varchar(50) NOT NULL,
	"label" varchar(100) NOT NULL,
	"field_type" "cms_field_type" DEFAULT 'text' NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"searchable" boolean DEFAULT false NOT NULL,
	"show_in_list" boolean DEFAULT false NOT NULL,
	"placeholder" varchar(200),
	"default_value" text,
	"options" jsonb,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(50) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cms_models_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "cms_sites" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(50) NOT NULL,
	"domain" varchar(255),
	"alias_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"title" varchar(200),
	"keywords" varchar(500),
	"description" varchar(1000),
	"logo" varchar(500),
	"favicon" varchar(500),
	"icp" varchar(100),
	"copyright" varchar(255),
	"theme" varchar(50) DEFAULT 'default' NOT NULL,
	"static_mode" "cms_static_mode" DEFAULT 'hybrid' NOT NULL,
	"robots" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"remark" text,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cms_sites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "cms_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"name" varchar(50) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"content_count" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cms_channels" ADD CONSTRAINT "cms_channels_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_channels" ADD CONSTRAINT "cms_channels_model_id_cms_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."cms_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_channels" ADD CONSTRAINT "cms_channels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_channels" ADD CONSTRAINT "cms_channels_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_tags" ADD CONSTRAINT "cms_content_tags_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_tags" ADD CONSTRAINT "cms_content_tags_tag_id_cms_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."cms_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_channel_id_cms_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."cms_channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_model_id_cms_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."cms_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_fragments" ADD CONSTRAINT "cms_fragments_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_fragments" ADD CONSTRAINT "cms_fragments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_fragments" ADD CONSTRAINT "cms_fragments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_friend_links" ADD CONSTRAINT "cms_friend_links_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_friend_links" ADD CONSTRAINT "cms_friend_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_friend_links" ADD CONSTRAINT "cms_friend_links_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_model_fields" ADD CONSTRAINT "cms_model_fields_model_id_cms_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."cms_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_model_fields" ADD CONSTRAINT "cms_model_fields_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_model_fields" ADD CONSTRAINT "cms_model_fields_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_models" ADD CONSTRAINT "cms_models_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_models" ADD CONSTRAINT "cms_models_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_sites" ADD CONSTRAINT "cms_sites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_sites" ADD CONSTRAINT "cms_sites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_sites" ADD CONSTRAINT "cms_sites_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_tags" ADD CONSTRAINT "cms_tags_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_tags" ADD CONSTRAINT "cms_tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_tags" ADD CONSTRAINT "cms_tags_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_channels_site_path_uq" ON "cms_channels" USING btree ("site_id","path");--> statement-breakpoint
CREATE INDEX "cms_channels_site_parent_idx" ON "cms_channels" USING btree ("site_id","parent_id");--> statement-breakpoint
CREATE INDEX "cms_contents_site_channel_idx" ON "cms_contents" USING btree ("site_id","channel_id");--> statement-breakpoint
CREATE INDEX "cms_contents_status_idx" ON "cms_contents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cms_contents_published_at_idx" ON "cms_contents" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "cms_contents_search_idx" ON "cms_contents" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_contents_site_slug_uq" ON "cms_contents" USING btree ("site_id","slug") WHERE "cms_contents"."slug" is not null and "cms_contents"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_fragments_site_code_uq" ON "cms_fragments" USING btree ("site_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_model_fields_model_name_uq" ON "cms_model_fields" USING btree ("model_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_sites_domain_uq" ON "cms_sites" USING btree ("domain") WHERE "cms_sites"."domain" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_tags_site_name_uq" ON "cms_tags" USING btree ("site_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_tags_site_slug_uq" ON "cms_tags" USING btree ("site_id","slug");--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "cms_contents_title_trgm_idx" ON "cms_contents" USING gin ("title" gin_trgm_ops);
