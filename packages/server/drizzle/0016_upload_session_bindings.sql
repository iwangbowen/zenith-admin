CREATE TABLE "upload_session_bindings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "upload_session_bindings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"upload_id" varchar(64) NOT NULL,
	"module" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "upload_session_bindings_upload_id_unique" UNIQUE("upload_id")
);
--> statement-breakpoint
ALTER TABLE "upload_session_bindings" ADD CONSTRAINT "upload_session_bindings_upload_id_upload_sessions_upload_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."upload_sessions"("upload_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_session_bindings" ADD CONSTRAINT "upload_session_bindings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_session_bindings" ADD CONSTRAINT "upload_session_bindings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_session_bindings" ADD CONSTRAINT "upload_session_bindings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "upload_session_bindings_module_idx" ON "upload_session_bindings" USING btree ("module");