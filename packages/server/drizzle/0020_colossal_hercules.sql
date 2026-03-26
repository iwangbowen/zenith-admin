CREATE TYPE "public"."backup_status" AS ENUM('pending', 'running', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."backup_type" AS ENUM('pg_dump', 'drizzle_export');--> statement-breakpoint
CREATE TYPE "public"."oauth_provider" AS ENUM('github', 'dingtalk', 'wechat_work');--> statement-breakpoint
CREATE TABLE "db_backups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"type" "backup_type" NOT NULL,
	"file_id" integer,
	"file_size" integer,
	"status" "backup_status" DEFAULT 'pending' NOT NULL,
	"tables" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"error_message" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_oauth_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider" "oauth_provider" NOT NULL,
	"open_id" varchar(128) NOT NULL,
	"union_id" varchar(128),
	"nickname" varchar(64),
	"avatar" varchar(512),
	"access_token" varchar(512),
	"refresh_token" varchar(512),
	"expires_at" timestamp with time zone,
	"raw" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_provider_open_id" UNIQUE("provider","open_id")
);
--> statement-breakpoint
ALTER TABLE "db_backups" ADD CONSTRAINT "db_backups_file_id_managed_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."managed_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_backups" ADD CONSTRAINT "db_backups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_oauth_accounts" ADD CONSTRAINT "user_oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;