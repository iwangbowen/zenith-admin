CREATE TABLE "maintenance_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"message" varchar(512) NOT NULL,
	"estimated_end_at" timestamp,
	"started_at" timestamp NOT NULL,
	"started_by_id" integer,
	"started_by_name" varchar(64),
	"ended_at" timestamp,
	"ended_by_id" integer,
	"ended_by_name" varchar(64),
	"duration_seconds" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "maintenance_logs_started_at_idx" ON "maintenance_logs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "maintenance_logs_ended_at_idx" ON "maintenance_logs" USING btree ("ended_at");