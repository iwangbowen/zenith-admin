CREATE TYPE "public"."cms_editorial_status" AS ENUM('draft', 'pending', 'rejected', 'approved', 'clean');--> statement-breakpoint
CREATE TYPE "public"."cms_revision_kind" AS ENUM('checkpoint', 'submission', 'publication', 'restore', 'preview');--> statement-breakpoint
CREATE TYPE "public"."cms_deployment_status" AS ENUM('building', 'ready', 'active', 'retired', 'failed');--> statement-breakpoint
CREATE TYPE "public"."cms_release_status" AS ENUM('draft', 'building', 'ready', 'scheduled', 'active', 'failed', 'cancelled', 'superseded');--> statement-breakpoint
ALTER TYPE "public"."cms_field_type" ADD VALUE 'reference';--> statement-breakpoint
ALTER TYPE "public"."cms_field_type" ADD VALUE 'references';--> statement-breakpoint
ALTER TYPE "public"."cms_field_type" ADD VALUE 'object';--> statement-breakpoint
ALTER TYPE "public"."cms_field_type" ADD VALUE 'array';--> statement-breakpoint
ALTER TYPE "public"."cms_field_type" ADD VALUE 'blocks';--> statement-breakpoint
CREATE TABLE "cms_asset_rights" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_asset_rights_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"resource_id" integer NOT NULL,
	"source" varchar(500),
	"license" varchar(500),
	"expires_at" timestamp,
	"revoked" boolean DEFAULT false NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"alt" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_asset_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_asset_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"resource_id" integer NOT NULL,
	"site_id" integer NOT NULL,
	"version" integer NOT NULL,
	"url" varchar(500) NOT NULL,
	"thumb_url" varchar(500),
	"file_id" uuid,
	"mime_type" varchar(128),
	"width" integer,
	"height" integer,
	"size" integer NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_editorial_notes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_editorial_notes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"content_id" integer NOT NULL,
	"revision_id" integer,
	"field_path" varchar(200),
	"message" text NOT NULL,
	"mentioned_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_model_unique_values" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_model_unique_values_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"model_id" integer NOT NULL,
	"content_id" integer NOT NULL,
	"field" varchar(50) NOT NULL,
	"value_hash" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_model_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_model_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"model_id" integer NOT NULL,
	"version" integer NOT NULL,
	"fields" jsonb NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_content_preview_grants" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_content_preview_grants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"token" varchar(36) NOT NULL,
	"content_id" integer NOT NULL,
	"revision_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_content_preview_grants_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "cms_content_review_revisions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_content_review_revisions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"content_id" integer NOT NULL,
	"workflow_instance_id" integer NOT NULL,
	"revision_id" integer NOT NULL,
	"hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_content_revision_approvals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_content_revision_approvals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"revision_id" integer NOT NULL,
	"hash" varchar(64) NOT NULL,
	"workflow_instance_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_content_revisions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_content_revisions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"content_id" integer NOT NULL,
	"version" integer NOT NULL,
	"source_version" integer NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"kind" "cms_revision_kind" NOT NULL,
	"hash" varchar(64) NOT NULL,
	"title" varchar(255) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"remark" varchar(200),
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_content_working_copies" (
	"content_id" integer PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"editorial_status" "cms_editorial_status" DEFAULT 'draft' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"submitted_revision_id" integer,
	"approved_revision_id" integer,
	"published_revision_id" integer,
	"reject_reason" varchar(500),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_content_suppressions" (
	"content_id" integer PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_deployments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_deployments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"release_id" integer NOT NULL,
	"status" "cms_deployment_status" DEFAULT 'building' NOT NULL,
	"snapshot" jsonb,
	"manifest_hash" varchar(64),
	"artifact_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"activated_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_releases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_releases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"status" "cms_release_status" DEFAULT 'draft' NOT NULL,
	"base_generation_id" integer,
	"deployment_id" integer,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"activate_at" timestamp with time zone,
	"time_zone" varchar(80) DEFAULT 'Asia/Shanghai' NOT NULL,
	"auto_activate" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_site_generations" (
	"site_id" integer PRIMARY KEY NOT NULL,
	"active_generation_id" integer,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "model_version_id" integer;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "locale" varchar(35) DEFAULT 'zh-CN' NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "translation_of_id" integer;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "source_revision_id" integer;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "due_at" timestamp;--> statement-breakpoint
ALTER TABLE "cms_model_fields" ADD COLUMN "configuration" jsonb;--> statement-breakpoint
ALTER TABLE "cms_models" ADD COLUMN "published_version_id" integer;--> statement-breakpoint
ALTER TABLE "cms_models" ADD COLUMN "has_unpublished_changes" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_asset_rights" ADD CONSTRAINT "cms_asset_rights_resource_id_cms_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."cms_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_asset_rights" ADD CONSTRAINT "cms_asset_rights_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_asset_rights" ADD CONSTRAINT "cms_asset_rights_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_asset_versions" ADD CONSTRAINT "cms_asset_versions_resource_id_cms_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."cms_resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_asset_versions" ADD CONSTRAINT "cms_asset_versions_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_asset_versions" ADD CONSTRAINT "cms_asset_versions_file_id_managed_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."managed_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_asset_versions" ADD CONSTRAINT "cms_asset_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_asset_versions" ADD CONSTRAINT "cms_asset_versions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_editorial_notes" ADD CONSTRAINT "cms_editorial_notes_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_editorial_notes" ADD CONSTRAINT "cms_editorial_notes_revision_id_cms_content_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."cms_content_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_editorial_notes" ADD CONSTRAINT "cms_editorial_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_editorial_notes" ADD CONSTRAINT "cms_editorial_notes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_model_unique_values" ADD CONSTRAINT "cms_model_unique_values_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_model_unique_values" ADD CONSTRAINT "cms_model_unique_values_model_id_cms_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."cms_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_model_versions" ADD CONSTRAINT "cms_model_versions_model_id_cms_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."cms_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_model_versions" ADD CONSTRAINT "cms_model_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_model_versions" ADD CONSTRAINT "cms_model_versions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_preview_grants" ADD CONSTRAINT "cms_content_preview_grants_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_preview_grants" ADD CONSTRAINT "cms_content_preview_grants_revision_id_cms_content_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."cms_content_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_preview_grants" ADD CONSTRAINT "cms_content_preview_grants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_preview_grants" ADD CONSTRAINT "cms_content_preview_grants_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_review_revisions" ADD CONSTRAINT "cms_content_review_revisions_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_review_revisions" ADD CONSTRAINT "cms_content_review_revisions_revision_id_cms_content_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."cms_content_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_revision_approvals" ADD CONSTRAINT "cms_content_revision_approvals_revision_id_cms_content_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."cms_content_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_revision_approvals" ADD CONSTRAINT "cms_content_revision_approvals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_revisions" ADD CONSTRAINT "cms_content_revisions_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_revisions" ADD CONSTRAINT "cms_content_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_working_copies" ADD CONSTRAINT "cms_content_working_copies_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_working_copies" ADD CONSTRAINT "cms_content_working_copies_submitted_revision_id_cms_content_revisions_id_fk" FOREIGN KEY ("submitted_revision_id") REFERENCES "public"."cms_content_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_working_copies" ADD CONSTRAINT "cms_content_working_copies_approved_revision_id_cms_content_revisions_id_fk" FOREIGN KEY ("approved_revision_id") REFERENCES "public"."cms_content_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_working_copies" ADD CONSTRAINT "cms_content_working_copies_published_revision_id_cms_content_revisions_id_fk" FOREIGN KEY ("published_revision_id") REFERENCES "public"."cms_content_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_working_copies" ADD CONSTRAINT "cms_content_working_copies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_working_copies" ADD CONSTRAINT "cms_content_working_copies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_suppressions" ADD CONSTRAINT "cms_content_suppressions_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_suppressions" ADD CONSTRAINT "cms_content_suppressions_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_suppressions" ADD CONSTRAINT "cms_content_suppressions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_suppressions" ADD CONSTRAINT "cms_content_suppressions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_deployments" ADD CONSTRAINT "cms_deployments_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_deployments" ADD CONSTRAINT "cms_deployments_release_id_cms_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."cms_releases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_deployments" ADD CONSTRAINT "cms_deployments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_deployments" ADD CONSTRAINT "cms_deployments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_releases" ADD CONSTRAINT "cms_releases_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_releases" ADD CONSTRAINT "cms_releases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_releases" ADD CONSTRAINT "cms_releases_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_site_generations" ADD CONSTRAINT "cms_site_generations_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_site_generations" ADD CONSTRAINT "cms_site_generations_active_generation_id_cms_deployments_id_fk" FOREIGN KEY ("active_generation_id") REFERENCES "public"."cms_deployments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_asset_rights_resource_uq" ON "cms_asset_rights" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_asset_versions_resource_version_uq" ON "cms_asset_versions" USING btree ("resource_id","version");--> statement-breakpoint
CREATE INDEX "cms_asset_versions_file_idx" ON "cms_asset_versions" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "cms_editorial_notes_content_idx" ON "cms_editorial_notes" USING btree ("content_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_model_unique_value_uq" ON "cms_model_unique_values" USING btree ("site_id","model_id","field","value_hash");--> statement-breakpoint
CREATE INDEX "cms_model_unique_content_idx" ON "cms_model_unique_values" USING btree ("content_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_model_versions_model_version_uq" ON "cms_model_versions" USING btree ("model_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_content_review_revisions_instance_uq" ON "cms_content_review_revisions" USING btree ("workflow_instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_content_revision_approvals_revision_uq" ON "cms_content_revision_approvals" USING btree ("revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_content_revisions_content_version_uq" ON "cms_content_revisions" USING btree ("content_id","version");--> statement-breakpoint
CREATE INDEX "cms_content_revisions_content_hash_idx" ON "cms_content_revisions" USING btree ("content_id","hash");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_working_translation_locale_uq" ON "cms_content_working_copies" USING btree (("snapshot"->>'translationOfId'),("snapshot"->>'locale')) WHERE "cms_content_working_copies"."snapshot"->>'translationOfId' is not null;--> statement-breakpoint
CREATE INDEX "cms_content_suppressions_site_idx" ON "cms_content_suppressions" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "cms_deployments_site_idx" ON "cms_deployments" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "cms_releases_site_status_idx" ON "cms_releases" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "cms_releases_schedule_idx" ON "cms_releases" USING btree ("activate_at");--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_translation_of_id_cms_contents_id_fk" FOREIGN KEY ("translation_of_id") REFERENCES "public"."cms_contents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION cms_immutable_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['created_by', 'updated_by']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['created_by', 'updated_by']) THEN
    RAISE EXCEPTION 'CMS revisions and approval facts are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cms_content_revisions_immutable BEFORE UPDATE ON cms_content_revisions FOR EACH ROW EXECUTE FUNCTION cms_immutable_revision();
--> statement-breakpoint
CREATE TRIGGER cms_content_approvals_immutable BEFORE UPDATE ON cms_content_revision_approvals FOR EACH ROW EXECUTE FUNCTION cms_immutable_revision();
--> statement-breakpoint
CREATE TRIGGER cms_content_review_immutable BEFORE UPDATE ON cms_content_review_revisions FOR EACH ROW EXECUTE FUNCTION cms_immutable_revision();
--> statement-breakpoint
CREATE TRIGGER cms_model_versions_immutable BEFORE UPDATE ON cms_model_versions FOR EACH ROW EXECUTE FUNCTION cms_immutable_revision();
--> statement-breakpoint
CREATE TRIGGER cms_asset_versions_immutable BEFORE UPDATE ON cms_asset_versions FOR EACH ROW EXECUTE FUNCTION cms_immutable_revision();
