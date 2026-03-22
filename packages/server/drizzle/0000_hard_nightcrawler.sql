CREATE TYPE "public"."role" AS ENUM('admin', 'user');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(32) NOT NULL,
	"nickname" varchar(32) NOT NULL,
	"email" varchar(128) NOT NULL,
	"password" varchar(128) NOT NULL,
	"avatar" varchar(256),
	"role" "role" DEFAULT 'user' NOT NULL,
	"status" "status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
