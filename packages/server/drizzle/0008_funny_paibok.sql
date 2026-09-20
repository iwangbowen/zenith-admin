CREATE TABLE "workflow_attachment_links" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_attachment_links_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"instance_id" integer NOT NULL,
	"task_id" integer,
	"comment_id" integer,
	"file_id" uuid NOT NULL,
	"source" varchar(16) NOT NULL,
	"source_key" varchar(512) NOT NULL,
	"field_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"tenant_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_attachment_links_source_file_unique" UNIQUE("instance_id","source","source_key","file_id"),
	CONSTRAINT "workflow_attachment_links_source_check" CHECK (("workflow_attachment_links"."source" = 'form' and "workflow_attachment_links"."task_id" is null and "workflow_attachment_links"."comment_id" is null and cardinality("workflow_attachment_links"."field_keys") > 0) or ("workflow_attachment_links"."source" = 'task' and "workflow_attachment_links"."task_id" is not null and "workflow_attachment_links"."comment_id" is null and "workflow_attachment_links"."source_key" = "workflow_attachment_links"."task_id"::text and cardinality("workflow_attachment_links"."field_keys") = 0) or ("workflow_attachment_links"."source" = 'comment' and "workflow_attachment_links"."comment_id" is not null and "workflow_attachment_links"."task_id" is null and "workflow_attachment_links"."source_key" = "workflow_attachment_links"."comment_id"::text and cardinality("workflow_attachment_links"."field_keys") = 0))
);
--> statement-breakpoint
CREATE TABLE "workflow_attachment_uploads" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tenant_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_comments" ADD CONSTRAINT "workflow_comments_id_instance_unique" UNIQUE("id","instance_id");
--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_id_instance_unique" UNIQUE("id","instance_id");
--> statement-breakpoint
ALTER TABLE "workflow_attachment_links" ADD CONSTRAINT "workflow_attachment_links_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_attachment_links" ADD CONSTRAINT "workflow_attachment_links_file_id_managed_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."managed_files"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_attachment_links" ADD CONSTRAINT "workflow_attachment_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_attachment_links" ADD CONSTRAINT "workflow_attachment_links_task_instance_fk" FOREIGN KEY ("task_id","instance_id") REFERENCES "public"."workflow_tasks"("id","instance_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_attachment_links" ADD CONSTRAINT "workflow_attachment_links_comment_instance_fk" FOREIGN KEY ("comment_id","instance_id") REFERENCES "public"."workflow_comments"("id","instance_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_attachment_uploads" ADD CONSTRAINT "workflow_attachment_uploads_file_id_managed_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."managed_files"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_attachment_uploads" ADD CONSTRAINT "workflow_attachment_uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_attachment_uploads" ADD CONSTRAINT "workflow_attachment_uploads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workflow_attachment_links_instance_id_idx" ON "workflow_attachment_links" USING btree ("instance_id","id");
--> statement-breakpoint
CREATE INDEX "workflow_attachment_links_task_id_idx" ON "workflow_attachment_links" USING btree ("task_id","id");
--> statement-breakpoint
CREATE INDEX "workflow_attachment_links_file_id_idx" ON "workflow_attachment_links" USING btree ("file_id");
--> statement-breakpoint
CREATE INDEX "workflow_attachment_links_tenant_idx" ON "workflow_attachment_links" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "workflow_attachment_uploads_tenant_idx" ON "workflow_attachment_uploads" USING btree ("tenant_id");
