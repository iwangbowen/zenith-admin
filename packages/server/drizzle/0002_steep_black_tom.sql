CREATE TYPE "public"."file_storage_provider" AS ENUM('local', 'oss');--> statement-breakpoint
CREATE TABLE "file_storage_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"provider" "file_storage_provider" DEFAULT 'local' NOT NULL,
	"status" "status" DEFAULT 'active' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"base_path" varchar(256),
	"local_root_path" varchar(512),
	"oss_region" varchar(64),
	"oss_endpoint" varchar(128),
	"oss_bucket" varchar(128),
	"oss_access_key_id" varchar(128),
	"oss_access_key_secret" varchar(256),
	"remark" varchar(256),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "managed_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"storage_config_id" integer NOT NULL,
	"storage_name" varchar(64) NOT NULL,
	"provider" "file_storage_provider" NOT NULL,
	"original_name" varchar(256) NOT NULL,
	"object_key" varchar(512) NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"mime_type" varchar(128),
	"extension" varchar(32),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "managed_files" ADD CONSTRAINT "managed_files_storage_config_id_file_storage_configs_id_fk" FOREIGN KEY ("storage_config_id") REFERENCES "public"."file_storage_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
