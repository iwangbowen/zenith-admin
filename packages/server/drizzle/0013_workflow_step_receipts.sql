CREATE TABLE "workflow_job_effects" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_job_effects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"job_id" integer NOT NULL,
	"operation_key" varchar(64) NOT NULL,
	"effect_key" varchar(128) NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_job_effects_operation_effect_unique" UNIQUE("operation_key","effect_key")
);
--> statement-breakpoint
ALTER TABLE "workflow_jobs" ALTER COLUMN "paused_remaining_ms" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "workflow_job_effects" ADD CONSTRAINT "workflow_job_effects_job_id_workflow_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."workflow_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_job_effects_job_idx" ON "workflow_job_effects" USING btree ("job_id");