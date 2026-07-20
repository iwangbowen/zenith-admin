CREATE TYPE "public"."cms_survey_question_type" AS ENUM('single', 'multiple', 'text');--> statement-breakpoint
CREATE TYPE "public"."cms_survey_status" AS ENUM('draft', 'published', 'closed');--> statement-breakpoint
CREATE TABLE "cms_content_favorites" (
	"member_id" integer NOT NULL,
	"content_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cms_content_favorites_member_id_content_id_pk" PRIMARY KEY("member_id","content_id")
);
--> statement-breakpoint
CREATE TABLE "cms_content_likes" (
	"member_id" integer NOT NULL,
	"content_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cms_content_likes_member_id_content_id_pk" PRIMARY KEY("member_id","content_id")
);
--> statement-breakpoint
CREATE TABLE "cms_member_view_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"content_id" integer NOT NULL,
	"site_id" integer NOT NULL,
	"view_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_survey_answers" (
	"id" serial PRIMARY KEY NOT NULL,
	"survey_id" integer NOT NULL,
	"member_id" integer,
	"ip" varchar(64),
	"answers" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_survey_questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"survey_id" integer NOT NULL,
	"label" varchar(200) NOT NULL,
	"type" "cms_survey_question_type" DEFAULT 'single' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_surveys" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"code" varchar(50) NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"status" "cms_survey_status" DEFAULT 'draft' NOT NULL,
	"allow_anonymous" boolean DEFAULT true NOT NULL,
	"start_at" timestamp,
	"end_at" timestamp,
	"answer_count" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "like_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD COLUMN "favorite_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_content_favorites" ADD CONSTRAINT "cms_content_favorites_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_favorites" ADD CONSTRAINT "cms_content_favorites_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_likes" ADD CONSTRAINT "cms_content_likes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_likes" ADD CONSTRAINT "cms_content_likes_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_member_view_history" ADD CONSTRAINT "cms_member_view_history_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_member_view_history" ADD CONSTRAINT "cms_member_view_history_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_member_view_history" ADD CONSTRAINT "cms_member_view_history_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_survey_answers" ADD CONSTRAINT "cms_survey_answers_survey_id_cms_surveys_id_fk" FOREIGN KEY ("survey_id") REFERENCES "public"."cms_surveys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_survey_answers" ADD CONSTRAINT "cms_survey_answers_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_survey_questions" ADD CONSTRAINT "cms_survey_questions_survey_id_cms_surveys_id_fk" FOREIGN KEY ("survey_id") REFERENCES "public"."cms_surveys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_surveys" ADD CONSTRAINT "cms_surveys_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_surveys" ADD CONSTRAINT "cms_surveys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_surveys" ADD CONSTRAINT "cms_surveys_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cms_content_favorites_content_idx" ON "cms_content_favorites" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "cms_content_favorites_member_idx" ON "cms_content_favorites" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "cms_content_likes_content_idx" ON "cms_content_likes" USING btree ("content_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_member_view_history_uq" ON "cms_member_view_history" USING btree ("member_id","content_id");--> statement-breakpoint
CREATE INDEX "cms_member_view_history_member_idx" ON "cms_member_view_history" USING btree ("member_id","updated_at");--> statement-breakpoint
CREATE INDEX "cms_survey_answers_survey_idx" ON "cms_survey_answers" USING btree ("survey_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_survey_answers_member_uq" ON "cms_survey_answers" USING btree ("survey_id","member_id") WHERE "cms_survey_answers"."member_id" is not null;--> statement-breakpoint
CREATE INDEX "cms_survey_questions_survey_idx" ON "cms_survey_questions" USING btree ("survey_id","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_surveys_site_code_uq" ON "cms_surveys" USING btree ("site_id","code");