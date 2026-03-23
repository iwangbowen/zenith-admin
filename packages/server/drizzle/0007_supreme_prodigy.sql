CREATE TABLE "operation_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"username" varchar(32),
	"module" varchar(64),
	"description" varchar(256) NOT NULL,
	"method" varchar(16) NOT NULL,
	"path" varchar(256) NOT NULL,
	"request_body" varchar(4096),
	"response_code" integer,
	"duration_ms" integer,
	"ip" varchar(64),
	"user_agent" varchar(512),
	"os" varchar(64),
	"browser" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
