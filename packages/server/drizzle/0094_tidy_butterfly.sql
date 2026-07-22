CREATE TYPE "public"."cms_form_captcha_provider" AS ENUM('inherit', 'none', 'math', 'turnstile');--> statement-breakpoint
CREATE TYPE "public"."cms_search_word_type" AS ENUM('extension', 'stop');--> statement-breakpoint
CREATE TABLE "cms_hotword_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_hotwords" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"group_id" integer,
	"keyword" varchar(100) NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_resource_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"parent_id" integer,
	"name" varchar(100) NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cms_search_words" DROP CONSTRAINT "cms_search_words_word_unique";--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "social_image_alt" varchar(255);--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "twitter_creator" varchar(100);--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "locked_at" timestamp;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "locked_by" integer;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "lock_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "cms_forms" ADD COLUMN "captcha_provider" "cms_form_captcha_provider" DEFAULT 'inherit' NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_forms" ADD COLUMN "turnstile_site_key" varchar(200);--> statement-breakpoint
ALTER TABLE "cms_forms" ADD COLUMN "turnstile_secret" varchar(500);--> statement-breakpoint
ALTER TABLE "cms_resources" ADD COLUMN "folder_id" integer;--> statement-breakpoint
ALTER TABLE "cms_search_words" ADD COLUMN "site_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_search_words" ADD COLUMN "type" "cms_search_word_type" DEFAULT 'extension' NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_search_words" ADD COLUMN "group_name" varchar(100) DEFAULT '默认分组' NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_hotword_groups" ADD CONSTRAINT "cms_hotword_groups_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_hotword_groups" ADD CONSTRAINT "cms_hotword_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_hotword_groups" ADD CONSTRAINT "cms_hotword_groups_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_hotwords" ADD CONSTRAINT "cms_hotwords_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_hotwords" ADD CONSTRAINT "cms_hotwords_group_id_cms_hotword_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."cms_hotword_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_hotwords" ADD CONSTRAINT "cms_hotwords_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_hotwords" ADD CONSTRAINT "cms_hotwords_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_resource_folders" ADD CONSTRAINT "cms_resource_folders_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_resource_folders" ADD CONSTRAINT "cms_resource_folders_parent_id_cms_resource_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."cms_resource_folders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_resource_folders" ADD CONSTRAINT "cms_resource_folders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_resource_folders" ADD CONSTRAINT "cms_resource_folders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_hotword_groups_site_name_uq" ON "cms_hotword_groups" USING btree ("site_id","name");--> statement-breakpoint
CREATE INDEX "cms_hotword_groups_site_sort_idx" ON "cms_hotword_groups" USING btree ("site_id","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_hotwords_site_keyword_uq" ON "cms_hotwords" USING btree ("site_id","keyword");--> statement-breakpoint
CREATE INDEX "cms_hotwords_site_group_sort_idx" ON "cms_hotwords" USING btree ("site_id","group_id","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_resource_folders_site_parent_name_uq" ON "cms_resource_folders" USING btree ("site_id","parent_id","name") WHERE "cms_resource_folders"."parent_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_resource_folders_site_root_name_uq" ON "cms_resource_folders" USING btree ("site_id","name") WHERE "cms_resource_folders"."parent_id" is null;--> statement-breakpoint
CREATE INDEX "cms_resource_folders_site_parent_idx" ON "cms_resource_folders" USING btree ("site_id","parent_id");--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_resources" ADD CONSTRAINT "cms_resources_folder_id_cms_resource_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."cms_resource_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_search_words" ADD CONSTRAINT "cms_search_words_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cms_contents_locked_at_idx" ON "cms_contents" USING btree ("locked_at");--> statement-breakpoint
CREATE INDEX "cms_resources_site_folder_idx" ON "cms_resources" USING btree ("site_id","folder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_search_words_site_type_word_uq" ON "cms_search_words" USING btree ("site_id","type","word");--> statement-breakpoint
CREATE INDEX "cms_search_words_site_group_idx" ON "cms_search_words" USING btree ("site_id","type","group_name");