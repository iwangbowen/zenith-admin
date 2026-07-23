CREATE TYPE "public"."cms_publish_artifact_status" AS ENUM('generated', 'deleted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."cms_publish_target_type" AS ENUM('content', 'contents', 'channel', 'site', 'theme', 'template', 'page');--> statement-breakpoint
CREATE TYPE "public"."cms_template_source" AS ENUM('manual', 'package');--> statement-breakpoint
CREATE TYPE "public"."cms_template_type" AS ENUM('layout', 'index', 'list', 'detail', 'page', 'search', 'tag', 'not_found', 'custom_page', 'block', 'survey');--> statement-breakpoint
CREATE TYPE "public"."cms_theme_deployment_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."cms_theme_package_status" AS ENUM('validated', 'disabled');--> statement-breakpoint
CREATE TABLE "app_data_migrations" (
	"key" varchar(128) PRIMARY KEY NOT NULL,
	"description" varchar(500) NOT NULL,
	"applied_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_publish_artifacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"site_id" integer NOT NULL,
	"publish_channel_id" integer,
	"target_type" "cms_publish_target_type" NOT NULL,
	"content_id" integer,
	"channel_id" integer,
	"page_id" integer,
	"theme_code" varchar(50),
	"theme_package_id" integer,
	"template_id" integer,
	"template_version" integer,
	"path" varchar(1000) NOT NULL,
	"url" varchar(1000),
	"checksum" varchar(64),
	"size" integer,
	"status" "cms_publish_artifact_status" NOT NULL,
	"error" text,
	"generated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_template_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"version" integer NOT NULL,
	"dsl" jsonb NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"change_note" varchar(500),
	"theme_package_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer,
	"theme_code" varchar(50) NOT NULL,
	"type" "cms_template_type" NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"source" "cms_template_source" DEFAULT 'manual' NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"active_version" integer,
	"lifecycle_revision" integer DEFAULT 0 NOT NULL,
	"description" varchar(500),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_theme_deployments" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"theme_code" varchar(50) NOT NULL,
	"theme_package_id" integer NOT NULL,
	"status" "cms_theme_deployment_status" DEFAULT 'active' NOT NULL,
	"activated_at" timestamp DEFAULT now() NOT NULL,
	"deactivated_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_theme_packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"version" varchar(64) NOT NULL,
	"engine_min" integer NOT NULL,
	"engine_max" integer NOT NULL,
	"signing_key_id" varchar(64) NOT NULL,
	"archive_checksum" varchar(64) NOT NULL,
	"manifest" jsonb NOT NULL,
	"validation_report" jsonb NOT NULL,
	"storage_key" varchar(255) NOT NULL,
	"status" "cms_theme_package_status" DEFAULT 'validated' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cms_sites" ADD COLUMN "theme_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_sites" ADD COLUMN "template_refs_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_publish_artifacts" ADD CONSTRAINT "cms_publish_artifacts_task_id_async_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."async_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_publish_artifacts" ADD CONSTRAINT "cms_publish_artifacts_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_publish_artifacts" ADD CONSTRAINT "cms_publish_artifacts_publish_channel_id_cms_publish_channels_id_fk" FOREIGN KEY ("publish_channel_id") REFERENCES "public"."cms_publish_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_publish_artifacts" ADD CONSTRAINT "cms_publish_artifacts_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_publish_artifacts" ADD CONSTRAINT "cms_publish_artifacts_channel_id_cms_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."cms_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_publish_artifacts" ADD CONSTRAINT "cms_publish_artifacts_page_id_cms_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."cms_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_publish_artifacts" ADD CONSTRAINT "cms_publish_artifacts_theme_package_id_cms_theme_packages_id_fk" FOREIGN KEY ("theme_package_id") REFERENCES "public"."cms_theme_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_publish_artifacts" ADD CONSTRAINT "cms_publish_artifacts_template_id_cms_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."cms_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_template_versions" ADD CONSTRAINT "cms_template_versions_template_id_cms_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."cms_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_template_versions" ADD CONSTRAINT "cms_template_versions_theme_package_id_cms_theme_packages_id_fk" FOREIGN KEY ("theme_package_id") REFERENCES "public"."cms_theme_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_template_versions" ADD CONSTRAINT "cms_template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_template_versions" ADD CONSTRAINT "cms_template_versions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_templates" ADD CONSTRAINT "cms_templates_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_templates" ADD CONSTRAINT "cms_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_templates" ADD CONSTRAINT "cms_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_theme_deployments" ADD CONSTRAINT "cms_theme_deployments_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_theme_deployments" ADD CONSTRAINT "cms_theme_deployments_theme_package_id_cms_theme_packages_id_fk" FOREIGN KEY ("theme_package_id") REFERENCES "public"."cms_theme_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_theme_deployments" ADD CONSTRAINT "cms_theme_deployments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_theme_deployments" ADD CONSTRAINT "cms_theme_deployments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_theme_packages" ADD CONSTRAINT "cms_theme_packages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_theme_packages" ADD CONSTRAINT "cms_theme_packages_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_publish_artifacts_task_path_uq" ON "cms_publish_artifacts" USING btree ("task_id","path");--> statement-breakpoint
CREATE INDEX "cms_publish_artifacts_site_time_idx" ON "cms_publish_artifacts" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "cms_publish_artifacts_task_status_idx" ON "cms_publish_artifacts" USING btree ("task_id","status");--> statement-breakpoint
CREATE INDEX "cms_publish_artifacts_target_idx" ON "cms_publish_artifacts" USING btree ("target_type","content_id","channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_template_versions_template_version_uq" ON "cms_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "cms_template_versions_package_idx" ON "cms_template_versions" USING btree ("theme_package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_templates_global_code_uq" ON "cms_templates" USING btree ("theme_code","type","code") WHERE "cms_templates"."site_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_templates_site_code_uq" ON "cms_templates" USING btree ("site_id","theme_code","type","code") WHERE "cms_templates"."site_id" is not null;--> statement-breakpoint
CREATE INDEX "cms_templates_site_theme_idx" ON "cms_templates" USING btree ("site_id","theme_code","status");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_theme_deployments_site_package_uq" ON "cms_theme_deployments" USING btree ("site_id","theme_package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_theme_deployments_site_active_uq" ON "cms_theme_deployments" USING btree ("site_id") WHERE "cms_theme_deployments"."status" = 'active';--> statement-breakpoint
CREATE INDEX "cms_theme_deployments_site_history_idx" ON "cms_theme_deployments" USING btree ("site_id","theme_code","activated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_theme_packages_code_version_uq" ON "cms_theme_packages" USING btree ("code","version");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_theme_packages_archive_checksum_uq" ON "cms_theme_packages" USING btree ("archive_checksum");--> statement-breakpoint
CREATE INDEX "cms_theme_packages_code_status_idx" ON "cms_theme_packages" USING btree ("code","status");