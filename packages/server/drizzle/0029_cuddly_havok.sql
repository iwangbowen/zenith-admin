CREATE TYPE "public"."message_channel" AS ENUM('email', 'sms', 'in_app');--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(100) NOT NULL,
	"channel" "message_channel" NOT NULL,
	"subject" varchar(200),
	"content" text NOT NULL,
	"variables" text,
	"status" "status" DEFAULT 'active' NOT NULL,
	"remark" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "message_templates_code_unique" UNIQUE("code")
);
