CREATE TABLE "notices" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(128) NOT NULL,
	"content" varchar(4096) NOT NULL,
	"type" varchar(32) DEFAULT 'notice' NOT NULL,
	"publish_status" varchar(32) DEFAULT 'draft' NOT NULL,
	"priority" varchar(32) DEFAULT 'medium' NOT NULL,
	"publish_time" timestamp with time zone,
	"create_by_id" integer,
	"create_by_name" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
