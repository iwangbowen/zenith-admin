CREATE TABLE "entity_watch_events" (
	"event_id" integer PRIMARY KEY NOT NULL,
	"watcher_cursor" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"claimed_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" varchar(500)
);
--> statement-breakpoint
CREATE TABLE "entity_watches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entity_watches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"tenant_id" integer,
	"entity_type" varchar(96) NOT NULL,
	"entity_key" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity_watch_events" ADD CONSTRAINT "entity_watch_events_event_id_domain_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."domain_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_watches" ADD CONSTRAINT "entity_watches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_watches" ADD CONSTRAINT "entity_watches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_watch_events_due_idx" ON "entity_watch_events" USING btree ("next_attempt_at","claimed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_watches_user_tenant_object_uq" ON "entity_watches" USING btree ("user_id","tenant_id","entity_type","entity_key") WHERE "entity_watches"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_watches_user_platform_object_uq" ON "entity_watches" USING btree ("user_id","entity_type","entity_key") WHERE "entity_watches"."tenant_id" is null;--> statement-breakpoint
CREATE INDEX "entity_watches_object_idx" ON "entity_watches" USING btree ("tenant_id","entity_type","entity_key","id");