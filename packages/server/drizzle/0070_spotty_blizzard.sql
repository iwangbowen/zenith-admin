CREATE TYPE "public"."ai_agent_status" AS ENUM('private', 'pending', 'published', 'rejected');--> statement-breakpoint
CREATE TABLE "ai_agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(300),
	"avatar" varchar(20) DEFAULT '🤖' NOT NULL,
	"system_prompt" text NOT NULL,
	"config_id" integer,
	"model" varchar(100),
	"temperature" varchar(10),
	"knowledge_base_id" integer,
	"tools" text[],
	"opening_message" text,
	"suggested_questions" text[],
	"status" "ai_agent_status" DEFAULT 'private' NOT NULL,
	"cloned_from_id" integer,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_eval_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"set_id" integer NOT NULL,
	"config_id" integer,
	"model" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"results" jsonb,
	"avg_duration_ms" integer,
	"total_tokens" integer,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_eval_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(300),
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_http_tools" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(60) NOT NULL,
	"description" varchar(500) NOT NULL,
	"method" varchar(10) DEFAULT 'GET' NOT NULL,
	"url_template" varchar(500) NOT NULL,
	"headers" jsonb,
	"params" jsonb,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_prompt_template_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"content" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "agent_id" integer;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "tags" text[];--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "active_leaf_msg_id" integer;--> statement-breakpoint
ALTER TABLE "ai_kb_documents" ADD COLUMN "source_url" varchar(500);--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "parent_id" integer;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "trace" jsonb;--> statement-breakpoint
ALTER TABLE "ai_provider_configs" ADD COLUMN "fallback_config_id" integer;--> statement-breakpoint
ALTER TABLE "ai_provider_configs" ADD COLUMN "max_concurrent" integer;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_eval_runs" ADD CONSTRAINT "ai_eval_runs_set_id_ai_eval_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."ai_eval_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_eval_runs" ADD CONSTRAINT "ai_eval_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_eval_sets" ADD CONSTRAINT "ai_eval_sets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_eval_sets" ADD CONSTRAINT "ai_eval_sets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_http_tools" ADD CONSTRAINT "ai_http_tools_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_http_tools" ADD CONSTRAINT "ai_http_tools_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompt_template_versions" ADD CONSTRAINT "ai_prompt_template_versions_template_id_ai_prompt_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."ai_prompt_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompt_template_versions" ADD CONSTRAINT "ai_prompt_template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_http_tools_name_uq" ON "ai_http_tools" USING btree ("name");