CREATE TABLE "cron_job_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"job_name" varchar(64) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_ms" integer,
	"status" "cron_run_status" DEFAULT 'running' NOT NULL,
	"output" text
);
--> statement-breakpoint
ALTER TABLE "cron_job_logs" ADD CONSTRAINT "cron_job_logs_job_id_cron_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."cron_jobs"("id") ON DELETE cascade ON UPDATE no action;