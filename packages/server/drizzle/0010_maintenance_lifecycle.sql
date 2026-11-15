DROP TABLE "maintenance_logs";
--> statement-breakpoint
DROP TABLE "maintenance_mode";
--> statement-breakpoint
CREATE TABLE "maintenance_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "maintenance_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"message" varchar(512) NOT NULL,
	"estimated_end_at" timestamp with time zone,
	"status" varchar(16) NOT NULL,
	"scheduled_start_at" timestamp with time zone,
	"auto_end_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"reason" varchar(500) NOT NULL,
	"end_reason" varchar(500),
	"notify_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remind_minutes" integer DEFAULT 15 NOT NULL,
	"reminder_sent" boolean DEFAULT false NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_by_id" integer,
	"started_by_name" varchar(64),
	"ended_at" timestamp with time zone,
	"ended_by_id" integer,
	"ended_by_name" varchar(64),
	"duration_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_period_status_check" CHECK ("maintenance_logs"."status" in ('scheduled', 'ongoing', 'completed', 'cancelled'))
);

--> statement-breakpoint
CREATE TABLE "maintenance_mode" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "maintenance_mode_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key" varchar(32) DEFAULT 'global' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"message" varchar(512) DEFAULT '系统维护中，请稍后重试' NOT NULL,
	"estimated_end_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_mode_key_unique" UNIQUE("key")
);

--> statement-breakpoint
CREATE INDEX "maintenance_logs_started_at_idx" ON "maintenance_logs" USING btree ("started_at");
--> statement-breakpoint
CREATE INDEX "maintenance_logs_ended_at_idx" ON "maintenance_logs" USING btree ("ended_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_one_open_period" ON "maintenance_logs" USING btree ((1)) WHERE "maintenance_logs"."status" in ('scheduled', 'ongoing');
--> statement-breakpoint
CREATE TRIGGER maintenance_mode_cache_invalidate AFTER INSERT OR UPDATE OR DELETE ON "maintenance_mode" FOR EACH ROW EXECUTE FUNCTION notify_cache_invalidate();
--> statement-breakpoint
CREATE TRIGGER maintenance_logs_cache_invalidate AFTER INSERT OR UPDATE OR DELETE ON "maintenance_logs" FOR EACH ROW EXECUTE FUNCTION notify_cache_invalidate();