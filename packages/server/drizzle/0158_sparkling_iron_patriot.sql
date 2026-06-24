CREATE TYPE "public"."mp_kf_routing_strategy" AS ENUM('manual', 'round_robin', 'least_active');--> statement-breakpoint
CREATE TYPE "public"."mp_kf_session_close_reason" AS ENUM('manual', 'wait_timeout', 'idle_timeout', 'system');--> statement-breakpoint
CREATE TYPE "public"."mp_kf_session_event_type" AS ENUM('create', 'assign', 'accept', 'transfer', 'reroute', 'close');--> statement-breakpoint
CREATE TYPE "public"."mp_kf_session_status" AS ENUM('waiting', 'active', 'closed');--> statement-breakpoint
CREATE TABLE "mp_kf_routing_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"strategy" "mp_kf_routing_strategy" DEFAULT 'least_active' NOT NULL,
	"max_concurrent" integer DEFAULT 5 NOT NULL,
	"wait_timeout_minutes" integer DEFAULT 3 NOT NULL,
	"idle_timeout_minutes" integer DEFAULT 15 NOT NULL,
	"auto_close_enabled" boolean DEFAULT true NOT NULL,
	"welcome_text" varchar(500),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_kf_session_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"type" "mp_kf_session_event_type" NOT NULL,
	"from_kf_id" integer,
	"to_kf_id" integer,
	"operator_id" integer,
	"detail" varchar(255),
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_kf_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"openid" varchar(64) NOT NULL,
	"kf_id" integer,
	"status" "mp_kf_session_status" DEFAULT 'waiting' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"source" varchar(32),
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_fan_msg_at" timestamp,
	"last_kf_msg_at" timestamp,
	"last_msg_at" timestamp DEFAULT now() NOT NULL,
	"waiting_since" timestamp,
	"accepted_at" timestamp,
	"closed_at" timestamp,
	"close_reason" "mp_kf_session_close_reason",
	"remark" varchar(255),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mp_kf_routing_configs" ADD CONSTRAINT "mp_kf_routing_configs_account_id_mp_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_kf_routing_configs" ADD CONSTRAINT "mp_kf_routing_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_kf_routing_configs" ADD CONSTRAINT "mp_kf_routing_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_kf_routing_configs" ADD CONSTRAINT "mp_kf_routing_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_kf_session_events" ADD CONSTRAINT "mp_kf_session_events_session_id_mp_kf_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."mp_kf_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_kf_session_events" ADD CONSTRAINT "mp_kf_session_events_account_id_mp_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_kf_session_events" ADD CONSTRAINT "mp_kf_session_events_from_kf_id_mp_kf_accounts_id_fk" FOREIGN KEY ("from_kf_id") REFERENCES "public"."mp_kf_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_kf_session_events" ADD CONSTRAINT "mp_kf_session_events_to_kf_id_mp_kf_accounts_id_fk" FOREIGN KEY ("to_kf_id") REFERENCES "public"."mp_kf_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_kf_session_events" ADD CONSTRAINT "mp_kf_session_events_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_kf_session_events" ADD CONSTRAINT "mp_kf_session_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_kf_sessions" ADD CONSTRAINT "mp_kf_sessions_account_id_mp_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_kf_sessions" ADD CONSTRAINT "mp_kf_sessions_kf_id_mp_kf_accounts_id_fk" FOREIGN KEY ("kf_id") REFERENCES "public"."mp_kf_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_kf_sessions" ADD CONSTRAINT "mp_kf_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_kf_sessions" ADD CONSTRAINT "mp_kf_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_kf_sessions" ADD CONSTRAINT "mp_kf_sessions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mp_kf_routing_configs_account_uq" ON "mp_kf_routing_configs" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "mp_kf_session_events_session_idx" ON "mp_kf_session_events" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_kf_sessions_open_uq" ON "mp_kf_sessions" USING btree ("account_id","openid") WHERE "mp_kf_sessions"."status" <> 'closed';--> statement-breakpoint
CREATE INDEX "mp_kf_sessions_account_status_idx" ON "mp_kf_sessions" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "mp_kf_sessions_kf_idx" ON "mp_kf_sessions" USING btree ("kf_id");