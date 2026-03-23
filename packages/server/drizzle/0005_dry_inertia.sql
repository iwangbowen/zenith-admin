CREATE TYPE "public"."login_status" AS ENUM('success', 'fail');--> statement-breakpoint
CREATE TABLE "login_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"username" varchar(64) NOT NULL,
	"ip" varchar(64),
	"browser" varchar(64),
	"os" varchar(64),
	"status" "login_status" NOT NULL,
	"message" varchar(256),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
