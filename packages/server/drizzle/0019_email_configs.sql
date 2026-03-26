CREATE TYPE "public"."email_encryption" AS ENUM('none', 'ssl', 'tls');--> statement-breakpoint
CREATE TABLE "email_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"smtp_host" varchar(128) DEFAULT '' NOT NULL,
	"smtp_port" integer DEFAULT 465 NOT NULL,
	"smtp_user" varchar(128) DEFAULT '' NOT NULL,
	"smtp_password" varchar(256) DEFAULT '' NOT NULL,
	"from_name" varchar(64) DEFAULT 'Zenith Admin' NOT NULL,
	"from_email" varchar(128) DEFAULT '' NOT NULL,
	"encryption" "email_encryption" DEFAULT 'ssl' NOT NULL,
	"status" "status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
