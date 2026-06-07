CREATE TABLE "maintenance_mode" (
	"id" serial PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"message" varchar(512) DEFAULT '系统维护中，请稍后重试' NOT NULL,
	"estimated_end_at" timestamp,
	"started_at" timestamp,
	"started_by_name" varchar(64),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
