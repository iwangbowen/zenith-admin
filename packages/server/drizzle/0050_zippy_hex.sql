ALTER TABLE "chat_conversations" DROP CONSTRAINT "chat_conversations_created_by_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "db_backups" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "db_backups" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "dict_items" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "dict_items" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "dicts" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "dicts" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "email_configs" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "email_configs" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "in_app_templates" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "in_app_templates" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "managed_files" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "managed_files" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "menus" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "menus" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "oauth_configs" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "oauth_configs" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "rate_limit_rules" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "rate_limit_rules" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "sms_configs" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "sms_configs" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "sms_templates" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "sms_templates" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "system_configs" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "system_configs" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "user_api_tokens" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "user_api_tokens" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "user_api_tokens" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "updated_by" integer;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD CONSTRAINT "cron_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD CONSTRAINT "cron_jobs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_backups" ADD CONSTRAINT "db_backups_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dict_items" ADD CONSTRAINT "dict_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dict_items" ADD CONSTRAINT "dict_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dicts" ADD CONSTRAINT "dicts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dicts" ADD CONSTRAINT "dicts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_configs" ADD CONSTRAINT "email_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_configs" ADD CONSTRAINT "email_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD CONSTRAINT "file_storage_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD CONSTRAINT "file_storage_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_templates" ADD CONSTRAINT "in_app_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_templates" ADD CONSTRAINT "in_app_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_files" ADD CONSTRAINT "managed_files_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_files" ADD CONSTRAINT "managed_files_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_configs" ADD CONSTRAINT "oauth_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_configs" ADD CONSTRAINT "oauth_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_limit_rules" ADD CONSTRAINT "rate_limit_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_limit_rules" ADD CONSTRAINT "rate_limit_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_configs" ADD CONSTRAINT "sms_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_configs" ADD CONSTRAINT "sms_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_templates" ADD CONSTRAINT "sms_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_templates" ADD CONSTRAINT "sms_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_configs" ADD CONSTRAINT "system_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_configs" ADD CONSTRAINT "system_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_api_tokens" ADD CONSTRAINT "user_api_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_api_tokens" ADD CONSTRAINT "user_api_tokens_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" DROP COLUMN "created_by_id";