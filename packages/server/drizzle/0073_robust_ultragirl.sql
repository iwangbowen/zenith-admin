CREATE TABLE "rule_decision_flows" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" text,
	"status" "workflow_definition_status" DEFAULT 'draft' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_steps" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rule_decision_flows_key_uniq" UNIQUE("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "rule_list_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"list_id" integer NOT NULL,
	"value" varchar(128) NOT NULL,
	"label" varchar(64),
	"expires_at" timestamp with time zone,
	"remark" varchar(255),
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rule_list_items_value_uniq" UNIQUE("list_id","value")
);
--> statement-breakpoint
CREATE TABLE "rule_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"type" varchar(8) DEFAULT 'black' NOT NULL,
	"description" text,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rule_lists_key_uniq" UNIQUE("tenant_id","key")
);
--> statement-breakpoint
ALTER TABLE "rule_decision_tables" ADD COLUMN "review_status" varchar(16);--> statement-breakpoint
ALTER TABLE "rule_decision_tables" ADD COLUMN "review_requested_by" integer;--> statement-breakpoint
ALTER TABLE "rule_decision_tables" ADD COLUMN "review_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rule_decision_tables" ADD COLUMN "review_comment" varchar(255);--> statement-breakpoint
ALTER TABLE "rule_decision_flows" ADD CONSTRAINT "rule_decision_flows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_flows" ADD CONSTRAINT "rule_decision_flows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_flows" ADD CONSTRAINT "rule_decision_flows_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_list_items" ADD CONSTRAINT "rule_list_items_list_id_rule_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."rule_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_list_items" ADD CONSTRAINT "rule_list_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_lists" ADD CONSTRAINT "rule_lists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_lists" ADD CONSTRAINT "rule_lists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_lists" ADD CONSTRAINT "rule_lists_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rule_list_items_list_idx" ON "rule_list_items" USING btree ("list_id");--> statement-breakpoint
ALTER TABLE "rule_decision_tables" ADD CONSTRAINT "rule_decision_tables_review_requested_by_users_id_fk" FOREIGN KEY ("review_requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;