CREATE TABLE "async_task_subjects" (
	"task_id" integer NOT NULL,
	"tenant_id" integer,
	"entity_type" varchar(96) NOT NULL,
	"entity_key" varchar(512) NOT NULL,
	"role" "entity_subject_role" DEFAULT 'related' NOT NULL,
	CONSTRAINT "async_task_subjects_task_id_entity_type_entity_key_role_pk" PRIMARY KEY("task_id","entity_type","entity_key","role"),
	CONSTRAINT "async_task_subjects_entity_type_check" CHECK (length("async_task_subjects"."entity_type") > 0),
	CONSTRAINT "async_task_subjects_entity_key_check" CHECK (length("async_task_subjects"."entity_key") > 0)
);
--> statement-breakpoint
CREATE TABLE "notification_outbox_subjects" (
	"outbox_id" integer NOT NULL,
	"tenant_id" integer,
	"entity_type" varchar(96) NOT NULL,
	"entity_key" varchar(512) NOT NULL,
	"role" "entity_subject_role" DEFAULT 'related' NOT NULL,
	CONSTRAINT "notification_outbox_subjects_outbox_id_entity_type_entity_key_role_pk" PRIMARY KEY("outbox_id","entity_type","entity_key","role"),
	CONSTRAINT "notification_outbox_subjects_entity_type_check" CHECK (length("notification_outbox_subjects"."entity_type") > 0),
	CONSTRAINT "notification_outbox_subjects_entity_key_check" CHECK (length("notification_outbox_subjects"."entity_key") > 0)
);
--> statement-breakpoint
ALTER TABLE "async_task_subjects" ADD CONSTRAINT "async_task_subjects_task_id_async_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."async_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "async_task_subjects" ADD CONSTRAINT "async_task_subjects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox_subjects" ADD CONSTRAINT "notification_outbox_subjects_outbox_id_notification_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."notification_outbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox_subjects" ADD CONSTRAINT "notification_outbox_subjects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "async_task_subjects_entity_idx" ON "async_task_subjects" USING btree ("tenant_id","entity_type","entity_key","task_id");--> statement-breakpoint
CREATE INDEX "async_task_subjects_task_idx" ON "async_task_subjects" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "notification_outbox_subjects_entity_idx" ON "notification_outbox_subjects" USING btree ("tenant_id","entity_type","entity_key","outbox_id");--> statement-breakpoint
CREATE INDEX "notification_outbox_subjects_outbox_idx" ON "notification_outbox_subjects" USING btree ("outbox_id");