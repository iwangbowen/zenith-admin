CREATE TABLE "api_access_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "api_access_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"user_id" integer,
	"username" varchar(64),
	"impersonator_id" integer,
	"impersonator_name" varchar(64),
	"principal_type" varchar(24) DEFAULT 'anonymous' NOT NULL,
	"auth_type" varchar(24) DEFAULT 'none' NOT NULL,
	"method" varchar(16) NOT NULL,
	"path" varchar(512) NOT NULL,
	"route_path" varchar(512),
	"request_id" varchar(64),
	"query_params" jsonb,
	"request_body" jsonb,
	"module" varchar(128),
	"operation_key" varchar(160),
	"operation_name" varchar(256),
	"operation_type" varchar(32),
	"response_code" integer,
	"duration_ms" integer,
	"error_name" varchar(128),
	"error_message" varchar(512),
	"service_name" varchar(128),
	"process_role" varchar(16),
	"hostname" varchar(128),
	"pid" integer,
	"ip" varchar(64),
	"location" varchar(128),
	"user_agent" varchar(512),
	"os" varchar(64),
	"browser" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_access_logs" ADD CONSTRAINT "api_access_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_access_logs_tenant_created_idx" ON "api_access_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "api_access_logs_created_at_idx" ON "api_access_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "api_access_logs_user_idx" ON "api_access_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_access_logs_request_idx" ON "api_access_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "api_access_logs_path_idx" ON "api_access_logs" USING btree ("path");--> statement-breakpoint
CREATE INDEX "api_access_logs_route_idx" ON "api_access_logs" USING btree ("route_path");--> statement-breakpoint
CREATE INDEX "api_access_logs_status_idx" ON "api_access_logs" USING btree ("response_code");