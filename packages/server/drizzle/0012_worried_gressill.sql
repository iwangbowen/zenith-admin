CREATE TYPE "public"."config_type" AS ENUM('string', 'number', 'boolean', 'json');--> statement-breakpoint
CREATE TYPE "public"."cron_run_status" AS ENUM('success', 'fail', 'running');--> statement-breakpoint
CREATE TABLE "cron_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"cron_expression" varchar(128) NOT NULL,
	"handler" varchar(128) NOT NULL,
	"params" text,
	"status" "status" DEFAULT 'disabled' NOT NULL,
	"description" varchar(256) DEFAULT '' NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"last_run_status" "cron_run_status",
	"last_run_message" varchar(1024),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cron_jobs_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "system_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"config_key" varchar(128) NOT NULL,
	"config_value" varchar(4096) DEFAULT '' NOT NULL,
	"config_type" "config_type" DEFAULT 'string' NOT NULL,
	"description" varchar(256) DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "system_configs_config_key_unique" UNIQUE("config_key")
);
