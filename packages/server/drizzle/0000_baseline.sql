CREATE TYPE "public"."status" AS ENUM('enabled', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."data_scope" AS ENUM('all', 'custom', 'dept_only', 'dept', 'self');--> statement-breakpoint
CREATE TYPE "public"."menu_type" AS ENUM('directory', 'menu', 'button');--> statement-breakpoint
CREATE TYPE "public"."business_type" AS ENUM('announcement');--> statement-breakpoint
CREATE TYPE "public"."file_storage_provider" AS ENUM('local', 'oss', 's3', 'cos', 'obs', 'kodo', 'bos', 'azure', 'sftp');--> statement-breakpoint
CREATE TYPE "public"."upload_session_status" AS ENUM('uploading', 'completed', 'aborted');--> statement-breakpoint
CREATE TYPE "public"."mask_type" AS ENUM('phone', 'email', 'id_card', 'name', 'bank_card', 'custom');--> statement-breakpoint
CREATE TYPE "public"."async_task_item_status" AS ENUM('pending', 'success', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."async_task_status" AS ENUM('pending', 'running', 'success', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."export_job_delete_reason" AS ENUM('expired', 'manual', 'file_missing');--> statement-breakpoint
CREATE TYPE "public"."export_job_execution_mode" AS ENUM('sync', 'async');--> statement-breakpoint
CREATE TYPE "public"."export_job_format" AS ENUM('xlsx', 'csv');--> statement-breakpoint
CREATE TYPE "public"."export_job_status" AS ENUM('pending', 'running', 'success', 'failed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."config_type" AS ENUM('string', 'number', 'boolean', 'json');--> statement-breakpoint
CREATE TYPE "public"."cron_run_status" AS ENUM('success', 'fail', 'running');--> statement-breakpoint
CREATE TYPE "public"."region_level" AS ENUM('province', 'city', 'county');--> statement-breakpoint
CREATE TYPE "public"."system_scheduler_run_status" AS ENUM('running', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."system_scheduler_task_type" AS ENUM('recurring', 'queue');--> statement-breakpoint
CREATE TYPE "public"."system_scheduler_trigger_type" AS ENUM('schedule', 'manual', 'queue');--> statement-breakpoint
CREATE TYPE "public"."login_risk_action" AS ENUM('allow', 'challenge', 'block');--> statement-breakpoint
CREATE TYPE "public"."login_risk_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."mfa_factor_status" AS ENUM('pending', 'enabled', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."mfa_factor_type" AS ENUM('totp', 'passkey', 'recovery_code');--> statement-breakpoint
CREATE TYPE "public"."oauth_provider" AS ENUM('github', 'dingtalk', 'wechat_work');--> statement-breakpoint
CREATE TYPE "public"."rate_limit_key_type" AS ENUM('ip', 'user', 'ip_path');--> statement-breakpoint
CREATE TYPE "public"."identity_provider_status" AS ENUM('enabled', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."identity_provider_sync_status" AS ENUM('success', 'failed', 'partial');--> statement-breakpoint
CREATE TYPE "public"."identity_provider_type" AS ENUM('oidc', 'saml', 'ldap', 'ad');--> statement-breakpoint
CREATE TYPE "public"."login_event_type" AS ENUM('login', 'logout');--> statement-breakpoint
CREATE TYPE "public"."login_status" AS ENUM('success', 'fail');--> statement-breakpoint
CREATE TYPE "public"."analytics_device_type" AS ENUM('desktop', 'mobile', 'tablet', 'bot', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."analytics_event_status" AS ENUM('active', 'deprecated', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."error_alert_condition" AS ENUM('new_error', 'threshold', 'spike');--> statement-breakpoint
CREATE TYPE "public"."error_level" AS ENUM('fatal', 'error', 'warning', 'info');--> statement-breakpoint
CREATE TYPE "public"."error_status" AS ENUM('unresolved', 'resolved', 'ignored', 'muted');--> statement-breakpoint
CREATE TYPE "public"."frontend_error_type" AS ENUM('js_error', 'promise_rejection', 'resource_error', 'console_error', 'http_error', 'white_screen', 'crash');--> statement-breakpoint
CREATE TYPE "public"."user_behavior_event_type" AS ENUM('page_view', 'page_leave', 'feature_use', 'area_click', 'custom', 'perf', 'api_request', 'identify');--> statement-breakpoint
CREATE TYPE "public"."workflow_approve_method" AS ENUM('and', 'or', 'sequential', 'ratio');--> statement-breakpoint
CREATE TYPE "public"."workflow_automation_trigger" AS ENUM('approved', 'rejected', 'withdrawn', 'created');--> statement-breakpoint
CREATE TYPE "public"."workflow_connector_invocation_source" AS ENUM('test', 'trigger', 'external', 'webhook', 'manual');--> statement-breakpoint
CREATE TYPE "public"."workflow_connector_type" AS ENUM('http', 'webhook', 'email', 'sms', 'wecom', 'dingtalk', 'feishu', 'mq', 'database');--> statement-breakpoint
CREATE TYPE "public"."workflow_definition_status" AS ENUM('draft', 'published', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."workflow_event_sign_mode" AS ENUM('hmacSha256', 'none');--> statement-breakpoint
CREATE TYPE "public"."workflow_form_type" AS ENUM('designer', 'custom', 'external');--> statement-breakpoint
CREATE TYPE "public"."workflow_instance_status" AS ENUM('draft', 'running', 'approved', 'rejected', 'withdrawn', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workflow_job_execution_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."workflow_job_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'dead', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."workflow_job_type" AS ENUM('delay_wake', 'task_timeout', 'trigger_dispatch', 'external_dispatch', 'subprocess_spawn', 'subprocess_join', 'event_dispatch', 'webhook_delivery', 'compensation_action');--> statement-breakpoint
CREATE TYPE "public"."workflow_node_type" AS ENUM('start', 'approve', 'handler', 'end', 'exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'routeGateway', 'ccNode', 'delay', 'trigger', 'subProcess', 'catchNode');--> statement-breakpoint
CREATE TYPE "public"."workflow_task_consult_status" AS ENUM('pending', 'replied', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."workflow_task_status" AS ENUM('pending', 'approved', 'rejected', 'skipped', 'waiting');--> statement-breakpoint
CREATE TYPE "public"."workflow_token_status" AS ENUM('active', 'consumed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."email_encryption" AS ENUM('none', 'ssl', 'tls');--> statement-breakpoint
CREATE TYPE "public"."in_app_message_type" AS ENUM('info', 'success', 'warning', 'error');--> statement-breakpoint
CREATE TYPE "public"."send_source" AS ENUM('manual', 'test', 'system', 'api');--> statement-breakpoint
CREATE TYPE "public"."send_status" AS ENUM('pending', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sms_provider" AS ENUM('aliyun', 'tencent');--> statement-breakpoint
CREATE TYPE "public"."backup_status" AS ENUM('pending', 'running', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."backup_type" AS ENUM('pg_dump', 'drizzle_export');--> statement-breakpoint
CREATE TYPE "public"."rule_hit_policy" AS ENUM('first', 'unique', 'priority', 'collect', 'any');--> statement-breakpoint
CREATE TYPE "public"."biz_leave_status" AS ENUM('draft', 'pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."biz_pay_demo_status" AS ENUM('pending', 'paying', 'paid', 'closed');--> statement-breakpoint
CREATE TYPE "public"."chat_conversation_type" AS ENUM('direct', 'group');--> statement-breakpoint
CREATE TYPE "public"."chat_member_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."chat_message_type" AS ENUM('text', 'image', 'file', 'system', 'forward', 'vote', 'voice', 'card');--> statement-breakpoint
CREATE TYPE "public"."channel_audience" AS ENUM('broadcast', 'targeted');--> statement-breakpoint
CREATE TYPE "public"."channel_auto_reply_keyword_mode" AS ENUM('exact', 'contains');--> statement-breakpoint
CREATE TYPE "public"."channel_auto_reply_match" AS ENUM('subscribe', 'keyword', 'default');--> statement-breakpoint
CREATE TYPE "public"."channel_conversation_status" AS ENUM('open', 'processing', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."channel_menu_type" AS ENUM('click', 'view');--> statement-breakpoint
CREATE TYPE "public"."channel_message_direction" AS ENUM('out', 'in');--> statement-breakpoint
CREATE TYPE "public"."channel_message_status" AS ENUM('sent', 'draft', 'scheduled');--> statement-breakpoint
CREATE TYPE "public"."channel_message_type" AS ENUM('text', 'card', 'image', 'news');--> statement-breakpoint
CREATE TYPE "public"."channel_type" AS ENUM('system', 'business');--> statement-breakpoint
CREATE TYPE "public"."payment_channel" AS ENUM('wechat', 'alipay');--> statement-breakpoint
CREATE TYPE "public"."payment_event_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_ledger_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."payment_ledger_type" AS ENUM('payment', 'refund', 'fee', 'settlement', 'adjust');--> statement-breakpoint
CREATE TYPE "public"."payment_link_status" AS ENUM('active', 'disabled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('wechat_native', 'wechat_jsapi', 'wechat_h5', 'alipay_page', 'alipay_wap', 'alipay_app');--> statement-breakpoint
CREATE TYPE "public"."payment_order_status" AS ENUM('pending', 'paying', 'success', 'closed', 'refunding', 'refunded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_recon_result" AS ENUM('matched', 'local_only', 'channel_only', 'amount_diff', 'status_diff');--> statement-breakpoint
CREATE TYPE "public"."payment_recon_status" AS ENUM('pending', 'comparing', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_refund_approval_status" AS ENUM('none', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."payment_refund_status" AS ENUM('pending', 'processing', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_risk_scope" AS ENUM('global', 'channel', 'bizType');--> statement-breakpoint
CREATE TYPE "public"."payment_settlement_status" AS ENUM('pending', 'settling', 'settled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_sharing_order_status" AS ENUM('pending', 'processing', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_sharing_receiver_type" AS ENUM('merchant', 'personal');--> statement-breakpoint
CREATE TYPE "public"."payment_webhook_delivery_status" AS ENUM('pending', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ai_feedback_status" AS ENUM('pending', 'resolved', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."ai_message_role" AS ENUM('system', 'user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."ai_prompt_scope" AS ENUM('system', 'user');--> statement-breakpoint
CREATE TYPE "public"."ai_provider" AS ENUM('openai_compatible', 'anthropic', 'gemini', 'baidu');--> statement-breakpoint
CREATE TYPE "public"."app_webhook_delivery_status" AS ENUM('pending', 'success', 'failed', 'retrying');--> statement-breakpoint
CREATE TYPE "public"."app_webhook_sign_mode" AS ENUM('hmacSha256', 'none');--> statement-breakpoint
CREATE TYPE "public"."ssh_auth_type" AS ENUM('password', 'key_path', 'key_content', 'agent');--> statement-breakpoint
CREATE TYPE "public"."checkin_milestone_reward_type" AS ENUM('points', 'coupon');--> statement-breakpoint
CREATE TYPE "public"."coupon_template_status" AS ENUM('draft', 'active', 'paused', 'expired');--> statement-breakpoint
CREATE TYPE "public"."coupon_type" AS ENUM('amount', 'percent');--> statement-breakpoint
CREATE TYPE "public"."coupon_valid_type" AS ENUM('fixed', 'relative');--> statement-breakpoint
CREATE TYPE "public"."member_coupon_status" AS ENUM('unused', 'used', 'expired', 'frozen');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('active', 'inactive', 'banned');--> statement-breakpoint
CREATE TYPE "public"."point_tx_type" AS ENUM('earn', 'redeem', 'expire', 'adjust', 'refund');--> statement-breakpoint
CREATE TYPE "public"."wallet_tx_type" AS ENUM('recharge', 'consume', 'refund', 'adjust');--> statement-breakpoint
CREATE TYPE "public"."monitor_alert_event_status" AS ENUM('firing', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."monitor_alert_level" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."monitor_alert_operator" AS ENUM('gt', 'gte', 'lt', 'lte');--> statement-breakpoint
CREATE TYPE "public"."monitor_alert_state" AS ENUM('ok', 'firing');--> statement-breakpoint
CREATE TYPE "public"."monitor_metric" AS ENUM('cpu', 'memory', 'disk', 'swap', 'load1', 'procCpu', 'heap', 'loopLag', 'qps', 'errorRate', 'netRxBps', 'netTxBps', 'diskReadBps', 'diskWriteBps', 'workflowHealth', 'workflowBacklog', 'workflowDeadLetter', 'workflowFailureRate', 'workflowStuckRunning');--> statement-breakpoint
CREATE TYPE "public"."ssl_cert_status" AS ENUM('valid', 'expiring', 'expired', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."ssl_cert_type" AS ENUM('self_signed', 'uploaded', 'letsencrypt');--> statement-breakpoint
CREATE TYPE "public"."mp_account_type" AS ENUM('subscribe', 'service', 'test');--> statement-breakpoint
CREATE TYPE "public"."mp_auto_reply_match" AS ENUM('exact', 'contain', 'regex');--> statement-breakpoint
CREATE TYPE "public"."mp_auto_reply_type" AS ENUM('subscribe', 'keyword', 'default');--> statement-breakpoint
CREATE TYPE "public"."mp_broadcast_status" AS ENUM('draft', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."mp_broadcast_target" AS ENUM('all', 'tag');--> statement-breakpoint
CREATE TYPE "public"."mp_broadcast_type" AS ENUM('text', 'image', 'mpnews');--> statement-breakpoint
CREATE TYPE "public"."mp_draft_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."mp_encrypt_mode" AS ENUM('plaintext', 'compatible', 'safe');--> statement-breakpoint
CREATE TYPE "public"."mp_fan_subscribe" AS ENUM('subscribed', 'unsubscribed');--> statement-breakpoint
CREATE TYPE "public"."mp_kf_routing_strategy" AS ENUM('manual', 'round_robin', 'least_active');--> statement-breakpoint
CREATE TYPE "public"."mp_kf_session_close_reason" AS ENUM('manual', 'wait_timeout', 'idle_timeout', 'system');--> statement-breakpoint
CREATE TYPE "public"."mp_kf_session_event_type" AS ENUM('create', 'assign', 'accept', 'transfer', 'reroute', 'close');--> statement-breakpoint
CREATE TYPE "public"."mp_kf_session_status" AS ENUM('waiting', 'active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."mp_material_type" AS ENUM('image', 'voice', 'video', 'thumb');--> statement-breakpoint
CREATE TYPE "public"."mp_menu_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."mp_message_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."mp_message_status" AS ENUM('received', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."mp_message_type" AS ENUM('text', 'image', 'voice', 'video', 'shortvideo', 'location', 'link', 'event');--> statement-breakpoint
CREATE TYPE "public"."mp_qrcode_type" AS ENUM('temporary', 'permanent');--> statement-breakpoint
CREATE TYPE "public"."mp_reply_content_type" AS ENUM('text', 'image', 'voice', 'video', 'news');--> statement-breakpoint
CREATE TYPE "public"."mp_template_send_status" AS ENUM('success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."report_datasource_type" AS ENUM('api', 'sql', 'mysql', 'postgresql', 'sqlserver', 'static');--> statement-breakpoint
CREATE TABLE "departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer DEFAULT 0 NOT NULL,
	"name" varchar(64) NOT NULL,
	"code" varchar(64) NOT NULL,
	"category" varchar(32) DEFAULT 'department' NOT NULL,
	"leader_id" integer,
	"phone" varchar(32),
	"email" varchar(128),
	"sort" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "departments_tenant_code_unique" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "menus" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer DEFAULT 0 NOT NULL,
	"title" varchar(64) NOT NULL,
	"name" varchar(64),
	"path" varchar(256),
	"component" varchar(256),
	"icon" varchar(64),
	"type" "menu_type" DEFAULT 'menu' NOT NULL,
	"permission" varchar(128),
	"query" varchar(512),
	"is_external" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"code" varchar(64) NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "positions_tenant_code_unique" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "role_dept_scopes" (
	"role_id" integer NOT NULL,
	"dept_id" integer NOT NULL,
	CONSTRAINT "role_dept_scopes_role_id_dept_id_pk" PRIMARY KEY("role_id","dept_id")
);
--> statement-breakpoint
CREATE TABLE "role_menus" (
	"role_id" integer NOT NULL,
	"menu_id" integer NOT NULL,
	CONSTRAINT "role_menus_role_id_menu_id_pk" PRIMARY KEY("role_id","menu_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"code" varchar(64) NOT NULL,
	"description" varchar(256),
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"data_scope" "data_scope" DEFAULT 'all' NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "roles_tenant_code_unique" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "tenant_package_menus" (
	"package_id" integer NOT NULL,
	"menu_id" integer NOT NULL,
	CONSTRAINT "tenant_package_menus_package_id_menu_id_pk" PRIMARY KEY("package_id","menu_id")
);
--> statement-breakpoint
CREATE TABLE "tenant_packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_packages_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(50) NOT NULL,
	"logo" varchar(500),
	"contact_name" varchar(50),
	"contact_phone" varchar(20),
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"expire_at" timestamp with time zone,
	"max_users" integer,
	"package_id" integer,
	"remark" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "user_dept_scopes" (
	"user_id" integer NOT NULL,
	"dept_id" integer NOT NULL,
	CONSTRAINT "user_dept_scopes_user_id_dept_id_pk" PRIMARY KEY("user_id","dept_id")
);
--> statement-breakpoint
CREATE TABLE "user_group_members" (
	"group_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "user_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"code" varchar(64) NOT NULL,
	"description" varchar(256),
	"owner_id" integer,
	"department_id" integer,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_groups_tenant_code_unique" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "user_menus" (
	"user_id" integer NOT NULL,
	"menu_id" integer NOT NULL,
	CONSTRAINT "user_menus_user_id_menu_id_pk" PRIMARY KEY("user_id","menu_id")
);
--> statement-breakpoint
CREATE TABLE "user_positions" (
	"user_id" integer NOT NULL,
	"position_id" integer NOT NULL,
	CONSTRAINT "user_positions_user_id_position_id_pk" PRIMARY KEY("user_id","position_id")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(32) NOT NULL,
	"nickname" varchar(32) NOT NULL,
	"email" varchar(128) NOT NULL,
	"password" varchar(128) NOT NULL,
	"avatar" varchar(256),
	"phone" varchar(20),
	"department_id" integer,
	"tenant_id" integer,
	"gender" varchar(20),
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"preferences" jsonb,
	"favorite_menus" jsonb,
	"user_data_scope" "data_scope",
	"password_updated_at" timestamp DEFAULT now() NOT NULL,
	"last_login_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_tenant_username_unique" UNIQUE("tenant_id","username"),
	CONSTRAINT "users_tenant_email_unique" UNIQUE("tenant_id","email")
);
--> statement-breakpoint
CREATE TABLE "business_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_type" "business_type" NOT NULL,
	"business_id" integer NOT NULL,
	"file_id" uuid NOT NULL,
	"name" varchar(256),
	"category" varchar(64),
	"sort_order" smallint DEFAULT 0,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_business_file" UNIQUE("business_type","business_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "file_storage_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"provider" "file_storage_provider" DEFAULT 'local' NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"base_path" varchar(256),
	"local_root_path" varchar(512),
	"oss_region" varchar(64),
	"oss_endpoint" varchar(128),
	"oss_bucket" varchar(128),
	"oss_access_key_id" varchar(128),
	"oss_access_key_secret" varchar(256),
	"s3_region" varchar(64),
	"s3_endpoint" varchar(256),
	"s3_bucket" varchar(128),
	"s3_access_key_id" varchar(128),
	"s3_secret_access_key" varchar(256),
	"s3_force_path_style" boolean DEFAULT false,
	"cos_region" varchar(64),
	"cos_bucket" varchar(128),
	"cos_secret_id" varchar(128),
	"cos_secret_key" varchar(256),
	"obs_endpoint" varchar(256),
	"obs_bucket" varchar(128),
	"obs_access_key_id" varchar(128),
	"obs_secret_access_key" varchar(256),
	"kodo_access_key" varchar(128),
	"kodo_secret_key" varchar(256),
	"kodo_bucket" varchar(128),
	"kodo_region" varchar(64),
	"kodo_endpoint" varchar(256),
	"bos_endpoint" varchar(256),
	"bos_bucket" varchar(128),
	"bos_access_key_id" varchar(128),
	"bos_secret_access_key" varchar(256),
	"azure_account_name" varchar(128),
	"azure_account_key" varchar(256),
	"azure_container_name" varchar(128),
	"azure_endpoint" varchar(256),
	"sftp_host" varchar(256),
	"sftp_port" integer DEFAULT 22,
	"sftp_username" varchar(128),
	"sftp_password" varchar(256),
	"sftp_private_key" text,
	"sftp_root_path" varchar(512),
	"sftp_base_url" varchar(512),
	"remark" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "managed_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"storage_config_id" integer NOT NULL,
	"storage_name" varchar(64) NOT NULL,
	"provider" "file_storage_provider" NOT NULL,
	"original_name" varchar(256) NOT NULL,
	"object_key" varchar(512) NOT NULL,
	"bucket_name" varchar(256),
	"size" integer DEFAULT 0 NOT NULL,
	"mime_type" varchar(128),
	"extension" varchar(32),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"upload_session_id" integer NOT NULL,
	"index" integer NOT NULL,
	"size" integer NOT NULL,
	"etag" varchar(256),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_upload_chunk" UNIQUE("upload_session_id","index")
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"upload_id" varchar(64) NOT NULL,
	"file_name" varchar(256) NOT NULL,
	"file_size" bigint NOT NULL,
	"mime_type" varchar(128),
	"chunk_size" integer NOT NULL,
	"total_chunks" integer NOT NULL,
	"storage_config_id" integer NOT NULL,
	"provider" "file_storage_provider" NOT NULL,
	"object_key" varchar(512) NOT NULL,
	"bucket_name" varchar(256),
	"multipart_upload_id" varchar(512),
	"status" "upload_session_status" DEFAULT 'uploading' NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "upload_sessions_upload_id_unique" UNIQUE("upload_id")
);
--> statement-breakpoint
CREATE TABLE "data_mask_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity" varchar(64) NOT NULL,
	"field" varchar(64) NOT NULL,
	"label" varchar(64) NOT NULL,
	"mask_type" "mask_type" NOT NULL,
	"custom_rule" jsonb,
	"exempt_role_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"remark" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "data_mask_entity_field_unique" UNIQUE("entity","field")
);
--> statement-breakpoint
CREATE TABLE "async_task_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"item_key" varchar(128) NOT NULL,
	"label" varchar(256),
	"status" "async_task_item_status" DEFAULT 'pending' NOT NULL,
	"message" text,
	"data" jsonb,
	"attempt" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_async_task_item" UNIQUE("task_id","item_key")
);
--> statement-breakpoint
CREATE TABLE "async_task_type_configs" (
	"task_type" varchar(64) PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"allow_concurrent" boolean DEFAULT true NOT NULL,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"retry_delay_ms" integer DEFAULT 5000 NOT NULL,
	"retention_days" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "async_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_type" varchar(64) NOT NULL,
	"title" varchar(128) NOT NULL,
	"status" "async_task_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_count" integer,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"progress_note" varchar(256),
	"checkpoint" jsonb,
	"result" jsonb,
	"error_message" text,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"next_run_at" timestamp,
	"idempotency_key" varchar(128),
	"heartbeat_at" timestamp,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_async_tasks_idempotency_key" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "export_job_downloads" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"downloaded_by" integer,
	"tenant_id" integer,
	"ip" varchar(64),
	"user_agent" varchar(512),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity" varchar(64) NOT NULL,
	"module_name" varchar(64) NOT NULL,
	"format" "export_job_format" NOT NULL,
	"status" "export_job_status" DEFAULT 'pending' NOT NULL,
	"execution_mode" "export_job_execution_mode" DEFAULT 'async' NOT NULL,
	"query" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"columns" jsonb,
	"row_count" integer,
	"file_id" uuid,
	"filename" varchar(256),
	"file_size" integer,
	"raw" boolean DEFAULT false NOT NULL,
	"masked" boolean DEFAULT true NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"watermark" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"expires_at" timestamp,
	"file_deleted_at" timestamp,
	"delete_reason" "export_job_delete_reason",
	"download_count" integer DEFAULT 0 NOT NULL,
	"last_downloaded_at" timestamp,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cron_job_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"job_name" varchar(64) NOT NULL,
	"execution_count" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_ms" integer,
	"status" "cron_run_status" DEFAULT 'running' NOT NULL,
	"output" text
);
--> statement-breakpoint
CREATE TABLE "cron_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"cron_expression" varchar(128) NOT NULL,
	"handler" varchar(128) NOT NULL,
	"params" text,
	"status" "status" DEFAULT 'disabled' NOT NULL,
	"description" varchar(256) DEFAULT '' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"retry_interval" integer DEFAULT 0 NOT NULL,
	"retry_backoff" boolean DEFAULT false NOT NULL,
	"monitor_timeout" integer,
	"last_run_at" timestamp with time zone,
	"last_run_status" "cron_run_status",
	"last_run_message" varchar(1024),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cron_jobs_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "maintenance_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"message" varchar(512) NOT NULL,
	"estimated_end_at" timestamp,
	"started_at" timestamp NOT NULL,
	"started_by_id" integer,
	"started_by_name" varchar(64),
	"ended_at" timestamp,
	"ended_by_id" integer,
	"ended_by_name" varchar(64),
	"duration_seconds" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_mode" (
	"id" serial PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"message" varchar(512) DEFAULT '系统维护中，请稍后重试' NOT NULL,
	"estimated_end_at" timestamp,
	"started_at" timestamp,
	"started_by_name" varchar(64),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(12) NOT NULL,
	"name" varchar(64) NOT NULL,
	"level" "region_level" NOT NULL,
	"parent_code" varchar(12),
	"sort" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "regions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "system_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"config_key" varchar(128) NOT NULL,
	"config_value" varchar(4096) DEFAULT '' NOT NULL,
	"config_type" "config_type" DEFAULT 'string' NOT NULL,
	"description" varchar(256) DEFAULT '' NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "system_configs_tenant_key_unique" UNIQUE("tenant_id","config_key")
);
--> statement-breakpoint
CREATE TABLE "system_scheduler_nodes" (
	"node_id" varchar(128) PRIMARY KEY NOT NULL,
	"hostname" varchar(128) NOT NULL,
	"pid" integer NOT NULL,
	"version" varchar(64),
	"started_at" timestamp with time zone NOT NULL,
	"last_heartbeat_at" timestamp with time zone NOT NULL,
	"registered_task_count" integer DEFAULT 0 NOT NULL,
	"running_job_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_scheduler_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_name" varchar(128) NOT NULL,
	"task_title" varchar(128) NOT NULL,
	"task_type" "system_scheduler_task_type" NOT NULL,
	"module" varchar(64) DEFAULT '系统' NOT NULL,
	"trigger_type" "system_scheduler_trigger_type" NOT NULL,
	"status" "system_scheduler_run_status" DEFAULT 'running' NOT NULL,
	"job_id" varchar(128),
	"node_id" varchar(128),
	"node_hostname" varchar(128),
	"node_pid" integer,
	"triggered_by" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_ms" integer,
	"result_message" text,
	"error_message" text,
	"alerted_at" timestamp with time zone,
	"alert_message" text,
	"alert_sent_at" timestamp with time zone,
	"alert_channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"alert_ack_at" timestamp with time zone,
	"alert_ack_by" integer,
	"alert_ack_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_scheduler_task_configs" (
	"task_name" varchar(128) PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"log_retention_days" integer DEFAULT 30 NOT NULL,
	"log_retention_runs" integer DEFAULT 1000 NOT NULL,
	"timeout_ms" integer,
	"failure_alert_threshold" integer DEFAULT 1 NOT NULL,
	"alert_enabled" boolean DEFAULT true NOT NULL,
	"alert_channels" jsonb DEFAULT '["inapp"]'::jsonb NOT NULL,
	"alert_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"alert_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"alert_webhook_url" varchar(512),
	"manual_singleton" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_risk_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"username" varchar(64) NOT NULL,
	"tenant_id" integer,
	"risk_level" "login_risk_level" DEFAULT 'low' NOT NULL,
	"reason" varchar(256) NOT NULL,
	"action" "login_risk_action" DEFAULT 'allow' NOT NULL,
	"ip" varchar(64),
	"location" varchar(128),
	"user_agent" varchar(512),
	"device_id_hash" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" "oauth_provider" NOT NULL,
	"client_id" varchar(256) DEFAULT '' NOT NULL,
	"client_secret" varchar(512) DEFAULT '' NOT NULL,
	"agent_id" varchar(128),
	"corp_id" varchar(128),
	"enabled" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_configs_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "rate_limit_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" varchar(255),
	"window_ms" integer NOT NULL,
	"limit" integer NOT NULL,
	"key_type" "rate_limit_key_type" DEFAULT 'ip' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"blocked_message" varchar(255),
	"path_patterns" text[] DEFAULT '{}' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limit_rules_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "user_api_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(64) NOT NULL,
	"token" varchar(128) NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_api_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user_mfa_factors" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" "mfa_factor_type" NOT NULL,
	"name" varchar(64) NOT NULL,
	"secret_encrypted" text,
	"credential_json" jsonb,
	"status" "mfa_factor_status" DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_oauth_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider" "oauth_provider" NOT NULL,
	"open_id" varchar(128) NOT NULL,
	"union_id" varchar(128),
	"nickname" varchar(64),
	"avatar" varchar(512),
	"access_token" varchar(512),
	"refresh_token" varchar(512),
	"expires_at" timestamp with time zone,
	"raw" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_provider_open_id" UNIQUE("provider","open_id")
);
--> statement-breakpoint
CREATE TABLE "user_trusted_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"device_id_hash" varchar(128) NOT NULL,
	"device_name" varchar(128),
	"ip" varchar(64),
	"user_agent" varchar(512),
	"trusted_until" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_provider_sync_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"status" "identity_provider_sync_status" NOT NULL,
	"trigger_type" varchar(32) DEFAULT 'manual' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"linked" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"message" text,
	"error_message" text,
	"details" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_identity_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"name" varchar(100) NOT NULL,
	"code" varchar(64) NOT NULL,
	"type" "identity_provider_type" NOT NULL,
	"status" "identity_provider_status" DEFAULT 'disabled' NOT NULL,
	"issuer" varchar(512),
	"authorization_endpoint" varchar(512),
	"token_endpoint" varchar(512),
	"userinfo_endpoint" varchar(512),
	"jwks_uri" varchar(512),
	"client_id" varchar(256),
	"client_secret" text,
	"scopes" varchar(256) DEFAULT 'openid profile email' NOT NULL,
	"saml_sso_url" varchar(512),
	"saml_entity_id" varchar(512),
	"saml_certificate" text,
	"ldap_url" varchar(512),
	"ldap_start_tls" boolean DEFAULT false NOT NULL,
	"ldap_skip_tls_verify" boolean DEFAULT false NOT NULL,
	"ldap_base_dn" varchar(512),
	"ldap_bind_dn" varchar(512),
	"ldap_bind_password" text,
	"ldap_user_filter" varchar(1000),
	"ldap_user_search_filter" varchar(1000),
	"ldap_sync_filter" varchar(1000),
	"ldap_group_base_dn" varchar(512),
	"ldap_group_filter" varchar(1000),
	"ldap_timeout_ms" integer DEFAULT 5000 NOT NULL,
	"attribute_mapping" jsonb DEFAULT '{"subject":"sub","email":"email","username":"preferred_username","nickname":"name"}'::jsonb NOT NULL,
	"jit_enabled" boolean DEFAULT false NOT NULL,
	"default_role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remark" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_identity_providers_tenant_code_unique" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "user_identity_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider_id" integer NOT NULL,
	"subject" varchar(256) NOT NULL,
	"email" varchar(128),
	"username" varchar(64),
	"display_name" varchar(128),
	"raw_profile" jsonb,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_identity_accounts_provider_subject_unique" UNIQUE("provider_id","subject"),
	CONSTRAINT "user_identity_accounts_user_provider_unique" UNIQUE("user_id","provider_id")
);
--> statement-breakpoint
CREATE TABLE "dict_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"dict_id" integer NOT NULL,
	"parent_id" integer,
	"label" varchar(64) NOT NULL,
	"value" varchar(64) NOT NULL,
	"color" varchar(32),
	"sort" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(256),
	"metadata" jsonb,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dicts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"code" varchar(64) NOT NULL,
	"description" varchar(256),
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dicts_tenant_code_unique" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "ip_access_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"ip" varchar(64) NOT NULL,
	"path" varchar(256) NOT NULL,
	"method" varchar(16) NOT NULL,
	"block_type" varchar(16) NOT NULL,
	"user_agent" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"username" varchar(64) NOT NULL,
	"ip" varchar(64),
	"location" varchar(128),
	"browser" varchar(64),
	"os" varchar(64),
	"user_agent" varchar(512),
	"event_type" "login_event_type" DEFAULT 'login' NOT NULL,
	"status" "login_status" NOT NULL,
	"message" varchar(256),
	"tenant_id" integer,
	"screen_width" smallint,
	"screen_height" smallint,
	"device_pixel_ratio" varchar(8),
	"gpu" varchar(256),
	"cpu_cores" smallint,
	"memory_gb" varchar(8),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operation_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"username" varchar(32),
	"module" varchar(64),
	"description" varchar(256) NOT NULL,
	"method" varchar(16) NOT NULL,
	"path" varchar(256) NOT NULL,
	"request_id" varchar(36),
	"request_body" varchar(4096),
	"before_data" text,
	"after_data" text,
	"response_code" integer,
	"response_body" text,
	"duration_ms" integer,
	"ip" varchar(64),
	"location" varchar(128),
	"user_agent" varchar(512),
	"os" varchar(64),
	"browser" varchar(64),
	"tenant_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_daily_rollup" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer DEFAULT 0 NOT NULL,
	"stat_date" date NOT NULL,
	"metric" varchar(32) NOT NULL,
	"dim_type" varchar(32) DEFAULT 'overall' NOT NULL,
	"dim_value" varchar(256) DEFAULT '' NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_event_meta" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"event_name" varchar(128) NOT NULL,
	"display_name" varchar(128),
	"category" varchar(64),
	"description" text,
	"property_schema" jsonb,
	"status" "analytics_event_status" DEFAULT 'active' NOT NULL,
	"event_count" bigint DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"session_id" varchar(36) NOT NULL,
	"distinct_id" varchar(64),
	"user_id" integer,
	"username" varchar(64),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"entry_page" varchar(256),
	"exit_page" varchar(256),
	"referrer" varchar(512),
	"utm_source" varchar(128),
	"browser" varchar(48),
	"os" varchar(48),
	"device_type" "analytics_device_type",
	"country" varchar(64),
	"region" varchar(64),
	"is_bounce" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"sample_rate" real DEFAULT 1 NOT NULL,
	"track_pageviews" boolean DEFAULT true NOT NULL,
	"track_clicks" boolean DEFAULT true NOT NULL,
	"track_performance" boolean DEFAULT true NOT NULL,
	"track_errors" boolean DEFAULT true NOT NULL,
	"track_api" boolean DEFAULT true NOT NULL,
	"mask_inputs" boolean DEFAULT true NOT NULL,
	"respect_dnt" boolean DEFAULT false NOT NULL,
	"blacklist_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retention_days" integer DEFAULT 180 NOT NULL,
	"error_retention_days" integer DEFAULT 90 NOT NULL,
	"session_timeout_minutes" integer DEFAULT 30 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_alert_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"name" varchar(128) NOT NULL,
	"error_type" "frontend_error_type",
	"level" "error_level",
	"condition" "error_alert_condition" DEFAULT 'threshold' NOT NULL,
	"threshold_count" integer DEFAULT 10 NOT NULL,
	"window_minutes" integer DEFAULT 60 NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"webhook_url" varchar(512),
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_triggered_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"group_id" integer NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"error_type" "frontend_error_type" NOT NULL,
	"level" "error_level" DEFAULT 'error' NOT NULL,
	"message" text NOT NULL,
	"stack" text,
	"source_url" varchar(512),
	"line_no" integer,
	"col_no" integer,
	"page_url" varchar(512),
	"release" varchar(64),
	"user_agent" varchar(512),
	"browser" varchar(48),
	"browser_version" varchar(32),
	"os" varchar(48),
	"device_type" "analytics_device_type",
	"user_id" integer,
	"username" varchar(64),
	"session_id" varchar(36),
	"breadcrumbs" jsonb,
	"context" jsonb,
	"http_status" integer,
	"http_method" varchar(16),
	"http_url" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"fingerprint" varchar(64) NOT NULL,
	"error_type" "frontend_error_type" NOT NULL,
	"level" "error_level" DEFAULT 'error' NOT NULL,
	"message" text NOT NULL,
	"status" "error_status" DEFAULT 'unresolved' NOT NULL,
	"assignee_id" integer,
	"assignee_name" varchar(64),
	"release" varchar(64),
	"note" text,
	"count" bigint DEFAULT 0 NOT NULL,
	"affected_users" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_maps" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"release" varchar(64) NOT NULL,
	"file_name" varchar(256) NOT NULL,
	"content" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"distinct_id" varchar(64),
	"anonymous_id" varchar(64),
	"user_id" integer,
	"username" varchar(64),
	"session_id" varchar(36),
	"event_type" "user_behavior_event_type" NOT NULL,
	"event_name" varchar(128),
	"page_path" varchar(256) NOT NULL,
	"page_title" varchar(128),
	"element_key" varchar(128),
	"element_label" varchar(128),
	"component_area" varchar(64),
	"click_x" real,
	"click_y" real,
	"scroll_depth" smallint,
	"duration_ms" integer,
	"properties" jsonb,
	"referrer" varchar(512),
	"utm_source" varchar(128),
	"utm_medium" varchar(128),
	"utm_campaign" varchar(128),
	"utm_term" varchar(128),
	"utm_content" varchar(128),
	"browser" varchar(48),
	"browser_version" varchar(32),
	"os" varchar(48),
	"os_version" varchar(32),
	"device_type" "analytics_device_type",
	"screen_w" integer,
	"screen_h" integer,
	"language" varchar(16),
	"user_agent" varchar(512),
	"ip" varchar(64),
	"country" varchar(64),
	"region" varchar(64),
	"city" varchar(64),
	"metric_name" varchar(32),
	"metric_value" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcement_reads" (
	"id" serial PRIMARY KEY NOT NULL,
	"announcement_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_announcement_user" UNIQUE("announcement_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "announcement_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"announcement_id" integer NOT NULL,
	"recipient_type" varchar(16) NOT NULL,
	"recipient_id" integer NOT NULL,
	CONSTRAINT "uniq_announcement_recipient" UNIQUE("announcement_id","recipient_type","recipient_id")
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(128) NOT NULL,
	"content" text NOT NULL,
	"type" varchar(32) DEFAULT 'notice' NOT NULL,
	"publish_status" varchar(32) DEFAULT 'draft' NOT NULL,
	"priority" varchar(32) DEFAULT 'medium' NOT NULL,
	"target_type" varchar(16) DEFAULT 'all' NOT NULL,
	"publish_time" timestamp with time zone,
	"create_by_id" integer,
	"create_by_name" varchar(32),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_automations" (
	"id" serial PRIMARY KEY NOT NULL,
	"definition_id" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"trigger" "workflow_automation_trigger" NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"code" varchar(64),
	"icon" varchar(64),
	"color" varchar(16),
	"sort" integer DEFAULT 0 NOT NULL,
	"description" text,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_categories_code_uniq" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "workflow_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"instance_id" integer NOT NULL,
	"task_id" integer,
	"user_id" integer NOT NULL,
	"content" text NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_compensation_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"compensation_id" integer NOT NULL,
	"action" varchar(16) NOT NULL,
	"note" text,
	"attachments" jsonb,
	"operator_id" integer,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_compensations" (
	"id" serial PRIMARY KEY NOT NULL,
	"instance_id" integer NOT NULL,
	"node_key" varchar(64) NOT NULL,
	"node_name" varchar(64),
	"error_message" varchar(1024),
	"action" varchar(16) DEFAULT 'notify' NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"compensation_action_status" varchar(16) DEFAULT 'none' NOT NULL,
	"failed_node_key" varchar(64),
	"action_payload" jsonb,
	"resolution" text,
	"resolved_by" integer,
	"resolved_at" timestamp with time zone,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_connector_invocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"connector_id" integer NOT NULL,
	"source" "workflow_connector_invocation_source" DEFAULT 'manual' NOT NULL,
	"ok" boolean NOT NULL,
	"status" integer,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"request_url" varchar(1024),
	"error" varchar(1024),
	"tenant_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_connectors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"code" varchar(64) NOT NULL,
	"description" text,
	"type" "workflow_connector_type" DEFAULT 'http' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credentials_encrypted" text,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"retry_max" integer DEFAULT 0 NOT NULL,
	"circuit_breaker_enabled" boolean DEFAULT true NOT NULL,
	"failure_threshold" integer DEFAULT 5 NOT NULL,
	"cooldown_sec" integer DEFAULT 60 NOT NULL,
	"rate_limit_enabled" boolean DEFAULT false NOT NULL,
	"rate_limit_window_sec" integer DEFAULT 1 NOT NULL,
	"rate_limit_max" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_connectors_code_uniq" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "workflow_data_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"method" varchar(8) DEFAULT 'GET' NOT NULL,
	"url" varchar(1024) NOT NULL,
	"headers" jsonb,
	"items_path" varchar(128),
	"value_field" varchar(64) NOT NULL,
	"label_field" varchar(64) NOT NULL,
	"keyword_param" varchar(64),
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_data_sources_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "workflow_definition_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"definition_id" integer NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" text,
	"flow_data" jsonb,
	"form_id" integer,
	"form_type" "workflow_form_type" DEFAULT 'designer' NOT NULL,
	"custom_form" jsonb,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" integer,
	"tenant_id" integer,
	CONSTRAINT "workflow_def_versions_def_ver_uniq" UNIQUE("definition_id","version")
);
--> statement-breakpoint
CREATE TABLE "workflow_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" text,
	"category_id" integer,
	"initiator_scope_type" varchar(16) DEFAULT 'all' NOT NULL,
	"initiator_scope_ids" jsonb,
	"flow_data" jsonb,
	"form_id" integer,
	"form_type" "workflow_form_type" DEFAULT 'designer' NOT NULL,
	"custom_form" jsonb,
	"status" "workflow_definition_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_delegations" (
	"id" serial PRIMARY KEY NOT NULL,
	"principal_id" integer NOT NULL,
	"delegate_id" integer NOT NULL,
	"definition_id" integer,
	"reason" varchar(255),
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_engine_health_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"health_score" smallint NOT NULL,
	"severity" varchar(16) DEFAULT 'healthy' NOT NULL,
	"backlog" integer DEFAULT 0 NOT NULL,
	"error_rate" real DEFAULT 0 NOT NULL,
	"critical_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"running_instances" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_event_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" varchar(256),
	"definition_id" integer,
	"events" text NOT NULL,
	"url" varchar(512) NOT NULL,
	"secret" varchar(256),
	"sign_mode" "workflow_event_sign_mode" DEFAULT 'hmacSha256' NOT NULL,
	"headers" text,
	"connector_id" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_forms" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"code" varchar(64),
	"description" text,
	"category_id" integer,
	"schema" jsonb,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_forms_code_uniq" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "workflow_instance_migrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"instance_id" integer NOT NULL,
	"definition_id" integer NOT NULL,
	"from_version" integer NOT NULL,
	"to_version" integer NOT NULL,
	"node_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'done' NOT NULL,
	"note" text,
	"created_by" integer,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_instances" (
	"id" serial PRIMARY KEY NOT NULL,
	"definition_id" integer NOT NULL,
	"definition_snapshot" jsonb NOT NULL,
	"form_snapshot" jsonb,
	"title" varchar(128) NOT NULL,
	"serial_no" varchar(64),
	"form_data" jsonb,
	"status" "workflow_instance_status" DEFAULT 'draft' NOT NULL,
	"priority" varchar(16) DEFAULT 'normal' NOT NULL,
	"current_node_key" varchar(64),
	"initiator_id" integer NOT NULL,
	"tenant_id" integer,
	"parent_instance_id" integer,
	"parent_task_id" integer,
	"parent_task_item_key" varchar(128),
	"parent_task_item_index" integer,
	"biz_type" varchar(64),
	"biz_id" varchar(64),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_job_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"job_type" "workflow_job_type" NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"status" "workflow_job_execution_status" DEFAULT 'running' NOT NULL,
	"request_url" varchar(512),
	"request_method" varchar(16),
	"request_body" text,
	"response_status" integer,
	"response_body" text,
	"error_message" text,
	"duration_ms" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_type" "workflow_job_type" NOT NULL,
	"status" "workflow_job_status" DEFAULT 'pending' NOT NULL,
	"instance_id" integer,
	"task_id" integer,
	"node_key" varchar(64),
	"idempotency_key" varchar(160),
	"trace_id" varchar(64),
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" varchar(64),
	"last_error" text,
	"result" jsonb,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "workflow_quick_phrases" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"content" varchar(255) NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_saved_views" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"page_key" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"definition_id" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"cron_expression" varchar(64) NOT NULL,
	"initiator_id" integer NOT NULL,
	"title_template" varchar(256),
	"form_data" jsonb,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_run_status" varchar(16),
	"last_run_message" varchar(512),
	"next_run_at" timestamp with time zone,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_serial_counters" (
	"id" serial PRIMARY KEY NOT NULL,
	"definition_id" integer NOT NULL,
	"period_key" varchar(16) NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "workflow_serial_counters_def_period_uniq" UNIQUE("definition_id","period_key")
);
--> statement-breakpoint
CREATE TABLE "workflow_simulation_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"definition_id" integer NOT NULL,
	"name" varchar(64) NOT NULL,
	"starter_user_id" integer,
	"form_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_simulation_cases_name_uniq" UNIQUE("definition_id","name")
);
--> statement-breakpoint
CREATE TABLE "workflow_task_consults" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"instance_id" integer NOT NULL,
	"inviter_id" integer NOT NULL,
	"consultee_id" integer NOT NULL,
	"question" varchar(500),
	"opinion" text,
	"status" "workflow_task_consult_status" DEFAULT 'pending' NOT NULL,
	"replied_at" timestamp with time zone,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_task_urges" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"instance_id" integer NOT NULL,
	"urger_id" integer,
	"urger_name" varchar(64),
	"message" varchar(256),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"instance_id" integer NOT NULL,
	"node_key" varchar(64) NOT NULL,
	"node_name" varchar(64) NOT NULL,
	"node_type" "workflow_node_type",
	"assignee_id" integer,
	"status" "workflow_task_status" DEFAULT 'pending' NOT NULL,
	"comment" text,
	"signature" text,
	"attachments" jsonb,
	"action_at" timestamp with time zone,
	"task_order" integer,
	"approve_method" "workflow_approve_method",
	"approve_ratio" integer,
	"external_callback_id" varchar(64),
	"sub_total" integer,
	"sub_done" integer DEFAULT 0 NOT NULL,
	"original_assignee_id" integer,
	"transfer_chain" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"delegated_from_id" integer,
	"return_origin_node_key" varchar(64),
	"cc_read_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_tasks_external_callback_id_unique" UNIQUE("external_callback_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"code" varchar(64),
	"description" text,
	"category_name" varchar(64),
	"icon" varchar(64),
	"color" varchar(16),
	"flow_data" jsonb,
	"form_schema" jsonb,
	"sort" integer DEFAULT 0 NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_templates_code_uniq" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "workflow_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"instance_id" integer NOT NULL,
	"node_key" varchar(64) NOT NULL,
	"status" "workflow_token_status" DEFAULT 'active' NOT NULL,
	"branch_path" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parent_token_id" integer,
	"scope_key" varchar(128),
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"consumed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "email_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"smtp_host" varchar(128) DEFAULT '' NOT NULL,
	"smtp_port" integer DEFAULT 465 NOT NULL,
	"smtp_user" varchar(128) DEFAULT '' NOT NULL,
	"smtp_password" varchar(256) DEFAULT '' NOT NULL,
	"from_name" varchar(64) DEFAULT 'Zenith Admin' NOT NULL,
	"from_email" varchar(128) DEFAULT '' NOT NULL,
	"encryption" "email_encryption" DEFAULT 'ssl' NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_send_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer,
	"to_email" varchar(256) NOT NULL,
	"subject" varchar(200) NOT NULL,
	"content" text NOT NULL,
	"status" "send_status" DEFAULT 'pending' NOT NULL,
	"error_msg" text,
	"source" "send_source" DEFAULT 'manual' NOT NULL,
	"user_id" integer,
	"ip" varchar(64),
	"tenant_id" integer,
	"sent_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(100) NOT NULL,
	"subject" varchar(200) NOT NULL,
	"content" text NOT NULL,
	"variables" text,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" text,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_templates_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "in_app_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer,
	"user_id" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"content" text NOT NULL,
	"type" "in_app_message_type" DEFAULT 'info' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"source" "send_source" DEFAULT 'system' NOT NULL,
	"sender_id" integer,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "in_app_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(100) NOT NULL,
	"title" varchar(200) NOT NULL,
	"content" text NOT NULL,
	"type" "in_app_message_type" DEFAULT 'info' NOT NULL,
	"variables" text,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" text,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "in_app_templates_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sms_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"provider" "sms_provider" NOT NULL,
	"access_key_id" varchar(256) DEFAULT '' NOT NULL,
	"access_key_secret" varchar(512) DEFAULT '' NOT NULL,
	"region" varchar(64),
	"sign_name" varchar(64) DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" text,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_send_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"config_id" integer,
	"template_id" integer,
	"provider" "sms_provider" NOT NULL,
	"phone" varchar(32) NOT NULL,
	"content" text NOT NULL,
	"status" "send_status" DEFAULT 'pending' NOT NULL,
	"error_msg" text,
	"biz_id" varchar(128),
	"delivery_status" varchar(32),
	"delivered_at" timestamp with time zone,
	"source" "send_source" DEFAULT 'manual' NOT NULL,
	"user_id" integer,
	"ip" varchar(64),
	"tenant_id" integer,
	"sent_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(100) NOT NULL,
	"template_code" varchar(100) DEFAULT '' NOT NULL,
	"sign_name" varchar(64),
	"content" text NOT NULL,
	"variables" text,
	"provider" "sms_provider" NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" text,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sms_templates_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "db_admin_query_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"sql_text" text NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "db_backups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"type" "backup_type" NOT NULL,
	"file_id" uuid,
	"file_size" integer,
	"status" "backup_status" DEFAULT 'pending' NOT NULL,
	"tables" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"error_message" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "db_query_favorites" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"sql" text NOT NULL,
	"description" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"color" varchar(20),
	"group_name" varchar(50),
	"description" text,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "rule_decision_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_key" varchar(64) NOT NULL,
	"table_id" integer,
	"instance_id" integer,
	"node_key" varchar(64),
	"source" varchar(16) DEFAULT 'runtime' NOT NULL,
	"matched" boolean DEFAULT false NOT NULL,
	"hit_policy" "rule_hit_policy" DEFAULT 'first' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"matched_row_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" integer,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_decision_table_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_id" integer NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" text,
	"hit_policy" "rule_hit_policy" DEFAULT 'first' NOT NULL,
	"inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" integer,
	"tenant_id" integer,
	CONSTRAINT "rule_decision_table_versions_uniq" UNIQUE("table_id","version")
);
--> statement-breakpoint
CREATE TABLE "rule_decision_tables" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" text,
	"category_id" integer,
	"status" "workflow_definition_status" DEFAULT 'draft' NOT NULL,
	"hit_policy" "rule_hit_policy" DEFAULT 'first' NOT NULL,
	"inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rule_decision_tables_key_uniq" UNIQUE("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "rule_test_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_id" integer NOT NULL,
	"name" varchar(64) NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expected" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rule_test_cases_name_uniq" UNIQUE("table_id","name")
);
--> statement-breakpoint
CREATE TABLE "biz_leaves" (
	"id" serial PRIMARY KEY NOT NULL,
	"leave_type" varchar(32) NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"days" real DEFAULT 1 NOT NULL,
	"reason" text,
	"status" "biz_leave_status" DEFAULT 'draft' NOT NULL,
	"workflow_instance_id" integer,
	"workflow_status" varchar(16),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biz_pay_demos" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject" varchar(128) NOT NULL,
	"amount" integer NOT NULL,
	"pay_method" varchar(32),
	"status" "biz_pay_demo_status" DEFAULT 'pending' NOT NULL,
	"payment_order_no" varchar(64),
	"paid_at" timestamp with time zone,
	"fulfill_remark" varchar(255),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_conversation_members" (
	"conversation_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" "chat_member_role" DEFAULT 'member' NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"is_starred" boolean DEFAULT false NOT NULL,
	"is_muted" boolean DEFAULT false NOT NULL,
	"last_read_at" timestamp with time zone,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chat_conversation_members_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "chat_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" "chat_conversation_type" DEFAULT 'direct' NOT NULL,
	"name" varchar(64),
	"announcement" varchar(500),
	"created_by" integer,
	"updated_by" integer,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_message_reactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"emoji" varchar(10) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_message_reactions_message_id_user_id_emoji_unique" UNIQUE("message_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"sender_id" integer,
	"type" "chat_message_type" DEFAULT 'text' NOT NULL,
	"content" text NOT NULL,
	"reply_to_id" integer,
	"is_recalled" boolean DEFAULT false NOT NULL,
	"is_edited" boolean DEFAULT false NOT NULL,
	"extra" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_webhooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"avatar" varchar(256),
	"description" varchar(255),
	"token" varchar(128) NOT NULL,
	"conversation_id" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chat_webhooks_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "channel_auto_replies" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"match_type" "channel_auto_reply_match" DEFAULT 'keyword' NOT NULL,
	"keyword" varchar(100),
	"keyword_mode" "channel_auto_reply_keyword_mode" DEFAULT 'contains' NOT NULL,
	"reply_type" "channel_message_type" DEFAULT 'text' NOT NULL,
	"reply_content" text NOT NULL,
	"reply_extra" jsonb,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_conversations" (
	"channel_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"status" "channel_conversation_status" DEFAULT 'open' NOT NULL,
	"assignee_id" integer,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolved_at" timestamp with time zone,
	"rating" integer,
	"rating_comment" text,
	"rated_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channel_conversations_channel_id_user_id_pk" PRIMARY KEY("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "channel_menus" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"parent_id" integer,
	"name" varchar(32) NOT NULL,
	"type" "channel_menu_type" DEFAULT 'click' NOT NULL,
	"value" varchar(500),
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_message_targets" (
	"message_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "channel_message_targets_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "channel_message_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" "channel_message_type" DEFAULT 'text' NOT NULL,
	"title" varchar(200),
	"content" text DEFAULT '' NOT NULL,
	"extra" jsonb,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"audience_type" "channel_audience" DEFAULT 'broadcast' NOT NULL,
	"type" "channel_message_type" DEFAULT 'text' NOT NULL,
	"title" varchar(200),
	"content" text NOT NULL,
	"extra" jsonb,
	"published_by_id" integer,
	"direction" "channel_message_direction" DEFAULT 'out' NOT NULL,
	"sender_user_id" integer,
	"status" "channel_message_status" DEFAULT 'sent' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"retracted_at" timestamp with time zone,
	"target_spec" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_quick_replies" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer,
	"title" varchar(100) NOT NULL,
	"content" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_subscriptions" (
	"channel_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"last_read_at" timestamp with time zone,
	"is_muted" boolean DEFAULT false NOT NULL,
	"subscribed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channel_subscriptions_channel_id_user_id_pk" PRIMARY KEY("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"avatar" varchar(256),
	"description" varchar(255),
	"type" "channel_type" DEFAULT 'system' NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channels_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "payment_channel_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"channel" "payment_channel" NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sandbox" boolean DEFAULT false NOT NULL,
	"notify_url" varchar(512),
	"wechat_app_id" varchar(64),
	"wechat_mch_id" varchar(64),
	"wechat_api_v3_key_encrypted" text,
	"wechat_private_key_encrypted" text,
	"wechat_serial_no" varchar(128),
	"wechat_platform_cert" text,
	"alipay_app_id" varchar(64),
	"alipay_private_key_encrypted" text,
	"alipay_public_key" text,
	"alipay_sign_type" varchar(16) DEFAULT 'RSA2',
	"alipay_gateway" varchar(256),
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(32) NOT NULL,
	"order_no" varchar(64) NOT NULL,
	"payload" text NOT NULL,
	"status" "payment_event_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" varchar(512),
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment_fee_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"channel" "payment_channel" NOT NULL,
	"pay_method" "payment_method",
	"rate_bps" integer DEFAULT 0 NOT NULL,
	"fixed_fee" integer DEFAULT 0 NOT NULL,
	"min_fee" integer,
	"max_fee" integer,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_ledger_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_no" varchar(64) NOT NULL,
	"direction" "payment_ledger_direction" NOT NULL,
	"type" "payment_ledger_type" NOT NULL,
	"amount" integer NOT NULL,
	"order_no" varchar(64),
	"refund_no" varchar(64),
	"channel" "payment_channel",
	"biz_type" varchar(64),
	"remark" varchar(256),
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_ledger_entries_entry_no_unique" UNIQUE("entry_no")
);
--> statement-breakpoint
CREATE TABLE "payment_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"link_no" varchar(64) NOT NULL,
	"token" varchar(64) NOT NULL,
	"subject" varchar(256) NOT NULL,
	"amount" integer,
	"pay_method" "payment_method",
	"biz_type" varchar(64) NOT NULL,
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expired_at" timestamp with time zone,
	"status" "payment_link_status" DEFAULT 'active' NOT NULL,
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_links_link_no_unique" UNIQUE("link_no"),
	CONSTRAINT "payment_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "payment_method_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"method" "payment_method" NOT NULL,
	"channel" "payment_channel" NOT NULL,
	"label" varchar(64) NOT NULL,
	"icon" varchar(128),
	"enabled" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_method_configs_method_unique" UNIQUE("method")
);
--> statement-breakpoint
CREATE TABLE "payment_notify_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel" "payment_channel" NOT NULL,
	"scene" varchar(16) DEFAULT 'payment' NOT NULL,
	"order_no" varchar(64),
	"raw_body" text,
	"headers" text,
	"signature_valid" boolean DEFAULT false NOT NULL,
	"result" varchar(32),
	"message" varchar(512),
	"ip" varchar(64),
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_no" varchar(64) NOT NULL,
	"out_trade_no" varchar(64) NOT NULL,
	"channel_trade_no" varchar(128),
	"biz_type" varchar(64) NOT NULL,
	"biz_id" varchar(128) NOT NULL,
	"subject" varchar(256) NOT NULL,
	"body" varchar(512),
	"amount" integer NOT NULL,
	"currency" varchar(8) DEFAULT 'CNY' NOT NULL,
	"channel" "payment_channel" NOT NULL,
	"channel_config_id" integer,
	"pay_method" "payment_method" NOT NULL,
	"status" "payment_order_status" DEFAULT 'pending' NOT NULL,
	"user_id" integer,
	"open_id" varchar(128),
	"client_ip" varchar(64),
	"department_id" integer,
	"paid_amount" integer,
	"fee_amount" integer,
	"net_amount" integer,
	"paid_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"notify_data" text,
	"error_message" varchar(512),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_orders_order_no_unique" UNIQUE("order_no"),
	CONSTRAINT "payment_orders_channel_out_trade_no_uq" UNIQUE("channel","out_trade_no")
);
--> statement-breakpoint
CREATE TABLE "payment_recon_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_no" varchar(64) NOT NULL,
	"channel" "payment_channel" NOT NULL,
	"bill_date" varchar(10) NOT NULL,
	"status" "payment_recon_status" DEFAULT 'pending' NOT NULL,
	"local_count" integer DEFAULT 0 NOT NULL,
	"local_amount" integer DEFAULT 0 NOT NULL,
	"channel_count" integer DEFAULT 0 NOT NULL,
	"channel_amount" integer DEFAULT 0 NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"diff_count" integer DEFAULT 0 NOT NULL,
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_recon_batches_batch_no_unique" UNIQUE("batch_no")
);
--> statement-breakpoint
CREATE TABLE "payment_recon_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"order_no" varchar(64),
	"channel_trade_no" varchar(128),
	"local_amount" integer,
	"channel_amount" integer,
	"local_status" varchar(32),
	"channel_status" varchar(32),
	"result" "payment_recon_result" NOT NULL,
	"remark" varchar(256),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_refunds" (
	"id" serial PRIMARY KEY NOT NULL,
	"refund_no" varchar(64) NOT NULL,
	"out_refund_no" varchar(64) NOT NULL,
	"order_no" varchar(64) NOT NULL,
	"order_id" integer,
	"channel_refund_no" varchar(128),
	"channel" "payment_channel" NOT NULL,
	"refund_amount" integer NOT NULL,
	"total_amount" integer NOT NULL,
	"reason" varchar(256),
	"status" "payment_refund_status" DEFAULT 'pending' NOT NULL,
	"approval_status" "payment_refund_approval_status" DEFAULT 'none' NOT NULL,
	"applied_by_id" integer,
	"approver_id" integer,
	"approved_at" timestamp with time zone,
	"approval_remark" varchar(256),
	"operator_id" integer,
	"refunded_at" timestamp with time zone,
	"notify_data" text,
	"error_message" varchar(512),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_refunds_refund_no_unique" UNIQUE("refund_no")
);
--> statement-breakpoint
CREATE TABLE "payment_risk_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"scope" "payment_risk_scope" DEFAULT 'global' NOT NULL,
	"channel" "payment_channel",
	"biz_type" varchar(64),
	"single_limit" integer,
	"daily_limit" integer,
	"daily_count_limit" integer,
	"blocklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_settlement_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_no" varchar(64) NOT NULL,
	"channel" "payment_channel" NOT NULL,
	"period_start" varchar(10) NOT NULL,
	"period_end" varchar(10) NOT NULL,
	"status" "payment_settlement_status" DEFAULT 'pending' NOT NULL,
	"order_count" integer DEFAULT 0 NOT NULL,
	"gross_amount" integer DEFAULT 0 NOT NULL,
	"fee_amount" integer DEFAULT 0 NOT NULL,
	"refund_amount" integer DEFAULT 0 NOT NULL,
	"net_amount" integer DEFAULT 0 NOT NULL,
	"settled_at" timestamp with time zone,
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_settlement_batches_batch_no_unique" UNIQUE("batch_no")
);
--> statement-breakpoint
CREATE TABLE "payment_sharing_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"sharing_no" varchar(64) NOT NULL,
	"order_no" varchar(64) NOT NULL,
	"receiver_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"status" "payment_sharing_order_status" DEFAULT 'pending' NOT NULL,
	"channel_sharing_no" varchar(128),
	"finished_at" timestamp with time zone,
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_sharing_orders_sharing_no_unique" UNIQUE("sharing_no")
);
--> statement-breakpoint
CREATE TABLE "payment_sharing_receivers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"receiver_type" "payment_sharing_receiver_type" DEFAULT 'merchant' NOT NULL,
	"account" varchar(128) NOT NULL,
	"ratio_bps" integer,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"endpoint_id" integer NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"order_no" varchar(64),
	"payload" text NOT NULL,
	"status" "payment_webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"http_status" integer,
	"response_body" varchar(1024),
	"last_error" varchar(512),
	"next_retry_at" timestamp with time zone,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_endpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"url" varchar(512) NOT NULL,
	"secret_encrypted" text,
	"biz_type" varchar(64),
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tenant_id" integer,
	"title" varchar(200) DEFAULT '新对话' NOT NULL,
	"provider_snapshot" jsonb,
	"is_archived" boolean DEFAULT false NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"system_prompt_override" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" "ai_message_role" NOT NULL,
	"content" text NOT NULL,
	"model" varchar(100),
	"tokens_input" integer DEFAULT 0 NOT NULL,
	"tokens_output" integer DEFAULT 0 NOT NULL,
	"feedback" integer,
	"feedback_reason" varchar(200),
	"feedback_status" "ai_feedback_status",
	"feedback_remark" varchar(500),
	"feedback_handled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_prompt_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"content" text NOT NULL,
	"description" varchar(300),
	"category" varchar(50),
	"scope" "ai_prompt_scope" DEFAULT 'system' NOT NULL,
	"user_id" integer,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_provider_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"provider" "ai_provider" DEFAULT 'openai_compatible' NOT NULL,
	"base_url" varchar(500) NOT NULL,
	"api_key" varchar(1000) NOT NULL,
	"model" varchar(100) NOT NULL,
	"system_prompt" text,
	"max_tokens" integer DEFAULT 4096 NOT NULL,
	"temperature" varchar(10) DEFAULT '0.7' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_ai_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(100),
	"provider" "ai_provider" DEFAULT 'openai_compatible' NOT NULL,
	"base_url" varchar(500),
	"api_key" varchar(1000),
	"model" varchar(100),
	"temperature" varchar(10),
	"max_tokens" integer,
	"system_prompt" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_scopes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"scope_group" varchar(64) DEFAULT 'general' NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_scopes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "app_webhook_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_id" integer NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"event_id" varchar(64) NOT NULL,
	"payload" jsonb,
	"attempt" integer DEFAULT 0 NOT NULL,
	"status" "app_webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"request_url" varchar(512),
	"response_status" integer,
	"response_body" text,
	"error_message" text,
	"duration_ms" integer,
	"next_retry_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_webhook_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"url" varchar(512) NOT NULL,
	"secret_encrypted" text,
	"sign_mode" "app_webhook_sign_mode" DEFAULT 'hmacSha256' NOT NULL,
	"events" text[] DEFAULT '{}' NOT NULL,
	"headers" jsonb,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"last_delivery_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth2_authorization_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(128) NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"user_id" integer NOT NULL,
	"redirect_uri" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"code_challenge" varchar(256),
	"code_challenge_method" varchar(10),
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth2_authorization_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "oauth2_clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"client_secret_hash" varchar(128),
	"client_secret_encrypted" text,
	"client_secret_prefix" varchar(20),
	"name" varchar(100) NOT NULL,
	"description" text,
	"logo_url" varchar(500),
	"redirect_uris" text[] DEFAULT '{}' NOT NULL,
	"allowed_scopes" text[] DEFAULT '{}' NOT NULL,
	"grant_types" text[] DEFAULT '{}' NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"rate_plan_id" integer,
	"sign_enabled" boolean DEFAULT false NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"owner_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth2_clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "oauth2_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_type" varchar(20) NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"token_prefix" varchar(20),
	"client_id" varchar(64) NOT NULL,
	"user_id" integer,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"expires_at" timestamp,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth2_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "oauth2_user_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth2_user_grants_user_client_unique" UNIQUE("user_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "open_api_call_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"app_name" varchar(100),
	"method" varchar(10) NOT NULL,
	"path" varchar(256) NOT NULL,
	"status_code" integer NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"ip" varchar(64),
	"user_agent" varchar(256),
	"scope" varchar(128),
	"error_message" varchar(512),
	"request_id" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"qps_limit" integer DEFAULT 10 NOT NULL,
	"daily_quota" integer DEFAULT 0 NOT NULL,
	"monthly_quota" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rate_plans_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ssh_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"host" varchar(255) NOT NULL,
	"port" integer DEFAULT 22 NOT NULL,
	"username" varchar(128) NOT NULL,
	"auth_type" "ssh_auth_type" DEFAULT 'password' NOT NULL,
	"password_encrypted" text,
	"key_path" text,
	"key_content_encrypted" text,
	"key_passphrase_encrypted" text,
	"env_vars" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"group_name" varchar(128),
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"order_num" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terminal_recordings" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(256) DEFAULT '' NOT NULL,
	"user_id" integer NOT NULL,
	"tenant_id" integer,
	"shell" varchar(64),
	"cols" integer DEFAULT 80 NOT NULL,
	"rows" integer DEFAULT 24 NOT NULL,
	"duration" real DEFAULT 0 NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkin_milestones" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(64) NOT NULL,
	"cumulative_days" integer NOT NULL,
	"reward_type" "checkin_milestone_reward_type" DEFAULT 'points' NOT NULL,
	"reward_points" integer DEFAULT 0 NOT NULL,
	"coupon_id" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"remark" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "checkin_milestones_cumulative_days_unique" UNIQUE("cumulative_days")
);
--> statement-breakpoint
CREATE TABLE "checkin_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"day_number" integer NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"experience" integer DEFAULT 0 NOT NULL,
	"remark" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "checkin_rules_day_number_unique" UNIQUE("day_number")
);
--> statement-breakpoint
CREATE TABLE "checkin_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"makeup_enabled" boolean DEFAULT true NOT NULL,
	"makeup_cost_points" integer DEFAULT 20 NOT NULL,
	"makeup_max_days" integer DEFAULT 7 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"type" "coupon_type" NOT NULL,
	"face_value" integer NOT NULL,
	"threshold" integer DEFAULT 0 NOT NULL,
	"max_discount" integer,
	"total_quantity" integer DEFAULT 0 NOT NULL,
	"issued_quantity" integer DEFAULT 0 NOT NULL,
	"per_limit" integer DEFAULT 1 NOT NULL,
	"valid_type" "coupon_valid_type" DEFAULT 'fixed' NOT NULL,
	"valid_start" timestamp with time zone,
	"valid_end" timestamp with time zone,
	"valid_days" integer,
	"status" "coupon_template_status" DEFAULT 'draft' NOT NULL,
	"description" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_checkin_milestone_awards" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"milestone_id" integer NOT NULL,
	"cumulative_days" integer NOT NULL,
	"reward_type" "checkin_milestone_reward_type" NOT NULL,
	"reward_points" integer DEFAULT 0 NOT NULL,
	"coupon_id" integer,
	"member_coupon_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_checkin_milestone_awards_member_id_milestone_id_unique" UNIQUE("member_id","milestone_id")
);
--> statement-breakpoint
CREATE TABLE "member_checkins" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"checkin_date" date NOT NULL,
	"consecutive_days" integer DEFAULT 1 NOT NULL,
	"points_awarded" integer DEFAULT 0 NOT NULL,
	"experience_awarded" integer DEFAULT 0 NOT NULL,
	"is_makeup" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_checkins_member_id_checkin_date_unique" UNIQUE("member_id","checkin_date")
);
--> statement-breakpoint
CREATE TABLE "member_coupons" (
	"id" serial PRIMARY KEY NOT NULL,
	"coupon_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"code" varchar(32) NOT NULL,
	"status" "member_coupon_status" DEFAULT 'unused' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	"expire_at" timestamp with time zone,
	"biz_type" varchar(64),
	"biz_id" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_coupons_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "member_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(32) NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"growth_threshold" integer DEFAULT 0 NOT NULL,
	"discount" integer DEFAULT 100 NOT NULL,
	"icon" varchar(256),
	"benefits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" varchar(256),
	"sort" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_levels_level_unique" UNIQUE("level")
);
--> statement-breakpoint
CREATE TABLE "member_login_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer,
	"ip" varchar(64),
	"location" varchar(128),
	"browser" varchar(64),
	"os" varchar(64),
	"user_agent" varchar(512),
	"status" "login_status" NOT NULL,
	"message" varchar(256),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_point_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"frozen" integer DEFAULT 0 NOT NULL,
	"total_earned" integer DEFAULT 0 NOT NULL,
	"total_spent" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_point_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"type" "point_tx_type" NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"biz_type" varchar(64),
	"biz_id" varchar(128),
	"remark" varchar(256),
	"operator_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_wallet_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"type" "wallet_tx_type" NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"biz_type" varchar(64),
	"biz_id" varchar(128),
	"payment_order_id" integer,
	"remark" varchar(256),
	"operator_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"frozen" integer DEFAULT 0 NOT NULL,
	"total_recharge" integer DEFAULT 0 NOT NULL,
	"total_consume" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(32),
	"phone" varchar(20),
	"email" varchar(128),
	"password" varchar(128),
	"nickname" varchar(32) NOT NULL,
	"avatar" varchar(256),
	"gender" varchar(20),
	"birthday" varchar(20),
	"status" "member_status" DEFAULT 'active' NOT NULL,
	"level_id" integer,
	"growth_value" integer DEFAULT 0 NOT NULL,
	"experience" integer DEFAULT 0 NOT NULL,
	"register_source" varchar(32) DEFAULT 'web' NOT NULL,
	"register_ip" varchar(64),
	"last_login_at" timestamp with time zone,
	"last_login_ip" varchar(64),
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitor_alert_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"rule_id" integer,
	"rule_name" varchar(128) NOT NULL,
	"metric" "monitor_metric" NOT NULL,
	"level" "monitor_alert_level" DEFAULT 'warning' NOT NULL,
	"operator" "monitor_alert_operator" NOT NULL,
	"threshold" real NOT NULL,
	"value" real NOT NULL,
	"status" "monitor_alert_event_status" DEFAULT 'firing' NOT NULL,
	"message" text NOT NULL,
	"notified" boolean DEFAULT false NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "monitor_alert_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"name" varchar(128) NOT NULL,
	"metric" "monitor_metric" NOT NULL,
	"operator" "monitor_alert_operator" DEFAULT 'gt' NOT NULL,
	"threshold" real NOT NULL,
	"duration_minutes" integer DEFAULT 0 NOT NULL,
	"level" "monitor_alert_level" DEFAULT 'warning' NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"webhook_url" varchar(512),
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"silence_minutes" integer DEFAULT 30 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"state" "monitor_alert_state" DEFAULT 'ok' NOT NULL,
	"breaching_since" timestamp with time zone,
	"last_triggered_at" timestamp with time zone,
	"last_value" real,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ssl_certificates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"domain" varchar(256) NOT NULL,
	"type" "ssl_cert_type" DEFAULT 'self_signed' NOT NULL,
	"cert_path" varchar(512),
	"key_path" varchar(512),
	"cert_content" text,
	"key_content" text,
	"issuer" varchar(256),
	"subject" varchar(256),
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"fingerprint" varchar(128),
	"serial_number" varchar(128),
	"status" "ssl_cert_status" DEFAULT 'valid' NOT NULL,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_metric_samples" (
	"id" serial PRIMARY KEY NOT NULL,
	"sampled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cpu" real DEFAULT 0 NOT NULL,
	"memory" real DEFAULT 0 NOT NULL,
	"disk" real DEFAULT 0 NOT NULL,
	"swap" real DEFAULT 0 NOT NULL,
	"load1" real DEFAULT 0 NOT NULL,
	"proc_cpu" real DEFAULT 0 NOT NULL,
	"heap" real DEFAULT 0 NOT NULL,
	"loop_lag" real DEFAULT 0 NOT NULL,
	"qps" real DEFAULT 0 NOT NULL,
	"error_rate" real DEFAULT 0 NOT NULL,
	"net_rx_bps" real DEFAULT 0 NOT NULL,
	"net_tx_bps" real DEFAULT 0 NOT NULL,
	"disk_read_bps" real DEFAULT 0 NOT NULL,
	"disk_write_bps" real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"account" varchar(100),
	"app_id" varchar(64) NOT NULL,
	"app_secret" varchar(128) DEFAULT '' NOT NULL,
	"token" varchar(64) DEFAULT '' NOT NULL,
	"encoding_aes_key" varchar(64),
	"encrypt_mode" "mp_encrypt_mode" DEFAULT 'plaintext' NOT NULL,
	"type" "mp_account_type" DEFAULT 'service' NOT NULL,
	"qr_code_url" varchar(500),
	"is_default" boolean DEFAULT false NOT NULL,
	"auto_create_member" boolean DEFAULT false NOT NULL,
	"content_check_enabled" boolean DEFAULT false NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" text,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mp_accounts_app_id_unique" UNIQUE("app_id")
);
--> statement-breakpoint
CREATE TABLE "mp_auto_replies" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"reply_type" "mp_auto_reply_type" NOT NULL,
	"keyword" varchar(64),
	"match_type" "mp_auto_reply_match" DEFAULT 'contain' NOT NULL,
	"content_type" "mp_reply_content_type" DEFAULT 'text' NOT NULL,
	"content" text,
	"media_id" varchar(128),
	"news_articles" jsonb,
	"transfer_to_kf" boolean DEFAULT false NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_broadcasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"msg_type" "mp_broadcast_type" DEFAULT 'text' NOT NULL,
	"target" "mp_broadcast_target" DEFAULT 'all' NOT NULL,
	"tag_id" integer,
	"content" text,
	"media_id" varchar(128),
	"status" "mp_broadcast_status" DEFAULT 'draft' NOT NULL,
	"wechat_msg_id" varchar(64),
	"scheduled_at" timestamp,
	"error_msg" text,
	"sent_at" timestamp,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_conditional_menus" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"name" varchar(64) NOT NULL,
	"buttons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"match_rule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"menu_id" varchar(64),
	"status" "mp_menu_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"articles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"wechat_media_id" varchar(128),
	"status" "mp_draft_status" DEFAULT 'draft' NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_fans" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"openid" varchar(64) NOT NULL,
	"nickname" varchar(128),
	"avatar" varchar(512),
	"sex" smallint DEFAULT 0 NOT NULL,
	"country" varchar(64),
	"province" varchar(64),
	"city" varchar(64),
	"language" varchar(16),
	"subscribe" "mp_fan_subscribe" DEFAULT 'subscribed' NOT NULL,
	"subscribe_time" timestamp with time zone,
	"remark" varchar(128),
	"tag_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unionid" varchar(64),
	"member_id" integer,
	"blacklisted" boolean DEFAULT false NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_kf_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"kf_account" varchar(64) NOT NULL,
	"nickname" varchar(64) NOT NULL,
	"avatar" varchar(512),
	"kf_id" varchar(64),
	"invite_status" varchar(32) DEFAULT 'none' NOT NULL,
	"invite_wx" varchar(64),
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"rating" integer,
	"rating_remark" varchar(255),
	"remark" varchar(255),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_materials" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"type" "mp_material_type" DEFAULT 'image' NOT NULL,
	"name" varchar(200) NOT NULL,
	"wechat_media_id" varchar(128),
	"url" varchar(1000),
	"file_size" integer,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_menus" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"buttons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "mp_menu_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mp_menus_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "mp_message_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"template_id" varchar(128) NOT NULL,
	"title" varchar(200) NOT NULL,
	"content" text,
	"example" text,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"openid" varchar(64) NOT NULL,
	"direction" "mp_message_direction" NOT NULL,
	"msg_type" "mp_message_type" DEFAULT 'text' NOT NULL,
	"content" text,
	"media_id" varchar(128),
	"media_url" varchar(1000),
	"event" varchar(32),
	"msg_id" varchar(64),
	"status" "mp_message_status" DEFAULT 'received' NOT NULL,
	"error_msg" text,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_qrcodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"type" "mp_qrcode_type" DEFAULT 'permanent' NOT NULL,
	"scene_str" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"ticket" varchar(256),
	"url" varchar(512),
	"expire_seconds" integer,
	"scan_count" integer DEFAULT 0 NOT NULL,
	"reward_points" integer DEFAULT 0 NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"wechat_tag_id" integer,
	"name" varchar(30) NOT NULL,
	"fans_count" integer DEFAULT 0 NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_template_send_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"template_id" varchar(128) NOT NULL,
	"openid" varchar(64) NOT NULL,
	"data" jsonb,
	"url" varchar(1000),
	"status" "mp_template_send_status" DEFAULT 'success' NOT NULL,
	"error_msg" text,
	"msg_id" varchar(64),
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_unmatched_keywords" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"keyword" varchar(128) NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"last_at" timestamp DEFAULT now() NOT NULL,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_alert_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"dataset_id" integer NOT NULL,
	"field" varchar(128),
	"aggregate" varchar(16) DEFAULT 'sum' NOT NULL,
	"op" varchar(8) DEFAULT 'gt' NOT NULL,
	"threshold" real DEFAULT 0 NOT NULL,
	"cron" varchar(64),
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recipients" varchar(512),
	"enabled" boolean DEFAULT true NOT NULL,
	"last_checked_at" timestamp,
	"last_triggered" boolean,
	"last_value" real,
	"remark" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_dashboard_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"remark" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "report_dashboard_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "report_dashboard_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"dashboard_id" integer NOT NULL,
	"widget_id" varchar(64),
	"content" varchar(1000) NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_dashboard_favorites" (
	"user_id" integer NOT NULL,
	"dashboard_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "report_dashboard_favorites_user_id_dashboard_id_pk" PRIMARY KEY("user_id","dashboard_id")
);
--> statement-breakpoint
CREATE TABLE "report_dashboard_shares" (
	"id" serial PRIMARY KEY NOT NULL,
	"dashboard_id" integer NOT NULL,
	"token" varchar(64) NOT NULL,
	"password_hash" varchar(100),
	"enabled" boolean DEFAULT true NOT NULL,
	"expire_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "report_dashboard_shares_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "report_dashboard_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"dashboard_id" integer NOT NULL,
	"cron" varchar(64) NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recipients" varchar(512),
	"enabled" boolean DEFAULT true NOT NULL,
	"remark" varchar(256),
	"last_run_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_dashboard_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"dashboard_id" integer NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"remark" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_dashboards" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"layout" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"canvas_layout" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"widgets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"filters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"category_id" integer,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "report_dashboards_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "report_datasets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"datasource_id" integer NOT NULL,
	"type" "report_datasource_type" NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"computed_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cache_ttl" integer DEFAULT 0 NOT NULL,
	"materialize" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "report_datasets_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "report_datasources" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"type" "report_datasource_type" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "report_datasources_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "report_print_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"dataset_id" integer,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"page_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "report_print_templates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_leader_id_users_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_dept_scopes" ADD CONSTRAINT "role_dept_scopes_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_dept_scopes" ADD CONSTRAINT "role_dept_scopes_dept_id_departments_id_fk" FOREIGN KEY ("dept_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_menus" ADD CONSTRAINT "role_menus_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_menus" ADD CONSTRAINT "role_menus_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_package_menus" ADD CONSTRAINT "tenant_package_menus_package_id_tenant_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."tenant_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_package_menus" ADD CONSTRAINT "tenant_package_menus_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_packages" ADD CONSTRAINT "tenant_packages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_packages" ADD CONSTRAINT "tenant_packages_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_package_id_tenant_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."tenant_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_dept_scopes" ADD CONSTRAINT "user_dept_scopes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_dept_scopes" ADD CONSTRAINT "user_dept_scopes_dept_id_departments_id_fk" FOREIGN KEY ("dept_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_members" ADD CONSTRAINT "user_group_members_group_id_user_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_members" ADD CONSTRAINT "user_group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_menus" ADD CONSTRAINT "user_menus_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_menus" ADD CONSTRAINT "user_menus_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_positions" ADD CONSTRAINT "user_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_positions" ADD CONSTRAINT "user_positions_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_files" ADD CONSTRAINT "business_files_file_id_managed_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."managed_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_files" ADD CONSTRAINT "business_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD CONSTRAINT "file_storage_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_storage_configs" ADD CONSTRAINT "file_storage_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_files" ADD CONSTRAINT "managed_files_storage_config_id_file_storage_configs_id_fk" FOREIGN KEY ("storage_config_id") REFERENCES "public"."file_storage_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_files" ADD CONSTRAINT "managed_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_files" ADD CONSTRAINT "managed_files_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_files" ADD CONSTRAINT "managed_files_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_chunks" ADD CONSTRAINT "upload_chunks_upload_session_id_upload_sessions_id_fk" FOREIGN KEY ("upload_session_id") REFERENCES "public"."upload_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_storage_config_id_file_storage_configs_id_fk" FOREIGN KEY ("storage_config_id") REFERENCES "public"."file_storage_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_mask_configs" ADD CONSTRAINT "data_mask_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_mask_configs" ADD CONSTRAINT "data_mask_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "async_task_items" ADD CONSTRAINT "async_task_items_task_id_async_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."async_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "async_tasks" ADD CONSTRAINT "async_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "async_tasks" ADD CONSTRAINT "async_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "async_tasks" ADD CONSTRAINT "async_tasks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_job_downloads" ADD CONSTRAINT "export_job_downloads_job_id_export_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."export_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_job_downloads" ADD CONSTRAINT "export_job_downloads_downloaded_by_users_id_fk" FOREIGN KEY ("downloaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_job_downloads" ADD CONSTRAINT "export_job_downloads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_file_id_managed_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."managed_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_job_logs" ADD CONSTRAINT "cron_job_logs_job_id_cron_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."cron_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD CONSTRAINT "cron_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD CONSTRAINT "cron_jobs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_configs" ADD CONSTRAINT "system_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_configs" ADD CONSTRAINT "system_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_configs" ADD CONSTRAINT "system_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_scheduler_runs" ADD CONSTRAINT "system_scheduler_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_scheduler_runs" ADD CONSTRAINT "system_scheduler_runs_alert_ack_by_users_id_fk" FOREIGN KEY ("alert_ack_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_risk_events" ADD CONSTRAINT "login_risk_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_risk_events" ADD CONSTRAINT "login_risk_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_configs" ADD CONSTRAINT "oauth_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_configs" ADD CONSTRAINT "oauth_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_limit_rules" ADD CONSTRAINT "rate_limit_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_limit_rules" ADD CONSTRAINT "rate_limit_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_api_tokens" ADD CONSTRAINT "user_api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_api_tokens" ADD CONSTRAINT "user_api_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_api_tokens" ADD CONSTRAINT "user_api_tokens_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_mfa_factors" ADD CONSTRAINT "user_mfa_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_oauth_accounts" ADD CONSTRAINT "user_oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_trusted_devices" ADD CONSTRAINT "user_trusted_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_provider_sync_logs" ADD CONSTRAINT "identity_provider_sync_logs_provider_id_tenant_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."tenant_identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_identity_providers" ADD CONSTRAINT "tenant_identity_providers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_identity_providers" ADD CONSTRAINT "tenant_identity_providers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_identity_providers" ADD CONSTRAINT "tenant_identity_providers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identity_accounts" ADD CONSTRAINT "user_identity_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identity_accounts" ADD CONSTRAINT "user_identity_accounts_provider_id_tenant_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."tenant_identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dict_items" ADD CONSTRAINT "dict_items_dict_id_dicts_id_fk" FOREIGN KEY ("dict_id") REFERENCES "public"."dicts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dict_items" ADD CONSTRAINT "dict_items_parent_id_dict_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."dict_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dict_items" ADD CONSTRAINT "dict_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dict_items" ADD CONSTRAINT "dict_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dicts" ADD CONSTRAINT "dicts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dicts" ADD CONSTRAINT "dicts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dicts" ADD CONSTRAINT "dicts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_logs" ADD CONSTRAINT "login_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_event_meta" ADD CONSTRAINT "analytics_event_meta_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_event_meta" ADD CONSTRAINT "analytics_event_meta_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_sessions" ADD CONSTRAINT "analytics_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_settings" ADD CONSTRAINT "analytics_settings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_settings" ADD CONSTRAINT "analytics_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_alert_rules" ADD CONSTRAINT "error_alert_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_alert_rules" ADD CONSTRAINT "error_alert_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_alert_rules" ADD CONSTRAINT "error_alert_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_group_id_error_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."error_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_groups" ADD CONSTRAINT "error_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_groups" ADD CONSTRAINT "error_groups_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_groups" ADD CONSTRAINT "error_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_groups" ADD CONSTRAINT "error_groups_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_maps" ADD CONSTRAINT "source_maps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_maps" ADD CONSTRAINT "source_maps_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_maps" ADD CONSTRAINT "source_maps_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_events" ADD CONSTRAINT "user_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_automations" ADD CONSTRAINT "workflow_automations_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_automations" ADD CONSTRAINT "workflow_automations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_automations" ADD CONSTRAINT "workflow_automations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_automations" ADD CONSTRAINT "workflow_automations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_categories" ADD CONSTRAINT "workflow_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_categories" ADD CONSTRAINT "workflow_categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_categories" ADD CONSTRAINT "workflow_categories_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_comments" ADD CONSTRAINT "workflow_comments_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_comments" ADD CONSTRAINT "workflow_comments_task_id_workflow_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."workflow_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_comments" ADD CONSTRAINT "workflow_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_comments" ADD CONSTRAINT "workflow_comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_compensation_logs" ADD CONSTRAINT "workflow_compensation_logs_compensation_id_workflow_compensations_id_fk" FOREIGN KEY ("compensation_id") REFERENCES "public"."workflow_compensations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_compensation_logs" ADD CONSTRAINT "workflow_compensation_logs_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_compensation_logs" ADD CONSTRAINT "workflow_compensation_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_compensations" ADD CONSTRAINT "workflow_compensations_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_compensations" ADD CONSTRAINT "workflow_compensations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_connector_invocations" ADD CONSTRAINT "workflow_connector_invocations_connector_id_workflow_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."workflow_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_connectors" ADD CONSTRAINT "workflow_connectors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_connectors" ADD CONSTRAINT "workflow_connectors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_connectors" ADD CONSTRAINT "workflow_connectors_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_data_sources" ADD CONSTRAINT "workflow_data_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_data_sources" ADD CONSTRAINT "workflow_data_sources_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definition_versions" ADD CONSTRAINT "workflow_definition_versions_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definition_versions" ADD CONSTRAINT "workflow_definition_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definition_versions" ADD CONSTRAINT "workflow_definition_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_category_id_workflow_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."workflow_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_form_id_workflow_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."workflow_forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_delegations" ADD CONSTRAINT "workflow_delegations_principal_id_users_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_delegations" ADD CONSTRAINT "workflow_delegations_delegate_id_users_id_fk" FOREIGN KEY ("delegate_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_delegations" ADD CONSTRAINT "workflow_delegations_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_delegations" ADD CONSTRAINT "workflow_delegations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_delegations" ADD CONSTRAINT "workflow_delegations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_delegations" ADD CONSTRAINT "workflow_delegations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event_subscriptions" ADD CONSTRAINT "workflow_event_subscriptions_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event_subscriptions" ADD CONSTRAINT "workflow_event_subscriptions_connector_id_workflow_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."workflow_connectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event_subscriptions" ADD CONSTRAINT "workflow_event_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event_subscriptions" ADD CONSTRAINT "workflow_event_subscriptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event_subscriptions" ADD CONSTRAINT "workflow_event_subscriptions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_forms" ADD CONSTRAINT "workflow_forms_category_id_workflow_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."workflow_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_forms" ADD CONSTRAINT "workflow_forms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_forms" ADD CONSTRAINT "workflow_forms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_forms" ADD CONSTRAINT "workflow_forms_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instance_migrations" ADD CONSTRAINT "workflow_instance_migrations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instance_migrations" ADD CONSTRAINT "workflow_instance_migrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_initiator_id_users_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_job_executions" ADD CONSTRAINT "workflow_job_executions_job_id_workflow_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."workflow_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_job_executions" ADD CONSTRAINT "workflow_job_executions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD CONSTRAINT "workflow_jobs_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD CONSTRAINT "workflow_jobs_task_id_workflow_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."workflow_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD CONSTRAINT "workflow_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD CONSTRAINT "workflow_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD CONSTRAINT "workflow_jobs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_quick_phrases" ADD CONSTRAINT "workflow_quick_phrases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_quick_phrases" ADD CONSTRAINT "workflow_quick_phrases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_saved_views" ADD CONSTRAINT "workflow_saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_saved_views" ADD CONSTRAINT "workflow_saved_views_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_schedules" ADD CONSTRAINT "workflow_schedules_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_schedules" ADD CONSTRAINT "workflow_schedules_initiator_id_users_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_schedules" ADD CONSTRAINT "workflow_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_schedules" ADD CONSTRAINT "workflow_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_schedules" ADD CONSTRAINT "workflow_schedules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_serial_counters" ADD CONSTRAINT "workflow_serial_counters_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_simulation_cases" ADD CONSTRAINT "workflow_simulation_cases_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_simulation_cases" ADD CONSTRAINT "workflow_simulation_cases_starter_user_id_users_id_fk" FOREIGN KEY ("starter_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_simulation_cases" ADD CONSTRAINT "workflow_simulation_cases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_simulation_cases" ADD CONSTRAINT "workflow_simulation_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_simulation_cases" ADD CONSTRAINT "workflow_simulation_cases_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_task_consults" ADD CONSTRAINT "workflow_task_consults_task_id_workflow_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."workflow_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_task_consults" ADD CONSTRAINT "workflow_task_consults_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_task_consults" ADD CONSTRAINT "workflow_task_consults_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_task_consults" ADD CONSTRAINT "workflow_task_consults_consultee_id_users_id_fk" FOREIGN KEY ("consultee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_task_consults" ADD CONSTRAINT "workflow_task_consults_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_task_urges" ADD CONSTRAINT "workflow_task_urges_task_id_workflow_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."workflow_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_task_urges" ADD CONSTRAINT "workflow_task_urges_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_task_urges" ADD CONSTRAINT "workflow_task_urges_urger_id_users_id_fk" FOREIGN KEY ("urger_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_original_assignee_id_users_id_fk" FOREIGN KEY ("original_assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_delegated_from_id_users_id_fk" FOREIGN KEY ("delegated_from_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tokens" ADD CONSTRAINT "workflow_tokens_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tokens" ADD CONSTRAINT "workflow_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_configs" ADD CONSTRAINT "email_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_configs" ADD CONSTRAINT "email_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_send_logs" ADD CONSTRAINT "email_send_logs_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_send_logs" ADD CONSTRAINT "email_send_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_send_logs" ADD CONSTRAINT "email_send_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_messages" ADD CONSTRAINT "in_app_messages_template_id_in_app_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."in_app_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_messages" ADD CONSTRAINT "in_app_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_messages" ADD CONSTRAINT "in_app_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_messages" ADD CONSTRAINT "in_app_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_templates" ADD CONSTRAINT "in_app_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_templates" ADD CONSTRAINT "in_app_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_templates" ADD CONSTRAINT "in_app_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_configs" ADD CONSTRAINT "sms_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_configs" ADD CONSTRAINT "sms_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_configs" ADD CONSTRAINT "sms_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_send_logs" ADD CONSTRAINT "sms_send_logs_config_id_sms_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."sms_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_send_logs" ADD CONSTRAINT "sms_send_logs_template_id_sms_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."sms_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_send_logs" ADD CONSTRAINT "sms_send_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_send_logs" ADD CONSTRAINT "sms_send_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_templates" ADD CONSTRAINT "sms_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_templates" ADD CONSTRAINT "sms_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_templates" ADD CONSTRAINT "sms_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_admin_query_history" ADD CONSTRAINT "db_admin_query_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_backups" ADD CONSTRAINT "db_backups_file_id_managed_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."managed_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_backups" ADD CONSTRAINT "db_backups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_backups" ADD CONSTRAINT "db_backups_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_query_favorites" ADD CONSTRAINT "db_query_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_executions" ADD CONSTRAINT "rule_decision_executions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_executions" ADD CONSTRAINT "rule_decision_executions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_table_versions" ADD CONSTRAINT "rule_decision_table_versions_table_id_rule_decision_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."rule_decision_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_table_versions" ADD CONSTRAINT "rule_decision_table_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_table_versions" ADD CONSTRAINT "rule_decision_table_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_tables" ADD CONSTRAINT "rule_decision_tables_category_id_workflow_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."workflow_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_tables" ADD CONSTRAINT "rule_decision_tables_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_tables" ADD CONSTRAINT "rule_decision_tables_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_tables" ADD CONSTRAINT "rule_decision_tables_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_test_cases" ADD CONSTRAINT "rule_test_cases_table_id_rule_decision_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."rule_decision_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_test_cases" ADD CONSTRAINT "rule_test_cases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_test_cases" ADD CONSTRAINT "rule_test_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_test_cases" ADD CONSTRAINT "rule_test_cases_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biz_leaves" ADD CONSTRAINT "biz_leaves_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biz_leaves" ADD CONSTRAINT "biz_leaves_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biz_leaves" ADD CONSTRAINT "biz_leaves_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biz_pay_demos" ADD CONSTRAINT "biz_pay_demos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biz_pay_demos" ADD CONSTRAINT "biz_pay_demos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biz_pay_demos" ADD CONSTRAINT "biz_pay_demos_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversation_members" ADD CONSTRAINT "chat_conversation_members_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversation_members" ADD CONSTRAINT "chat_conversation_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_reactions" ADD CONSTRAINT "chat_message_reactions_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_reactions" ADD CONSTRAINT "chat_message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_webhooks" ADD CONSTRAINT "chat_webhooks_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_webhooks" ADD CONSTRAINT "chat_webhooks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_webhooks" ADD CONSTRAINT "chat_webhooks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_webhooks" ADD CONSTRAINT "chat_webhooks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_auto_replies" ADD CONSTRAINT "channel_auto_replies_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_conversations" ADD CONSTRAINT "channel_conversations_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_conversations" ADD CONSTRAINT "channel_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_conversations" ADD CONSTRAINT "channel_conversations_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_conversations" ADD CONSTRAINT "channel_conversations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_conversations" ADD CONSTRAINT "channel_conversations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_menus" ADD CONSTRAINT "channel_menus_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_message_targets" ADD CONSTRAINT "channel_message_targets_message_id_channel_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."channel_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_message_targets" ADD CONSTRAINT "channel_message_targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_message_templates" ADD CONSTRAINT "channel_message_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_message_templates" ADD CONSTRAINT "channel_message_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_quick_replies" ADD CONSTRAINT "channel_quick_replies_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_quick_replies" ADD CONSTRAINT "channel_quick_replies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_quick_replies" ADD CONSTRAINT "channel_quick_replies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_subscriptions" ADD CONSTRAINT "channel_subscriptions_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_subscriptions" ADD CONSTRAINT "channel_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_channel_configs" ADD CONSTRAINT "payment_channel_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_channel_configs" ADD CONSTRAINT "payment_channel_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_channel_configs" ADD CONSTRAINT "payment_channel_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_fee_rules" ADD CONSTRAINT "payment_fee_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_fee_rules" ADD CONSTRAINT "payment_fee_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_fee_rules" ADD CONSTRAINT "payment_fee_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_ledger_entries" ADD CONSTRAINT "payment_ledger_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_method_configs" ADD CONSTRAINT "payment_method_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_method_configs" ADD CONSTRAINT "payment_method_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_method_configs" ADD CONSTRAINT "payment_method_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_notify_logs" ADD CONSTRAINT "payment_notify_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_channel_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("channel_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_batches" ADD CONSTRAINT "payment_recon_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_batches" ADD CONSTRAINT "payment_recon_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_batches" ADD CONSTRAINT "payment_recon_batches_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_items" ADD CONSTRAINT "payment_recon_items_batch_id_payment_recon_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payment_recon_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_order_id_payment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."payment_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_applied_by_id_users_id_fk" FOREIGN KEY ("applied_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_risk_rules" ADD CONSTRAINT "payment_risk_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_risk_rules" ADD CONSTRAINT "payment_risk_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_risk_rules" ADD CONSTRAINT "payment_risk_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlement_batches" ADD CONSTRAINT "payment_settlement_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlement_batches" ADD CONSTRAINT "payment_settlement_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlement_batches" ADD CONSTRAINT "payment_settlement_batches_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sharing_orders" ADD CONSTRAINT "payment_sharing_orders_receiver_id_payment_sharing_receivers_id_fk" FOREIGN KEY ("receiver_id") REFERENCES "public"."payment_sharing_receivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sharing_orders" ADD CONSTRAINT "payment_sharing_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sharing_orders" ADD CONSTRAINT "payment_sharing_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sharing_orders" ADD CONSTRAINT "payment_sharing_orders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sharing_receivers" ADD CONSTRAINT "payment_sharing_receivers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sharing_receivers" ADD CONSTRAINT "payment_sharing_receivers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sharing_receivers" ADD CONSTRAINT "payment_sharing_receivers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook_deliveries" ADD CONSTRAINT "payment_webhook_deliveries_endpoint_id_payment_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."payment_webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook_deliveries" ADD CONSTRAINT "payment_webhook_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook_endpoints" ADD CONSTRAINT "payment_webhook_endpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook_endpoints" ADD CONSTRAINT "payment_webhook_endpoints_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook_endpoints" ADD CONSTRAINT "payment_webhook_endpoints_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompt_templates" ADD CONSTRAINT "ai_prompt_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompt_templates" ADD CONSTRAINT "ai_prompt_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompt_templates" ADD CONSTRAINT "ai_prompt_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_configs" ADD CONSTRAINT "ai_provider_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_configs" ADD CONSTRAINT "ai_provider_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_ai_configs" ADD CONSTRAINT "user_ai_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_scopes" ADD CONSTRAINT "api_scopes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_scopes" ADD CONSTRAINT "api_scopes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_webhook_deliveries" ADD CONSTRAINT "app_webhook_deliveries_subscription_id_app_webhook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."app_webhook_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_webhook_subscriptions" ADD CONSTRAINT "app_webhook_subscriptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_webhook_subscriptions" ADD CONSTRAINT "app_webhook_subscriptions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth2_authorization_codes" ADD CONSTRAINT "oauth2_authorization_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth2_clients" ADD CONSTRAINT "oauth2_clients_rate_plan_id_rate_plans_id_fk" FOREIGN KEY ("rate_plan_id") REFERENCES "public"."rate_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth2_clients" ADD CONSTRAINT "oauth2_clients_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth2_clients" ADD CONSTRAINT "oauth2_clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth2_clients" ADD CONSTRAINT "oauth2_clients_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth2_tokens" ADD CONSTRAINT "oauth2_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth2_user_grants" ADD CONSTRAINT "oauth2_user_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_profiles" ADD CONSTRAINT "ssh_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_recordings" ADD CONSTRAINT "terminal_recordings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_recordings" ADD CONSTRAINT "terminal_recordings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_milestones" ADD CONSTRAINT "checkin_milestones_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_milestones" ADD CONSTRAINT "checkin_milestones_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_milestones" ADD CONSTRAINT "checkin_milestones_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_rules" ADD CONSTRAINT "checkin_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_rules" ADD CONSTRAINT "checkin_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_settings" ADD CONSTRAINT "checkin_settings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_settings" ADD CONSTRAINT "checkin_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_checkin_milestone_awards" ADD CONSTRAINT "member_checkin_milestone_awards_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_checkin_milestone_awards" ADD CONSTRAINT "member_checkin_milestone_awards_milestone_id_checkin_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."checkin_milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_checkins" ADD CONSTRAINT "member_checkins_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_coupons" ADD CONSTRAINT "member_coupons_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_coupons" ADD CONSTRAINT "member_coupons_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_levels" ADD CONSTRAINT "member_levels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_levels" ADD CONSTRAINT "member_levels_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_login_logs" ADD CONSTRAINT "member_login_logs_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_point_accounts" ADD CONSTRAINT "member_point_accounts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_point_transactions" ADD CONSTRAINT "member_point_transactions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_point_transactions" ADD CONSTRAINT "member_point_transactions_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_wallet_transactions" ADD CONSTRAINT "member_wallet_transactions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_wallet_transactions" ADD CONSTRAINT "member_wallet_transactions_payment_order_id_payment_orders_id_fk" FOREIGN KEY ("payment_order_id") REFERENCES "public"."payment_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_wallet_transactions" ADD CONSTRAINT "member_wallet_transactions_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_wallets" ADD CONSTRAINT "member_wallets_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_level_id_member_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."member_levels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_alert_events" ADD CONSTRAINT "monitor_alert_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_alert_events" ADD CONSTRAINT "monitor_alert_events_rule_id_monitor_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."monitor_alert_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_alert_rules" ADD CONSTRAINT "monitor_alert_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_alert_rules" ADD CONSTRAINT "monitor_alert_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_alert_rules" ADD CONSTRAINT "monitor_alert_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssl_certificates" ADD CONSTRAINT "ssl_certificates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssl_certificates" ADD CONSTRAINT "ssl_certificates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_accounts" ADD CONSTRAINT "mp_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_accounts" ADD CONSTRAINT "mp_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_accounts" ADD CONSTRAINT "mp_accounts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_auto_replies" ADD CONSTRAINT "mp_auto_replies_account_id_mp_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_auto_replies" ADD CONSTRAINT "mp_auto_replies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_auto_replies" ADD CONSTRAINT "mp_auto_replies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_auto_replies" ADD CONSTRAINT "mp_auto_replies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_broadcasts" ADD CONSTRAINT "mp_broadcasts_account_id_mp_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_broadcasts" ADD CONSTRAINT "mp_broadcasts_tag_id_mp_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."mp_tags"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_broadcasts" ADD CONSTRAINT "mp_broadcasts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_broadcasts" ADD CONSTRAINT "mp_broadcasts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_broadcasts" ADD CONSTRAINT "mp_broadcasts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_conditional_menus" ADD CONSTRAINT "mp_conditional_menus_account_id_mp_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_conditional_menus" ADD CONSTRAINT "mp_conditional_menus_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_conditional_menus" ADD CONSTRAINT "mp_conditional_menus_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_conditional_menus" ADD CONSTRAINT "mp_conditional_menus_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_drafts" ADD CONSTRAINT "mp_drafts_account_id_mp_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_drafts" ADD CONSTRAINT "mp_drafts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_drafts" ADD CONSTRAINT "mp_drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_drafts" ADD CONSTRAINT "mp_drafts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_fans" ADD CONSTRAINT "mp_fans_account_id_mp_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_fans" ADD CONSTRAINT "mp_fans_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_fans" ADD CONSTRAINT "mp_fans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_fans" ADD CONSTRAINT "mp_fans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_fans" ADD CONSTRAINT "mp_fans_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_kf_accounts" ADD CONSTRAINT "mp_kf_accounts_account_id_mp_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_kf_accounts" ADD CONSTRAINT "mp_kf_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_kf_accounts" ADD CONSTRAINT "mp_kf_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_kf_accounts" ADD CONSTRAINT "mp_kf_accounts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "mp_materials" ADD CONSTRAINT "mp_materials_account_id_mp_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_materials" ADD CONSTRAINT "mp_materials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_materials" ADD CONSTRAINT "mp_materials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_materials" ADD CONSTRAINT "mp_materials_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_menus" ADD CONSTRAINT "mp_menus_account_id_mp_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_menus" ADD CONSTRAINT "mp_menus_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_menus" ADD CONSTRAINT "mp_menus_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_menus" ADD CONSTRAINT "mp_menus_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_message_templates" ADD CONSTRAINT "mp_message_templates_account_id_mp_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_message_templates" ADD CONSTRAINT "mp_message_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_message_templates" ADD CONSTRAINT "mp_message_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_message_templates" ADD CONSTRAINT "mp_message_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_messages" ADD CONSTRAINT "mp_messages_account_id_mp_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_messages" ADD CONSTRAINT "mp_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_qrcodes" ADD CONSTRAINT "mp_qrcodes_account_id_mp_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_qrcodes" ADD CONSTRAINT "mp_qrcodes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_qrcodes" ADD CONSTRAINT "mp_qrcodes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_qrcodes" ADD CONSTRAINT "mp_qrcodes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_tags" ADD CONSTRAINT "mp_tags_account_id_mp_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_tags" ADD CONSTRAINT "mp_tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_tags" ADD CONSTRAINT "mp_tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_tags" ADD CONSTRAINT "mp_tags_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_template_send_logs" ADD CONSTRAINT "mp_template_send_logs_account_id_mp_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_template_send_logs" ADD CONSTRAINT "mp_template_send_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_unmatched_keywords" ADD CONSTRAINT "mp_unmatched_keywords_account_id_mp_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mp_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_unmatched_keywords" ADD CONSTRAINT "mp_unmatched_keywords_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_alert_rules" ADD CONSTRAINT "report_alert_rules_dataset_id_report_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."report_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_alert_rules" ADD CONSTRAINT "report_alert_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_alert_rules" ADD CONSTRAINT "report_alert_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_categories" ADD CONSTRAINT "report_dashboard_categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_categories" ADD CONSTRAINT "report_dashboard_categories_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_comments" ADD CONSTRAINT "report_dashboard_comments_dashboard_id_report_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."report_dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_comments" ADD CONSTRAINT "report_dashboard_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_favorites" ADD CONSTRAINT "report_dashboard_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_favorites" ADD CONSTRAINT "report_dashboard_favorites_dashboard_id_report_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."report_dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_shares" ADD CONSTRAINT "report_dashboard_shares_dashboard_id_report_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."report_dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_shares" ADD CONSTRAINT "report_dashboard_shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_shares" ADD CONSTRAINT "report_dashboard_shares_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_subscriptions" ADD CONSTRAINT "report_dashboard_subscriptions_dashboard_id_report_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."report_dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_subscriptions" ADD CONSTRAINT "report_dashboard_subscriptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_subscriptions" ADD CONSTRAINT "report_dashboard_subscriptions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_versions" ADD CONSTRAINT "report_dashboard_versions_dashboard_id_report_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."report_dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_versions" ADD CONSTRAINT "report_dashboard_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_versions" ADD CONSTRAINT "report_dashboard_versions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboards" ADD CONSTRAINT "report_dashboards_category_id_report_dashboard_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."report_dashboard_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboards" ADD CONSTRAINT "report_dashboards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboards" ADD CONSTRAINT "report_dashboards_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_datasets" ADD CONSTRAINT "report_datasets_datasource_id_report_datasources_id_fk" FOREIGN KEY ("datasource_id") REFERENCES "public"."report_datasources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_datasets" ADD CONSTRAINT "report_datasets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_datasets" ADD CONSTRAINT "report_datasets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_datasources" ADD CONSTRAINT "report_datasources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_datasources" ADD CONSTRAINT "report_datasources_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_print_templates" ADD CONSTRAINT "report_print_templates_dataset_id_report_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."report_datasets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_print_templates" ADD CONSTRAINT "report_print_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_print_templates" ADD CONSTRAINT "report_print_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "async_task_items_task_idx" ON "async_task_items" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "async_task_items_task_status_idx" ON "async_task_items" USING btree ("task_id","status");--> statement-breakpoint
CREATE INDEX "async_tasks_type_idx" ON "async_tasks" USING btree ("task_type");--> statement-breakpoint
CREATE INDEX "async_tasks_status_idx" ON "async_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "async_tasks_created_by_idx" ON "async_tasks" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "async_tasks_created_at_idx" ON "async_tasks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "export_job_downloads_job_idx" ON "export_job_downloads" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "export_job_downloads_downloaded_by_idx" ON "export_job_downloads" USING btree ("downloaded_by");--> statement-breakpoint
CREATE INDEX "export_jobs_entity_idx" ON "export_jobs" USING btree ("entity");--> statement-breakpoint
CREATE INDEX "export_jobs_status_idx" ON "export_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "export_jobs_created_by_idx" ON "export_jobs" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "export_jobs_tenant_idx" ON "export_jobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "export_jobs_expires_at_idx" ON "export_jobs" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "maintenance_logs_started_at_idx" ON "maintenance_logs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "maintenance_logs_ended_at_idx" ON "maintenance_logs" USING btree ("ended_at");--> statement-breakpoint
CREATE INDEX "system_scheduler_nodes_active_idx" ON "system_scheduler_nodes" USING btree ("active");--> statement-breakpoint
CREATE INDEX "system_scheduler_nodes_last_heartbeat_idx" ON "system_scheduler_nodes" USING btree ("last_heartbeat_at");--> statement-breakpoint
CREATE INDEX "system_scheduler_runs_task_idx" ON "system_scheduler_runs" USING btree ("task_name");--> statement-breakpoint
CREATE INDEX "system_scheduler_runs_status_idx" ON "system_scheduler_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "system_scheduler_runs_started_at_idx" ON "system_scheduler_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "system_scheduler_runs_triggered_by_idx" ON "system_scheduler_runs" USING btree ("triggered_by");--> statement-breakpoint
CREATE INDEX "system_scheduler_runs_alert_ack_by_idx" ON "system_scheduler_runs" USING btree ("alert_ack_by");--> statement-breakpoint
CREATE INDEX "login_risk_events_user_idx" ON "login_risk_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "login_risk_events_tenant_idx" ON "login_risk_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "login_risk_events_created_idx" ON "login_risk_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "user_mfa_factors_user_idx" ON "user_mfa_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_mfa_factors_status_idx" ON "user_mfa_factors" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "user_trusted_devices_user_device_uq" ON "user_trusted_devices" USING btree ("user_id","device_id_hash");--> statement-breakpoint
CREATE INDEX "user_trusted_devices_user_idx" ON "user_trusted_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_trusted_devices_trusted_until_idx" ON "user_trusted_devices" USING btree ("trusted_until");--> statement-breakpoint
CREATE INDEX "identity_provider_sync_logs_provider_idx" ON "identity_provider_sync_logs" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "identity_provider_sync_logs_status_idx" ON "identity_provider_sync_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tenant_identity_providers_tenant_idx" ON "tenant_identity_providers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_identity_providers_status_idx" ON "tenant_identity_providers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "user_identity_accounts_user_idx" ON "user_identity_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_identity_accounts_provider_idx" ON "user_identity_accounts" USING btree ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dict_items_dict_id_value_unique" ON "dict_items" USING btree ("dict_id","value");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_rollup_uq" ON "analytics_daily_rollup" USING btree ("tenant_id","stat_date","metric","dim_type","dim_value");--> statement-breakpoint
CREATE INDEX "analytics_rollup_date_idx" ON "analytics_daily_rollup" USING btree ("stat_date");--> statement-breakpoint
CREATE INDEX "analytics_rollup_metric_idx" ON "analytics_daily_rollup" USING btree ("metric");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_event_meta_name_uq" ON "analytics_event_meta" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "analytics_event_meta_status_idx" ON "analytics_event_meta" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_sessions_sid_uq" ON "analytics_sessions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "analytics_sessions_started_idx" ON "analytics_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "analytics_sessions_user_idx" ON "analytics_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "analytics_sessions_tenant_idx" ON "analytics_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "analytics_settings_tenant_idx" ON "analytics_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "error_alert_rules_tenant_idx" ON "error_alert_rules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "error_events_group_idx" ON "error_events" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "error_events_created_idx" ON "error_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "error_events_user_idx" ON "error_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "error_events_tenant_idx" ON "error_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "error_groups_fingerprint_uq" ON "error_groups" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "error_groups_status_idx" ON "error_groups" USING btree ("status");--> statement-breakpoint
CREATE INDEX "error_groups_type_idx" ON "error_groups" USING btree ("error_type");--> statement-breakpoint
CREATE INDEX "error_groups_last_seen_idx" ON "error_groups" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "error_groups_tenant_idx" ON "error_groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "error_groups_assignee_idx" ON "error_groups" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "source_maps_release_idx" ON "source_maps" USING btree ("release","file_name");--> statement-breakpoint
CREATE INDEX "source_maps_tenant_idx" ON "source_maps" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "user_events_created_idx" ON "user_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "user_events_type_idx" ON "user_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "user_events_name_idx" ON "user_events" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "user_events_page_idx" ON "user_events" USING btree ("page_path");--> statement-breakpoint
CREATE INDEX "user_events_user_idx" ON "user_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_events_session_idx" ON "user_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "user_events_tenant_idx" ON "user_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "user_events_distinct_idx" ON "user_events" USING btree ("distinct_id");--> statement-breakpoint
CREATE INDEX "wf_compensation_log_cid_idx" ON "workflow_compensation_logs" USING btree ("compensation_id");--> statement-breakpoint
CREATE INDEX "wf_compensation_instance_idx" ON "workflow_compensations" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "wf_compensation_status_idx" ON "workflow_compensations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "workflow_connector_invocations_conn_idx" ON "workflow_connector_invocations" USING btree ("connector_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_engine_health_snapshots_created_at_idx" ON "workflow_engine_health_snapshots" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "wf_inst_migration_idx" ON "workflow_instance_migrations" USING btree ("instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_instances_biz_key_uniq" ON "workflow_instances" USING btree ("biz_type","biz_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_instances_parent_task_item_key_idx" ON "workflow_instances" USING btree ("parent_task_id","parent_task_item_key");--> statement-breakpoint
CREATE INDEX "workflow_job_executions_job_idx" ON "workflow_job_executions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "workflow_job_executions_type_idx" ON "workflow_job_executions" USING btree ("job_type","status");--> statement-breakpoint
CREATE INDEX "workflow_jobs_due_idx" ON "workflow_jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "workflow_jobs_type_status_idx" ON "workflow_jobs" USING btree ("job_type","status");--> statement-breakpoint
CREATE INDEX "workflow_jobs_trace_idx" ON "workflow_jobs" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "workflow_jobs_instance_idx" ON "workflow_jobs" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "workflow_tokens_instance_status_idx" ON "workflow_tokens" USING btree ("instance_id","status");--> statement-breakpoint
CREATE INDEX "workflow_tokens_parent_idx" ON "workflow_tokens" USING btree ("parent_token_id");--> statement-breakpoint
CREATE INDEX "rule_exec_instance_idx" ON "rule_decision_executions" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "rule_exec_table_idx" ON "rule_decision_executions" USING btree ("table_id");--> statement-breakpoint
CREATE INDEX "payment_events_status_idx" ON "payment_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_fee_rules_channel_idx" ON "payment_fee_rules" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "payment_ledger_order_idx" ON "payment_ledger_entries" USING btree ("order_no");--> statement-breakpoint
CREATE INDEX "payment_ledger_type_idx" ON "payment_ledger_entries" USING btree ("type");--> statement-breakpoint
CREATE INDEX "payment_notify_logs_order_no_idx" ON "payment_notify_logs" USING btree ("order_no");--> statement-breakpoint
CREATE INDEX "payment_orders_biz_idx" ON "payment_orders" USING btree ("biz_type","biz_id");--> statement-breakpoint
CREATE INDEX "payment_orders_status_idx" ON "payment_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_orders_expired_idx" ON "payment_orders" USING btree ("expired_at");--> statement-breakpoint
CREATE INDEX "payment_recon_batches_date_idx" ON "payment_recon_batches" USING btree ("bill_date");--> statement-breakpoint
CREATE INDEX "payment_recon_items_batch_idx" ON "payment_recon_items" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "payment_refunds_order_no_idx" ON "payment_refunds" USING btree ("order_no");--> statement-breakpoint
CREATE INDEX "payment_refunds_status_idx" ON "payment_refunds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_risk_rules_scope_idx" ON "payment_risk_rules" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "payment_settlement_batches_status_idx" ON "payment_settlement_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_sharing_orders_order_no_idx" ON "payment_sharing_orders" USING btree ("order_no");--> statement-breakpoint
CREATE INDEX "payment_sharing_orders_receiver_idx" ON "payment_sharing_orders" USING btree ("receiver_id");--> statement-breakpoint
CREATE INDEX "payment_webhook_deliveries_endpoint_idx" ON "payment_webhook_deliveries" USING btree ("endpoint_id");--> statement-breakpoint
CREATE INDEX "payment_webhook_deliveries_status_idx" ON "payment_webhook_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "app_webhook_deliveries_sub_idx" ON "app_webhook_deliveries" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "app_webhook_deliveries_client_idx" ON "app_webhook_deliveries" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "app_webhook_deliveries_status_idx" ON "app_webhook_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "app_webhook_deliveries_next_retry_idx" ON "app_webhook_deliveries" USING btree ("next_retry_at");--> statement-breakpoint
CREATE INDEX "app_webhook_deliveries_created_idx" ON "app_webhook_deliveries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "app_webhook_subscriptions_client_idx" ON "app_webhook_subscriptions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "open_api_call_logs_client_idx" ON "open_api_call_logs" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "open_api_call_logs_created_idx" ON "open_api_call_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "open_api_call_logs_path_idx" ON "open_api_call_logs" USING btree ("path");--> statement-breakpoint
CREATE INDEX "coupons_status_idx" ON "coupons" USING btree ("status");--> statement-breakpoint
CREATE INDEX "member_coupons_member_idx" ON "member_coupons" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "member_coupons_coupon_idx" ON "member_coupons" USING btree ("coupon_id");--> statement-breakpoint
CREATE INDEX "member_coupons_status_idx" ON "member_coupons" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "member_point_accounts_member_unique" ON "member_point_accounts" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "member_point_tx_member_idx" ON "member_point_transactions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "member_point_tx_biz_idx" ON "member_point_transactions" USING btree ("biz_type","biz_id");--> statement-breakpoint
CREATE INDEX "member_wallet_tx_member_idx" ON "member_wallet_transactions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "member_wallet_tx_biz_idx" ON "member_wallet_transactions" USING btree ("biz_type","biz_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_wallets_member_unique" ON "member_wallets" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_phone_unique" ON "members" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "members_email_unique" ON "members" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "members_username_unique" ON "members" USING btree ("username");--> statement-breakpoint
CREATE INDEX "members_status_idx" ON "members" USING btree ("status");--> statement-breakpoint
CREATE INDEX "monitor_alert_events_rule_idx" ON "monitor_alert_events" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "monitor_alert_events_status_idx" ON "monitor_alert_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "monitor_alert_events_triggered_idx" ON "monitor_alert_events" USING btree ("triggered_at");--> statement-breakpoint
CREATE INDEX "monitor_alert_events_tenant_idx" ON "monitor_alert_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "monitor_alert_rules_tenant_idx" ON "monitor_alert_rules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "monitor_alert_rules_enabled_idx" ON "monitor_alert_rules" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "system_metric_samples_at_idx" ON "system_metric_samples" USING btree ("sampled_at");--> statement-breakpoint
CREATE INDEX "mp_accounts_tenant_idx" ON "mp_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "mp_auto_replies_account_type_idx" ON "mp_auto_replies" USING btree ("account_id","reply_type");--> statement-breakpoint
CREATE INDEX "mp_broadcasts_account_idx" ON "mp_broadcasts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "mp_broadcasts_account_status_idx" ON "mp_broadcasts" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "mp_conditional_menus_account_idx" ON "mp_conditional_menus" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "mp_drafts_account_idx" ON "mp_drafts" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_fans_account_openid_uq" ON "mp_fans" USING btree ("account_id","openid");--> statement-breakpoint
CREATE INDEX "mp_fans_account_idx" ON "mp_fans" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "mp_fans_member_idx" ON "mp_fans" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_kf_accounts_account_kf_uq" ON "mp_kf_accounts" USING btree ("account_id","kf_account");--> statement-breakpoint
CREATE INDEX "mp_kf_accounts_account_idx" ON "mp_kf_accounts" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_kf_routing_configs_account_uq" ON "mp_kf_routing_configs" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "mp_kf_session_events_session_idx" ON "mp_kf_session_events" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_kf_sessions_open_uq" ON "mp_kf_sessions" USING btree ("account_id","openid") WHERE "mp_kf_sessions"."status" <> 'closed';--> statement-breakpoint
CREATE INDEX "mp_kf_sessions_account_status_idx" ON "mp_kf_sessions" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "mp_kf_sessions_kf_idx" ON "mp_kf_sessions" USING btree ("kf_id");--> statement-breakpoint
CREATE INDEX "mp_materials_account_type_idx" ON "mp_materials" USING btree ("account_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_message_templates_account_tpl_uq" ON "mp_message_templates" USING btree ("account_id","template_id");--> statement-breakpoint
CREATE INDEX "mp_messages_account_openid_idx" ON "mp_messages" USING btree ("account_id","openid");--> statement-breakpoint
CREATE INDEX "mp_messages_account_idx" ON "mp_messages" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_messages_account_msgid_uq" ON "mp_messages" USING btree ("account_id","msg_id") WHERE "mp_messages"."msg_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "mp_qrcodes_account_idx" ON "mp_qrcodes" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "mp_qrcodes_account_scene_idx" ON "mp_qrcodes" USING btree ("account_id","scene_str");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_tags_account_name_uq" ON "mp_tags" USING btree ("account_id","name");--> statement-breakpoint
CREATE INDEX "mp_tags_account_idx" ON "mp_tags" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "mp_template_send_logs_account_idx" ON "mp_template_send_logs" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_unmatched_keywords_account_kw_uq" ON "mp_unmatched_keywords" USING btree ("account_id","keyword");--> statement-breakpoint
CREATE INDEX "report_alert_rules_dataset_idx" ON "report_alert_rules" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "report_dashboard_comments_dashboard_idx" ON "report_dashboard_comments" USING btree ("dashboard_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_dashboard_versions_dash_ver_uq" ON "report_dashboard_versions" USING btree ("dashboard_id","version");
--> statement-breakpoint
-- ===== 表/列注释：继承自旧迁移链 0053_table_comments.sql（基线化时从存量库实况提取，已剔除指向废弃列的条目）=====
COMMENT ON TABLE public.announcement_reads IS '公告已读记录表';
COMMENT ON COLUMN public.announcement_reads.id IS '主键 ID';
COMMENT ON COLUMN public.announcement_reads.announcement_id IS '公告 ID';
COMMENT ON COLUMN public.announcement_reads.user_id IS '阅读用户 ID';
COMMENT ON COLUMN public.announcement_reads.read_at IS '阅读时间';
COMMENT ON TABLE public.announcement_recipients IS '公告收件人定向表';
COMMENT ON COLUMN public.announcement_recipients.id IS '主键 ID';
COMMENT ON COLUMN public.announcement_recipients.announcement_id IS '公告 ID';
COMMENT ON COLUMN public.announcement_recipients.recipient_type IS '收件人类型：user/role/dept';
COMMENT ON COLUMN public.announcement_recipients.recipient_id IS '收件人 ID（对应类型表的主键）';
COMMENT ON TABLE public.announcements IS '公告表';
COMMENT ON COLUMN public.announcements.id IS '主键 ID';
COMMENT ON COLUMN public.announcements.title IS '公告标题';
COMMENT ON COLUMN public.announcements.content IS '公告内容（富文本/Markdown）';
COMMENT ON COLUMN public.announcements.type IS '公告类型（notice/活动/系统等）';
COMMENT ON COLUMN public.announcements.publish_status IS '发布状态：draft/published/...';
COMMENT ON COLUMN public.announcements.priority IS '优先级：low/medium/high';
COMMENT ON COLUMN public.announcements.target_type IS '目标范围：all/users/roles/depts';
COMMENT ON COLUMN public.announcements.publish_time IS '发布时间';
COMMENT ON COLUMN public.announcements.create_by_id IS '发布人 ID';
COMMENT ON COLUMN public.announcements.create_by_name IS '发布人姓名';
COMMENT ON COLUMN public.announcements.tenant_id IS '所属租户 ID';
COMMENT ON COLUMN public.announcements.created_by IS '创建人';
COMMENT ON COLUMN public.announcements.updated_by IS '最后更新人';
COMMENT ON COLUMN public.announcements.created_at IS '创建时间';
COMMENT ON COLUMN public.announcements.updated_at IS '更新时间';
COMMENT ON TABLE public.chat_conversation_members IS '聊天会话成员表';
COMMENT ON COLUMN public.chat_conversation_members.conversation_id IS '会话 ID';
COMMENT ON COLUMN public.chat_conversation_members.user_id IS '成员用户 ID';
COMMENT ON COLUMN public.chat_conversation_members.last_read_at IS '最近一次已读时间';
COMMENT ON COLUMN public.chat_conversation_members.joined_at IS '加入时间';
COMMENT ON COLUMN public.chat_conversation_members.is_pinned IS '是否置顶';
COMMENT ON COLUMN public.chat_conversation_members.is_starred IS '是否标星';
COMMENT ON COLUMN public.chat_conversation_members.role IS '成员角色：owner/member';
COMMENT ON COLUMN public.chat_conversation_members.is_muted IS '是否免打扰';
COMMENT ON TABLE public.chat_conversations IS '聊天会话表';
COMMENT ON COLUMN public.chat_conversations.id IS '主键 ID';
COMMENT ON COLUMN public.chat_conversations.type IS '会话类型：direct 单聊 / group 群聊';
COMMENT ON COLUMN public.chat_conversations.name IS '会话名称（群聊用）';
COMMENT ON COLUMN public.chat_conversations.tenant_id IS '所属租户 ID';
COMMENT ON COLUMN public.chat_conversations.created_at IS '创建时间';
COMMENT ON COLUMN public.chat_conversations.updated_at IS '更新时间';
COMMENT ON COLUMN public.chat_conversations.announcement IS '群公告';
COMMENT ON COLUMN public.chat_conversations.created_by IS '创建人';
COMMENT ON COLUMN public.chat_conversations.updated_by IS '最后更新人';
COMMENT ON TABLE public.chat_message_reactions IS '聊天消息表情回应表';
COMMENT ON COLUMN public.chat_message_reactions.id IS '主键 ID';
COMMENT ON COLUMN public.chat_message_reactions.message_id IS '消息 ID';
COMMENT ON COLUMN public.chat_message_reactions.user_id IS '回应用户 ID';
COMMENT ON COLUMN public.chat_message_reactions.emoji IS '表情字符';
COMMENT ON COLUMN public.chat_message_reactions.created_at IS '创建时间';
COMMENT ON TABLE public.chat_messages IS '聊天消息表';
COMMENT ON COLUMN public.chat_messages.id IS '主键 ID';
COMMENT ON COLUMN public.chat_messages.conversation_id IS '所属会话 ID';
COMMENT ON COLUMN public.chat_messages.sender_id IS '发送者用户 ID';
COMMENT ON COLUMN public.chat_messages.type IS '消息类型：text/image/file/system/forward/vote';
COMMENT ON COLUMN public.chat_messages.content IS '消息正文';
COMMENT ON COLUMN public.chat_messages.reply_to_id IS '引用回复的消息 ID';
COMMENT ON COLUMN public.chat_messages.is_recalled IS '是否已撤回';
COMMENT ON COLUMN public.chat_messages.extra IS '附加信息（JSON：图片/文件元数据等）';
COMMENT ON COLUMN public.chat_messages.created_at IS '发送时间';
COMMENT ON COLUMN public.chat_messages.updated_at IS '更新时间';
COMMENT ON COLUMN public.chat_messages.is_edited IS '是否被编辑';
COMMENT ON TABLE public.cron_job_logs IS '定时任务执行日志表';
COMMENT ON COLUMN public.cron_job_logs.id IS '主键 ID';
COMMENT ON COLUMN public.cron_job_logs.job_id IS '关联任务 ID';
COMMENT ON COLUMN public.cron_job_logs.job_name IS '任务名称快照';
COMMENT ON COLUMN public.cron_job_logs.started_at IS '开始时间';
COMMENT ON COLUMN public.cron_job_logs.ended_at IS '结束时间';
COMMENT ON COLUMN public.cron_job_logs.duration_ms IS '耗时（毫秒）';
COMMENT ON COLUMN public.cron_job_logs.status IS '状态：success/fail/running';
COMMENT ON COLUMN public.cron_job_logs.output IS '执行输出/错误堆栈';
COMMENT ON COLUMN public.cron_job_logs.execution_count IS '本次第几次重试（从 1 起）';
COMMENT ON TABLE public.cron_jobs IS '定时任务表';
COMMENT ON COLUMN public.cron_jobs.id IS '主键 ID';
COMMENT ON COLUMN public.cron_jobs.name IS '任务名称（全局唯一）';
COMMENT ON COLUMN public.cron_jobs.cron_expression IS 'Cron 表达式';
COMMENT ON COLUMN public.cron_jobs.handler IS '处理器键（代码注册的任务标识）';
COMMENT ON COLUMN public.cron_jobs.params IS '处理器参数（JSON 字符串）';
COMMENT ON COLUMN public.cron_jobs.status IS '状态：enabled/disabled';
COMMENT ON COLUMN public.cron_jobs.description IS '描述';
COMMENT ON COLUMN public.cron_jobs.last_run_at IS '最近一次执行开始时间';
COMMENT ON COLUMN public.cron_jobs.last_run_status IS '最近一次执行结果：success/fail/running';
COMMENT ON COLUMN public.cron_jobs.last_run_message IS '最近一次执行附加信息';
COMMENT ON COLUMN public.cron_jobs.created_at IS '创建时间';
COMMENT ON COLUMN public.cron_jobs.updated_at IS '更新时间';
COMMENT ON COLUMN public.cron_jobs.retry_count IS '失败重试次数';
COMMENT ON COLUMN public.cron_jobs.retry_interval IS '重试间隔（秒）';
COMMENT ON COLUMN public.cron_jobs.monitor_timeout IS '执行超时告警阈值（秒）';
COMMENT ON COLUMN public.cron_jobs.created_by IS '创建人';
COMMENT ON COLUMN public.cron_jobs.updated_by IS '最后更新人';
COMMENT ON TABLE public.db_admin_query_history IS '数据库管理员 SQL 控制台查询历史';
COMMENT ON COLUMN public.db_admin_query_history.id IS '主键 ID';
COMMENT ON COLUMN public.db_admin_query_history.user_id IS '执行用户 ID';
COMMENT ON COLUMN public.db_admin_query_history.sql_text IS '执行的 SQL';
COMMENT ON COLUMN public.db_admin_query_history.duration_ms IS '耗时（毫秒）';
COMMENT ON COLUMN public.db_admin_query_history.row_count IS '返回/影响行数';
COMMENT ON COLUMN public.db_admin_query_history.success IS '是否执行成功';
COMMENT ON COLUMN public.db_admin_query_history.error_message IS '错误信息';
COMMENT ON COLUMN public.db_admin_query_history.executed_at IS '执行时间';
COMMENT ON TABLE public.db_backups IS '数据库备份记录表';
COMMENT ON COLUMN public.db_backups.id IS '主键 ID';
COMMENT ON COLUMN public.db_backups.name IS '备份名称';
COMMENT ON COLUMN public.db_backups.type IS '备份方式：pg_dump/drizzle_export';
COMMENT ON COLUMN public.db_backups.file_id IS '关联文件 ID（managed_files.id）';
COMMENT ON COLUMN public.db_backups.file_size IS '备份文件大小（字节）';
COMMENT ON COLUMN public.db_backups.status IS '状态：pending/running/success/failed';
COMMENT ON COLUMN public.db_backups.tables IS '备份涉及的表（逗号分隔，NULL 表示全库）';
COMMENT ON COLUMN public.db_backups.started_at IS '开始时间';
COMMENT ON COLUMN public.db_backups.completed_at IS '完成时间';
COMMENT ON COLUMN public.db_backups.duration_ms IS '耗时（毫秒）';
COMMENT ON COLUMN public.db_backups.error_message IS '错误信息';
COMMENT ON COLUMN public.db_backups.created_by IS '操作人';
COMMENT ON COLUMN public.db_backups.created_at IS '创建时间';
COMMENT ON COLUMN public.db_backups.updated_by IS '最后更新人';
COMMENT ON COLUMN public.db_backups.updated_at IS '更新时间';
COMMENT ON TABLE public.departments IS '部门表';
COMMENT ON COLUMN public.departments.id IS '主键 ID';
COMMENT ON COLUMN public.departments.parent_id IS '上级部门 ID（0 表示根节点）';
COMMENT ON COLUMN public.departments.name IS '部门名称';
COMMENT ON COLUMN public.departments.code IS '部门编码（租户内唯一）';
COMMENT ON COLUMN public.departments.phone IS '部门联系电话';
COMMENT ON COLUMN public.departments.email IS '部门邮箱';
COMMENT ON COLUMN public.departments.sort IS '排序值（升序）';
COMMENT ON COLUMN public.departments.status IS '状态：enabled/disabled';
COMMENT ON COLUMN public.departments.created_at IS '创建时间';
COMMENT ON COLUMN public.departments.updated_at IS '更新时间';
COMMENT ON COLUMN public.departments.tenant_id IS '所属租户 ID';
COMMENT ON COLUMN public.departments.leader_id IS '负责人用户 ID';
COMMENT ON COLUMN public.departments.created_by IS '创建人';
COMMENT ON COLUMN public.departments.updated_by IS '最后更新人';
COMMENT ON TABLE public.dict_items IS '字典项表';
COMMENT ON COLUMN public.dict_items.id IS '主键 ID';
COMMENT ON COLUMN public.dict_items.dict_id IS '所属字典 ID';
COMMENT ON COLUMN public.dict_items.label IS '显示标签';
COMMENT ON COLUMN public.dict_items.value IS '取值（字典内唯一）';
COMMENT ON COLUMN public.dict_items.sort IS '排序值';
COMMENT ON COLUMN public.dict_items.status IS '状态：enabled/disabled';
COMMENT ON COLUMN public.dict_items.remark IS '备注';
COMMENT ON COLUMN public.dict_items.created_at IS '创建时间';
COMMENT ON COLUMN public.dict_items.updated_at IS '更新时间';
COMMENT ON COLUMN public.dict_items.color IS '前端展示颜色（可选）';
COMMENT ON COLUMN public.dict_items.created_by IS '创建人';
COMMENT ON COLUMN public.dict_items.updated_by IS '最后更新人';
COMMENT ON TABLE public.dicts IS '数据字典表';
COMMENT ON COLUMN public.dicts.id IS '主键 ID';
COMMENT ON COLUMN public.dicts.name IS '字典名称';
COMMENT ON COLUMN public.dicts.code IS '字典编码（租户内唯一）';
COMMENT ON COLUMN public.dicts.description IS '描述';
COMMENT ON COLUMN public.dicts.status IS '状态：enabled/disabled';
COMMENT ON COLUMN public.dicts.created_at IS '创建时间';
COMMENT ON COLUMN public.dicts.updated_at IS '更新时间';
COMMENT ON COLUMN public.dicts.tenant_id IS '所属租户 ID';
COMMENT ON COLUMN public.dicts.created_by IS '创建人';
COMMENT ON COLUMN public.dicts.updated_by IS '最后更新人';
COMMENT ON TABLE public.email_configs IS '邮件 SMTP 配置表（全局单例使用）';
COMMENT ON COLUMN public.email_configs.id IS '主键 ID';
COMMENT ON COLUMN public.email_configs.smtp_host IS 'SMTP 服务器地址';
COMMENT ON COLUMN public.email_configs.smtp_port IS 'SMTP 端口（465/587/25）';
COMMENT ON COLUMN public.email_configs.smtp_user IS 'SMTP 用户名';
COMMENT ON COLUMN public.email_configs.smtp_password IS 'SMTP 密码（加密存储）';
COMMENT ON COLUMN public.email_configs.from_name IS '发件人显示名';
COMMENT ON COLUMN public.email_configs.from_email IS '发件人邮箱';
COMMENT ON COLUMN public.email_configs.encryption IS '加密方式：none/ssl/tls';
COMMENT ON COLUMN public.email_configs.status IS '状态：enabled/disabled';
COMMENT ON COLUMN public.email_configs.created_at IS '创建时间';
COMMENT ON COLUMN public.email_configs.updated_at IS '更新时间';
COMMENT ON COLUMN public.email_configs.created_by IS '创建人';
COMMENT ON COLUMN public.email_configs.updated_by IS '最后更新人';
COMMENT ON TABLE public.email_send_logs IS '邮件发送记录表';
COMMENT ON COLUMN public.email_send_logs.id IS '主键 ID';
COMMENT ON COLUMN public.email_send_logs.template_id IS '使用的模板 ID';
COMMENT ON COLUMN public.email_send_logs.to_email IS '收件人邮箱';
COMMENT ON COLUMN public.email_send_logs.subject IS '实际发送主题';
COMMENT ON COLUMN public.email_send_logs.content IS '实际发送正文';
COMMENT ON COLUMN public.email_send_logs.status IS '发送状态：pending/success/failed';
COMMENT ON COLUMN public.email_send_logs.error_msg IS '失败原因';
COMMENT ON COLUMN public.email_send_logs.source IS '触发来源：manual/test/system/api';
COMMENT ON COLUMN public.email_send_logs.user_id IS '触发用户 ID';
COMMENT ON COLUMN public.email_send_logs.ip IS '触发 IP';
COMMENT ON COLUMN public.email_send_logs.tenant_id IS '所属租户 ID';
COMMENT ON COLUMN public.email_send_logs.sent_at IS '发送完成时间';
COMMENT ON COLUMN public.email_send_logs.created_at IS '记录创建时间';
COMMENT ON TABLE public.email_templates IS '邮件模板表';
COMMENT ON COLUMN public.email_templates.id IS '主键 ID';
COMMENT ON COLUMN public.email_templates.name IS '模板名称';
COMMENT ON COLUMN public.email_templates.code IS '模板编码（全局唯一）';
COMMENT ON COLUMN public.email_templates.subject IS '邮件主题（支持变量）';
COMMENT ON COLUMN public.email_templates.content IS '邮件正文（HTML/支持变量）';
COMMENT ON COLUMN public.email_templates.variables IS '变量定义（JSON）';
COMMENT ON COLUMN public.email_templates.status IS '状态：enabled/disabled';
COMMENT ON COLUMN public.email_templates.remark IS '备注';
COMMENT ON COLUMN public.email_templates.tenant_id IS '所属租户 ID';
COMMENT ON COLUMN public.email_templates.created_at IS '创建时间';
COMMENT ON COLUMN public.email_templates.updated_at IS '更新时间';
COMMENT ON COLUMN public.email_templates.created_by IS '创建人';
COMMENT ON COLUMN public.email_templates.updated_by IS '最后更新人';
COMMENT ON TABLE public.file_storage_configs IS '文件存储配置表（本地/OSS/S3/COS）';
COMMENT ON COLUMN public.file_storage_configs.id IS '主键 ID';
COMMENT ON COLUMN public.file_storage_configs.name IS '配置名称';
COMMENT ON COLUMN public.file_storage_configs.provider IS '存储类型：local/oss/s3/cos';
COMMENT ON COLUMN public.file_storage_configs.status IS '状态：enabled/disabled';
COMMENT ON COLUMN public.file_storage_configs.is_default IS '是否默认存储（全局仅一个）';
COMMENT ON COLUMN public.file_storage_configs.base_path IS '基础路径（对象 key 前缀）';
COMMENT ON COLUMN public.file_storage_configs.local_root_path IS '本地存储根目录（local 模式）';
COMMENT ON COLUMN public.file_storage_configs.oss_region IS '阿里云 OSS Region';
COMMENT ON COLUMN public.file_storage_configs.oss_endpoint IS '阿里云 OSS Endpoint';
COMMENT ON COLUMN public.file_storage_configs.oss_bucket IS '阿里云 OSS Bucket';
COMMENT ON COLUMN public.file_storage_configs.oss_access_key_id IS '阿里云 AccessKeyId';
COMMENT ON COLUMN public.file_storage_configs.oss_access_key_secret IS '阿里云 AccessKeySecret';
COMMENT ON COLUMN public.file_storage_configs.remark IS '备注';
COMMENT ON COLUMN public.file_storage_configs.created_at IS '创建时间';
COMMENT ON COLUMN public.file_storage_configs.updated_at IS '更新时间';
COMMENT ON COLUMN public.file_storage_configs.s3_region IS 'S3 Region';
COMMENT ON COLUMN public.file_storage_configs.s3_endpoint IS 'S3 Endpoint（MinIO/R2 使用）';
COMMENT ON COLUMN public.file_storage_configs.s3_bucket IS 'S3 Bucket';
COMMENT ON COLUMN public.file_storage_configs.s3_access_key_id IS 'S3 AccessKeyId';
COMMENT ON COLUMN public.file_storage_configs.s3_secret_access_key IS 'S3 SecretAccessKey';
COMMENT ON COLUMN public.file_storage_configs.s3_force_path_style IS '是否强制使用 path-style 寻址';
COMMENT ON COLUMN public.file_storage_configs.cos_region IS '腾讯云 COS Region';
COMMENT ON COLUMN public.file_storage_configs.cos_bucket IS '腾讯云 COS Bucket';
COMMENT ON COLUMN public.file_storage_configs.cos_secret_id IS '腾讯云 SecretId';
COMMENT ON COLUMN public.file_storage_configs.cos_secret_key IS '腾讯云 SecretKey';
COMMENT ON COLUMN public.file_storage_configs.created_by IS '创建人';
COMMENT ON COLUMN public.file_storage_configs.updated_by IS '最后更新人';
COMMENT ON TABLE public.in_app_messages IS '站内信收件记录表';
COMMENT ON COLUMN public.in_app_messages.id IS '主键 ID';
COMMENT ON COLUMN public.in_app_messages.template_id IS '使用的模板 ID';
COMMENT ON COLUMN public.in_app_messages.user_id IS '接收用户 ID';
COMMENT ON COLUMN public.in_app_messages.title IS '消息标题';
COMMENT ON COLUMN public.in_app_messages.content IS '消息内容';
COMMENT ON COLUMN public.in_app_messages.type IS '消息类型：info/success/warning/error';
COMMENT ON COLUMN public.in_app_messages.is_read IS '是否已读';
COMMENT ON COLUMN public.in_app_messages.read_at IS '阅读时间';
COMMENT ON COLUMN public.in_app_messages.source IS '触发来源：manual/test/system/api';
COMMENT ON COLUMN public.in_app_messages.sender_id IS '发送者用户 ID';
COMMENT ON COLUMN public.in_app_messages.tenant_id IS '所属租户 ID';
COMMENT ON COLUMN public.in_app_messages.created_at IS '创建时间';
COMMENT ON TABLE public.in_app_templates IS '站内信模板表';
COMMENT ON COLUMN public.in_app_templates.id IS '主键 ID';
COMMENT ON COLUMN public.in_app_templates.name IS '模板名称';
COMMENT ON COLUMN public.in_app_templates.code IS '模板编码（全局唯一）';
COMMENT ON COLUMN public.in_app_templates.title IS '消息标题（支持变量）';
COMMENT ON COLUMN public.in_app_templates.content IS '消息内容（支持变量）';
COMMENT ON COLUMN public.in_app_templates.type IS '消息类型：info/success/warning/error';
COMMENT ON COLUMN public.in_app_templates.variables IS '变量定义（JSON）';
COMMENT ON COLUMN public.in_app_templates.status IS '状态：enabled/disabled';
COMMENT ON COLUMN public.in_app_templates.remark IS '备注';
COMMENT ON COLUMN public.in_app_templates.tenant_id IS '所属租户 ID';
COMMENT ON COLUMN public.in_app_templates.created_at IS '创建时间';
COMMENT ON COLUMN public.in_app_templates.updated_at IS '更新时间';
COMMENT ON COLUMN public.in_app_templates.created_by IS '创建人';
COMMENT ON COLUMN public.in_app_templates.updated_by IS '最后更新人';
COMMENT ON TABLE public.login_logs IS '登录日志表';
COMMENT ON COLUMN public.login_logs.id IS '主键 ID';
COMMENT ON COLUMN public.login_logs.user_id IS '用户 ID（登录失败时可能为空）';
COMMENT ON COLUMN public.login_logs.username IS '登录用户名';
COMMENT ON COLUMN public.login_logs.ip IS '登录 IP';
COMMENT ON COLUMN public.login_logs.browser IS '浏览器信息';
COMMENT ON COLUMN public.login_logs.os IS '操作系统';
COMMENT ON COLUMN public.login_logs.status IS '登录结果：success/fail';
COMMENT ON COLUMN public.login_logs.message IS '失败原因或附加信息';
COMMENT ON COLUMN public.login_logs.created_at IS '登录时间';
COMMENT ON COLUMN public.login_logs.tenant_id IS '所属租户 ID';
COMMENT ON TABLE public.managed_files IS '文件元数据表';
COMMENT ON COLUMN public.managed_files.id IS '主键 ID';
COMMENT ON COLUMN public.managed_files.storage_config_id IS '所属存储配置 ID';
COMMENT ON COLUMN public.managed_files.storage_name IS '存储配置名称快照';
COMMENT ON COLUMN public.managed_files.provider IS '存储类型快照';
COMMENT ON COLUMN public.managed_files.original_name IS '原始文件名';
COMMENT ON COLUMN public.managed_files.object_key IS '存储对象 Key（相对路径）';
COMMENT ON COLUMN public.managed_files.size IS '文件大小（字节）';
COMMENT ON COLUMN public.managed_files.mime_type IS 'MIME 类型';
COMMENT ON COLUMN public.managed_files.extension IS '扩展名（不含点）';
COMMENT ON COLUMN public.managed_files.created_at IS '上传时间';
COMMENT ON COLUMN public.managed_files.updated_at IS '更新时间';
COMMENT ON COLUMN public.managed_files.tenant_id IS '所属租户 ID';
COMMENT ON COLUMN public.managed_files.created_by IS '上传人';
COMMENT ON COLUMN public.managed_files.updated_by IS '最后更新人';
COMMENT ON TABLE public.menus IS '菜单/权限点表';
COMMENT ON COLUMN public.menus.id IS '主键 ID';
COMMENT ON COLUMN public.menus.parent_id IS '上级菜单 ID（0 表示根节点）';
COMMENT ON COLUMN public.menus.title IS '菜单显示标题';
COMMENT ON COLUMN public.menus.name IS '路由 name（前端 Vue/React Router 命名路由）';
COMMENT ON COLUMN public.menus.path IS '路由路径';
COMMENT ON COLUMN public.menus.icon IS '图标名称（lucide-react）';
COMMENT ON COLUMN public.menus.type IS '类型：directory 目录 / menu 菜单 / button 按钮（权限点）';
COMMENT ON COLUMN public.menus.permission IS '权限标识（如 user:create）';
COMMENT ON COLUMN public.menus.sort IS '排序值';
COMMENT ON COLUMN public.menus.status IS '状态：enabled/disabled';
COMMENT ON COLUMN public.menus.visible IS '是否在侧边栏可见';
COMMENT ON COLUMN public.menus.created_at IS '创建时间';
COMMENT ON COLUMN public.menus.updated_at IS '更新时间';
COMMENT ON COLUMN public.menus.component IS '前端组件路径';
COMMENT ON COLUMN public.menus.created_by IS '创建人';
COMMENT ON COLUMN public.menus.updated_by IS '最后更新人';
COMMENT ON TABLE public.oauth_configs IS 'OAuth 第三方登录配置表';
COMMENT ON COLUMN public.oauth_configs.id IS '主键 ID';
COMMENT ON COLUMN public.oauth_configs.provider IS '平台：github/dingtalk/wechat_work（唯一）';
COMMENT ON COLUMN public.oauth_configs.client_id IS 'Client ID / AppKey';
COMMENT ON COLUMN public.oauth_configs.client_secret IS 'Client Secret / AppSecret';
COMMENT ON COLUMN public.oauth_configs.agent_id IS '企业微信 AgentId';
COMMENT ON COLUMN public.oauth_configs.corp_id IS '钉钉/企业微信 CorpId';
COMMENT ON COLUMN public.oauth_configs.enabled IS '是否启用';
COMMENT ON COLUMN public.oauth_configs.created_at IS '创建时间';
COMMENT ON COLUMN public.oauth_configs.updated_at IS '更新时间';
COMMENT ON COLUMN public.oauth_configs.created_by IS '创建人';
COMMENT ON COLUMN public.oauth_configs.updated_by IS '最后更新人';
COMMENT ON TABLE public.operation_logs IS '操作日志表';
COMMENT ON COLUMN public.operation_logs.id IS '主键 ID';
COMMENT ON COLUMN public.operation_logs.user_id IS '操作用户 ID';
COMMENT ON COLUMN public.operation_logs.username IS '操作用户名';
COMMENT ON COLUMN public.operation_logs.module IS '所属模块';
COMMENT ON COLUMN public.operation_logs.description IS '操作描述';
COMMENT ON COLUMN public.operation_logs.method IS 'HTTP 方法';
COMMENT ON COLUMN public.operation_logs.path IS '请求路径';
COMMENT ON COLUMN public.operation_logs.request_body IS '请求体（脱敏后）';
COMMENT ON COLUMN public.operation_logs.response_code IS '业务响应码（0 表示成功）';
COMMENT ON COLUMN public.operation_logs.duration_ms IS '处理耗时（毫秒）';
COMMENT ON COLUMN public.operation_logs.ip IS '客户端 IP';
COMMENT ON COLUMN public.operation_logs.user_agent IS 'User-Agent';
COMMENT ON COLUMN public.operation_logs.os IS '操作系统';
COMMENT ON COLUMN public.operation_logs.browser IS '浏览器';
COMMENT ON COLUMN public.operation_logs.created_at IS '请求时间';
COMMENT ON COLUMN public.operation_logs.before_data IS '变更前数据快照（JSON）';
COMMENT ON COLUMN public.operation_logs.after_data IS '变更后数据快照（JSON）';
COMMENT ON COLUMN public.operation_logs.tenant_id IS '所属租户 ID';
COMMENT ON COLUMN public.operation_logs.request_id IS '请求追踪 ID';
COMMENT ON TABLE public.password_reset_tokens IS '密码重置 Token 表';
COMMENT ON COLUMN public.password_reset_tokens.id IS '主键 ID';
COMMENT ON COLUMN public.password_reset_tokens.user_id IS '关联用户 ID';
COMMENT ON COLUMN public.password_reset_tokens.token IS '重置 Token（全局唯一）';
COMMENT ON COLUMN public.password_reset_tokens.expires_at IS '过期时间';
COMMENT ON COLUMN public.password_reset_tokens.used_at IS '使用时间（NULL 表示未使用）';
COMMENT ON COLUMN public.password_reset_tokens.created_at IS '签发时间';
COMMENT ON TABLE public.positions IS '岗位表';
COMMENT ON COLUMN public.positions.id IS '主键 ID';
COMMENT ON COLUMN public.positions.name IS '岗位名称';
COMMENT ON COLUMN public.positions.code IS '岗位编码（租户内唯一）';
COMMENT ON COLUMN public.positions.sort IS '排序值';
COMMENT ON COLUMN public.positions.status IS '状态：enabled/disabled';
COMMENT ON COLUMN public.positions.remark IS '备注';
COMMENT ON COLUMN public.positions.created_at IS '创建时间';
COMMENT ON COLUMN public.positions.updated_at IS '更新时间';
COMMENT ON COLUMN public.positions.tenant_id IS '所属租户 ID';
COMMENT ON COLUMN public.positions.created_by IS '创建人';
COMMENT ON COLUMN public.positions.updated_by IS '最后更新人';
COMMENT ON TABLE public.rate_limit_rules IS '接口限流规则表';
COMMENT ON COLUMN public.rate_limit_rules.id IS '主键 ID';
COMMENT ON COLUMN public.rate_limit_rules.name IS '规则名称（全局唯一）';
COMMENT ON COLUMN public.rate_limit_rules.description IS '规则描述';
COMMENT ON COLUMN public.rate_limit_rules.window_ms IS '时间窗口（毫秒）';
COMMENT ON COLUMN public.rate_limit_rules."limit" IS '窗口内最大请求次数';
COMMENT ON COLUMN public.rate_limit_rules.key_type IS '限流键类型：ip/user/ip_path';
COMMENT ON COLUMN public.rate_limit_rules.enabled IS '是否启用';
COMMENT ON COLUMN public.rate_limit_rules.blocked_message IS '触发限流时返回的提示文案';
COMMENT ON COLUMN public.rate_limit_rules.created_at IS '创建时间';
COMMENT ON COLUMN public.rate_limit_rules.updated_at IS '更新时间';
COMMENT ON COLUMN public.rate_limit_rules.created_by IS '创建人';
COMMENT ON COLUMN public.rate_limit_rules.updated_by IS '最后更新人';
COMMENT ON TABLE public.regions IS '中国行政区划表';
COMMENT ON COLUMN public.regions.id IS '主键 ID';
COMMENT ON COLUMN public.regions.code IS '行政区划代码（全局唯一）';
COMMENT ON COLUMN public.regions.name IS '区划名称';
COMMENT ON COLUMN public.regions.level IS '层级：province/city/county';
COMMENT ON COLUMN public.regions.parent_code IS '父级区划代码';
COMMENT ON COLUMN public.regions.sort IS '排序值';
COMMENT ON COLUMN public.regions.status IS '状态：enabled/disabled';
COMMENT ON COLUMN public.regions.created_at IS '创建时间';
COMMENT ON COLUMN public.regions.updated_at IS '更新时间';
COMMENT ON COLUMN public.regions.created_by IS '创建人';
COMMENT ON COLUMN public.regions.updated_by IS '最后更新人';
COMMENT ON TABLE public.role_menus IS '角色-菜单（权限）关联表';
COMMENT ON COLUMN public.role_menus.role_id IS '角色 ID';
COMMENT ON COLUMN public.role_menus.menu_id IS '菜单 ID';
COMMENT ON TABLE public.roles IS '角色表';
COMMENT ON COLUMN public.roles.id IS '主键 ID';
COMMENT ON COLUMN public.roles.name IS '角色名称';
COMMENT ON COLUMN public.roles.code IS '角色编码（租户内唯一）';
COMMENT ON COLUMN public.roles.description IS '角色描述';
COMMENT ON COLUMN public.roles.status IS '状态：enabled/disabled';
COMMENT ON COLUMN public.roles.created_at IS '创建时间';
COMMENT ON COLUMN public.roles.updated_at IS '更新时间';
COMMENT ON COLUMN public.roles.data_scope IS '数据权限范围：all 全部 / dept 本部门 / self 本人';
COMMENT ON COLUMN public.roles.tenant_id IS '所属租户 ID';
COMMENT ON COLUMN public.roles.created_by IS '创建人';
COMMENT ON COLUMN public.roles.updated_by IS '最后更新人';
COMMENT ON TABLE public.sms_configs IS '短信服务商配置表';
COMMENT ON COLUMN public.sms_configs.id IS '主键 ID';
COMMENT ON COLUMN public.sms_configs.name IS '配置名称';
COMMENT ON COLUMN public.sms_configs.provider IS '服务商：aliyun/tencent';
COMMENT ON COLUMN public.sms_configs.access_key_id IS 'AccessKeyId';
COMMENT ON COLUMN public.sms_configs.access_key_secret IS 'AccessKeySecret';
COMMENT ON COLUMN public.sms_configs.region IS '区域';
COMMENT ON COLUMN public.sms_configs.sign_name IS '默认短信签名';
COMMENT ON COLUMN public.sms_configs.is_default IS '是否默认配置';
COMMENT ON COLUMN public.sms_configs.status IS '状态：enabled/disabled';
COMMENT ON COLUMN public.sms_configs.remark IS '备注';
COMMENT ON COLUMN public.sms_configs.tenant_id IS '所属租户 ID';
COMMENT ON COLUMN public.sms_configs.created_at IS '创建时间';
COMMENT ON COLUMN public.sms_configs.updated_at IS '更新时间';
COMMENT ON COLUMN public.sms_configs.created_by IS '创建人';
COMMENT ON COLUMN public.sms_configs.updated_by IS '最后更新人';
COMMENT ON TABLE public.sms_send_logs IS '短信发送记录表';
COMMENT ON COLUMN public.sms_send_logs.id IS '主键 ID';
COMMENT ON COLUMN public.sms_send_logs.config_id IS '使用的服务商配置 ID';
COMMENT ON COLUMN public.sms_send_logs.template_id IS '使用的模板 ID';
COMMENT ON COLUMN public.sms_send_logs.provider IS '服务商：aliyun/tencent';
COMMENT ON COLUMN public.sms_send_logs.phone IS '接收手机号';
COMMENT ON COLUMN public.sms_send_logs.content IS '实际发送内容';
COMMENT ON COLUMN public.sms_send_logs.status IS '发送状态：pending/success/failed';
COMMENT ON COLUMN public.sms_send_logs.error_msg IS '失败原因';
COMMENT ON COLUMN public.sms_send_logs.biz_id IS '服务商业务流水号';
COMMENT ON COLUMN public.sms_send_logs.delivery_status IS '终端送达状态';
COMMENT ON COLUMN public.sms_send_logs.delivered_at IS '终端送达时间';
COMMENT ON COLUMN public.sms_send_logs.source IS '触发来源：manual/test/system/api';
COMMENT ON COLUMN public.sms_send_logs.user_id IS '触发用户 ID';
COMMENT ON COLUMN public.sms_send_logs.ip IS '触发 IP';
COMMENT ON COLUMN public.sms_send_logs.tenant_id IS '所属租户 ID';
COMMENT ON COLUMN public.sms_send_logs.sent_at IS '发送完成时间';
COMMENT ON COLUMN public.sms_send_logs.created_at IS '记录创建时间';
COMMENT ON TABLE public.sms_templates IS '短信模板表';
COMMENT ON COLUMN public.sms_templates.id IS '主键 ID';
COMMENT ON COLUMN public.sms_templates.name IS '模板名称';
COMMENT ON COLUMN public.sms_templates.code IS '模板编码（全局唯一）';
COMMENT ON COLUMN public.sms_templates.template_code IS '服务商侧模板 Code';
COMMENT ON COLUMN public.sms_templates.sign_name IS '签名（可覆盖配置默认值）';
COMMENT ON COLUMN public.sms_templates.content IS '模板内容（支持变量）';
COMMENT ON COLUMN public.sms_templates.variables IS '变量定义（JSON）';
COMMENT ON COLUMN public.sms_templates.provider IS '所属服务商：aliyun/tencent';
COMMENT ON COLUMN public.sms_templates.status IS '状态：enabled/disabled';
COMMENT ON COLUMN public.sms_templates.remark IS '备注';
COMMENT ON COLUMN public.sms_templates.tenant_id IS '所属租户 ID';
COMMENT ON COLUMN public.sms_templates.created_at IS '创建时间';
COMMENT ON COLUMN public.sms_templates.updated_at IS '更新时间';
COMMENT ON COLUMN public.sms_templates.created_by IS '创建人';
COMMENT ON COLUMN public.sms_templates.updated_by IS '最后更新人';
COMMENT ON TABLE public.system_configs IS '系统参数配置表';
COMMENT ON COLUMN public.system_configs.id IS '主键 ID';
COMMENT ON COLUMN public.system_configs.config_key IS '配置键（租户内唯一）';
COMMENT ON COLUMN public.system_configs.config_value IS '配置值';
COMMENT ON COLUMN public.system_configs.config_type IS '值类型：string/number/boolean/json';
COMMENT ON COLUMN public.system_configs.description IS '描述';
COMMENT ON COLUMN public.system_configs.created_at IS '创建时间';
COMMENT ON COLUMN public.system_configs.updated_at IS '更新时间';
COMMENT ON COLUMN public.system_configs.tenant_id IS '所属租户 ID';
COMMENT ON COLUMN public.system_configs.created_by IS '创建人';
COMMENT ON COLUMN public.system_configs.updated_by IS '最后更新人';
COMMENT ON TABLE public.tags IS '标签表';
COMMENT ON COLUMN public.tags.id IS '主键 ID';
COMMENT ON COLUMN public.tags.name IS '标签名称（全局唯一）';
COMMENT ON COLUMN public.tags.color IS '展示颜色';
COMMENT ON COLUMN public.tags.group_name IS '所属分组';
COMMENT ON COLUMN public.tags.description IS '描述';
COMMENT ON COLUMN public.tags.status IS '状态：enabled/disabled';
COMMENT ON COLUMN public.tags.sort_order IS '排序值';
COMMENT ON COLUMN public.tags.created_at IS '创建时间';
COMMENT ON COLUMN public.tags.updated_at IS '更新时间';
COMMENT ON COLUMN public.tags.created_by IS '创建人';
COMMENT ON COLUMN public.tags.updated_by IS '最后更新人';
COMMENT ON TABLE public.tenants IS '租户表';
COMMENT ON COLUMN public.tenants.id IS '主键 ID';
COMMENT ON COLUMN public.tenants.name IS '租户名称';
COMMENT ON COLUMN public.tenants.code IS '租户编码（全局唯一）';
COMMENT ON COLUMN public.tenants.logo IS '租户 Logo URL';
COMMENT ON COLUMN public.tenants.contact_name IS '联系人姓名';
COMMENT ON COLUMN public.tenants.contact_phone IS '联系人电话';
COMMENT ON COLUMN public.tenants.status IS '状态：enabled/disabled';
COMMENT ON COLUMN public.tenants.expire_at IS '到期时间';
COMMENT ON COLUMN public.tenants.max_users IS '最大用户数限制';
COMMENT ON COLUMN public.tenants.remark IS '备注';
COMMENT ON COLUMN public.tenants.created_at IS '创建时间';
COMMENT ON COLUMN public.tenants.updated_at IS '更新时间';
COMMENT ON COLUMN public.tenants.created_by IS '创建人（users.id）';
COMMENT ON COLUMN public.tenants.updated_by IS '最后更新人（users.id）';
COMMENT ON TABLE public.user_api_tokens IS '用户个人 API Token 表';
COMMENT ON COLUMN public.user_api_tokens.id IS '主键 ID';
COMMENT ON COLUMN public.user_api_tokens.user_id IS '所属用户 ID';
COMMENT ON COLUMN public.user_api_tokens.name IS 'Token 名称（标识用途）';
COMMENT ON COLUMN public.user_api_tokens.token IS 'Token 值（全局唯一）';
COMMENT ON COLUMN public.user_api_tokens.last_used_at IS '最近使用时间';
COMMENT ON COLUMN public.user_api_tokens.expires_at IS '过期时间（NULL 表示永久）';
COMMENT ON COLUMN public.user_api_tokens.created_at IS '创建时间';
COMMENT ON COLUMN public.user_api_tokens.created_by IS '创建人';
COMMENT ON COLUMN public.user_api_tokens.updated_by IS '最后更新人';
COMMENT ON COLUMN public.user_api_tokens.updated_at IS '更新时间';
COMMENT ON TABLE public.user_oauth_accounts IS 'OAuth 第三方账号绑定表';
COMMENT ON COLUMN public.user_oauth_accounts.id IS '主键 ID';
COMMENT ON COLUMN public.user_oauth_accounts.user_id IS '关联用户 ID';
COMMENT ON COLUMN public.user_oauth_accounts.provider IS '第三方平台：github/dingtalk/wechat_work';
COMMENT ON COLUMN public.user_oauth_accounts.open_id IS '平台用户 OpenID';
COMMENT ON COLUMN public.user_oauth_accounts.union_id IS '平台 UnionID（如有）';
COMMENT ON COLUMN public.user_oauth_accounts.nickname IS '第三方平台昵称';
COMMENT ON COLUMN public.user_oauth_accounts.avatar IS '第三方平台头像';
COMMENT ON COLUMN public.user_oauth_accounts.access_token IS 'AccessToken';
COMMENT ON COLUMN public.user_oauth_accounts.refresh_token IS 'RefreshToken';
COMMENT ON COLUMN public.user_oauth_accounts.expires_at IS 'Token 过期时间';
COMMENT ON COLUMN public.user_oauth_accounts.raw IS '平台返回原始 JSON';
COMMENT ON COLUMN public.user_oauth_accounts.created_at IS '绑定时间';
COMMENT ON COLUMN public.user_oauth_accounts.updated_at IS '更新时间';
COMMENT ON TABLE public.user_positions IS '用户-岗位关联表';
COMMENT ON COLUMN public.user_positions.user_id IS '用户 ID';
COMMENT ON COLUMN public.user_positions.position_id IS '岗位 ID';
COMMENT ON TABLE public.user_roles IS '用户-角色关联表';
COMMENT ON COLUMN public.user_roles.user_id IS '用户 ID';
COMMENT ON COLUMN public.user_roles.role_id IS '角色 ID';
COMMENT ON TABLE public.users IS '用户表';
COMMENT ON COLUMN public.users.id IS '主键 ID';
COMMENT ON COLUMN public.users.username IS '登录用户名（租户内唯一）';
COMMENT ON COLUMN public.users.nickname IS '昵称/显示名';
COMMENT ON COLUMN public.users.email IS '邮箱（租户内唯一）';
COMMENT ON COLUMN public.users.password IS '密码哈希值（bcrypt）';
COMMENT ON COLUMN public.users.avatar IS '头像 URL';
COMMENT ON COLUMN public.users.status IS '账号状态：enabled/disabled';
COMMENT ON COLUMN public.users.created_at IS '创建时间';
COMMENT ON COLUMN public.users.updated_at IS '更新时间';
COMMENT ON COLUMN public.users.department_id IS '所属部门 ID';
COMMENT ON COLUMN public.users.password_updated_at IS '密码最近修改时间';
COMMENT ON COLUMN public.users.tenant_id IS '所属租户 ID';
COMMENT ON COLUMN public.users.phone IS '手机号';
COMMENT ON COLUMN public.users.preferences IS '个人偏好设置（JSON）';
COMMENT ON COLUMN public.users.created_by IS '创建人';
COMMENT ON COLUMN public.users.updated_by IS '最后更新人';
COMMENT ON TABLE public.workflow_definitions IS '工作流定义表';
COMMENT ON COLUMN public.workflow_definitions.id IS '主键 ID';
COMMENT ON COLUMN public.workflow_definitions.name IS '流程名称';
COMMENT ON COLUMN public.workflow_definitions.description IS '流程描述';
COMMENT ON COLUMN public.workflow_definitions.flow_data IS 'React Flow 节点+边 JSON';
COMMENT ON COLUMN public.workflow_definitions.status IS '状态：draft/published/disabled';
COMMENT ON COLUMN public.workflow_definitions.version IS '版本号';
COMMENT ON COLUMN public.workflow_definitions.tenant_id IS '所属租户 ID';
COMMENT ON COLUMN public.workflow_definitions.created_by IS '创建人';
COMMENT ON COLUMN public.workflow_definitions.created_at IS '创建时间';
COMMENT ON COLUMN public.workflow_definitions.updated_at IS '更新时间';
COMMENT ON COLUMN public.workflow_definitions.updated_by IS '最后更新人';
COMMENT ON TABLE public.workflow_instances IS '工作流实例表';
COMMENT ON COLUMN public.workflow_instances.id IS '主键 ID';
COMMENT ON COLUMN public.workflow_instances.definition_id IS '关联流程定义 ID';
COMMENT ON COLUMN public.workflow_instances.definition_snapshot IS '发起时的定义快照（JSON）';
COMMENT ON COLUMN public.workflow_instances.title IS '实例标题';
COMMENT ON COLUMN public.workflow_instances.form_data IS '表单数据（JSON）';
COMMENT ON COLUMN public.workflow_instances.status IS '状态：draft/running/approved/rejected/withdrawn';
COMMENT ON COLUMN public.workflow_instances.current_node_key IS '当前节点 key';
COMMENT ON COLUMN public.workflow_instances.initiator_id IS '发起人用户 ID';
COMMENT ON COLUMN public.workflow_instances.tenant_id IS '所属租户 ID';
COMMENT ON COLUMN public.workflow_instances.created_at IS '创建时间';
COMMENT ON COLUMN public.workflow_instances.updated_at IS '更新时间';
COMMENT ON COLUMN public.workflow_instances.created_by IS '创建人';
COMMENT ON COLUMN public.workflow_instances.updated_by IS '最后更新人';
COMMENT ON TABLE public.workflow_tasks IS '工作流审批任务表';
COMMENT ON COLUMN public.workflow_tasks.id IS '主键 ID';
COMMENT ON COLUMN public.workflow_tasks.instance_id IS '关联流程实例 ID';
COMMENT ON COLUMN public.workflow_tasks.node_key IS '节点 key';
COMMENT ON COLUMN public.workflow_tasks.node_name IS '节点名称快照';
COMMENT ON COLUMN public.workflow_tasks.assignee_id IS '审批人用户 ID';
COMMENT ON COLUMN public.workflow_tasks.status IS '状态：pending/approved/rejected/skipped';
COMMENT ON COLUMN public.workflow_tasks.comment IS '审批意见';
COMMENT ON COLUMN public.workflow_tasks.action_at IS '处理时间';
COMMENT ON COLUMN public.workflow_tasks.created_at IS '创建时间';
COMMENT ON COLUMN public.workflow_tasks.node_type IS '节点类型：start/approve/end/exclusiveGateway/parallelGateway/ccNode';
