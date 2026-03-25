CREATE TYPE "public"."data_scope" AS ENUM('all', 'dept', 'self');--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "data_scope" "data_scope" DEFAULT 'all' NOT NULL;