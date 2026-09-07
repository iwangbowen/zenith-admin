ALTER TYPE "public"."drive_activity_action" ADD VALUE 'legal_hold';--> statement-breakpoint
ALTER TYPE "public"."drive_activity_action" ADD VALUE 'legal_release';--> statement-breakpoint
ALTER TYPE "public"."drive_activity_action" ADD VALUE 'archive';--> statement-breakpoint
ALTER TYPE "public"."drive_activity_action" ADD VALUE 'unarchive';--> statement-breakpoint
CREATE TABLE "drive_legal_holds" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drive_legal_holds_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"node_id" integer NOT NULL,
	"space_id" integer NOT NULL,
	"reason" varchar(500) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"released_by" integer,
	"released_at" timestamp,
	"release_note" varchar(200),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_open_app_grants" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drive_open_app_grants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"client_id" varchar(64) NOT NULL,
	"space_id" integer NOT NULL,
	"role" "drive_role" DEFAULT 'downloader' NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(200),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_quota_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drive_quota_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"space_id" integer NOT NULL,
	"requester_id" integer NOT NULL,
	"current_quota_bytes" bigint DEFAULT 0 NOT NULL,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	"requested_gb" integer NOT NULL,
	"reason" varchar(500),
	"status" "drive_access_request_status" DEFAULT 'pending' NOT NULL,
	"approved_gb" integer,
	"decided_by" integer,
	"decided_at" timestamp,
	"decision_note" varchar(200),
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drive_spaces" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "drive_legal_holds" ADD CONSTRAINT "drive_legal_holds_node_id_drive_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."drive_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_legal_holds" ADD CONSTRAINT "drive_legal_holds_space_id_drive_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."drive_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_legal_holds" ADD CONSTRAINT "drive_legal_holds_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_legal_holds" ADD CONSTRAINT "drive_legal_holds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_legal_holds" ADD CONSTRAINT "drive_legal_holds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_legal_holds" ADD CONSTRAINT "drive_legal_holds_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_open_app_grants" ADD CONSTRAINT "drive_open_app_grants_space_id_drive_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."drive_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_open_app_grants" ADD CONSTRAINT "drive_open_app_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_open_app_grants" ADD CONSTRAINT "drive_open_app_grants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_open_app_grants" ADD CONSTRAINT "drive_open_app_grants_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_quota_requests" ADD CONSTRAINT "drive_quota_requests_space_id_drive_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."drive_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_quota_requests" ADD CONSTRAINT "drive_quota_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_quota_requests" ADD CONSTRAINT "drive_quota_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_quota_requests" ADD CONSTRAINT "drive_quota_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drive_legal_holds_active_node_uq" ON "drive_legal_holds" USING btree ("node_id") WHERE "drive_legal_holds"."active" = true;--> statement-breakpoint
CREATE INDEX "drive_legal_holds_space_idx" ON "drive_legal_holds" USING btree ("space_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "drive_open_app_grants_client_space_uq" ON "drive_open_app_grants" USING btree ("client_id","space_id");--> statement-breakpoint
CREATE INDEX "drive_open_app_grants_space_idx" ON "drive_open_app_grants" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drive_quota_requests_pending_unique" ON "drive_quota_requests" USING btree ("space_id") WHERE "drive_quota_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "drive_quota_requests_status_idx" ON "drive_quota_requests" USING btree ("status","created_at");