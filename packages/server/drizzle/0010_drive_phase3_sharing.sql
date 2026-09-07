CREATE TYPE "public"."drive_access_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "drive_access_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drive_access_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"node_id" integer NOT NULL,
	"space_id" integer NOT NULL,
	"requester_id" integer NOT NULL,
	"role" "drive_role" NOT NULL,
	"reason" varchar(500),
	"status" "drive_access_request_status" DEFAULT 'pending' NOT NULL,
	"granted_role" "drive_role",
	"granted_expire_at" timestamp,
	"decided_by" integer,
	"decided_at" timestamp,
	"decision_note" varchar(200),
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_collect_submissions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drive_collect_submissions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"share_id" integer NOT NULL,
	"node_id" integer,
	"file_name" varchar(255) NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	"submitter_name" varchar(50),
	"submitter_note" varchar(200),
	"client_ip" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drive_share_links" ADD COLUMN "allowed_ips" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "drive_share_links" ADD COLUMN "watermark" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "drive_share_links" ADD COLUMN "collect_policy" jsonb;--> statement-breakpoint
ALTER TABLE "drive_access_requests" ADD CONSTRAINT "drive_access_requests_node_id_drive_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."drive_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_access_requests" ADD CONSTRAINT "drive_access_requests_space_id_drive_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."drive_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_access_requests" ADD CONSTRAINT "drive_access_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_access_requests" ADD CONSTRAINT "drive_access_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_access_requests" ADD CONSTRAINT "drive_access_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_collect_submissions" ADD CONSTRAINT "drive_collect_submissions_share_id_drive_share_links_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."drive_share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_collect_submissions" ADD CONSTRAINT "drive_collect_submissions_node_id_drive_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."drive_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drive_access_requests_pending_unique" ON "drive_access_requests" USING btree ("node_id","requester_id") WHERE "drive_access_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "drive_access_requests_requester_idx" ON "drive_access_requests" USING btree ("requester_id","created_at");--> statement-breakpoint
CREATE INDEX "drive_access_requests_space_status_idx" ON "drive_access_requests" USING btree ("space_id","status");--> statement-breakpoint
CREATE INDEX "drive_collect_submissions_share_idx" ON "drive_collect_submissions" USING btree ("share_id","created_at");