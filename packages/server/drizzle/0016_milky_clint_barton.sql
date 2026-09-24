CREATE TYPE "public"."cms_editorial_task_source" AS ENUM('manual', 'search', 'submission');--> statement-breakpoint
CREATE TYPE "public"."cms_editorial_task_status" AS ENUM('open', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."cms_feedback_status" AS ENUM('new', 'processing', 'resolved', 'closed');--> statement-breakpoint
CREATE TABLE "cms_editorial_tasks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_editorial_tasks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"source" "cms_editorial_task_source" DEFAULT 'manual' NOT NULL,
	"source_key" varchar(100),
	"source_keyword" varchar(64),
	"feedback_id" integer,
	"owner_id" integer,
	"due_at" timestamp,
	"content_id" integer,
	"status" "cms_editorial_task_status" DEFAULT 'open' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_feedback_cases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_feedback_cases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"form_id" integer NOT NULL,
	"submission_id" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"form_name" varchar(100) NOT NULL,
	"fields" jsonb NOT NULL,
	"status" "cms_feedback_status" DEFAULT 'new' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"owner_id" integer,
	"due_at" timestamp,
	"resolution" text,
	"workflow_definition_id" integer,
	"workflow_instance_id" integer,
	"workflow_subject_version" integer,
	"workflow_status" varchar(30),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_feedback_history" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_feedback_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"feedback_id" integer NOT NULL,
	"version" integer NOT NULL,
	"action" varchar(40) NOT NULL,
	"note" text,
	"actor_id" integer,
	"actor_name" varchar(100),
	"snapshot" jsonb NOT NULL,
	"previous_hash" varchar(64),
	"hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_form_handling_policies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_form_handling_policies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"form_id" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"workflow_definition_id" integer,
	"default_owner_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cms_editorial_tasks" ADD CONSTRAINT "cms_editorial_tasks_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_editorial_tasks" ADD CONSTRAINT "cms_editorial_tasks_feedback_id_cms_feedback_cases_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."cms_feedback_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_editorial_tasks" ADD CONSTRAINT "cms_editorial_tasks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_editorial_tasks" ADD CONSTRAINT "cms_editorial_tasks_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_editorial_tasks" ADD CONSTRAINT "cms_editorial_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_editorial_tasks" ADD CONSTRAINT "cms_editorial_tasks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_feedback_cases" ADD CONSTRAINT "cms_feedback_cases_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_feedback_cases" ADD CONSTRAINT "cms_feedback_cases_form_id_cms_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."cms_forms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_feedback_cases" ADD CONSTRAINT "cms_feedback_cases_submission_id_cms_form_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."cms_form_submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_feedback_cases" ADD CONSTRAINT "cms_feedback_cases_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_feedback_cases" ADD CONSTRAINT "cms_feedback_cases_workflow_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("workflow_definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_feedback_cases" ADD CONSTRAINT "cms_feedback_cases_workflow_instance_id_workflow_instances_id_fk" FOREIGN KEY ("workflow_instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_feedback_cases" ADD CONSTRAINT "cms_feedback_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_feedback_cases" ADD CONSTRAINT "cms_feedback_cases_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_feedback_history" ADD CONSTRAINT "cms_feedback_history_feedback_id_cms_feedback_cases_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."cms_feedback_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_form_handling_policies" ADD CONSTRAINT "cms_form_handling_policies_form_id_cms_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."cms_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_form_handling_policies" ADD CONSTRAINT "cms_form_handling_policies_workflow_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("workflow_definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_form_handling_policies" ADD CONSTRAINT "cms_form_handling_policies_default_owner_id_users_id_fk" FOREIGN KEY ("default_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_form_handling_policies" ADD CONSTRAINT "cms_form_handling_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_form_handling_policies" ADD CONSTRAINT "cms_form_handling_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_editorial_tasks_source_uq" ON "cms_editorial_tasks" USING btree ("site_id","source","source_key");--> statement-breakpoint
CREATE INDEX "cms_editorial_tasks_site_status_idx" ON "cms_editorial_tasks" USING btree ("site_id","status","id");--> statement-breakpoint
CREATE INDEX "cms_editorial_tasks_owner_due_idx" ON "cms_editorial_tasks" USING btree ("owner_id","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_feedback_cases_submission_uq" ON "cms_feedback_cases" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "cms_feedback_cases_site_status_idx" ON "cms_feedback_cases" USING btree ("site_id","status","id");--> statement-breakpoint
CREATE INDEX "cms_feedback_cases_owner_due_idx" ON "cms_feedback_cases" USING btree ("owner_id","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_feedback_history_version_uq" ON "cms_feedback_history" USING btree ("feedback_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_form_handling_policies_form_uq" ON "cms_form_handling_policies" USING btree ("form_id");

CREATE OR REPLACE FUNCTION cms_feedback_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CMS feedback history is immutable' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER cms_feedback_history_no_update_delete BEFORE UPDATE OR DELETE ON cms_feedback_history FOR EACH ROW EXECUTE FUNCTION cms_feedback_history_immutable();
CREATE TRIGGER cms_feedback_history_no_truncate BEFORE TRUNCATE ON cms_feedback_history FOR EACH STATEMENT EXECUTE FUNCTION cms_feedback_history_immutable();
