CREATE TABLE "member_login_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer,
	"ip" varchar(64),
	"location" varchar(128),
	"browser" varchar(64),
	"os" varchar(64),
	"user_agent" varchar(512),
	"status" "login_status" NOT NULL,
	"message" varchar(256),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_login_logs" ADD CONSTRAINT "member_login_logs_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;