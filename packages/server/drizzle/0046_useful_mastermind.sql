CREATE TYPE "public"."rate_limit_key_type" AS ENUM('ip', 'user', 'ip_path');--> statement-breakpoint
CREATE TABLE "rate_limit_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" varchar(255),
	"window_ms" integer NOT NULL,
	"limit" integer NOT NULL,
	"key_type" "rate_limit_key_type" DEFAULT 'ip' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"blocked_message" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limit_rules_name_unique" UNIQUE("name")
);
