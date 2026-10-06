CREATE TABLE "ws_metric_samples" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ws_metric_samples_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sampled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connections" integer DEFAULT 0 NOT NULL,
	"users" integer DEFAULT 0 NOT NULL,
	"idle" integer DEFAULT 0 NOT NULL,
	"connects" integer DEFAULT 0 NOT NULL,
	"disconnects" integer DEFAULT 0 NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"recv" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ws_metric_samples_at_idx" ON "ws_metric_samples" USING btree ("sampled_at");