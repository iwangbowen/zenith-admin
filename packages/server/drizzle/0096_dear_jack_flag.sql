CREATE TYPE "public"."cms_ad_event_type" AS ENUM('impression', 'click');--> statement-breakpoint
CREATE TYPE "public"."cms_interaction_captcha_policy" AS ENUM('inherit', 'none', 'math', 'turnstile');--> statement-breakpoint
CREATE TYPE "public"."cms_interaction_kind" AS ENUM('survey', 'poll');--> statement-breakpoint
CREATE TYPE "public"."cms_interaction_participant_scope" AS ENUM('anonymous', 'member');--> statement-breakpoint
CREATE TYPE "public"."cms_interaction_question_type" AS ENUM('single', 'multiple', 'text');--> statement-breakpoint
CREATE TYPE "public"."cms_interaction_repeat_policy" AS ENUM('once_per_member', 'once_per_ip', 'multiple');--> statement-breakpoint
CREATE TYPE "public"."cms_interaction_result_visibility" AS ENUM('always', 'after_submit', 'after_close', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."cms_interaction_status" AS ENUM('draft', 'published', 'closed');--> statement-breakpoint
CREATE TYPE "public"."cms_page_block_acl_subject_type" AS ENUM('user', 'role');--> statement-breakpoint
CREATE TYPE "public"."cms_subscription_subject_type" AS ENUM('site', 'channel', 'author');--> statement-breakpoint
CREATE TABLE "cms_ad_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"ad_id" integer NOT NULL,
	"slot_id" integer NOT NULL,
	"event_type" "cms_ad_event_type" NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"visitor_hash" varchar(64) NOT NULL,
	"ip_hash" varchar(64) NOT NULL,
	"user_agent" varchar(500),
	"device" "cms_device_type" DEFAULT 'pc' NOT NULL,
	"referrer" varchar(1000),
	"path" varchar(500),
	"publish_channel_id" integer,
	"member_id" integer,
	"dedupe_key" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_interaction_answers" (
	"id" serial PRIMARY KEY NOT NULL,
	"response_id" integer NOT NULL,
	"question_id" integer NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_interaction_questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"interaction_id" integer NOT NULL,
	"label" varchar(200) NOT NULL,
	"type" "cms_interaction_question_type" DEFAULT 'single' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"min_choices" integer DEFAULT 1 NOT NULL,
	"max_choices" integer DEFAULT 1 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_interaction_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"interaction_id" integer NOT NULL,
	"member_id" integer,
	"visitor_hash" varchar(64) NOT NULL,
	"ip_hash" varchar(64) NOT NULL,
	"repeat_key" varchar(80),
	"request_key" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_interactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"code" varchar(50) NOT NULL,
	"kind" "cms_interaction_kind" NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"status" "cms_interaction_status" DEFAULT 'draft' NOT NULL,
	"participant_scope" "cms_interaction_participant_scope" DEFAULT 'anonymous' NOT NULL,
	"repeat_policy" "cms_interaction_repeat_policy" DEFAULT 'once_per_ip' NOT NULL,
	"result_visibility" "cms_interaction_result_visibility" DEFAULT 'after_submit' NOT NULL,
	"captcha_policy" "cms_interaction_captcha_policy" DEFAULT 'inherit' NOT NULL,
	"turnstile_site_key" varchar(200),
	"turnstile_secret" varchar(500),
	"thank_you_message" varchar(500) DEFAULT '感谢您的参与！' NOT NULL,
	"start_at" timestamp,
	"end_at" timestamp,
	"response_count" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_member_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"site_id" integer NOT NULL,
	"subject_type" "cms_subscription_subject_type" NOT NULL,
	"subject_key" varchar(255) NOT NULL,
	"subject_id" integer,
	"subject_label" varchar(255) NOT NULL,
	"notification_enabled" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"points_awarded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_page_block_acls" (
	"id" serial PRIMARY KEY NOT NULL,
	"page_id" integer NOT NULL,
	"block_id" varchar(100) NOT NULL,
	"subject_type" "cms_page_block_acl_subject_type" NOT NULL,
	"subject_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cms_poll_votes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cms_polls" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cms_survey_answers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cms_survey_questions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cms_surveys" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "cms_poll_votes" CASCADE;--> statement-breakpoint
DROP TABLE "cms_polls" CASCADE;--> statement-breakpoint
DROP TABLE "cms_survey_answers" CASCADE;--> statement-breakpoint
DROP TABLE "cms_survey_questions" CASCADE;--> statement-breakpoint
DROP TABLE "cms_surveys" CASCADE;--> statement-breakpoint
ALTER TABLE "cms_templates" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
UPDATE "cms_templates" SET "type" = 'interaction' WHERE "type" = 'survey';--> statement-breakpoint
DROP TYPE "public"."cms_template_type";--> statement-breakpoint
CREATE TYPE "public"."cms_template_type" AS ENUM('layout', 'index', 'list', 'detail', 'page', 'search', 'tag', 'not_found', 'custom_page', 'block', 'interaction');--> statement-breakpoint
ALTER TABLE "cms_templates" ALTER COLUMN "type" SET DATA TYPE "public"."cms_template_type" USING "type"::"public"."cms_template_type";--> statement-breakpoint
ALTER TABLE "cms_pages" ADD COLUMN "requires_dynamic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "cms_pages"
SET "requires_dynamic" = true
WHERE EXISTS (
	SELECT 1
	FROM jsonb_array_elements(
		CASE WHEN jsonb_typeof("cms_pages"."blocks") = 'array' THEN "cms_pages"."blocks" ELSE '[]'::jsonb END
	) AS block
	WHERE block->'displayCondition'->>'audience' IN ('guest', 'member')
		OR NULLIF(block->'displayCondition'->>'startAt', '') IS NOT NULL
		OR NULLIF(block->'displayCondition'->>'endAt', '') IS NOT NULL
);--> statement-breakpoint
ALTER TABLE "cms_ad_events" ADD CONSTRAINT "cms_ad_events_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_ad_events" ADD CONSTRAINT "cms_ad_events_publish_channel_id_cms_publish_channels_id_fk" FOREIGN KEY ("publish_channel_id") REFERENCES "public"."cms_publish_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_ad_events" ADD CONSTRAINT "cms_ad_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_interaction_answers" ADD CONSTRAINT "cms_interaction_answers_response_id_cms_interaction_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."cms_interaction_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_interaction_answers" ADD CONSTRAINT "cms_interaction_answers_question_id_cms_interaction_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."cms_interaction_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_interaction_questions" ADD CONSTRAINT "cms_interaction_questions_interaction_id_cms_interactions_id_fk" FOREIGN KEY ("interaction_id") REFERENCES "public"."cms_interactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_interaction_responses" ADD CONSTRAINT "cms_interaction_responses_interaction_id_cms_interactions_id_fk" FOREIGN KEY ("interaction_id") REFERENCES "public"."cms_interactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_interaction_responses" ADD CONSTRAINT "cms_interaction_responses_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_interactions" ADD CONSTRAINT "cms_interactions_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_interactions" ADD CONSTRAINT "cms_interactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_interactions" ADD CONSTRAINT "cms_interactions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_member_subscriptions" ADD CONSTRAINT "cms_member_subscriptions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_member_subscriptions" ADD CONSTRAINT "cms_member_subscriptions_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_page_block_acls" ADD CONSTRAINT "cms_page_block_acls_page_id_cms_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."cms_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_ad_events_dedupe_uq" ON "cms_ad_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "cms_ad_events_site_time_idx" ON "cms_ad_events" USING btree ("site_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "cms_ad_events_ad_time_idx" ON "cms_ad_events" USING btree ("ad_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "cms_ad_events_slot_time_idx" ON "cms_ad_events" USING btree ("slot_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "cms_ad_events_type_device_time_idx" ON "cms_ad_events" USING btree ("event_type","device","occurred_at");--> statement-breakpoint
CREATE INDEX "cms_ad_events_channel_time_idx" ON "cms_ad_events" USING btree ("publish_channel_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_interaction_answers_response_question_uq" ON "cms_interaction_answers" USING btree ("response_id","question_id");--> statement-breakpoint
CREATE INDEX "cms_interaction_answers_question_idx" ON "cms_interaction_answers" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "cms_interaction_questions_parent_idx" ON "cms_interaction_questions" USING btree ("interaction_id","sort");--> statement-breakpoint
CREATE INDEX "cms_interaction_responses_parent_time_idx" ON "cms_interaction_responses" USING btree ("interaction_id","created_at","id");--> statement-breakpoint
CREATE INDEX "cms_interaction_responses_member_idx" ON "cms_interaction_responses" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_interaction_responses_repeat_uq" ON "cms_interaction_responses" USING btree ("interaction_id","repeat_key") WHERE "cms_interaction_responses"."repeat_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_interaction_responses_request_uq" ON "cms_interaction_responses" USING btree ("interaction_id","request_key") WHERE "cms_interaction_responses"."request_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_interactions_site_code_uq" ON "cms_interactions" USING btree ("site_id","code");--> statement-breakpoint
CREATE INDEX "cms_interactions_site_status_idx" ON "cms_interactions" USING btree ("site_id","status","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_member_subscriptions_subject_uq" ON "cms_member_subscriptions" USING btree ("member_id","site_id","subject_type","subject_key");--> statement-breakpoint
CREATE INDEX "cms_member_subscriptions_member_idx" ON "cms_member_subscriptions" USING btree ("member_id","active","created_at");--> statement-breakpoint
CREATE INDEX "cms_member_subscriptions_subject_idx" ON "cms_member_subscriptions" USING btree ("site_id","subject_type","subject_key","active");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_page_block_acls_grant_uq" ON "cms_page_block_acls" USING btree ("page_id","block_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "cms_page_block_acls_block_idx" ON "cms_page_block_acls" USING btree ("page_id","block_id");--> statement-breakpoint
CREATE INDEX "cms_page_block_acls_subject_idx" ON "cms_page_block_acls" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_notifications_member_type_biz_uq" ON "member_notifications" USING btree ("member_id","type","biz_id") WHERE "member_notifications"."biz_id" is not null and "member_notifications"."type" = 'cms_content_published';--> statement-breakpoint
DROP TYPE "public"."cms_poll_status";--> statement-breakpoint
DROP TYPE "public"."cms_survey_question_type";--> statement-breakpoint
DROP TYPE "public"."cms_survey_status";