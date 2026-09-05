-- pg_trgm 必须先于本文件内的 gin_trgm_ops 索引（operation_logs / wiki_docs / cms_contents / async_tasks 等）创建；
-- 重建基线后需保留此前置行（见 docs/backend/database.md「迁移目录」）。
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."push_provider" AS ENUM('jpush');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('enabled', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."data_scope" AS ENUM('all', 'custom', 'dept_only', 'dept', 'self');--> statement-breakpoint
CREATE TYPE "public"."menu_type" AS ENUM('directory', 'menu', 'button');--> statement-breakpoint
CREATE TYPE "public"."business_type" AS ENUM('announcement', 'wiki_doc');--> statement-breakpoint
CREATE TYPE "public"."file_object_acl" AS ENUM('default', 'private', 'public-read', 'public-read-write');--> statement-breakpoint
CREATE TYPE "public"."file_storage_provider" AS ENUM('local', 'oss', 's3', 'cos', 'obs', 'kodo', 'bos', 'azure', 'sftp');--> statement-breakpoint
CREATE TYPE "public"."file_url_strategy" AS ENUM('proxy', 'public', 'presigned');--> statement-breakpoint
CREATE TYPE "public"."file_visibility" AS ENUM('public', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."upload_session_status" AS ENUM('uploading', 'completed', 'aborted');--> statement-breakpoint
CREATE TYPE "public"."mask_type" AS ENUM('phone', 'email', 'id_card', 'name', 'bank_card', 'custom');--> statement-breakpoint
CREATE TYPE "public"."async_task_item_status" AS ENUM('pending', 'success', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."async_task_status" AS ENUM('pending', 'running', 'success', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."export_job_delete_reason" AS ENUM('expired', 'manual', 'file_missing');--> statement-breakpoint
CREATE TYPE "public"."export_job_execution_mode" AS ENUM('sync', 'async');--> statement-breakpoint
CREATE TYPE "public"."export_job_format" AS ENUM('xlsx', 'csv', 'pdf', 'docx');--> statement-breakpoint
CREATE TYPE "public"."export_job_status" AS ENUM('pending', 'running', 'success', 'failed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."cron_run_status" AS ENUM('success', 'fail', 'running');--> statement-breakpoint
CREATE TYPE "public"."region_level" AS ENUM('province', 'city', 'county');--> statement-breakpoint
CREATE TYPE "public"."system_scheduler_run_status" AS ENUM('running', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."system_scheduler_task_type" AS ENUM('recurring', 'queue');--> statement-breakpoint
CREATE TYPE "public"."system_scheduler_trigger_type" AS ENUM('schedule', 'manual', 'queue');--> statement-breakpoint
CREATE TYPE "public"."user_feedback_category" AS ENUM('suggestion', 'bug', 'ux', 'other');--> statement-breakpoint
CREATE TYPE "public"."user_feedback_status" AS ENUM('pending', 'processing', 'resolved', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."login_risk_action" AS ENUM('allow', 'challenge', 'block');--> statement-breakpoint
CREATE TYPE "public"."login_risk_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."mfa_factor_status" AS ENUM('pending', 'enabled', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."mfa_factor_type" AS ENUM('totp', 'passkey', 'recovery_code');--> statement-breakpoint
CREATE TYPE "public"."oauth_provider" AS ENUM('github', 'dingtalk', 'wechat_work', 'feishu');--> statement-breakpoint
CREATE TYPE "public"."rate_limit_algorithm" AS ENUM('fixed_window', 'sliding_window');--> statement-breakpoint
CREATE TYPE "public"."rate_limit_key_type" AS ENUM('ip', 'user', 'ip_path');--> statement-breakpoint
CREATE TYPE "public"."rate_limit_mode" AS ENUM('enforce', 'monitor');--> statement-breakpoint
CREATE TYPE "public"."identity_provider_status" AS ENUM('enabled', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."identity_provider_sync_status" AS ENUM('success', 'failed', 'partial');--> statement-breakpoint
CREATE TYPE "public"."identity_provider_type" AS ENUM('oidc', 'saml', 'ldap', 'ad');--> statement-breakpoint
CREATE TYPE "public"."directory_sync_conflict_status" AS ENUM('pending', 'resolved', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."directory_sync_run_status" AS ENUM('running', 'success', 'partial', 'failed', 'aborted');--> statement-breakpoint
CREATE TYPE "public"."directory_sync_source_type" AS ENUM('ldap', 'dingtalk', 'wechat_work', 'feishu', 'scim');--> statement-breakpoint
CREATE TYPE "public"."login_event_type" AS ENUM('login', 'logout');--> statement-breakpoint
CREATE TYPE "public"."login_status" AS ENUM('success', 'fail');--> statement-breakpoint
CREATE TYPE "public"."analytics_campaign_channel" AS ENUM('email', 'in_app', 'webhook', 'sms');--> statement-breakpoint
CREATE TYPE "public"."analytics_campaign_status" AS ENUM('draft', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."analytics_device_type" AS ENUM('desktop', 'mobile', 'tablet', 'bot', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."analytics_event_override_status" AS ENUM('enabled', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."analytics_event_quality_issue_type" AS ENUM('missing_required', 'type_mismatch', 'invalid_enum', 'event_disabled', 'origin_rejected', 'quota_exceeded');--> statement-breakpoint
CREATE TYPE "public"."analytics_event_source" AS ENUM('web_admin', 'web_member', 'server');--> statement-breakpoint
CREATE TYPE "public"."analytics_event_status" AS ENUM('active', 'deprecated', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."analytics_experiment_status" AS ENUM('draft', 'running', 'paused', 'completed');--> statement-breakpoint
CREATE TYPE "public"."analytics_identity_type" AS ENUM('admin', 'member', 'anonymous');--> statement-breakpoint
CREATE TYPE "public"."error_alert_condition" AS ENUM('new_error', 'threshold', 'spike');--> statement-breakpoint
CREATE TYPE "public"."error_level" AS ENUM('fatal', 'error', 'warning', 'info');--> statement-breakpoint
CREATE TYPE "public"."error_status" AS ENUM('unresolved', 'resolved', 'ignored', 'muted');--> statement-breakpoint
CREATE TYPE "public"."frontend_error_type" AS ENUM('js_error', 'promise_rejection', 'resource_error', 'console_error', 'http_error', 'white_screen', 'crash');--> statement-breakpoint
CREATE TYPE "public"."replay_mode" AS ENUM('buffer', 'stream');--> statement-breakpoint
CREATE TYPE "public"."replay_status" AS ENUM('recording', 'completed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."user_behavior_event_type" AS ENUM('page_view', 'page_leave', 'feature_use', 'area_click', 'custom', 'perf', 'api_request', 'identify');--> statement-breakpoint
CREATE TYPE "public"."workflow_approve_method" AS ENUM('and', 'or', 'sequential', 'ratio');--> statement-breakpoint
CREATE TYPE "public"."workflow_automation_trigger" AS ENUM('approved', 'rejected', 'withdrawn', 'created');--> statement-breakpoint
CREATE TYPE "public"."workflow_connector_invocation_source" AS ENUM('test', 'trigger', 'external', 'webhook', 'manual');--> statement-breakpoint
CREATE TYPE "public"."workflow_connector_type" AS ENUM('http', 'webhook', 'email', 'sms', 'wecom', 'dingtalk', 'feishu', 'mq', 'database');--> statement-breakpoint
CREATE TYPE "public"."workflow_definition_status" AS ENUM('draft', 'published', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."workflow_event_sign_mode" AS ENUM('hmacSha256', 'none');--> statement-breakpoint
CREATE TYPE "public"."workflow_form_type" AS ENUM('designer', 'custom', 'external');--> statement-breakpoint
CREATE TYPE "public"."workflow_instance_status" AS ENUM('draft', 'running', 'suspended', 'returned', 'approved', 'rejected', 'withdrawn', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workflow_job_execution_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."workflow_job_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'dead', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."workflow_job_type" AS ENUM('delay_wake', 'task_timeout', 'trigger_dispatch', 'external_dispatch', 'subprocess_spawn', 'subprocess_join', 'event_dispatch', 'webhook_delivery', 'compensation_action');--> statement-breakpoint
CREATE TYPE "public"."workflow_node_type" AS ENUM('start', 'approve', 'handler', 'end', 'exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'routeGateway', 'ccNode', 'delay', 'trigger', 'subProcess', 'catchNode');--> statement-breakpoint
CREATE TYPE "public"."workflow_task_consult_status" AS ENUM('pending', 'replied', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."workflow_task_status" AS ENUM('pending', 'approved', 'rejected', 'skipped', 'waiting');--> statement-breakpoint
CREATE TYPE "public"."workflow_task_transfer_action" AS ENUM('transfer', 'delegate', 'reassign', 'handover', 'timeout');--> statement-breakpoint
CREATE TYPE "public"."workflow_token_status" AS ENUM('active', 'consumed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."broadcast_audience" AS ENUM('all_users', 'all_members', 'user_ids', 'member_ids');--> statement-breakpoint
CREATE TYPE "public"."broadcast_status" AS ENUM('draft', 'sending', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."email_encryption" AS ENUM('none', 'ssl', 'tls');--> statement-breakpoint
CREATE TYPE "public"."in_app_message_type" AS ENUM('info', 'success', 'warning', 'error');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('inapp', 'email', 'sms', 'push', 'webhook', 'chat');--> statement-breakpoint
CREATE TYPE "public"."notification_decision" AS ENUM('sent', 'suppressed', 'deferred', 'deduped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."notification_digest_mode" AS ENUM('realtime', 'hourly', 'daily');--> statement-breakpoint
CREATE TYPE "public"."notification_outbox_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."notification_recipient_type" AS ENUM('user', 'member', 'external');--> statement-breakpoint
CREATE TYPE "public"."send_source" AS ENUM('manual', 'test', 'system', 'api');--> statement-breakpoint
CREATE TYPE "public"."send_status" AS ENUM('pending', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sms_provider" AS ENUM('aliyun', 'tencent');--> statement-breakpoint
CREATE TYPE "public"."backup_status" AS ENUM('pending', 'running', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."backup_type" AS ENUM('pg_dump', 'drizzle_export');--> statement-breakpoint
CREATE TYPE "public"."rule_hit_policy" AS ENUM('first', 'unique', 'priority', 'collect', 'any');--> statement-breakpoint
CREATE TYPE "public"."biz_leave_status" AS ENUM('draft', 'pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."biz_pay_demo_status" AS ENUM('pending', 'paying', 'paid', 'closed');--> statement-breakpoint
CREATE TYPE "public"."chat_conversation_type" AS ENUM('direct', 'group');--> statement-breakpoint
CREATE TYPE "public"."chat_join_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."chat_member_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."chat_message_type" AS ENUM('text', 'image', 'file', 'system', 'forward', 'vote', 'voice', 'card', 'video');--> statement-breakpoint
CREATE TYPE "public"."chat_scheduled_status" AS ENUM('pending', 'sent', 'canceled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."channel_audience" AS ENUM('broadcast', 'targeted');--> statement-breakpoint
CREATE TYPE "public"."channel_auto_reply_keyword_mode" AS ENUM('exact', 'contains');--> statement-breakpoint
CREATE TYPE "public"."channel_auto_reply_match" AS ENUM('subscribe', 'keyword', 'default');--> statement-breakpoint
CREATE TYPE "public"."channel_conversation_status" AS ENUM('open', 'processing', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."channel_menu_type" AS ENUM('click', 'view');--> statement-breakpoint
CREATE TYPE "public"."channel_message_direction" AS ENUM('out', 'in');--> statement-breakpoint
CREATE TYPE "public"."channel_message_status" AS ENUM('sent', 'draft', 'scheduled');--> statement-breakpoint
CREATE TYPE "public"."channel_message_type" AS ENUM('text', 'card', 'image', 'news');--> statement-breakpoint
CREATE TYPE "public"."channel_type" AS ENUM('system', 'business');--> statement-breakpoint
CREATE TYPE "public"."payment_cashier_session_status" AS ENUM('ready', 'creating', 'awaiting', 'processing', 'unknown', 'succeeded', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."payment_cashier_use_slot_status" AS ENUM('none', 'reserved', 'consumed', 'released');--> statement-breakpoint
CREATE TYPE "public"."payment_channel" AS ENUM('wechat', 'alipay', 'unionpay');--> statement-breakpoint
CREATE TYPE "public"."payment_contract_operation" AS ENUM('sign', 'terminate');--> statement-breakpoint
CREATE TYPE "public"."payment_contract_status" AS ENUM('pending', 'unknown', 'signed', 'paused', 'terminated', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_deduct_period" AS ENUM('daily', 'weekly', 'monthly', 'custom');--> statement-breakpoint
CREATE TYPE "public"."payment_dispute_reply_author" AS ENUM('merchant', 'user', 'system');--> statement-breakpoint
CREATE TYPE "public"."payment_dispute_status" AS ENUM('pending', 'processing', 'resolved', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payment_dispute_type" AS ENUM('refund_request', 'service_issue', 'fraud_report', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_event_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_fund_reservation_status" AS ENUM('active', 'captured', 'released', 'expired');--> statement-breakpoint
CREATE TYPE "public"."payment_ledger_account_code" AS ENUM('provider_clearing', 'merchant_pending', 'merchant_available', 'merchant_frozen', 'platform_fee', 'refund_payable', 'sharing_payable', 'payout_payable', 'suspense');--> statement-breakpoint
CREATE TYPE "public"."payment_ledger_normal_balance" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."payment_link_status" AS ENUM('active', 'disabled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('wechat_native', 'wechat_jsapi', 'wechat_h5', 'alipay_page', 'alipay_wap', 'alipay_app', 'unionpay_qr', 'wechat_papay', 'alipay_cycle', 'wechat_preauth', 'alipay_preauth');--> statement-breakpoint
CREATE TYPE "public"."payment_order_status" AS ENUM('pending', 'paying', 'unknown', 'success', 'closed', 'refunding', 'refunded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_preauth_operation" AS ENUM('freeze', 'capture', 'release');--> statement-breakpoint
CREATE TYPE "public"."payment_preauth_status" AS ENUM('pending', 'unknown', 'frozen', 'captured', 'released', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_recon_handle_status" AS ENUM('pending', 'adjusted', 'suspended', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."payment_recon_result" AS ENUM('matched', 'local_only', 'channel_only', 'amount_diff', 'status_diff');--> statement-breakpoint
CREATE TYPE "public"."payment_recon_source" AS ENUM('manual_upload', 'sandbox_generated', 'provider_download');--> statement-breakpoint
CREATE TYPE "public"."payment_recon_status" AS ENUM('pending', 'comparing', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_refund_approval_status" AS ENUM('none', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."payment_refund_status" AS ENUM('pending', 'processing', 'unknown', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_risk_action" AS ENUM('block', 'review');--> statement-breakpoint
CREATE TYPE "public"."payment_risk_dimension" AS ENUM('blocklist', 'single_limit', 'daily_limit', 'daily_count', 'decision');--> statement-breakpoint
CREATE TYPE "public"."payment_risk_review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."payment_risk_scope" AS ENUM('global', 'channel', 'bizType');--> statement-breakpoint
CREATE TYPE "public"."payment_settlement_status" AS ENUM('pending', 'settling', 'settled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_sharing_order_status" AS ENUM('pending', 'processing', 'success', 'failed', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."payment_sharing_receiver_type" AS ENUM('merchant', 'personal');--> statement-breakpoint
CREATE TYPE "public"."payment_sharing_reversal_status" AS ENUM('processing', 'unknown', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_transfer_approval_status" AS ENUM('none', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."payment_transfer_status" AS ENUM('pending', 'processing', 'unknown', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ai_feedback_status" AS ENUM('pending', 'resolved', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."ai_message_role" AS ENUM('system', 'user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."ai_prompt_scope" AS ENUM('system', 'user');--> statement-breakpoint
CREATE TYPE "public"."app_webhook_delivery_status" AS ENUM('pending', 'success', 'failed', 'retrying');--> statement-breakpoint
CREATE TYPE "public"."app_webhook_sign_mode" AS ENUM('hmacSha256', 'none');--> statement-breakpoint
CREATE TYPE "public"."open_app_environment" AS ENUM('production', 'sandbox');--> statement-breakpoint
CREATE TYPE "public"."open_app_review_status" AS ENUM('draft', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."ssh_auth_type" AS ENUM('password', 'key_path', 'key_content', 'agent');--> statement-breakpoint
CREATE TYPE "public"."terminal_session_kind" AS ENUM('local', 'ssh', 'docker', 'db');--> statement-breakpoint
CREATE TYPE "public"."terminal_session_state" AS ENUM('active', 'detached', 'terminated', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ops_host_auth_type" AS ENUM('password', 'key_content');--> statement-breakpoint
CREATE TYPE "public"."ops_host_status" AS ENUM('unknown', 'online', 'offline');--> statement-breakpoint
CREATE TYPE "public"."checkin_milestone_reward_type" AS ENUM('points', 'coupon');--> statement-breakpoint
CREATE TYPE "public"."coupon_template_status" AS ENUM('draft', 'active', 'paused', 'expired');--> statement-breakpoint
CREATE TYPE "public"."coupon_type" AS ENUM('amount', 'percent');--> statement-breakpoint
CREATE TYPE "public"."coupon_valid_type" AS ENUM('fixed', 'relative');--> statement-breakpoint
CREATE TYPE "public"."member_coupon_status" AS ENUM('unused', 'used', 'expired', 'frozen');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('active', 'inactive', 'banned');--> statement-breakpoint
CREATE TYPE "public"."point_tx_type" AS ENUM('earn', 'redeem', 'expire', 'adjust', 'refund');--> statement-breakpoint
CREATE TYPE "public"."wallet_tx_type" AS ENUM('recharge', 'consume', 'refund', 'adjust');--> statement-breakpoint
CREATE TYPE "public"."monitor_alert_event_status" AS ENUM('firing', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."monitor_alert_handle_status" AS ENUM('pending', 'acknowledged', 'closed');--> statement-breakpoint
CREATE TYPE "public"."monitor_alert_level" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."monitor_alert_notify_status" AS ENUM('skipped', 'success', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."monitor_alert_operator" AS ENUM('gt', 'gte', 'lt', 'lte');--> statement-breakpoint
CREATE TYPE "public"."monitor_alert_state" AS ENUM('ok', 'firing');--> statement-breakpoint
CREATE TYPE "public"."monitor_metric" AS ENUM('cpu', 'memory', 'disk', 'swap', 'load1', 'procCpu', 'heap', 'loopLag', 'qps', 'errorRate', 'netRxBps', 'netTxBps', 'diskReadBps', 'diskWriteBps', 'logErrorPerMin', 'logWarnPerMin', 'workflowHealth', 'workflowBacklog', 'workflowDeadLetter', 'workflowFailureRate', 'workflowStuckRunning', 'paymentFailureRate', 'paymentStuckPaying', 'paymentReconDiff', 'paymentEventBacklog', 'paymentWebhookFailureRate', 'openApiErrorRate', 'openApiAppErrorRate', 'openWebhookFailureRate', 'openWebhookDisabledSubs', 'replayStorageMb');--> statement-breakpoint
CREATE TYPE "public"."ssl_cert_status" AS ENUM('valid', 'expiring', 'expired', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."ssl_cert_type" AS ENUM('self_signed', 'uploaded', 'letsencrypt');--> statement-breakpoint
CREATE TYPE "public"."app_arch" AS ENUM('x64', 'arm64', 'universal');--> statement-breakpoint
CREATE TYPE "public"."app_artifact_kind" AS ENUM('installer', 'hotupdate', 'metadata', 'external');--> statement-breakpoint
CREATE TYPE "public"."app_platform" AS ENUM('windows', 'macos', 'linux', 'android', 'ios', 'web');--> statement-breakpoint
CREATE TYPE "public"."app_release_channel" AS ENUM('stable', 'beta', 'internal');--> statement-breakpoint
CREATE TYPE "public"."app_release_event_type" AS ENUM('check', 'download', 'install_success', 'install_fail');--> statement-breakpoint
CREATE TYPE "public"."app_release_status" AS ENUM('draft', 'published', 'revoked');--> statement-breakpoint
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
CREATE TYPE "public"."report_dashboard_lifecycle_status" AS ENUM('draft', 'published', 'offline');--> statement-breakpoint
CREATE TYPE "public"."report_dashboard_version_source" AS ENUM('manual', 'publish', 'restore_backup');--> statement-breakpoint
CREATE TYPE "public"."report_datasource_type" AS ENUM('api', 'sql', 'mysql', 'postgresql', 'sqlserver', 'static');--> statement-breakpoint
CREATE TYPE "public"."report_delivery_status" AS ENUM('pending', 'running', 'success', 'partial', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."report_delivery_target_type" AS ENUM('subscription', 'alert', 'sla');--> statement-breakpoint
CREATE TYPE "public"."report_delivery_trigger_type" AS ENUM('manual', 'scheduled', 'trigger', 'recover');--> statement-breakpoint
CREATE TYPE "public"."report_resource_type" AS ENUM('datasource', 'dataset', 'dashboard', 'metric', 'print_template', 'fill_template', 'asset_template');--> statement-breakpoint
CREATE TYPE "public"."report_schedule_misfire_policy" AS ENUM('skip', 'fire_once');--> statement-breakpoint
CREATE TYPE "public"."report_acl_role" AS ENUM('viewer', 'editor', 'owner');--> statement-breakpoint
CREATE TYPE "public"."report_acl_subject_type" AS ENUM('user', 'role', 'department', 'user_group');--> statement-breakpoint
CREATE TYPE "public"."report_approval_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."report_asset_template_type" AS ENUM('dashboard', 'widget', 'print', 'semantic_model');--> statement-breakpoint
CREATE TYPE "public"."report_chatbi_message_role" AS ENUM('user', 'assistant', 'system', 'tool');--> statement-breakpoint
CREATE TYPE "public"."report_chatbi_session_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."report_dq_anomaly_status" AS ENUM('open', 'acknowledged', 'resolved', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."report_dq_rule_type" AS ENUM('not_null', 'uniqueness', 'range', 'pattern', 'freshness', 'row_count', 'custom_sql');--> statement-breakpoint
CREATE TYPE "public"."report_dq_run_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."report_dq_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."report_environment_kind" AS ENUM('development', 'testing', 'staging', 'production');--> statement-breakpoint
CREATE TYPE "public"."report_fill_record_status" AS ENUM('draft', 'submitted', 'in_review', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."report_fill_sync_status" AS ENUM('pending', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."report_fill_template_status" AS ENUM('draft', 'published', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."report_materialization_strategy" AS ENUM('full', 'incremental');--> statement-breakpoint
CREATE TYPE "public"."report_metric_lifecycle_status" AS ENUM('draft', 'published', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."report_metric_type" AS ENUM('simple', 'ratio', 'composite');--> statement-breakpoint
CREATE TYPE "public"."report_promotion_status" AS ENUM('pending', 'approved', 'deploying', 'succeeded', 'failed', 'cancelled', 'rolled_back');--> statement-breakpoint
CREATE TYPE "public"."report_quota_scope" AS ENUM('tenant', 'user');--> statement-breakpoint
CREATE TYPE "public"."report_sla_type" AS ENUM('freshness', 'query_latency_p95', 'availability', 'dq_score');--> statement-breakpoint
CREATE TYPE "public"."report_sla_violation_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."report_snapshot_status" AS ENUM('pending', 'building', 'ready', 'failed', 'expired', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."report_transfer_status" AS ENUM('pending', 'accepted', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."cms_ad_event_type" AS ENUM('impression', 'click');--> statement-breakpoint
CREATE TYPE "public"."cms_channel_detail_path_rule" AS ENUM('none', 'year', 'month', 'date', 'dateStr', 'idHash');--> statement-breakpoint
CREATE TYPE "public"."cms_channel_static_mode" AS ENUM('inherit', 'dynamic', 'hybrid', 'static');--> statement-breakpoint
CREATE TYPE "public"."cms_channel_type" AS ENUM('list', 'page', 'link');--> statement-breakpoint
CREATE TYPE "public"."cms_collect_item_status" AS ENUM('success', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."cms_comment_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."cms_content_status" AS ENUM('draft', 'pending', 'published', 'offline', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."cms_content_type" AS ENUM('article', 'album', 'media', 'link');--> statement-breakpoint
CREATE TYPE "public"."cms_device_type" AS ENUM('pc', 'mobile', 'bot');--> statement-breakpoint
CREATE TYPE "public"."cms_distribution_conflict_strategy" AS ENUM('skip', 'overwrite', 'create-new');--> statement-breakpoint
CREATE TYPE "public"."cms_distribution_mode" AS ENUM('copy', 'mapping', 'scheduled');--> statement-breakpoint
CREATE TYPE "public"."cms_field_option_source" AS ENUM('manual', 'dict');--> statement-breakpoint
CREATE TYPE "public"."cms_field_type" AS ENUM('text', 'textarea', 'richtext', 'number', 'date', 'datetime', 'image', 'file', 'select', 'radio', 'checkbox', 'switch');--> statement-breakpoint
CREATE TYPE "public"."cms_form_captcha_provider" AS ENUM('inherit', 'none', 'math', 'turnstile');--> statement-breakpoint
CREATE TYPE "public"."cms_interaction_captcha_policy" AS ENUM('inherit', 'none', 'math', 'turnstile');--> statement-breakpoint
CREATE TYPE "public"."cms_interaction_kind" AS ENUM('survey', 'poll');--> statement-breakpoint
CREATE TYPE "public"."cms_interaction_participant_scope" AS ENUM('anonymous', 'member');--> statement-breakpoint
CREATE TYPE "public"."cms_interaction_question_type" AS ENUM('single', 'multiple', 'text', 'rating', 'nps', 'matrix', 'date', 'number');--> statement-breakpoint
CREATE TYPE "public"."cms_interaction_repeat_policy" AS ENUM('once_per_member', 'once_per_ip', 'multiple');--> statement-breakpoint
CREATE TYPE "public"."cms_interaction_result_visibility" AS ENUM('always', 'after_submit', 'after_close', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."cms_interaction_status" AS ENUM('draft', 'published', 'closed');--> statement-breakpoint
CREATE TYPE "public"."cms_page_block_acl_subject_type" AS ENUM('user', 'role');--> statement-breakpoint
CREATE TYPE "public"."cms_publish_artifact_status" AS ENUM('generated', 'deleted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."cms_publish_target_type" AS ENUM('content', 'contents', 'channel', 'site', 'theme', 'page');--> statement-breakpoint
CREATE TYPE "public"."cms_resource_owner_type" AS ENUM('site', 'content', 'contentVersion', 'channel', 'friendLink', 'ad', 'page', 'widget', 'form');--> statement-breakpoint
CREATE TYPE "public"."cms_resource_type" AS ENUM('image', 'video', 'audio', 'document', 'other');--> statement-breakpoint
CREATE TYPE "public"."cms_search_word_type" AS ENUM('extension', 'stop');--> statement-breakpoint
CREATE TYPE "public"."cms_static_mode" AS ENUM('dynamic', 'hybrid', 'static');--> statement-breakpoint
CREATE TYPE "public"."cms_subscription_subject_type" AS ENUM('site', 'channel', 'author');--> statement-breakpoint
CREATE TYPE "public"."cms_widget_ref_owner_type" AS ENUM('page', 'theme_slot');--> statement-breakpoint
CREATE TYPE "public"."cms_widget_source_type" AS ENUM('content', 'channel');--> statement-breakpoint
CREATE TYPE "public"."cms_widget_status" AS ENUM('draft', 'published', 'offline');--> statement-breakpoint
CREATE TYPE "public"."cms_widget_type" AS ENUM('manual-list');--> statement-breakpoint
CREATE TYPE "public"."wiki_comment_status" AS ENUM('visible', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."wiki_doc_status" AS ENUM('draft', 'pending', 'published', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."wiki_review_action" AS ENUM('submit', 'approve', 'reject', 'withdraw');--> statement-breakpoint
CREATE TYPE "public"."wiki_space_member_role" AS ENUM('owner', 'admin', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."wiki_space_visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TYPE "public"."short_link_redirect_type" AS ENUM('302', '301');--> statement-breakpoint
CREATE TYPE "public"."marketing_campaign_status" AS ENUM('draft', 'published', 'ended');--> statement-breakpoint
CREATE TYPE "public"."marketing_campaign_type" AS ENUM('lottery');--> statement-breakpoint
CREATE TYPE "public"."marketing_grant_status" AS ENUM('none', 'granted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."marketing_prize_type" AS ENUM('points', 'coupon', 'physical', 'none');--> statement-breakpoint
CREATE TYPE "public"."iot_access_mode" AS ENUM('r', 'rw');--> statement-breakpoint
CREATE TYPE "public"."iot_alarm_level" AS ENUM('warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."iot_alarm_rule_type" AS ENUM('threshold', 'offline', 'event');--> statement-breakpoint
CREATE TYPE "public"."iot_alarm_status" AS ENUM('firing', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."iot_automation_trigger" AS ENUM('property', 'event', 'online', 'offline');--> statement-breakpoint
CREATE TYPE "public"."iot_command_status" AS ENUM('pending', 'delivered', 'acked', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."iot_compare_op" AS ENUM('gt', 'gte', 'lt', 'lte', 'eq', 'neq');--> statement-breakpoint
CREATE TYPE "public"."iot_device_event_kind" AS ENUM('lifecycle', 'model', 'anomaly');--> statement-breakpoint
CREATE TYPE "public"."iot_event_level" AS ENUM('info', 'warn', 'fault');--> statement-breakpoint
CREATE TYPE "public"."iot_forward_source" AS ENUM('telemetry', 'event', 'alarm', 'lifecycle');--> statement-breakpoint
CREATE TYPE "public"."iot_forward_status" AS ENUM('succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."iot_log_level" AS ENUM('debug', 'info', 'warn', 'error');--> statement-breakpoint
CREATE TYPE "public"."iot_node_type" AS ENUM('direct', 'gateway', 'sub');--> statement-breakpoint
CREATE TYPE "public"."iot_ota_device_status" AS ENUM('pending', 'notified', 'downloading', 'installing', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."iot_ota_task_status" AS ENUM('running', 'paused', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."iot_property_type" AS ENUM('number', 'string', 'boolean', 'enum');--> statement-breakpoint
CREATE TYPE "public"."iot_schedule_action" AS ENUM('command', 'desired');--> statement-breakpoint
CREATE TYPE "public"."iot_schedule_type" AS ENUM('cron', 'once');--> statement-breakpoint
CREATE TYPE "public"."iot_validation_mode" AS ENUM('loose', 'strict');--> statement-breakpoint
CREATE TYPE "public"."drive_activity_action" AS ENUM('upload', 'new_version', 'create_folder', 'rename', 'move', 'copy', 'delete', 'restore', 'purge', 'download', 'preview', 'share_create', 'share_update', 'share_revoke', 'share_access', 'save_from_share', 'permission_change', 'inherit_change', 'version_restore', 'version_delete', 'lock', 'unlock', 'comment', 'tag');--> statement-breakpoint
CREATE TYPE "public"."drive_node_type" AS ENUM('folder', 'file');--> statement-breakpoint
CREATE TYPE "public"."drive_role" AS ENUM('viewer', 'downloader', 'editor', 'manager');--> statement-breakpoint
CREATE TYPE "public"."drive_share_permission" AS ENUM('preview', 'download');--> statement-breakpoint
CREATE TYPE "public"."drive_space_type" AS ENUM('personal', 'department', 'team');--> statement-breakpoint
CREATE TYPE "public"."drive_subject_type" AS ENUM('user', 'department', 'role', 'user_group');--> statement-breakpoint
CREATE TYPE "public"."drive_upload_conflict_policy" AS ENUM('rename', 'version', 'fail');--> statement-breakpoint
CREATE TABLE "departments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "departments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "menus_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"embed" boolean DEFAULT false NOT NULL,
	"keep_alive" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"feature_key" varchar(50),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "positions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "roles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
CREATE TABLE "tenant_package_features" (
	"package_id" integer NOT NULL,
	"feature_key" varchar(50) NOT NULL,
	CONSTRAINT "tenant_package_features_package_id_feature_key_pk" PRIMARY KEY("package_id","feature_key")
);
--> statement-breakpoint
CREATE TABLE "tenant_packages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tenant_packages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(100) NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"quotas" jsonb,
	"remark" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_packages_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tenants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
CREATE TABLE "user_group_roles" (
	"group_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	CONSTRAINT "user_group_roles_group_id_role_id_pk" PRIMARY KEY("group_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "user_groups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_groups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(64) NOT NULL,
	"code" varchar(64) NOT NULL,
	"description" varchar(256),
	"owner_id" integer,
	"member_mode" varchar(10) DEFAULT 'static' NOT NULL,
	"member_rule" jsonb,
	"rule_synced_at" timestamp,
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"username" varchar(32) NOT NULL,
	"nickname" varchar(32) NOT NULL,
	"email" varchar(128),
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
	CONSTRAINT "users_tenant_email_unique" UNIQUE("tenant_id","email"),
	CONSTRAINT "users_tenant_phone_unique" UNIQUE("tenant_id","phone")
);
--> statement-breakpoint
CREATE TABLE "license_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "license_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"license_id" integer,
	"type" varchar(40) NOT NULL,
	"detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "licenses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "licenses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"license_id" varchar(64) NOT NULL,
	"envelope" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"key_id" varchar(32) NOT NULL,
	"edition" varchar(20) NOT NULL,
	"customer_name" varchar(200) NOT NULL,
	"features" jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"grace_until" timestamp NOT NULL,
	"activated_at" timestamp DEFAULT now() NOT NULL,
	"activated_by" integer,
	"last_verified_at" timestamp,
	"invalid_reason" text,
	"replaced_by_id" integer,
	CONSTRAINT "licenses_license_id_unique" UNIQUE("license_id")
);
--> statement-breakpoint
CREATE TABLE "system_installations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "system_installations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"installation_id" varchar(64) NOT NULL,
	"license_epoch" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "system_installations_installation_id_unique" UNIQUE("installation_id")
);
--> statement-breakpoint
CREATE TABLE "business_files" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "business_files_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "file_storage_configs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(64) NOT NULL,
	"provider" "file_storage_provider" DEFAULT 'local' NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"base_path" varchar(256),
	"object_acl" "file_object_acl" DEFAULT 'default' NOT NULL,
	"url_strategy" "file_url_strategy" DEFAULT 'proxy' NOT NULL,
	"public_base_url" varchar(512),
	"presigned_expiry_seconds" integer DEFAULT 1800 NOT NULL,
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
	"size" bigint DEFAULT 0 NOT NULL,
	"mime_type" varchar(128),
	"extension" varchar(32),
	"object_acl" "file_object_acl",
	"visibility" "file_visibility" DEFAULT 'public' NOT NULL,
	"content_hash" varchar(64),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_chunks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "upload_chunks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"upload_session_id" integer NOT NULL,
	"index" integer NOT NULL,
	"size" integer NOT NULL,
	"etag" varchar(256),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_upload_chunk" UNIQUE("upload_session_id","index")
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "upload_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"object_acl" "file_object_acl",
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "data_mask_configs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "async_task_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "async_tasks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"trace_id" varchar(64),
	"parent_ref" varchar(32),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_job_downloads" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "export_job_downloads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"job_id" integer NOT NULL,
	"downloaded_by" integer,
	"tenant_id" integer,
	"ip" varchar(64),
	"user_agent" varchar(512),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "export_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cron_job_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cron_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "maintenance_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "maintenance_mode_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"enabled" boolean DEFAULT false NOT NULL,
	"message" varchar(512) DEFAULT '系统维护中，请稍后重试' NOT NULL,
	"estimated_end_at" timestamp,
	"started_at" timestamp,
	"started_by_name" varchar(64),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "regions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
CREATE TABLE "retention_policies" (
	"policy_key" varchar(128) PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"retention_days" integer NOT NULL,
	"batch_size" integer DEFAULT 5000 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_deleted" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_runtime_state" (
	"key" varchar(128) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "system_scheduler_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
CREATE TABLE "system_settings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "system_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"module" varchar(64) NOT NULL,
	"tenant_id" integer,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "system_settings_module_tenant_unique" UNIQUE NULLS NOT DISTINCT("module","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "user_feedbacks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_feedbacks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"score" integer,
	"category" "user_feedback_category" DEFAULT 'suggestion' NOT NULL,
	"content" varchar(1000),
	"page_path" varchar(200),
	"replay_id" varchar(36),
	"status" "user_feedback_status" DEFAULT 'pending' NOT NULL,
	"handle_remark" varchar(500),
	"handled_by" integer,
	"handled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_risk_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "login_risk_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "oauth_configs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"provider" "oauth_provider" NOT NULL,
	"client_id" varchar(256) DEFAULT '' NOT NULL,
	"client_secret" varchar(512) DEFAULT '' NOT NULL,
	"agent_id" varchar(128),
	"corp_id" varchar(128),
	"enabled" boolean DEFAULT false NOT NULL,
	"auto_link_by_email" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_configs_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "password_reset_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"token" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "rate_limit_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rate_limit_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(64) NOT NULL,
	"description" varchar(255),
	"window_ms" integer NOT NULL,
	"limit" integer NOT NULL,
	"key_type" "rate_limit_key_type" DEFAULT 'ip' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"mode" "rate_limit_mode" DEFAULT 'enforce' NOT NULL,
	"algorithm" "rate_limit_algorithm" DEFAULT 'fixed_window' NOT NULL,
	"allowlist" text[] DEFAULT '{}' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"alert_threshold" integer,
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_api_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"name" varchar(64) NOT NULL,
	"token_hash" varchar(64),
	"token_prefix" varchar(20),
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user_mfa_factors" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_mfa_factors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_oauth_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_trusted_devices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "identity_provider_sync_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tenant_identity_providers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"auto_link_by_email" boolean DEFAULT false NOT NULL,
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_identity_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
CREATE TABLE "directory_sync_conflicts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "directory_sync_conflicts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_id" integer NOT NULL,
	"run_id" integer,
	"entity_type" varchar(16) NOT NULL,
	"external_id" varchar(256) NOT NULL,
	"name" varchar(128),
	"conflict_type" varchar(32) NOT NULL,
	"source_data" jsonb,
	"local_data" jsonb,
	"candidate_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "directory_sync_conflict_status" DEFAULT 'pending' NOT NULL,
	"resolution" varchar(16),
	"resolved_by" integer,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directory_sync_dept_links" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "directory_sync_dept_links_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_id" integer NOT NULL,
	"external_id" varchar(256) NOT NULL,
	"department_id" integer NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "directory_sync_dept_links_source_external_unique" UNIQUE("source_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "directory_sync_run_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "directory_sync_run_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"run_id" integer NOT NULL,
	"entity_type" varchar(16) NOT NULL,
	"external_id" varchar(256) NOT NULL,
	"name" varchar(128),
	"action" varchar(16) NOT NULL,
	"applied" boolean DEFAULT false NOT NULL,
	"diff" jsonb,
	"message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directory_sync_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "directory_sync_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_id" integer NOT NULL,
	"trigger_type" varchar(16) DEFAULT 'manual' NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"status" "directory_sync_run_status" DEFAULT 'running' NOT NULL,
	"total_fetched" integer DEFAULT 0 NOT NULL,
	"dept_created" integer DEFAULT 0 NOT NULL,
	"dept_updated" integer DEFAULT 0 NOT NULL,
	"user_created" integer DEFAULT 0 NOT NULL,
	"user_linked" integer DEFAULT 0 NOT NULL,
	"user_updated" integer DEFAULT 0 NOT NULL,
	"user_disabled" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"conflict_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"message" text,
	"error_message" text,
	"triggered_by" integer,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directory_sync_sources" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "directory_sync_sources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(100) NOT NULL,
	"type" "directory_sync_source_type" NOT NULL,
	"status" "status" DEFAULT 'disabled' NOT NULL,
	"tenant_id" integer,
	"identity_provider_id" integer,
	"oauth_provider" varchar(32),
	"contact_secret" text,
	"callback_token" text,
	"callback_aes_key" text,
	"callback_url_key" varchar(64),
	"pending_callback_sync" boolean DEFAULT false NOT NULL,
	"callback_last_event_at" timestamp with time zone,
	"match_key" varchar(16) DEFAULT 'phone' NOT NULL,
	"field_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scope_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"conflict_policy" varchar(16) DEFAULT 'suspend' NOT NULL,
	"lifecycle" jsonb DEFAULT '{"disableOnLeave":true,"kickSessions":true,"defaultRoleIds":[]}'::jsonb NOT NULL,
	"sync_departments" boolean DEFAULT true NOT NULL,
	"cron_expression" varchar(64),
	"circuit_breaker_percent" integer DEFAULT 30 NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_run_status" "directory_sync_run_status",
	"remark" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "directory_sync_sources_tenant_name_unique" UNIQUE("tenant_id","name"),
	CONSTRAINT "directory_sync_sources_callback_key_unique" UNIQUE("callback_url_key")
);
--> statement-breakpoint
CREATE TABLE "directory_sync_user_links" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "directory_sync_user_links_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_id" integer NOT NULL,
	"external_id" varchar(256) NOT NULL,
	"user_id" integer NOT NULL,
	"external_data" jsonb,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "directory_sync_user_links_source_external_unique" UNIQUE("source_id","external_id"),
	CONSTRAINT "directory_sync_user_links_source_user_unique" UNIQUE("source_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "dict_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dict_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dicts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ip_access_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ip" varchar(64) NOT NULL,
	"path" varchar(256) NOT NULL,
	"method" varchar(16) NOT NULL,
	"block_type" varchar(16) NOT NULL,
	"user_agent" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "login_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "operation_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analytics_daily_rollup_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analytics_event_meta_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"version" integer DEFAULT 1 NOT NULL,
	"owner_id" integer,
	"owner_name" varchar(64),
	"strict_mode" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_event_overrides" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analytics_event_overrides_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer NOT NULL,
	"event_name" varchar(128) NOT NULL,
	"status" "analytics_event_override_status" DEFAULT 'enabled' NOT NULL,
	"reason" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_event_quality_daily" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analytics_event_quality_daily_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer DEFAULT 0 NOT NULL,
	"stat_date" date NOT NULL,
	"event_name" varchar(128) NOT NULL,
	"issue_type" "analytics_event_quality_issue_type" NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	"sample" jsonb,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_experiments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analytics_experiments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"exp_key" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(500),
	"status" "analytics_experiment_status" DEFAULT 'draft' NOT NULL,
	"traffic_allocation" integer DEFAULT 100 NOT NULL,
	"variants" jsonb NOT NULL,
	"metric_event_name" varchar(128) NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_identity_map" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analytics_identity_map_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"anonymous_id" varchar(64) NOT NULL,
	"distinct_id" varchar(64) NOT NULL,
	"identity_type" "analytics_identity_type" NOT NULL,
	"user_id" integer,
	"member_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_saved_reports" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analytics_saved_reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"name" varchar(128) NOT NULL,
	"report_type" varchar(32) DEFAULT 'funnel' NOT NULL,
	"config" jsonb NOT NULL,
	"created_by" integer,
	"created_by_name" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_segment_campaigns" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analytics_segment_campaigns_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"segment_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"channel" "analytics_campaign_channel" NOT NULL,
	"template_id" integer,
	"webhook_url" varchar(500),
	"landing_url" varchar(2048),
	"status" "analytics_campaign_status" DEFAULT 'draft' NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" varchar(500),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_segment_members" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analytics_segment_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"segment_id" integer NOT NULL,
	"tenant_id" integer,
	"distinct_id" varchar(64) NOT NULL,
	"identity_type" "analytics_identity_type" DEFAULT 'anonymous' NOT NULL,
	"user_id" integer,
	"member_id" integer,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_sessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analytics_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"source" "analytics_event_source" DEFAULT 'web_admin' NOT NULL,
	"app_id" varchar(64) DEFAULT 'admin' NOT NULL,
	"environment" varchar(32) DEFAULT 'production' NOT NULL,
	"member_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_settings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analytics_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"anonymize_ip" boolean DEFAULT false NOT NULL,
	"blacklist_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_ignore_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retention_days" integer DEFAULT 180 NOT NULL,
	"error_retention_days" integer DEFAULT 90 NOT NULL,
	"session_timeout_minutes" integer DEFAULT 30 NOT NULL,
	"track_replay" boolean DEFAULT false NOT NULL,
	"replay_session_sample_rate" real DEFAULT 0 NOT NULL,
	"replay_on_error" boolean DEFAULT true NOT NULL,
	"replay_mask_all_text" boolean DEFAULT false NOT NULL,
	"replay_block_selector" varchar(256) DEFAULT '' NOT NULL,
	"replay_retention_days" integer DEFAULT 30 NOT NULL,
	"replay_storage_quota_mb" integer DEFAULT 4096 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_sites" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analytics_sites_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"site_key" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"app_id" varchar(50) NOT NULL,
	"allowed_origins" jsonb,
	"daily_event_quota" integer,
	"status" "analytics_event_override_status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(500),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_user_profiles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analytics_user_profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"distinct_id" varchar(64) NOT NULL,
	"identity_type" "analytics_identity_type" DEFAULT 'anonymous' NOT NULL,
	"user_id" integer,
	"member_id" integer,
	"display_name" varchar(64),
	"properties" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_user_segments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analytics_user_segments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"name" varchar(128) NOT NULL,
	"description" text,
	"rules" jsonb NOT NULL,
	"status" "analytics_event_override_status" DEFAULT 'enabled' NOT NULL,
	"estimated_size" integer DEFAULT 0 NOT NULL,
	"snapshot_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_alert_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "error_alert_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"rule_id" integer,
	"rule_name" varchar(128) NOT NULL,
	"condition" "error_alert_condition" NOT NULL,
	"detail" text NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" varchar(16) DEFAULT 'cron' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_alert_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "error_alert_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "error_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"source" "analytics_event_source" DEFAULT 'web_admin' NOT NULL,
	"app_id" varchar(64) DEFAULT 'admin' NOT NULL,
	"environment" varchar(32) DEFAULT 'production' NOT NULL,
	"member_id" integer,
	"replay_id" varchar(36),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_group_identities" (
	"group_id" integer NOT NULL,
	"identity" varchar(80) NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "error_group_identities_group_id_identity_pk" PRIMARY KEY("group_id","identity")
);
--> statement-breakpoint
CREATE TABLE "error_groups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "error_groups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"environment" varchar(32) DEFAULT 'production' NOT NULL,
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
CREATE TABLE "replay_access_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "replay_access_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"replay_id" varchar(36) NOT NULL,
	"replay_owner" varchar(64),
	"user_id" integer NOT NULL,
	"username" varchar(64),
	"action" varchar(16) DEFAULT 'view' NOT NULL,
	"ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replay_click_points" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "replay_click_points_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"page_path" varchar(256) NOT NULL,
	"x_pct" smallint NOT NULL,
	"y_pct" smallint NOT NULL,
	"source" "analytics_event_source" DEFAULT 'web_admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replay_segments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "replay_segments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"replay_id" varchar(36) NOT NULL,
	"seq" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"from_ts" timestamp with time zone NOT NULL,
	"to_ts" timestamp with time zone NOT NULL,
	"byte_size" integer NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"has_full_snapshot" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replay_sessions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"session_id" varchar(36) NOT NULL,
	"mode" "replay_mode" NOT NULL,
	"status" "replay_status" DEFAULT 'recording' NOT NULL,
	"triggers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"segment_count" integer DEFAULT 0 NOT NULL,
	"total_bytes" bigint DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"page_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"click_labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"entry_page_url" varchar(512),
	"source" "analytics_event_source" DEFAULT 'web_admin' NOT NULL,
	"app_id" varchar(64) DEFAULT 'admin' NOT NULL,
	"environment" varchar(32) DEFAULT 'production' NOT NULL,
	"user_id" integer,
	"username" varchar(64),
	"member_id" integer,
	"browser" varchar(48),
	"os" varchar(48),
	"device_type" "analytics_device_type",
	"sdk_version" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_maps" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "source_maps_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" uuid,
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
	"source" "analytics_event_source" DEFAULT 'web_admin' NOT NULL,
	"app_id" varchar(64) DEFAULT 'admin' NOT NULL,
	"environment" varchar(32) DEFAULT 'production' NOT NULL,
	"sdk_version" varchar(32),
	"member_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcement_reads" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "announcement_reads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"announcement_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_announcement_user" UNIQUE("announcement_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "announcement_recipients" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "announcement_recipients_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"announcement_id" integer NOT NULL,
	"recipient_type" varchar(16) NOT NULL,
	"recipient_id" integer NOT NULL,
	CONSTRAINT "uniq_announcement_recipient" UNIQUE("announcement_id","recipient_type","recipient_id")
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "announcements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
CREATE TABLE "workflow_automation_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_automation_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"rule_id" integer,
	"rule_name" varchar(128) NOT NULL,
	"instance_id" integer,
	"instance_title" varchar(256),
	"trigger" "workflow_automation_trigger" NOT NULL,
	"action_index" integer NOT NULL,
	"action_type" varchar(32) NOT NULL,
	"status" varchar(16) NOT NULL,
	"error" varchar(512),
	"duration_ms" integer,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_automations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_automations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"instance_id" integer NOT NULL,
	"task_id" integer,
	"parent_id" integer,
	"user_id" integer NOT NULL,
	"content" text NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_compensation_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_compensation_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_compensations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_connector_invocations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_connectors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_data_sources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(64) NOT NULL,
	"method" varchar(8) DEFAULT 'GET' NOT NULL,
	"url" varchar(1024) NOT NULL,
	"headers_encrypted" text,
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_definition_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"definition_id" integer NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" text,
	"flow_data" jsonb,
	"form_id" integer,
	"form_type" "workflow_form_type" DEFAULT 'designer' NOT NULL,
	"custom_form" jsonb,
	"form_schema" jsonb,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" integer,
	"tenant_id" integer,
	CONSTRAINT "workflow_def_versions_def_ver_uniq" UNIQUE("definition_id","version")
);
--> statement-breakpoint
CREATE TABLE "workflow_definitions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_definitions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_delegations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"principal_id" integer NOT NULL,
	"delegate_id" integer NOT NULL,
	"definition_id" integer,
	"mode" varchar(16) DEFAULT 'full' NOT NULL,
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_engine_health_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_event_subscriptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(64) NOT NULL,
	"description" varchar(256),
	"definition_id" integer,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"url" varchar(512) NOT NULL,
	"secret_encrypted" text,
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_forms_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(64) NOT NULL,
	"code" varchar(64),
	"description" text,
	"category_id" integer,
	"schema" jsonb,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_forms_code_uniq" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "workflow_instance_migrations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_instance_migrations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_instances_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"suspended_at" timestamp,
	"suspend_reason" varchar(500),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_job_executions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_job_executions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"job_type" "workflow_job_type" NOT NULL,
	"status" "workflow_job_status" DEFAULT 'pending' NOT NULL,
	"instance_id" integer,
	"task_id" integer,
	"node_key" varchar(64),
	"idempotency_key" varchar(160),
	"trace_id" varchar(64),
	"parent_ref" varchar(32),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_quick_phrases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer,
	"content" varchar(255) NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_saved_views" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_saved_views_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_schedules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"definition_id" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"cron_expression" varchar(64) NOT NULL,
	"timezone" varchar(64),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_serial_counters_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"definition_id" integer NOT NULL,
	"period_key" varchar(16) NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "workflow_serial_counters_def_period_uniq" UNIQUE("definition_id","period_key")
);
--> statement-breakpoint
CREATE TABLE "workflow_simulation_cases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_simulation_cases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_task_consults_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
CREATE TABLE "workflow_task_transfers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_task_transfers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"task_id" integer NOT NULL,
	"instance_id" integer NOT NULL,
	"from_user_id" integer,
	"to_user_id" integer NOT NULL,
	"action" "workflow_task_transfer_action" NOT NULL,
	"reason" varchar(500),
	"operator_id" integer,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_task_urges" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_task_urges_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"task_id" integer NOT NULL,
	"instance_id" integer NOT NULL,
	"urger_id" integer,
	"urger_name" varchar(64),
	"message" varchar(256),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_tasks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_tasks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"delegated_from_id" integer,
	"delegation_mode" varchar(16),
	"sign_type" varchar(8),
	"return_origin_node_key" varchar(64),
	"activation_id" varchar(36) NOT NULL,
	"cc_read_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_tasks_external_callback_id_unique" UNIQUE("external_callback_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_templates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
CREATE TABLE "broadcast_campaigns" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "broadcast_campaigns_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" varchar(200) NOT NULL,
	"content" text NOT NULL,
	"link" varchar(500),
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audience_type" "broadcast_audience" NOT NULL,
	"audience_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "broadcast_status" DEFAULT 'draft' NOT NULL,
	"total_recipients" integer,
	"enqueued_count" integer DEFAULT 0 NOT NULL,
	"task_id" integer,
	"sent_at" timestamp with time zone,
	"remark" text,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_configs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "email_configs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "email_send_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "email_templates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "in_app_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"template_id" integer,
	"user_id" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"content" text NOT NULL,
	"type" "in_app_message_type" DEFAULT 'info' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"source" "send_source" DEFAULT 'system' NOT NULL,
	"sender_id" integer,
	"link" varchar(512),
	"dedupe_key" varchar(192),
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "in_app_messages_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "in_app_templates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "in_app_templates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
CREATE TABLE "notification_dispatches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notification_dispatches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"outbox_id" integer,
	"event_key" varchar(100) NOT NULL,
	"recipient_type" "notification_recipient_type" NOT NULL,
	"recipient_id" integer,
	"recipient_address" varchar(512),
	"channel" "notification_channel" NOT NULL,
	"decision" "notification_decision" NOT NULL,
	"reason_code" varchar(64),
	"reason_detail" text,
	"provider_msg_id" varchar(128),
	"dedupe_key" varchar(256),
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_event_overrides" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notification_event_overrides_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"event_key" varchar(100) NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"enabled" boolean NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notification_outbox_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_key" varchar(100) NOT NULL,
	"recipients" jsonb NOT NULL,
	"vars" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channel_policy" jsonb,
	"channel_options" jsonb,
	"link" varchar(512),
	"dedupe_key" varchar(192),
	"status" "notification_outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" varchar(500),
	"claimed_at" timestamp with time zone,
	"scheduled_at" timestamp with time zone,
	"digest_key" varchar(128),
	"trace_id" varchar(64),
	"parent_ref" varchar(32),
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notification_preferences_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"recipient_type" "notification_recipient_type" NOT NULL,
	"recipient_id" integer NOT NULL,
	"event_key" varchar(100) NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"enabled" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_recipient_settings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notification_recipient_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"recipient_type" "notification_recipient_type" NOT NULL,
	"recipient_id" integer NOT NULL,
	"global_muted" boolean DEFAULT false NOT NULL,
	"timezone" varchar(64) DEFAULT 'Asia/Shanghai' NOT NULL,
	"quiet_start" varchar(5),
	"quiet_end" varchar(5),
	"digest_mode" "notification_digest_mode" DEFAULT 'realtime' NOT NULL,
	"digest_hour" smallint DEFAULT 9 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_configs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "push_configs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"app_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"provider" "push_provider" DEFAULT 'jpush' NOT NULL,
	"app_key" varchar(128) DEFAULT '' NOT NULL,
	"master_secret" varchar(256) DEFAULT '' NOT NULL,
	"apns_production" boolean DEFAULT false NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_configs_app_unique" UNIQUE("app_id")
);
--> statement-breakpoint
CREATE TABLE "push_send_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "push_send_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"config_id" integer,
	"app_id" integer,
	"provider" "push_provider" NOT NULL,
	"subject_type" varchar(16),
	"subject_id" integer,
	"device_count" integer DEFAULT 0 NOT NULL,
	"title" varchar(200) NOT NULL,
	"content" text NOT NULL,
	"link" varchar(500),
	"event_key" varchar(128),
	"status" "send_status" DEFAULT 'pending' NOT NULL,
	"provider_msg_id" varchar(128),
	"delivery_status" varchar(32),
	"delivered_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"error_msg" text,
	"source" "send_source" DEFAULT 'system' NOT NULL,
	"tenant_id" integer,
	"sent_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_configs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sms_configs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sms_send_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sms_templates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "db_admin_query_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "db_backups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "db_query_favorites_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tags_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
CREATE TABLE "rule_asset_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rule_asset_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ref_kind" varchar(16) NOT NULL,
	"ref_id" integer NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_by" integer,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" integer,
	CONSTRAINT "rule_asset_versions_uniq" UNIQUE("ref_kind","ref_id","version")
);
--> statement-breakpoint
CREATE TABLE "rule_decision_flows" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rule_decision_flows_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
CREATE TABLE "rule_decision_table_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rule_decision_table_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"table_id" integer NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" text,
	"hit_policy" "rule_hit_policy" DEFAULT 'first' NOT NULL,
	"inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" integer,
	"tenant_id" integer,
	CONSTRAINT "rule_decision_table_versions_uniq" UNIQUE("table_id","version")
);
--> statement-breakpoint
CREATE TABLE "rule_decision_tables" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rule_decision_tables_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" text,
	"category_id" integer,
	"status" "workflow_definition_status" DEFAULT 'draft' NOT NULL,
	"hit_policy" "rule_hit_policy" DEFAULT 'first' NOT NULL,
	"inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"gray_percent" integer,
	"gray_dimension" varchar(200),
	"gray_version" integer,
	"review_status" varchar(16),
	"review_requested_by" integer,
	"review_requested_at" timestamp with time zone,
	"review_comment" varchar(255),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rule_decision_tables_key_uniq" UNIQUE("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "rule_executions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rule_executions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ref_kind" varchar(16) NOT NULL,
	"ref_id" integer,
	"rule_key" varchar(64) NOT NULL,
	"version" integer,
	"caller" varchar(64),
	"biz_ref" varchar(128),
	"source" varchar(16) DEFAULT 'runtime' NOT NULL,
	"matched" boolean DEFAULT false NOT NULL,
	"hit_policy" "rule_hit_policy",
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"matched_row_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" integer,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_list_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rule_list_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"list_id" integer NOT NULL,
	"value" varchar(128) NOT NULL,
	"label" varchar(64),
	"match_mode" varchar(8) DEFAULT 'exact' NOT NULL,
	"expires_at" timestamp with time zone,
	"remark" varchar(255),
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rule_list_items_value_uniq" UNIQUE("list_id","value")
);
--> statement-breakpoint
CREATE TABLE "rule_lists" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rule_lists_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
CREATE TABLE "rule_scorecards" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rule_scorecards_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" text,
	"status" "workflow_definition_status" DEFAULT 'draft' NOT NULL,
	"base_score" integer DEFAULT 0 NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"grades" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_snapshot" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rule_scorecards_key_uniq" UNIQUE("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "rule_test_cases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rule_test_cases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "biz_leaves_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "biz_pay_demos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"is_archived" boolean DEFAULT false NOT NULL,
	"muted_until" timestamp with time zone,
	"last_read_at" timestamp with time zone,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chat_conversation_members_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "chat_conversations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chat_conversations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" "chat_conversation_type" DEFAULT 'direct' NOT NULL,
	"name" varchar(64),
	"announcement" varchar(500),
	"mute_all" boolean DEFAULT false NOT NULL,
	"join_approval" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_custom_emojis" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chat_custom_emojis_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"url" varchar(512) NOT NULL,
	"file_id" varchar(64),
	"name" varchar(64),
	"width" integer,
	"height" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_group_invites" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chat_group_invites_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"conversation_id" integer NOT NULL,
	"token" varchar(64) NOT NULL,
	"created_by" integer,
	"expires_at" timestamp with time zone,
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chat_group_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "chat_group_join_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chat_group_join_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"conversation_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"invite_id" integer,
	"status" "chat_join_request_status" DEFAULT 'pending' NOT NULL,
	"message" varchar(255),
	"handled_by" integer,
	"handled_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_message_favorites" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chat_message_favorites_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"message_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_message_favorites_message_id_user_id_unique" UNIQUE("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "chat_message_reactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chat_message_reactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"message_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"emoji" varchar(10) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_message_reactions_message_id_user_id_emoji_unique" UNIQUE("message_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chat_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
CREATE TABLE "chat_quick_replies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chat_quick_replies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"content" varchar(500) NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_scheduled_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chat_scheduled_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"conversation_id" integer NOT NULL,
	"sender_id" integer NOT NULL,
	"type" "chat_message_type" DEFAULT 'text' NOT NULL,
	"content" text NOT NULL,
	"extra" jsonb,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" "chat_scheduled_status" DEFAULT 'pending' NOT NULL,
	"fail_reason" varchar(255),
	"sent_message_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_webhooks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chat_webhooks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "channel_auto_replies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "channel_menus_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "channel_message_templates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "channel_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "channel_quick_replies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "channels_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
CREATE TABLE "payment_apps" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_apps_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(64) NOT NULL,
	"open_client_id" integer NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"wechat_config_id" integer,
	"alipay_config_id" integer,
	"unionpay_config_id" integer,
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_apps_open_client_unique" UNIQUE("open_client_id")
);
--> statement-breakpoint
CREATE TABLE "payment_cashier_sessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_cashier_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"session_token" varchar(64) NOT NULL,
	"link_id" integer NOT NULL,
	"app_id" integer NOT NULL,
	"order_no" varchar(64),
	"pay_method" "payment_method" NOT NULL,
	"amount" integer NOT NULL,
	"status" "payment_cashier_session_status" DEFAULT 'ready' NOT NULL,
	"use_slot_status" "payment_cashier_use_slot_status" DEFAULT 'none' NOT NULL,
	"pay_params" jsonb,
	"return_url" varchar(512) NOT NULL,
	"error_message" varchar(512),
	"expires_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_cashier_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "payment_channel_configs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_channel_configs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(64) NOT NULL,
	"channel" "payment_channel" NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sandbox" boolean DEFAULT false NOT NULL,
	"callback_token" varchar(64) NOT NULL,
	"sandbox_notify_secret_encrypted" text NOT NULL,
	"notify_url" varchar(512),
	"wechat_app_id" varchar(64),
	"wechat_mch_id" varchar(64),
	"wechat_api_v3_key_encrypted" text,
	"wechat_private_key_encrypted" text,
	"wechat_serial_no" varchar(128),
	"wechat_platform_cert" text,
	"alipay_app_id" varchar(64),
	"alipay_seller_id" varchar(64),
	"alipay_private_key_encrypted" text,
	"alipay_public_key" text,
	"alipay_sign_type" varchar(16) DEFAULT 'RSA2',
	"alipay_gateway" varchar(256),
	"unionpay_mer_id" varchar(64),
	"unionpay_private_key_encrypted" text,
	"unionpay_cert_id" varchar(64),
	"unionpay_public_key" text,
	"unionpay_gateway" varchar(256),
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_channel_configs_callback_token_unique" UNIQUE("callback_token")
);
--> statement-breakpoint
CREATE TABLE "payment_contracts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_contracts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"contract_no" varchar(64) NOT NULL,
	"channel" "payment_channel" NOT NULL,
	"channel_config_id" integer NOT NULL,
	"app_id" integer NOT NULL,
	"currency" varchar(8) DEFAULT 'CNY' NOT NULL,
	"plan_id" integer NOT NULL,
	"signer_account" varchar(128) NOT NULL,
	"signer_name" varchar(64),
	"status" "payment_contract_status" DEFAULT 'pending' NOT NULL,
	"unknown_operation" "payment_contract_operation",
	"version" integer DEFAULT 0 NOT NULL,
	"error_message" varchar(512),
	"channel_contract_no" varchar(128),
	"biz_type" varchar(64) NOT NULL,
	"biz_id" varchar(128) NOT NULL,
	"next_deduct_at" timestamp with time zone,
	"last_deduct_at" timestamp with time zone,
	"fail_count" integer DEFAULT 0 NOT NULL,
	"total_deduct_count" integer DEFAULT 0 NOT NULL,
	"last_order_no" varchar(64),
	"signed_at" timestamp with time zone,
	"terminated_at" timestamp with time zone,
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_contracts_contract_no_unique" UNIQUE("contract_no")
);
--> statement-breakpoint
CREATE TABLE "payment_deduct_plans" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_deduct_plans_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(64) NOT NULL,
	"period" "payment_deduct_period" DEFAULT 'monthly' NOT NULL,
	"custom_days" integer,
	"amount" integer NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_dispute_replies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_dispute_replies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"dispute_id" integer NOT NULL,
	"author" "payment_dispute_reply_author" DEFAULT 'merchant' NOT NULL,
	"content" text NOT NULL,
	"operator_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_disputes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_disputes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"dispute_no" varchar(64) NOT NULL,
	"channel_dispute_no" varchar(128),
	"channel" "payment_channel" NOT NULL,
	"order_no" varchar(64) NOT NULL,
	"complainant" varchar(128),
	"complainant_phone" varchar(32),
	"type" "payment_dispute_type" DEFAULT 'other' NOT NULL,
	"content" text NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"status" "payment_dispute_status" DEFAULT 'pending' NOT NULL,
	"route" varchar(32),
	"priority" integer,
	"sla_hours" integer,
	"deadline" timestamp with time zone,
	"refund_no" varchar(64),
	"resolved_at" timestamp with time zone,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_disputes_dispute_no_unique" UNIQUE("dispute_no")
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_fee_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
CREATE TABLE "payment_fund_reservations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_fund_reservations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"reservation_no" varchar(64) NOT NULL,
	"account_id" integer NOT NULL,
	"source_type" varchar(64) NOT NULL,
	"source_id" varchar(128) NOT NULL,
	"amount" bigint NOT NULL,
	"status" "payment_fund_reservation_status" DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"reason" varchar(256),
	"finalization_reason" varchar(256),
	"app_id" integer NOT NULL,
	"channel_config_id" integer NOT NULL,
	"currency" varchar(8) NOT NULL,
	"tenant_id" integer,
	"expires_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_fund_reservations_reservation_no_unique" UNIQUE("reservation_no"),
	CONSTRAINT "payment_fund_reservations_amount_positive_check" CHECK ("payment_fund_reservations"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_journal_lines" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_journal_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"journal_id" integer NOT NULL,
	"line_no" integer NOT NULL,
	"account_id" integer NOT NULL,
	"debit_amount" bigint DEFAULT 0 NOT NULL,
	"credit_amount" bigint DEFAULT 0 NOT NULL,
	"memo" varchar(256),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_journal_lines_journal_line_unique" UNIQUE("journal_id","line_no"),
	CONSTRAINT "payment_journal_lines_single_side_check" CHECK ((("payment_journal_lines"."debit_amount" > 0 and "payment_journal_lines"."credit_amount" = 0) or ("payment_journal_lines"."credit_amount" > 0 and "payment_journal_lines"."debit_amount" = 0)))
);
--> statement-breakpoint
CREATE TABLE "payment_journals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_journals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"journal_no" varchar(64) NOT NULL,
	"source_type" varchar(64) NOT NULL,
	"source_id" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"description" varchar(512) NOT NULL,
	"app_id" integer NOT NULL,
	"channel_config_id" integer NOT NULL,
	"currency" varchar(8) NOT NULL,
	"reversal_of_journal_id" integer,
	"operator_id" integer,
	"tenant_id" integer,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_journals_journal_no_unique" UNIQUE("journal_no")
);
--> statement-breakpoint
CREATE TABLE "payment_ledger_accounts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_ledger_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"account_no" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"code" "payment_ledger_account_code" NOT NULL,
	"normal_balance" "payment_ledger_normal_balance" NOT NULL,
	"app_id" integer NOT NULL,
	"channel_config_id" integer NOT NULL,
	"currency" varchar(8) NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_ledger_accounts_account_no_unique" UNIQUE("account_no")
);
--> statement-breakpoint
CREATE TABLE "payment_link_redemptions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_link_redemptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"link_id" integer NOT NULL,
	"order_no" varchar(64) NOT NULL,
	"tenant_id" integer,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_link_redemptions_order_no_unique" UNIQUE("order_no")
);
--> statement-breakpoint
CREATE TABLE "payment_links" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_links_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"link_no" varchar(64) NOT NULL,
	"token" varchar(64) NOT NULL,
	"app_id" integer NOT NULL,
	"subject" varchar(256) NOT NULL,
	"amount" integer,
	"pay_method" "payment_method",
	"biz_type" varchar(64) NOT NULL,
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"reserved_count" integer DEFAULT 0 NOT NULL,
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_method_configs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_notify_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_notify_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"channel" "payment_channel" NOT NULL,
	"channel_config_id" integer NOT NULL,
	"app_id" integer,
	"provider_event_id" varchar(128),
	"scene" varchar(16) DEFAULT 'payment' NOT NULL,
	"order_no" varchar(64),
	"raw_body" text,
	"headers" text,
	"signature_valid" boolean DEFAULT false NOT NULL,
	"merchant_id" varchar(128),
	"provider_app_id" varchar(128),
	"paid_amount" integer,
	"currency" varchar(8),
	"result" varchar(32),
	"message" varchar(512),
	"ip" varchar(64),
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_orders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"channel_config_id" integer NOT NULL,
	"app_id" integer NOT NULL,
	"pay_method" "payment_method" NOT NULL,
	"status" "payment_order_status" DEFAULT 'pending' NOT NULL,
	"user_id" integer,
	"open_id" varchar(128),
	"client_ip" varchar(64),
	"department_id" integer,
	"paid_amount" integer,
	"fee_amount" integer,
	"net_amount" integer,
	"original_amount" integer,
	"discount_amount" integer,
	"member_coupon_id" integer,
	"paid_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"return_url" varchar(512),
	"notify_data" text,
	"error_message" varchar(512),
	"idempotency_key" varchar(128),
	"request_hash" varchar(64),
	"version" integer DEFAULT 0 NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_orders_order_no_unique" UNIQUE("order_no"),
	CONSTRAINT "payment_orders_config_out_trade_no_uq" UNIQUE("channel_config_id","out_trade_no")
);
--> statement-breakpoint
CREATE TABLE "payment_preauths" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_preauths_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"preauth_no" varchar(64) NOT NULL,
	"channel" "payment_channel" NOT NULL,
	"channel_config_id" integer NOT NULL,
	"app_id" integer NOT NULL,
	"currency" varchar(8) DEFAULT 'CNY' NOT NULL,
	"channel_preauth_no" varchar(128),
	"biz_type" varchar(64) NOT NULL,
	"biz_id" varchar(128) NOT NULL,
	"subject" varchar(256) NOT NULL,
	"payer_account" varchar(128) NOT NULL,
	"frozen_amount" integer NOT NULL,
	"captured_amount" integer,
	"capture_order_no" varchar(64),
	"status" "payment_preauth_status" DEFAULT 'pending' NOT NULL,
	"unknown_operation" "payment_preauth_operation",
	"version" integer DEFAULT 0 NOT NULL,
	"error_message" varchar(512),
	"frozen_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"remark" varchar(256),
	"operator_id" integer,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_preauths_preauth_no_unique" UNIQUE("preauth_no")
);
--> statement-breakpoint
CREATE TABLE "payment_recon_batches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_recon_batches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"batch_no" varchar(64) NOT NULL,
	"channel" "payment_channel" NOT NULL,
	"app_id" integer NOT NULL,
	"channel_config_id" integer NOT NULL,
	"currency" varchar(8) DEFAULT 'CNY' NOT NULL,
	"bill_date" varchar(10) NOT NULL,
	"source" "payment_recon_source" DEFAULT 'manual_upload' NOT NULL,
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_recon_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"batch_id" integer NOT NULL,
	"order_no" varchar(64),
	"channel_trade_no" varchar(128),
	"local_amount" integer,
	"channel_amount" integer,
	"local_status" varchar(32),
	"channel_status" varchar(32),
	"result" "payment_recon_result" NOT NULL,
	"handle_status" "payment_recon_handle_status",
	"handle_remark" varchar(256),
	"handled_at" timestamp with time zone,
	"handled_by_id" integer,
	"remark" varchar(256),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_refunds" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_refunds_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"refund_no" varchar(64) NOT NULL,
	"out_refund_no" varchar(64) NOT NULL,
	"order_no" varchar(64) NOT NULL,
	"order_id" integer NOT NULL,
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
	"idempotency_key" varchar(128),
	"request_hash" varchar(64),
	"version" integer DEFAULT 0 NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_refunds_refund_no_unique" UNIQUE("refund_no")
);
--> statement-breakpoint
CREATE TABLE "payment_risk_hits" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_risk_hits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"rule_id" integer,
	"rule_name" varchar(64) NOT NULL,
	"action" "payment_risk_action" NOT NULL,
	"dimension" "payment_risk_dimension" NOT NULL,
	"dimension_value" varchar(256),
	"channel" "payment_channel" NOT NULL,
	"biz_type" varchar(64) NOT NULL,
	"biz_id" varchar(128) NOT NULL,
	"order_no" varchar(64),
	"amount" integer NOT NULL,
	"open_id" varchar(128),
	"user_id" integer,
	"client_ip" varchar(64),
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_risk_reviews" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_risk_reviews_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"review_no" varchar(64) NOT NULL,
	"hit_id" integer,
	"order_no" varchar(64) NOT NULL,
	"channel" "payment_channel" NOT NULL,
	"app_id" integer NOT NULL,
	"biz_type" varchar(64) NOT NULL,
	"biz_id" varchar(128) NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(8) DEFAULT 'CNY' NOT NULL,
	"reason" varchar(256) NOT NULL,
	"status" "payment_risk_review_status" DEFAULT 'pending' NOT NULL,
	"reviewer_id" integer,
	"reviewed_at" timestamp with time zone,
	"review_remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_risk_reviews_review_no_unique" UNIQUE("review_no")
);
--> statement-breakpoint
CREATE TABLE "payment_risk_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_risk_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(64) NOT NULL,
	"scope" "payment_risk_scope" DEFAULT 'global' NOT NULL,
	"channel" "payment_channel",
	"biz_type" varchar(64),
	"single_limit" integer,
	"daily_limit" integer,
	"daily_count_limit" integer,
	"block_list_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allow_list_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action" "payment_risk_action" DEFAULT 'block' NOT NULL,
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_settlement_batches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"batch_no" varchar(64) NOT NULL,
	"channel" "payment_channel" NOT NULL,
	"app_id" integer NOT NULL,
	"channel_config_id" integer NOT NULL,
	"currency" varchar(8) DEFAULT 'CNY' NOT NULL,
	"period_start" varchar(10) NOT NULL,
	"period_end" varchar(10) NOT NULL,
	"status" "payment_settlement_status" DEFAULT 'pending' NOT NULL,
	"order_count" integer DEFAULT 0 NOT NULL,
	"gross_amount" integer DEFAULT 0 NOT NULL,
	"fee_amount" integer DEFAULT 0 NOT NULL,
	"refund_amount" integer DEFAULT 0 NOT NULL,
	"sharing_amount" integer DEFAULT 0 NOT NULL,
	"net_amount" integer DEFAULT 0 NOT NULL,
	"settled_at" timestamp with time zone,
	"failure_reason" varchar(512),
	"payout_reference" varchar(128),
	"version" integer DEFAULT 0 NOT NULL,
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_settlement_batches_batch_no_unique" UNIQUE("batch_no")
);
--> statement-breakpoint
CREATE TABLE "payment_settlement_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_settlement_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"batch_id" integer NOT NULL,
	"journal_line_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	"app_id" integer NOT NULL,
	"channel_config_id" integer NOT NULL,
	"currency" varchar(8) NOT NULL,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_settlement_items_journal_line_unique" UNIQUE("journal_line_id"),
	CONSTRAINT "payment_settlement_items_batch_line_unique" UNIQUE("batch_id","journal_line_id"),
	CONSTRAINT "payment_settlement_items_amount_nonzero_check" CHECK ("payment_settlement_items"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "payment_sharing_orders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_sharing_orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sharing_no" varchar(64) NOT NULL,
	"order_no" varchar(64) NOT NULL,
	"receiver_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"status" "payment_sharing_order_status" DEFAULT 'pending' NOT NULL,
	"channel_sharing_no" varchar(128),
	"attempts" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_sharing_receivers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(64) NOT NULL,
	"receiver_type" "payment_sharing_receiver_type" DEFAULT 'merchant' NOT NULL,
	"account" varchar(128) NOT NULL,
	"ratio_bps" integer,
	"auto_share" boolean DEFAULT false NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_sharing_reversals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_sharing_reversals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"reversal_no" varchar(64) NOT NULL,
	"sharing_order_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"status" "payment_sharing_reversal_status" DEFAULT 'processing' NOT NULL,
	"channel_reversal_no" varchar(128),
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"reason" varchar(256) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"query_attempts" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"error_message" varchar(512),
	"finished_at" timestamp with time zone,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_sharing_reversals_reversal_no_unique" UNIQUE("reversal_no"),
	CONSTRAINT "payment_sharing_reversals_sharing_order_unique" UNIQUE("sharing_order_id")
);
--> statement-breakpoint
CREATE TABLE "payment_transfers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_transfers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"transfer_no" varchar(64) NOT NULL,
	"out_transfer_no" varchar(64) NOT NULL,
	"channel" "payment_channel" NOT NULL,
	"app_id" integer NOT NULL,
	"channel_config_id" integer NOT NULL,
	"currency" varchar(8) DEFAULT 'CNY' NOT NULL,
	"receiver_account" varchar(128) NOT NULL,
	"receiver_name" varchar(64),
	"amount" integer NOT NULL,
	"remark" varchar(256),
	"status" "payment_transfer_status" DEFAULT 'pending' NOT NULL,
	"approval_status" "payment_transfer_approval_status" DEFAULT 'none' NOT NULL,
	"applied_by_id" integer,
	"approver_id" integer,
	"approved_at" timestamp with time zone,
	"approval_remark" varchar(256),
	"channel_transfer_no" varchar(128),
	"fail_reason" varchar(512),
	"attempts" integer DEFAULT 0 NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"fund_reservation_id" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"biz_type" varchar(64),
	"biz_id" varchar(128),
	"finished_at" timestamp with time zone,
	"operator_id" integer,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_transfers_transfer_no_unique" UNIQUE("transfer_no"),
	CONSTRAINT "payment_transfers_config_out_no_uq" UNIQUE("channel_config_id","out_transfer_no")
);
--> statement-breakpoint
CREATE TABLE "ai_agents" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_agents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(300),
	"avatar" varchar(20) DEFAULT '🤖' NOT NULL,
	"instructions" text NOT NULL,
	"config_id" integer,
	"model" varchar(100),
	"model_settings" jsonb,
	"max_steps" integer,
	"knowledge_base_id" integer,
	"tools" text[],
	"opening_message" text,
	"suggested_questions" text[],
	"usage_count" integer DEFAULT 0 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_arena_votes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_arena_votes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"question" text NOT NULL,
	"model_a" varchar(100) NOT NULL,
	"model_b" varchar(100) NOT NULL,
	"winner" varchar(10) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_conversations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"tenant_id" integer,
	"title" varchar(200) DEFAULT '新对话' NOT NULL,
	"provider_snapshot" jsonb,
	"is_archived" boolean DEFAULT false NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"system_prompt_override" text,
	"knowledge_base_id" integer,
	"agent_id" integer,
	"tags" text[],
	"active_leaf_msg_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_http_tools" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_http_tools_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(60) NOT NULL,
	"description" varchar(500) NOT NULL,
	"method" varchar(10) DEFAULT 'GET' NOT NULL,
	"url_template" varchar(500) NOT NULL,
	"headers" jsonb,
	"params" jsonb,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_kb_chunks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_kb_chunks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kb_id" integer NOT NULL,
	"doc_id" integer NOT NULL,
	"content" text NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_kb_documents" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_kb_documents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kb_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"source_url" varchar(500),
	"status" varchar(20) DEFAULT 'ready' NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"char_count" integer DEFAULT 0 NOT NULL,
	"error" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_knowledge_bases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_knowledge_bases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(100) NOT NULL,
	"description" varchar(300),
	"user_id" integer NOT NULL,
	"embedding_model" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"conversation_id" integer NOT NULL,
	"parent_id" integer,
	"role" "ai_message_role" NOT NULL,
	"content" text NOT NULL,
	"reasoning" text,
	"model" varchar(100),
	"tokens_input" integer DEFAULT 0 NOT NULL,
	"tokens_output" integer DEFAULT 0 NOT NULL,
	"ttft_ms" integer,
	"duration_ms" integer,
	"feedback" integer,
	"feedback_reason" varchar(200),
	"feedback_status" "ai_feedback_status",
	"feedback_remark" varchar(500),
	"feedback_handled_at" timestamp,
	"trace" jsonb,
	"tool_calls" jsonb,
	"kb_references" jsonb,
	"images" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_prompt_template_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_prompt_template_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"template_id" integer NOT NULL,
	"version" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"content" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_prompt_templates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_prompt_templates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(100) NOT NULL,
	"content" text NOT NULL,
	"description" varchar(300),
	"category" varchar(50),
	"scope" "ai_prompt_scope" DEFAULT 'system' NOT NULL,
	"user_id" integer,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_provider_configs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_provider_configs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(100) NOT NULL,
	"provider_id" varchar(50) NOT NULL,
	"base_url" varchar(500),
	"api_key" varchar(1000) NOT NULL,
	"headers" jsonb,
	"models" text[] NOT NULL,
	"default_model" varchar(100) NOT NULL,
	"model_settings" jsonb,
	"provider_options" jsonb,
	"fallbacks" jsonb,
	"capabilities" jsonb,
	"price_input_per_m" integer,
	"price_output_per_m" integer,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"max_concurrent" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_shared_conversations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_shared_conversations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"token" varchar(64) NOT NULL,
	"conversation_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_user_settings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_user_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_ai_configs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_ai_configs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"name" varchar(100),
	"provider_id" varchar(50) DEFAULT 'custom' NOT NULL,
	"base_url" varchar(500),
	"api_key" varchar(1000),
	"headers" jsonb,
	"models" text[] DEFAULT '{}' NOT NULL,
	"default_model" varchar(100),
	"model_settings" jsonb,
	"provider_options" jsonb,
	"capabilities" jsonb,
	"system_prompt" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_scopes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "api_scopes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app_webhook_deliveries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"subscription_id" integer NOT NULL,
	"client_id" varchar(64),
	"tenant_id" integer,
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_webhook_deliveries_subscription_event_unique" UNIQUE("subscription_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "app_webhook_subscriptions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app_webhook_subscriptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"client_id" varchar(64),
	"name" varchar(100) NOT NULL,
	"url" varchar(512) NOT NULL,
	"secret_encrypted" text,
	"sign_mode" "app_webhook_sign_mode" DEFAULT 'hmacSha256' NOT NULL,
	"events" text[] DEFAULT '{}' NOT NULL,
	"cms_site_id" integer,
	"internal" boolean DEFAULT false NOT NULL,
	"headers" jsonb,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"last_delivery_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"auto_disabled_at" timestamp with time zone,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_webhook_subscriptions_identity_check" CHECK ((("app_webhook_subscriptions"."internal" = true and "app_webhook_subscriptions"."client_id" is null) or ("app_webhook_subscriptions"."internal" = false and "app_webhook_subscriptions"."client_id" is not null)))
);
--> statement-breakpoint
CREATE TABLE "oauth2_authorization_codes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "oauth2_authorization_codes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code_hash" varchar(64),
	"client_id" varchar(64) NOT NULL,
	"user_id" integer NOT NULL,
	"redirect_uri" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"code_challenge" varchar(256),
	"code_challenge_method" varchar(10),
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth2_authorization_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "oauth2_clients" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "oauth2_clients_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"client_id" varchar(64) NOT NULL,
	"client_secret_hash" varchar(128),
	"client_secret_encrypted" text,
	"previous_client_secret_hash" varchar(128),
	"previous_client_secret_encrypted" text,
	"previous_secret_expires_at" timestamp with time zone,
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
	"ip_allowlist" text[] DEFAULT '{}' NOT NULL,
	"environment" "open_app_environment" DEFAULT 'production' NOT NULL,
	"review_status" "open_app_review_status" DEFAULT 'approved' NOT NULL,
	"review_comment" text,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" integer,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"owner_id" integer,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth2_clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "oauth2_token_families" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"user_id" integer,
	"compromised" boolean DEFAULT false NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth2_tokens" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "oauth2_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"token_type" varchar(20) NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"token_prefix" varchar(20),
	"family_id" varchar(64),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "oauth2_user_grants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth2_user_grants_user_client_unique" UNIQUE("user_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "open_api_call_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "open_api_call_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"auth_channel" varchar(16),
	"user_id" integer,
	"error_message" varchar(512),
	"request_id" varchar(64),
	"environment" "open_app_environment" DEFAULT 'production' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "open_api_call_stats_daily" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "open_api_call_stats_daily_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"stat_date" date NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"app_name" varchar(100),
	"path" varchar(256) NOT NULL,
	"environment" "open_app_environment" DEFAULT 'production' NOT NULL,
	"total_calls" bigint DEFAULT 0 NOT NULL,
	"success_calls" bigint DEFAULT 0 NOT NULL,
	"failed_calls" bigint DEFAULT 0 NOT NULL,
	"duration_sum_ms" bigint DEFAULT 0 NOT NULL,
	"max_duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "open_api_call_stats_daily_unique" UNIQUE("stat_date","client_id","path","environment")
);
--> statement-breakpoint
CREATE TABLE "open_quota_alerts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "open_quota_alerts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"client_id" varchar(64) NOT NULL,
	"dimension" varchar(20) NOT NULL,
	"period" varchar(16) NOT NULL,
	"threshold" integer NOT NULL,
	"used" bigint NOT NULL,
	"quota_limit" bigint NOT NULL,
	"plan_code" varchar(64) NOT NULL,
	"event_id" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "open_quota_alerts_dedupe_unique" UNIQUE("client_id","dimension","period","threshold")
);
--> statement-breakpoint
CREATE TABLE "rate_plans" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rate_plans_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ssh_profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "terminal_recordings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
CREATE TABLE "terminal_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tenant_id" integer,
	"kind" "terminal_session_kind" NOT NULL,
	"target" varchar(255) DEFAULT '' NOT NULL,
	"label" varchar(255) DEFAULT '' NOT NULL,
	"client_ip" varchar(64) DEFAULT '' NOT NULL,
	"node_id" varchar(128) NOT NULL,
	"state" "terminal_session_state" DEFAULT 'active' NOT NULL,
	"cols" integer DEFAULT 80 NOT NULL,
	"rows" integer DEFAULT 24 NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"end_reason" varchar(32),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_hosts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ops_hosts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(64) NOT NULL,
	"host" varchar(255) NOT NULL,
	"port" integer DEFAULT 22 NOT NULL,
	"username" varchar(64) NOT NULL,
	"auth_type" "ops_host_auth_type" DEFAULT 'password' NOT NULL,
	"password_encrypted" text,
	"key_content_encrypted" text,
	"key_passphrase_encrypted" text,
	"connection_version" integer DEFAULT 0 NOT NULL,
	"host_key_fingerprint" varchar(64),
	"status" "ops_host_status" DEFAULT 'unknown' NOT NULL,
	"snapshot" jsonb,
	"probed_at" timestamp,
	"probe_error" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"remark" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	CONSTRAINT "ops_hosts_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "checkin_milestones" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "checkin_milestones_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "checkin_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "checkin_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"makeup_enabled" boolean DEFAULT true NOT NULL,
	"makeup_cost_points" integer DEFAULT 20 NOT NULL,
	"makeup_max_days" integer DEFAULT 7 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "coupons_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"exchange_points" integer DEFAULT 0 NOT NULL,
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "member_checkin_milestone_awards_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "member_checkins_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"member_id" integer NOT NULL,
	"checkin_date" date NOT NULL,
	"consecutive_days" integer DEFAULT 1 NOT NULL,
	"points_awarded" integer DEFAULT 0 NOT NULL,
	"experience_awarded" integer DEFAULT 0 NOT NULL,
	"is_makeup" boolean DEFAULT false NOT NULL,
	"remark" varchar(256),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_checkins_member_id_checkin_date_unique" UNIQUE("member_id","checkin_date")
);
--> statement-breakpoint
CREATE TABLE "member_coupons" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "member_coupons_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "member_levels_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "member_login_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
CREATE TABLE "member_notifications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "member_notifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"member_id" integer NOT NULL,
	"type" varchar(32) NOT NULL,
	"title" varchar(128) NOT NULL,
	"content" varchar(512),
	"biz_id" varchar(128),
	"read_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_point_accounts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "member_point_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "member_point_transactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
CREATE TABLE "member_tag_bindings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "member_tag_bindings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"member_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_tag_bindings_unique" UNIQUE("member_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "member_tags" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "member_tags_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(32) NOT NULL,
	"color" varchar(20),
	"description" varchar(256),
	"sort" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "member_vip_renewals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "member_vip_renewals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"member_id" integer NOT NULL,
	"order_no" varchar(64) NOT NULL,
	"contract_no" varchar(64),
	"amount" integer NOT NULL,
	"vip_expire_after" timestamp with time zone NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_vip_renewals_order_no_unique" UNIQUE("order_no")
);
--> statement-breakpoint
CREATE TABLE "member_wallet_transactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "member_wallet_transactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"member_id" integer NOT NULL,
	"type" "wallet_tx_type" NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"biz_type" varchar(64),
	"biz_id" varchar(128),
	"payment_intent_no" varchar(64),
	"payment_event_id" varchar(128),
	"remark" varchar(256),
	"operator_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_wallets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "member_wallets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"vip_expire_at" timestamp with time zone,
	"growth_value" integer DEFAULT 0 NOT NULL,
	"experience" integer DEFAULT 0 NOT NULL,
	"register_source" varchar(32) DEFAULT 'web' NOT NULL,
	"register_ip" varchar(64),
	"last_login_at" timestamp with time zone,
	"last_login_ip" varchar(64),
	"remark" varchar(256),
	"deleted_at" timestamp with time zone,
	"invite_code" varchar(16),
	"invited_by" integer,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitor_alert_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitor_alert_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"notify_status" "monitor_alert_notify_status" DEFAULT 'skipped' NOT NULL,
	"notify_channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notify_error" text,
	"notified_at" timestamp with time zone,
	"handle_status" "monitor_alert_handle_status" DEFAULT 'pending' NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"handled_by" integer,
	"handled_at" timestamp with time zone,
	"handle_note" varchar(500),
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "monitor_alert_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitor_alert_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"name" varchar(128) NOT NULL,
	"metric" "monitor_metric" NOT NULL,
	"operator" "monitor_alert_operator" DEFAULT 'gt' NOT NULL,
	"threshold" real NOT NULL,
	"duration_minutes" integer DEFAULT 0 NOT NULL,
	"level" "monitor_alert_level" DEFAULT 'warning' NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"webhook_url" varchar(512),
	"recipient_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recipient_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ssl_certificates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "system_metric_samples_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
CREATE TABLE "app_artifacts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app_artifacts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"release_id" integer NOT NULL,
	"platform" "app_platform" NOT NULL,
	"arch" "app_arch" DEFAULT 'x64' NOT NULL,
	"kind" "app_artifact_kind" DEFAULT 'installer' NOT NULL,
	"file_id" uuid,
	"external_url" varchar(500),
	"file_name" varchar(255) NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	"sha256" varchar(64),
	"download_count" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_artifacts_release_filename_unique" UNIQUE("release_id","file_name")
);
--> statement-breakpoint
CREATE TABLE "app_release_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app_release_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"app_id" integer NOT NULL,
	"release_id" integer,
	"artifact_id" integer,
	"event_type" "app_release_event_type" NOT NULL,
	"channel" "app_release_channel" DEFAULT 'stable' NOT NULL,
	"platform" "app_platform",
	"arch" "app_arch",
	"version" varchar(32),
	"device_id" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_releases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app_releases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"app_id" integer NOT NULL,
	"channel" "app_release_channel" DEFAULT 'stable' NOT NULL,
	"version" varchar(32) NOT NULL,
	"notes" text,
	"status" "app_release_status" DEFAULT 'draft' NOT NULL,
	"mandatory" boolean DEFAULT false NOT NULL,
	"min_version" varchar(32),
	"rollout_percent" smallint DEFAULT 100 NOT NULL,
	"published_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_releases_app_channel_version_unique" UNIQUE("app_id","channel","version")
);
--> statement-breakpoint
CREATE TABLE "client_apps" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "client_apps_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"app_key" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_apps_app_key_unique" UNIQUE("app_key")
);
--> statement-breakpoint
CREATE TABLE "client_devices" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "client_devices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"device_id" varchar(64) NOT NULL,
	"app_id" integer NOT NULL,
	"platform" "app_platform" NOT NULL,
	"arch" "app_arch",
	"device_model" varchar(128),
	"os_version" varchar(64),
	"app_version" varchar(32),
	"subject_type" varchar(16),
	"subject_id" integer,
	"push_provider" "push_provider",
	"push_registration_id" varchar(128),
	"push_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_active_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_devices_device_id_unique" UNIQUE("device_id")
);
--> statement-breakpoint
CREATE TABLE "mp_accounts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mp_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mp_auto_replies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mp_broadcasts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mp_conditional_menus_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mp_drafts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mp_fans_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mp_kf_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mp_kf_routing_configs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mp_kf_session_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mp_kf_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mp_materials_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mp_menus_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mp_message_templates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mp_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mp_qrcodes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mp_tags_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mp_template_send_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mp_unmatched_keywords_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"account_id" integer NOT NULL,
	"keyword" varchar(128) NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"last_at" timestamp DEFAULT now() NOT NULL,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_alert_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_alert_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"name" varchar(64) NOT NULL,
	"dataset_id" integer,
	"metric_id" integer,
	"field" varchar(128),
	"group_by_field" varchar(128),
	"aggregate" varchar(16) DEFAULT 'sum' NOT NULL,
	"op" varchar(8) DEFAULT 'gt' NOT NULL,
	"threshold" real DEFAULT 0 NOT NULL,
	"cron" varchar(64),
	"timezone" varchar(64) DEFAULT 'Asia/Shanghai' NOT NULL,
	"misfire_policy" "report_schedule_misfire_policy" DEFAULT 'fire_once' NOT NULL,
	"next_run_at" timestamp with time zone,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recipients" varchar(512),
	"webhook_url" varchar(1024),
	"silence_mins" integer DEFAULT 60 NOT NULL,
	"notify_on_recover" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_checked_at" timestamp,
	"last_triggered" boolean,
	"last_value" real,
	"last_notified_at" timestamp,
	"last_delivery_at" timestamp with time zone,
	"last_delivery_status" "report_delivery_status",
	"last_delivery_error" varchar(512),
	"remark" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "report_alert_rules_source_check" CHECK (("report_alert_rules"."dataset_id" IS NOT NULL) <> ("report_alert_rules"."metric_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "report_dashboard_categories" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_dashboard_categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_dashboard_comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"dashboard_id" integer NOT NULL,
	"widget_id" varchar(64),
	"parent_id" integer,
	"content" varchar(1000) NOT NULL,
	"user_id" integer,
	"resolved_at" timestamp,
	"resolved_by" integer,
	"deleted_at" timestamp,
	"deleted_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_dashboard_embed_tokens" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_dashboard_embed_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"dashboard_id" integer NOT NULL,
	"token" varchar(64) NOT NULL,
	"token_encrypted" varchar(256),
	"allowed_filter_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fixed_filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expire_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"remark" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "report_dashboard_embed_tokens_token_unique" UNIQUE("token")
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
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_dashboard_shares_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"dashboard_id" integer NOT NULL,
	"token" varchar(64) NOT NULL,
	"token_encrypted" varchar(256),
	"password_hash" varchar(100),
	"enabled" boolean DEFAULT true NOT NULL,
	"expire_at" timestamp with time zone,
	"max_access_count" integer,
	"access_count" integer DEFAULT 0 NOT NULL,
	"session_version" integer DEFAULT 1 NOT NULL,
	"allowed_cidrs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_ips" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "report_dashboard_shares_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "report_dashboard_subscriptions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_dashboard_subscriptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"dashboard_id" integer NOT NULL,
	"cron" varchar(64) NOT NULL,
	"timezone" varchar(64) DEFAULT 'Asia/Shanghai' NOT NULL,
	"misfire_policy" "report_schedule_misfire_policy" DEFAULT 'fire_once' NOT NULL,
	"next_run_at" timestamp with time zone,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recipients" varchar(512),
	"webhook_url" varchar(1024),
	"enabled" boolean DEFAULT true NOT NULL,
	"remark" varchar(256),
	"last_run_at" timestamp with time zone,
	"last_delivery_at" timestamp with time zone,
	"last_delivery_status" "report_delivery_status",
	"last_delivery_error" varchar(512),
	"last_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_dashboard_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_dashboard_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"dashboard_id" integer NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"source" "report_dashboard_version_source" DEFAULT 'manual' NOT NULL,
	"remark" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_dashboards" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_dashboards_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"owner_id" integer,
	"folder_id" integer,
	"name" varchar(64) NOT NULL,
	"layout" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"canvas_layout" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"widgets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"filters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"category_id" integer,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"lifecycle_status" "report_dashboard_lifecycle_status" DEFAULT 'draft' NOT NULL,
	"lifecycle_initialized" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"published_snapshot" jsonb,
	"published_at" timestamp,
	"published_by" integer,
	"remark" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_dataset_execution_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_dataset_execution_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"dataset_id" integer,
	"datasource_id" integer,
	"user_id" integer,
	"scene" varchar(32) NOT NULL,
	"source_ref_id" varchar(64),
	"duration_ms" integer NOT NULL,
	"row_count" integer,
	"bytes" integer,
	"truncated" boolean DEFAULT false NOT NULL,
	"slow" boolean DEFAULT false NOT NULL,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"error_code" integer,
	"error_message" varchar(512),
	"param_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_datasets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_datasets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"owner_id" integer,
	"folder_id" integer,
	"name" varchar(64) NOT NULL,
	"datasource_id" integer NOT NULL,
	"type" "report_datasource_type" NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"computed_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cache_ttl" integer DEFAULT 0 NOT NULL,
	"materialize" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_datasources" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_datasources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"owner_id" integer,
	"folder_id" integer,
	"name" varchar(64) NOT NULL,
	"type" "report_datasource_type" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_test_status" varchar(16),
	"last_test_latency_ms" integer,
	"last_test_error" varchar(512),
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"remark" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_delivery_attempts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_delivery_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"run_id" integer NOT NULL,
	"channel" varchar(16) NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" "report_delivery_status" DEFAULT 'pending' NOT NULL,
	"duration_ms" integer,
	"error_message" varchar(512),
	"payload_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_delivery_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_delivery_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"target_type" "report_delivery_target_type" NOT NULL,
	"subscription_id" integer,
	"alert_rule_id" integer,
	"sla_rule_id" integer,
	"dashboard_id" integer,
	"dataset_id" integer,
	"target_name" varchar(128),
	"trigger_type" "report_delivery_trigger_type" NOT NULL,
	"status" "report_delivery_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"duration_ms" integer,
	"error_message" varchar(512),
	"payload_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_value" real,
	"triggered" boolean,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" integer,
	"acknowledge_note" varchar(500),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	"requested_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_folders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_folders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"parent_id" integer,
	"name" varchar(64) NOT NULL,
	"resource_type" "report_resource_type" NOT NULL,
	"owner_id" integer,
	"sort" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_print_templates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_print_templates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"owner_id" integer,
	"folder_id" integer,
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
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_share_access_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_share_access_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"share_id" integer NOT NULL,
	"dashboard_id" integer NOT NULL,
	"action" varchar(16) NOT NULL,
	"client_ip" varchar(64),
	"ok" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_asset_templates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_asset_templates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"folder_id" integer,
	"owner_id" integer,
	"code" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"type" "report_asset_template_type" NOT NULL,
	"description" text,
	"content" jsonb NOT NULL,
	"preview_file_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_asset_usage_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_asset_usage_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"resource_type" "report_resource_type" NOT NULL,
	"resource_id" integer NOT NULL,
	"user_id" integer,
	"action" varchar(16) NOT NULL,
	"scene" varchar(64),
	"duration_ms" integer,
	"row_count" bigint DEFAULT 0 NOT NULL,
	"byte_size" bigint DEFAULT 0 NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_chatbi_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_chatbi_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"session_id" integer NOT NULL,
	"user_id" integer,
	"role" "report_chatbi_message_role" NOT NULL,
	"content" text NOT NULL,
	"generated_sql" text,
	"chart_suggestion" jsonb,
	"result_sample" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result_row_count" bigint DEFAULT 0 NOT NULL,
	"result_byte_size" bigint DEFAULT 0 NOT NULL,
	"saved_resource_type" "report_resource_type",
	"saved_resource_id" integer,
	"saved_dataset_id" integer,
	"saved_dashboard_id" integer,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"cost_units" double precision DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"model_id" varchar(128),
	"error_message" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_chatbi_sessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_chatbi_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"user_id" integer NOT NULL,
	"title" varchar(128) NOT NULL,
	"datasource_id" integer,
	"dataset_id" integer,
	"allowed_tables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"context_snapshot" jsonb NOT NULL,
	"status" "report_chatbi_session_status" DEFAULT 'active' NOT NULL,
	"total_tokens" bigint DEFAULT 0 NOT NULL,
	"total_cost_units" double precision DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_deprecation_notices" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_deprecation_notices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"resource_type" "report_resource_type" NOT NULL,
	"resource_id" integer NOT NULL,
	"title" varchar(128) NOT NULL,
	"message" text NOT NULL,
	"replacement_resource_type" "report_resource_type",
	"replacement_resource_id" integer,
	"effective_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"published_by" integer,
	"processed_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_dq_anomalies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_dq_anomalies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"dataset_id" integer NOT NULL,
	"rule_id" integer,
	"run_id" integer,
	"severity" "report_dq_severity" NOT NULL,
	"title" varchar(256) NOT NULL,
	"detail" text,
	"sample" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sample_row_count" integer DEFAULT 0 NOT NULL,
	"sample_bytes" bigint DEFAULT 0 NOT NULL,
	"status" "report_dq_anomaly_status" DEFAULT 'open' NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" integer,
	"acknowledgement_note" varchar(1000),
	"resolved_at" timestamp with time zone,
	"resolved_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_dq_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_dq_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"dataset_id" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"type" "report_dq_rule_type" NOT NULL,
	"field" varchar(128),
	"severity" "report_dq_severity" DEFAULT 'medium' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cron" varchar(64),
	"timezone" varchar(64) DEFAULT 'Asia/Shanghai' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_status" "report_dq_run_status",
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_dq_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_dq_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"rule_id" integer NOT NULL,
	"dataset_id" integer NOT NULL,
	"status" "report_dq_run_status" DEFAULT 'pending' NOT NULL,
	"trigger_type" varchar(32) NOT NULL,
	"checked_rows" bigint DEFAULT 0 NOT NULL,
	"failed_rows" bigint DEFAULT 0 NOT NULL,
	"pass_rate" double precision,
	"sample_rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sample_row_count" integer DEFAULT 0 NOT NULL,
	"sample_bytes" bigint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"error_message" varchar(1000),
	"schema_signature" varchar(128),
	"requested_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_dq_scores" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_dq_scores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"dataset_id" integer NOT NULL,
	"score" double precision NOT NULL,
	"passed_rules" integer DEFAULT 0 NOT NULL,
	"failed_rules" integer DEFAULT 0 NOT NULL,
	"total_rules" integer DEFAULT 0 NOT NULL,
	"dimensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_environment_promotions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_environment_promotions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"resource_type" "report_resource_type" NOT NULL,
	"resource_id" integer NOT NULL,
	"source_environment_id" integer NOT NULL,
	"target_environment_id" integer NOT NULL,
	"source_revision" integer NOT NULL,
	"source_snapshot" jsonb NOT NULL,
	"target_snapshot" jsonb,
	"rollback_snapshot" jsonb,
	"status" "report_promotion_status" DEFAULT 'pending' NOT NULL,
	"requested_by" integer,
	"approved_by" integer,
	"deployed_by" integer,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_message" varchar(1000),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_environments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_environments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"code" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"kind" "report_environment_kind" NOT NULL,
	"description" varchar(500),
	"base_url" varchar(1024),
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_fill_records" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_fill_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"template_id" integer NOT NULL,
	"submitter_id" integer NOT NULL,
	"status" "report_fill_record_status" DEFAULT 'draft' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"template_revision" integer NOT NULL,
	"template_schema_snapshot" jsonb NOT NULL,
	"template_need_review" boolean NOT NULL,
	"workflow_definition_id_snapshot" integer,
	"submit_comment" varchar(1000),
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" integer,
	"review_comment" varchar(1000),
	"workflow_instance_id" integer,
	"generated_dataset_id" integer,
	"sync_status" "report_fill_sync_status" DEFAULT 'pending' NOT NULL,
	"sync_task_id" integer,
	"sync_error" varchar(1000),
	"synced_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_fill_templates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_fill_templates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"folder_id" integer,
	"owner_id" integer,
	"code" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"form_schema" jsonb NOT NULL,
	"published_schema" jsonb,
	"published_revision" integer,
	"workflow_definition_id" integer,
	"need_review" boolean DEFAULT false NOT NULL,
	"generated_dataset_id" integer,
	"status" "report_fill_template_status" DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_materialization_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_materialization_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"dataset_id" integer NOT NULL,
	"strategy" "report_materialization_strategy" DEFAULT 'full' NOT NULL,
	"status" "report_snapshot_status" DEFAULT 'pending' NOT NULL,
	"revision" integer NOT NULL,
	"key_field" varchar(128),
	"watermark" varchar(256),
	"delta_window_minutes" integer,
	"file_id" uuid,
	"inline_data" jsonb,
	"row_count" bigint DEFAULT 0 NOT NULL,
	"byte_size" bigint DEFAULT 0 NOT NULL,
	"checksum" varchar(128),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"error_message" varchar(1000),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_metrics" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_metrics_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"folder_id" integer,
	"owner_id" integer,
	"code" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"type" "report_metric_type" NOT NULL,
	"dataset_id" integer NOT NULL,
	"source_field" varchar(128),
	"formula" text,
	"aggregate" varchar(32),
	"dimensions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"time_field" varchar(128),
	"unit" varchar(32),
	"format" varchar(128),
	"caliber" text,
	"lifecycle_status" "report_metric_lifecycle_status" DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"published_snapshot" jsonb,
	"published_at" timestamp with time zone,
	"published_by" integer,
	"deprecated_at" timestamp with time zone,
	"deprecated_by" integer,
	"deprecation_reason" varchar(500),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_publish_approvals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_publish_approvals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"resource_type" "report_resource_type" NOT NULL,
	"resource_id" integer NOT NULL,
	"action" varchar(16) NOT NULL,
	"requested_revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"status" "report_approval_status" DEFAULT 'pending' NOT NULL,
	"requested_by" integer,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" integer,
	"decided_at" timestamp with time zone,
	"decision_note" varchar(1000),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_query_cost_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_query_cost_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"user_id" integer,
	"dataset_id" integer,
	"datasource_id" integer,
	"scene" varchar(64) NOT NULL,
	"request_id" varchar(128) NOT NULL,
	"queued_ms" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"row_count" bigint DEFAULT 0 NOT NULL,
	"byte_size" bigint DEFAULT 0 NOT NULL,
	"cost_units" double precision DEFAULT 0 NOT NULL,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"error_code" varchar(64),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_query_quotas" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_query_quotas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"scope" "report_quota_scope" NOT NULL,
	"user_id" integer,
	"max_concurrent" integer NOT NULL,
	"daily_query_limit" bigint DEFAULT 0 NOT NULL,
	"daily_row_limit" bigint DEFAULT 0 NOT NULL,
	"daily_byte_limit" bigint DEFAULT 0 NOT NULL,
	"daily_cost_limit" double precision DEFAULT 0 NOT NULL,
	"reset_timezone" varchar(64) DEFAULT 'Asia/Shanghai' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_resource_acls" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_resource_acls_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"resource_type" "report_resource_type" NOT NULL,
	"resource_id" integer NOT NULL,
	"subject_type" "report_acl_subject_type" NOT NULL,
	"subject_id" integer NOT NULL,
	"role" "report_acl_role" NOT NULL,
	"inherit_from_folder" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"granted_by" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_resource_transfers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_resource_transfers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"resource_type" "report_resource_type" NOT NULL,
	"resource_id" integer NOT NULL,
	"from_owner_id" integer,
	"to_owner_id" integer NOT NULL,
	"status" "report_transfer_status" DEFAULT 'pending' NOT NULL,
	"reason" varchar(500),
	"requested_by" integer,
	"decided_by" integer,
	"decided_at" timestamp with time zone,
	"decision_note" varchar(500),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_sla_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_sla_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"dataset_id" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"type" "report_sla_type" NOT NULL,
	"target_value" double precision NOT NULL,
	"warning_value" double precision,
	"window_minutes" integer NOT NULL,
	"cron" varchar(64),
	"timezone" varchar(64) DEFAULT 'Asia/Shanghai' NOT NULL,
	"severity" "report_dq_severity" DEFAULT 'high' NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recipients" varchar(512),
	"webhook_url" varchar(512),
	"silence_mins" integer DEFAULT 60 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_evaluated_at" timestamp with time zone,
	"last_notified_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_sla_violations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_sla_violations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tenant_id" integer,
	"rule_id" integer NOT NULL,
	"dataset_id" integer NOT NULL,
	"status" "report_sla_violation_status" DEFAULT 'open' NOT NULL,
	"observed_value" double precision NOT NULL,
	"target_value" double precision NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"window_ended_at" timestamp with time zone NOT NULL,
	"detail" text,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" integer,
	"resolved_at" timestamp with time zone,
	"resolved_by" integer,
	"resolution_note" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_ad_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_ad_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"ad_id" integer NOT NULL,
	"slot_id" integer NOT NULL,
	"event_type" "cms_ad_event_type" NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"visitor_hash" varchar(64) NOT NULL,
	"ip_hash" varchar(64) NOT NULL,
	"user_agent" varchar(500),
	"device" "cms_device_type" DEFAULT 'pc' NOT NULL,
	"referrer" varchar(1000),
	"path" varchar(500),
	"member_id" integer,
	"dedupe_key" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_ad_slots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_ad_slots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"remark" varchar(200),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_ad_stats" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_ad_stats_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ad_id" integer NOT NULL,
	"stat_date" varchar(10) NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_ads" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_ads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slot_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"image" varchar(500),
	"link_url" varchar(500),
	"start_at" timestamp,
	"end_at" timestamp,
	"click_count" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_channel_users" (
	"channel_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	CONSTRAINT "cms_channel_users_channel_id_user_id_pk" PRIMARY KEY("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "cms_channels" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_channels_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"parent_id" integer DEFAULT 0 NOT NULL,
	"model_id" integer,
	"name" varchar(100) NOT NULL,
	"code" varchar(50) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"path" varchar(255) NOT NULL,
	"type" "cms_channel_type" DEFAULT 'list' NOT NULL,
	"link_url" varchar(500),
	"list_template" varchar(50),
	"detail_template" varchar(50),
	"static_mode" "cms_channel_static_mode" DEFAULT 'inherit' NOT NULL,
	"detail_path_rule" "cms_channel_detail_path_rule" DEFAULT 'none' NOT NULL,
	"page_size" integer DEFAULT 20 NOT NULL,
	"page_content" text,
	"seo_title" varchar(255),
	"seo_keywords" varchar(500),
	"seo_description" varchar(500),
	"image" varchar(500),
	"visible" boolean DEFAULT true NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_collect_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_collect_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"rule_id" integer NOT NULL,
	"url" varchar(500) NOT NULL,
	"title" varchar(255),
	"status" "cms_collect_item_status" NOT NULL,
	"content_id" integer,
	"error" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_collect_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_collect_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"channel_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"list_url" varchar(500) NOT NULL,
	"page_start" integer DEFAULT 1 NOT NULL,
	"page_end" integer DEFAULT 1 NOT NULL,
	"list_selector" varchar(200) NOT NULL,
	"title_selector" varchar(200) NOT NULL,
	"body_selector" varchar(200) NOT NULL,
	"summary_selector" varchar(200),
	"cover_selector" varchar(200),
	"remove_selectors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"auto_publish" boolean DEFAULT false NOT NULL,
	"localize_images" boolean DEFAULT false NOT NULL,
	"max_items" integer DEFAULT 50 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"last_run_at" timestamp,
	"remark" varchar(200),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_comments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"content_id" integer NOT NULL,
	"parent_id" integer DEFAULT 0 NOT NULL,
	"member_id" integer,
	"nickname" varchar(50) NOT NULL,
	"content" text NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"status" "cms_comment_status" DEFAULT 'pending' NOT NULL,
	"risk_flag" varchar(32),
	"ip" varchar(64),
	"user_agent" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_content_channels" (
	"content_id" integer NOT NULL,
	"channel_id" integer NOT NULL,
	CONSTRAINT "cms_content_channels_content_id_channel_id_pk" PRIMARY KEY("content_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "cms_content_favorites" (
	"member_id" integer NOT NULL,
	"content_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cms_content_favorites_member_id_content_id_pk" PRIMARY KEY("member_id","content_id")
);
--> statement-breakpoint
CREATE TABLE "cms_content_likes" (
	"member_id" integer NOT NULL,
	"content_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cms_content_likes_member_id_content_id_pk" PRIMARY KEY("member_id","content_id")
);
--> statement-breakpoint
CREATE TABLE "cms_content_op_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_content_op_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"content_id" integer NOT NULL,
	"action" varchar(30) NOT NULL,
	"detail" varchar(500),
	"operator_id" integer,
	"operator_name" varchar(50) DEFAULT '系统' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_content_relations" (
	"content_id" integer NOT NULL,
	"related_id" integer NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cms_content_relations_content_id_related_id_pk" PRIMARY KEY("content_id","related_id")
);
--> statement-breakpoint
CREATE TABLE "cms_content_tags" (
	"content_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "cms_content_tags_content_id_tag_id_pk" PRIMARY KEY("content_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "cms_content_tombstones" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_content_tombstones_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"content_id" integer NOT NULL,
	"deleted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_content_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_content_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"content_id" integer NOT NULL,
	"version" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"remark" varchar(200),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_contents" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_contents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"channel_id" integer NOT NULL,
	"model_id" integer,
	"content_type" "cms_content_type" DEFAULT 'article' NOT NULL,
	"media_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"title" varchar(255) NOT NULL,
	"title_style" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sub_title" varchar(255),
	"short_title" varchar(100),
	"slug" varchar(255),
	"summary" text,
	"cover_image" varchar(500),
	"author" varchar(50),
	"editor" varchar(50),
	"source" varchar(100),
	"source_url" varchar(500),
	"is_original" boolean DEFAULT false NOT NULL,
	"body" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extend" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_link" varchar(500),
	"detail_template" varchar(50),
	"static_path" varchar(255),
	"is_top" boolean DEFAULT false NOT NULL,
	"top_weight" integer DEFAULT 0 NOT NULL,
	"top_expire_at" timestamp,
	"is_recommend" boolean DEFAULT false NOT NULL,
	"is_hot" boolean DEFAULT false NOT NULL,
	"has_image" boolean DEFAULT false NOT NULL,
	"has_video" boolean DEFAULT false NOT NULL,
	"has_attachment" boolean DEFAULT false NOT NULL,
	"status" "cms_content_status" DEFAULT 'draft' NOT NULL,
	"reject_reason" varchar(500),
	"published_at" timestamp,
	"scheduled_at" timestamp,
	"expire_at" timestamp,
	"view_count" integer DEFAULT 0 NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"favorite_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"seo_title" varchar(255),
	"seo_keywords" varchar(500),
	"seo_description" varchar(500),
	"social_image_alt" varchar(255),
	"twitter_creator" varchar(100),
	"search_vector" "tsvector",
	"deleted_at" timestamp,
	"archived_at" timestamp,
	"mapping_source_id" integer,
	"distribution_rule_id" integer,
	"distribution_source_id" integer,
	"distribution_source_version" integer,
	"member_id" integer,
	"dept_id" integer,
	"locked_at" timestamp,
	"locked_by" integer,
	"lock_reason" varchar(500),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_distribution_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_distribution_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(100) NOT NULL,
	"source_site_id" integer NOT NULL,
	"source_channel_id" integer,
	"target_site_id" integer NOT NULL,
	"target_channel_id" integer NOT NULL,
	"mode" "cms_distribution_mode" DEFAULT 'copy' NOT NULL,
	"conflict_strategy" "cms_distribution_conflict_strategy" DEFAULT 'skip' NOT NULL,
	"filters" jsonb DEFAULT '{"statuses":["published"],"contentTypes":[],"keyword":null,"publishedFrom":null,"publishedTo":null}'::jsonb NOT NULL,
	"schedule_cron" varchar(100),
	"next_run_at" timestamp,
	"last_run_at" timestamp,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"remark" varchar(500),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_error_prone_words" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_error_prone_words_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"word" varchar(50) NOT NULL,
	"correction" varchar(50) NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(200),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cms_error_prone_words_word_unique" UNIQUE("word")
);
--> statement-breakpoint
CREATE TABLE "cms_form_submissions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_form_submissions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"form_id" integer NOT NULL,
	"data" jsonb NOT NULL,
	"ip" varchar(64),
	"user_agent" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_forms" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_forms_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"success_message" varchar(255),
	"notify_email" varchar(255),
	"captcha_provider" "cms_form_captcha_provider" DEFAULT 'inherit' NOT NULL,
	"turnstile_site_key" varchar(200),
	"turnstile_secret" varchar(500),
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_friend_link_groups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_friend_link_groups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(50) NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"remark" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_friend_links" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_friend_links_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"group_id" integer,
	"name" varchar(100) NOT NULL,
	"url" varchar(500) NOT NULL,
	"logo" varchar(500),
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"remark" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_hotword_groups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_hotword_groups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_hotwords" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_hotwords_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"group_id" integer,
	"keyword" varchar(100) NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_interaction_answers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_interaction_answers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"response_id" integer NOT NULL,
	"question_id" integer NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_interaction_questions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_interaction_questions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"interaction_id" integer NOT NULL,
	"label" varchar(200) NOT NULL,
	"type" "cms_interaction_question_type" DEFAULT 'single' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"min_choices" integer DEFAULT 1 NOT NULL,
	"max_choices" integer DEFAULT 1 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"allow_other" boolean DEFAULT false NOT NULL,
	"other_label" varchar(50),
	"rating_max" integer DEFAULT 5 NOT NULL,
	"matrix_rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"page_no" integer DEFAULT 1 NOT NULL,
	"visible_when" jsonb
);
--> statement-breakpoint
CREATE TABLE "cms_interaction_responses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_interaction_responses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"interaction_id" integer NOT NULL,
	"member_id" integer,
	"visitor_hash" varchar(64) NOT NULL,
	"ip_hash" varchar(64) NOT NULL,
	"repeat_key" varchar(80),
	"request_key" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_interactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_interactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"code" varchar(50) NOT NULL,
	"kind" "cms_interaction_kind" NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"status" "cms_interaction_status" DEFAULT 'draft' NOT NULL,
	"participant_scope" "cms_interaction_participant_scope" DEFAULT 'anonymous' NOT NULL,
	"repeat_policy" "cms_interaction_repeat_policy" DEFAULT 'once_per_ip' NOT NULL,
	"result_visibility" "cms_interaction_result_visibility" DEFAULT 'after_submit' NOT NULL,
	"captcha_policy" "cms_interaction_captcha_policy" DEFAULT 'inherit' NOT NULL,
	"turnstile_site_key" varchar(200),
	"turnstile_secret" varchar(500),
	"thank_you_message" varchar(500) DEFAULT '感谢您的参与！' NOT NULL,
	"start_at" timestamp,
	"end_at" timestamp,
	"response_count" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_link_words" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_link_words_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"keyword" varchar(50) NOT NULL,
	"url" varchar(500) NOT NULL,
	"max_replaces" integer DEFAULT 1 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_member_subscriptions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_member_subscriptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"member_id" integer NOT NULL,
	"site_id" integer NOT NULL,
	"subject_type" "cms_subscription_subject_type" NOT NULL,
	"subject_key" varchar(255) NOT NULL,
	"subject_id" integer,
	"subject_label" varchar(255) NOT NULL,
	"notification_enabled" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"points_awarded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_member_view_history" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_member_view_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"member_id" integer NOT NULL,
	"content_id" integer NOT NULL,
	"site_id" integer NOT NULL,
	"view_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_model_fields" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_model_fields_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"model_id" integer NOT NULL,
	"name" varchar(50) NOT NULL,
	"label" varchar(100) NOT NULL,
	"field_type" "cms_field_type" DEFAULT 'text' NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"searchable" boolean DEFAULT false NOT NULL,
	"show_in_list" boolean DEFAULT false NOT NULL,
	"show_in_detail" boolean DEFAULT false NOT NULL,
	"detail_group" varchar(50),
	"detail_sort" integer DEFAULT 0 NOT NULL,
	"placeholder" varchar(200),
	"default_value" text,
	"option_source" "cms_field_option_source" DEFAULT 'manual' NOT NULL,
	"dict_code" varchar(64),
	"options" jsonb,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_models" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_models_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"owner_site_id" integer,
	"name" varchar(100) NOT NULL,
	"code" varchar(50) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cms_models_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "cms_open_app_grants" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_open_app_grants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"client_id" varchar(64) NOT NULL,
	"site_id" integer NOT NULL,
	"channel_ids" integer[] DEFAULT '{}' NOT NULL,
	"can_publish" boolean DEFAULT false NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(200),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_page_block_acls" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_page_block_acls_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"page_id" integer NOT NULL,
	"block_id" varchar(100) NOT NULL,
	"subject_type" "cms_page_block_acl_subject_type" NOT NULL,
	"subject_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_pages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_pages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"path" varchar(200),
	"is_home" boolean DEFAULT false NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requires_dynamic" boolean DEFAULT false NOT NULL,
	"seo_title" varchar(255),
	"seo_keywords" varchar(500),
	"seo_description" varchar(500),
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(200),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_publish_artifacts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_publish_artifacts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"task_id" integer NOT NULL,
	"site_id" integer NOT NULL,
	"target_type" "cms_publish_target_type" NOT NULL,
	"content_id" integer,
	"channel_id" integer,
	"page_id" integer,
	"theme_code" varchar(50),
	"path" varchar(1000) NOT NULL,
	"url" varchar(1000),
	"checksum" varchar(64),
	"size" integer,
	"public_revision" integer DEFAULT 0 NOT NULL,
	"status" "cms_publish_artifact_status" NOT NULL,
	"error" text,
	"generated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_push_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_push_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"engine" varchar(20) NOT NULL,
	"urls" jsonb NOT NULL,
	"success" boolean NOT NULL,
	"status_code" integer,
	"response" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_redirects" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_redirects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"from_path" varchar(500) NOT NULL,
	"to_url" varchar(500) NOT NULL,
	"redirect_type" integer DEFAULT 301 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(200),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_resource_folders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_resource_folders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"parent_id" integer,
	"name" varchar(100) NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_resource_refs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_resource_refs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"resource_id" integer NOT NULL,
	"owner_type" "cms_resource_owner_type" NOT NULL,
	"owner_id" integer NOT NULL,
	"field" varchar(64) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_resources" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_resources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"folder_id" integer,
	"type" "cms_resource_type" DEFAULT 'image' NOT NULL,
	"name" varchar(255) NOT NULL,
	"url" varchar(500) NOT NULL,
	"thumb_url" varchar(500),
	"file_id" uuid,
	"owns_file" boolean DEFAULT true NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"mime_type" varchar(128),
	"remark" varchar(200),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_search_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_search_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"keyword" varchar(64) NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"ip" varchar(64),
	"device_type" "cms_device_type" DEFAULT 'pc' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_search_words" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_search_words_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"word" varchar(50) NOT NULL,
	"type" "cms_search_word_type" DEFAULT 'extension' NOT NULL,
	"group_name" varchar(100) DEFAULT '默认分组' NOT NULL,
	"weight" integer DEFAULT 1000 NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"remark" varchar(200),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_sensitive_words" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_sensitive_words_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"word" varchar(50) NOT NULL,
	"replace_with" varchar(50),
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cms_sensitive_words_word_unique" UNIQUE("word")
);
--> statement-breakpoint
CREATE TABLE "cms_site_inheritances" (
	"site_id" integer PRIMARY KEY NOT NULL,
	"seo_title" boolean DEFAULT false NOT NULL,
	"seo_keywords" boolean DEFAULT false NOT NULL,
	"seo_description" boolean DEFAULT false NOT NULL,
	"static_mode" boolean DEFAULT false NOT NULL,
	"review_mode" boolean DEFAULT false NOT NULL,
	"webhook" boolean DEFAULT false NOT NULL,
	"cdn" boolean DEFAULT false NOT NULL,
	"theme" boolean DEFAULT false NOT NULL,
	"theme_config" boolean DEFAULT false NOT NULL,
	"templates" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_site_users" (
	"site_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	CONSTRAINT "cms_site_users_site_id_user_id_pk" PRIMARY KEY("site_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "cms_sites" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_sites_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"parent_id" integer,
	"name" varchar(100) NOT NULL,
	"code" varchar(50) NOT NULL,
	"domain" varchar(255),
	"alias_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"title" varchar(200),
	"keywords" varchar(500),
	"description" varchar(1000),
	"logo" varchar(500),
	"favicon" varchar(500),
	"icp" varchar(100),
	"copyright" varchar(255),
	"theme" varchar(50) DEFAULT 'default' NOT NULL,
	"model_id" integer,
	"extend" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"theme_revision" integer DEFAULT 0 NOT NULL,
	"template_refs_revision" integer DEFAULT 0 NOT NULL,
	"public_revision" integer DEFAULT 0 NOT NULL,
	"static_mode" "cms_static_mode" DEFAULT 'hybrid' NOT NULL,
	"robots" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"remark" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cms_sites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "cms_tags" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_tags_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"name" varchar(50) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"group_name" varchar(50),
	"content_count" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_visit_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_visit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"path" varchar(500) NOT NULL,
	"page_kind" varchar(20) DEFAULT 'other' NOT NULL,
	"content_id" integer,
	"visitor_hash" varchar(32) NOT NULL,
	"ip" varchar(64),
	"device_type" "cms_device_type" DEFAULT 'pc' NOT NULL,
	"referrer_host" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_widget_refs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_widget_refs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"widget_id" integer NOT NULL,
	"owner_type" "cms_widget_ref_owner_type" NOT NULL,
	"owner_id" integer NOT NULL,
	"field" varchar(100) NOT NULL,
	"renderer_key" varchar(50) NOT NULL,
	"style_props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_widget_source_refs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_widget_source_refs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"widget_id" integer NOT NULL,
	"item_id" varchar(100) NOT NULL,
	"source_type" "cms_widget_source_type" NOT NULL,
	"source_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_widgets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cms_widgets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"site_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(100) NOT NULL,
	"type" "cms_widget_type" DEFAULT 'manual-list' NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"draft_data" jsonb DEFAULT '{"items":[]}'::jsonb NOT NULL,
	"published_data" jsonb,
	"published_name" varchar(100),
	"draft_revision" integer DEFAULT 1 NOT NULL,
	"published_revision" integer DEFAULT 0 NOT NULL,
	"status" "cms_widget_status" DEFAULT 'draft' NOT NULL,
	"default_renderer_key" varchar(50) DEFAULT 'list-sidebar' NOT NULL,
	"remark" varchar(200),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_comments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wiki_comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"doc_id" integer NOT NULL,
	"parent_id" integer,
	"content" varchar(1000) NOT NULL,
	"status" "wiki_comment_status" DEFAULT 'visible' NOT NULL,
	"mentioned_user_ids" integer[] DEFAULT '{}' NOT NULL,
	"is_question" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp,
	"author_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_doc_favorites" (
	"doc_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_doc_favorites_doc_id_user_id_pk" PRIMARY KEY("doc_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "wiki_doc_read_receipts" (
	"doc_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_doc_read_receipts_doc_id_user_id_pk" PRIMARY KEY("doc_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "wiki_doc_subscriptions" (
	"doc_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_doc_subscriptions_doc_id_user_id_pk" PRIMARY KEY("doc_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "wiki_doc_tags" (
	"doc_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "wiki_doc_tags_doc_id_tag_id_pk" PRIMARY KEY("doc_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "wiki_doc_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wiki_doc_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"doc_id" integer NOT NULL,
	"version" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"change_note" varchar(300),
	"author_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_doc_versions_doc_version_uk" UNIQUE("doc_id","version")
);
--> statement-breakpoint
CREATE TABLE "wiki_doc_views" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wiki_doc_views_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"doc_id" integer NOT NULL,
	"user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_docs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wiki_docs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"space_id" integer NOT NULL,
	"parent_id" integer,
	"title" varchar(200) NOT NULL,
	"summary" varchar(500),
	"content" text DEFAULT '' NOT NULL,
	"status" "wiki_doc_status" DEFAULT 'draft' NOT NULL,
	"reject_reason" varchar(500),
	"sort" integer DEFAULT 0 NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"require_read_receipt" boolean DEFAULT false NOT NULL,
	"owner_id" integer,
	"expire_at" timestamp,
	"review_cycle_days" integer,
	"next_review_at" timestamp,
	"is_archived" boolean DEFAULT false NOT NULL,
	"published_at" timestamp,
	"deleted_at" timestamp,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_review_records" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wiki_review_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"doc_id" integer NOT NULL,
	"version" integer NOT NULL,
	"action" "wiki_review_action" NOT NULL,
	"actor_id" integer,
	"reason" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_search_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wiki_search_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"keyword" varchar(200) NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"clicked_doc_id" integer,
	"user_id" integer,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_space_members" (
	"space_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" "wiki_space_member_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_space_members_space_id_user_id_pk" PRIMARY KEY("space_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "wiki_spaces" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wiki_spaces_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(100) NOT NULL,
	"description" varchar(300),
	"icon" varchar(50),
	"visibility" "wiki_space_visibility" DEFAULT 'public' NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"ai_sync_enabled" boolean DEFAULT false NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_tags" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wiki_tags_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(50) NOT NULL,
	"color" varchar(20),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "wiki_templates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wiki_templates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(100) NOT NULL,
	"description" varchar(300),
	"content" text DEFAULT '' NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "short_link_clicks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "short_link_clicks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"link_id" integer NOT NULL,
	"visitor_id" varchar(40),
	"ip" varchar(64),
	"country" varchar(64),
	"province" varchar(64),
	"city" varchar(64),
	"device_type" varchar(16),
	"os" varchar(64),
	"browser" varchar(64),
	"referer" varchar(512),
	"is_bot" boolean DEFAULT false NOT NULL,
	"clicked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "short_link_daily_stats" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "short_link_daily_stats_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"link_id" integer NOT NULL,
	"stat_date" date NOT NULL,
	"pv" integer DEFAULT 0 NOT NULL,
	"uv" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "short_links" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "short_links_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" varchar(32) NOT NULL,
	"target_url" text NOT NULL,
	"title" varchar(128),
	"redirect_type" "short_link_redirect_type" DEFAULT '302' NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"expires_at" timestamp,
	"max_visits" integer,
	"password" varchar(32),
	"utm_source" varchar(128),
	"utm_medium" varchar(128),
	"utm_campaign" varchar(128),
	"utm_term" varchar(128),
	"utm_content" varchar(128),
	"biz_type" varchar(32) DEFAULT 'custom' NOT NULL,
	"biz_ref" varchar(64),
	"remark" varchar(256),
	"total_pv" integer DEFAULT 0 NOT NULL,
	"last_visit_at" timestamp,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "short_links_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "marketing_campaigns" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "marketing_campaigns_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(128) NOT NULL,
	"type" "marketing_campaign_type" DEFAULT 'lottery' NOT NULL,
	"status" "marketing_campaign_status" DEFAULT 'draft' NOT NULL,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp NOT NULL,
	"per_member_limit" integer DEFAULT 1 NOT NULL,
	"daily_per_member_limit" integer,
	"landing_url" varchar(2048),
	"description" text,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_participations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "marketing_participations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"campaign_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"prize_id" integer,
	"prize_name" varchar(128),
	"grant_status" "marketing_grant_status" DEFAULT 'none' NOT NULL,
	"grant_note" varchar(256),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_prizes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "marketing_prizes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"campaign_id" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"prize_type" "marketing_prize_type" NOT NULL,
	"points" integer,
	"coupon_id" integer,
	"stock" integer DEFAULT 0 NOT NULL,
	"total_stock" integer DEFAULT 0 NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_alarm_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_alarm_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(128) NOT NULL,
	"product_id" integer NOT NULL,
	"device_id" integer,
	"rule_type" "iot_alarm_rule_type" NOT NULL,
	"property_identifier" varchar(64),
	"operator" "iot_compare_op",
	"threshold" double precision,
	"consecutive_count" integer DEFAULT 1 NOT NULL,
	"offline_minutes" integer,
	"event_identifier" varchar(64),
	"level" "iot_alarm_level" DEFAULT 'warning' NOT NULL,
	"notify_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"escalate_after_minutes" integer,
	"escalate_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_alarms" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_alarms_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"rule_id" integer,
	"rule_name" varchar(128) NOT NULL,
	"device_id" integer NOT NULL,
	"rule_type" "iot_alarm_rule_type" NOT NULL,
	"level" "iot_alarm_level" NOT NULL,
	"status" "iot_alarm_status" DEFAULT 'firing' NOT NULL,
	"message" varchar(512) NOT NULL,
	"context" jsonb,
	"fired_at" timestamp DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp,
	"acknowledged_by" integer,
	"escalated_at" timestamp,
	"resolved_at" timestamp,
	"resolved_by" integer,
	"resolve_note" varchar(512),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_automation_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_automation_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"automation_id" integer NOT NULL,
	"automation_name" varchar(128) NOT NULL,
	"device_id" integer NOT NULL,
	"trigger_context" jsonb NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_automations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_automations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(128) NOT NULL,
	"product_id" integer NOT NULL,
	"device_id" integer,
	"trigger_type" "iot_automation_trigger" NOT NULL,
	"property_identifier" varchar(64),
	"operator" "iot_compare_op",
	"threshold" double precision,
	"event_identifier" varchar(64),
	"decision_rule_key" varchar(64),
	"cooldown_seconds" integer DEFAULT 60 NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_commands" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_commands_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"device_id" integer NOT NULL,
	"service" varchar(64) NOT NULL,
	"params" jsonb,
	"status" "iot_command_status" DEFAULT 'pending' NOT NULL,
	"expire_at" timestamp NOT NULL,
	"sent_at" timestamp,
	"acked_at" timestamp,
	"response" jsonb,
	"error_msg" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_device_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_device_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"device_id" integer NOT NULL,
	"kind" "iot_device_event_kind" NOT NULL,
	"identifier" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"level" "iot_event_level" DEFAULT 'info' NOT NULL,
	"payload" jsonb,
	"reported_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_device_group_members" (
	"group_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	CONSTRAINT "iot_device_group_members_group_id_device_id_pk" PRIMARY KEY("group_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "iot_device_groups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_device_groups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(64) NOT NULL,
	"description" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_device_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_device_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"device_id" integer NOT NULL,
	"level" "iot_log_level" DEFAULT 'info' NOT NULL,
	"tag" varchar(64),
	"content" varchar(1024) NOT NULL,
	"reported_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_device_state" (
	"device_id" integer PRIMARY KEY NOT NULL,
	"reported" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reported_at" timestamp,
	"desired" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"desired_version" integer DEFAULT 0 NOT NULL,
	"desired_at" timestamp,
	"online" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_device_whitelist" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_device_whitelist_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"product_id" integer NOT NULL,
	"sn" varchar(64) NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"used_at" timestamp,
	"device_id" integer,
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "iot_device_whitelist_sn_unique" UNIQUE("sn")
);
--> statement-breakpoint
CREATE TABLE "iot_devices" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_devices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sn" varchar(64) NOT NULL,
	"secret" varchar(64) NOT NULL,
	"product_id" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"node_type" "iot_node_type" DEFAULT 'direct' NOT NULL,
	"gateway_id" integer,
	"latitude" double precision,
	"longitude" double precision,
	"address" varchar(256),
	"firmware_version" varchar(32),
	"activated_at" timestamp,
	"last_seen_at" timestamp,
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "iot_devices_sn_unique" UNIQUE("sn")
);
--> statement-breakpoint
CREATE TABLE "iot_firmwares" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_firmwares_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"product_id" integer NOT NULL,
	"version" varchar(32) NOT NULL,
	"file_id" uuid,
	"file_name" varchar(255) NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"release_notes" text,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_forward_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_forward_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"rule_id" integer NOT NULL,
	"rule_name" varchar(128) NOT NULL,
	"source" "iot_forward_source" NOT NULL,
	"device_id" integer,
	"payload" jsonb NOT NULL,
	"status" "iot_forward_status" NOT NULL,
	"response_status" integer,
	"error_message" varchar(512),
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_forward_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_forward_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(128) NOT NULL,
	"source" "iot_forward_source" NOT NULL,
	"product_id" integer,
	"group_id" integer,
	"url" varchar(512) NOT NULL,
	"secret" varchar(128),
	"headers" jsonb,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"auto_disabled_at" timestamp,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_maintenance_windows" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_maintenance_windows_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(128) NOT NULL,
	"product_id" integer,
	"group_id" integer,
	"device_id" integer,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp NOT NULL,
	"reason" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_online_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_online_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"total_count" integer NOT NULL,
	"online_count" integer NOT NULL,
	"sampled_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_ota_task_devices" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_ota_task_devices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"task_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"status" "iot_ota_device_status" DEFAULT 'pending' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"from_version" varchar(32),
	"batch_index" integer DEFAULT 1 NOT NULL,
	"error_msg" varchar(256),
	"notified_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_ota_tasks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_ota_tasks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" varchar(128) NOT NULL,
	"firmware_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"firmware_version" varchar(32) NOT NULL,
	"status" "iot_ota_task_status" DEFAULT 'running' NOT NULL,
	"timeout_minutes" integer DEFAULT 30 NOT NULL,
	"batch_size" integer,
	"current_batch" integer DEFAULT 1 NOT NULL,
	"failure_threshold" integer,
	"total_count" integer DEFAULT 0 NOT NULL,
	"succeeded_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_product_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_product_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"product_id" integer NOT NULL,
	"identifier" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"level" "iot_event_level" DEFAULT 'info' NOT NULL,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"description" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_product_properties" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_product_properties_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"product_id" integer NOT NULL,
	"identifier" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"data_type" "iot_property_type" NOT NULL,
	"access_mode" "iot_access_mode" DEFAULT 'r' NOT NULL,
	"unit" varchar(16),
	"min_value" double precision,
	"max_value" double precision,
	"enum_options" jsonb,
	"featured" boolean DEFAULT false NOT NULL,
	"anomaly_enabled" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"description" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_product_services" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_product_services_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"product_id" integer NOT NULL,
	"identifier" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"danger" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"description" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_products" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_products_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(128) NOT NULL,
	"description" text,
	"validation_mode" "iot_validation_mode" DEFAULT 'loose' NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"registration_secret" varchar(64),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_schedule_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_schedule_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"schedule_id" integer NOT NULL,
	"schedule_name" varchar(128) NOT NULL,
	"device_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_schedules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_schedules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(128) NOT NULL,
	"schedule_type" "iot_schedule_type" NOT NULL,
	"cron_expression" varchar(64),
	"run_at" timestamp,
	"product_id" integer NOT NULL,
	"group_id" integer,
	"device_id" integer,
	"action_type" "iot_schedule_action" NOT NULL,
	"service" varchar(64),
	"params" jsonb,
	"desired" jsonb,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"next_run_at" timestamp,
	"last_run_at" timestamp,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_telemetry" (
	"device_id" integer NOT NULL,
	"metrics" jsonb NOT NULL,
	"reported_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iot_telemetry_hourly" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "iot_telemetry_hourly_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"device_id" integer NOT NULL,
	"property" varchar(64) NOT NULL,
	"bucket" timestamp NOT NULL,
	"min_value" double precision NOT NULL,
	"max_value" double precision NOT NULL,
	"avg_value" double precision NOT NULL,
	"last_value" double precision NOT NULL,
	"count" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_activities" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drive_activities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"space_id" integer NOT NULL,
	"node_id" integer,
	"node_name" varchar(255) NOT NULL,
	"node_type" "drive_node_type" NOT NULL,
	"action" "drive_activity_action" NOT NULL,
	"actor_id" integer,
	"share_id" integer,
	"detail" jsonb,
	"client_ip" varchar(64),
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_file_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drive_file_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"node_id" integer NOT NULL,
	"version" integer NOT NULL,
	"file_id" uuid NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	"content_hash" varchar(64),
	"comment" varchar(500),
	"author_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "drive_file_versions_node_version_unique" UNIQUE("node_id","version")
);
--> statement-breakpoint
CREATE TABLE "drive_node_comments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drive_node_comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"node_id" integer NOT NULL,
	"parent_id" integer,
	"content" varchar(2000) NOT NULL,
	"author_id" integer,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_node_permissions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drive_node_permissions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"node_id" integer NOT NULL,
	"subject_type" "drive_subject_type" NOT NULL,
	"subject_id" integer NOT NULL,
	"role" "drive_role" NOT NULL,
	"expire_at" timestamp,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "drive_node_permissions_node_subject_unique" UNIQUE("node_id","subject_type","subject_id")
);
--> statement-breakpoint
CREATE TABLE "drive_node_stars" (
	"user_id" integer NOT NULL,
	"node_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "drive_node_stars_user_id_node_id_pk" PRIMARY KEY("user_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "drive_node_tags" (
	"node_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "drive_node_tags_node_id_tag_id_pk" PRIMARY KEY("node_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "drive_node_texts" (
	"node_id" integer PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"search_vector" "tsvector",
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_nodes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drive_nodes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"space_id" integer NOT NULL,
	"parent_id" integer,
	"ancestor_ids" integer[] DEFAULT '{}' NOT NULL,
	"depth" smallint DEFAULT 0 NOT NULL,
	"type" "drive_node_type" NOT NULL,
	"name" varchar(255) NOT NULL,
	"extension" varchar(32),
	"mime_type" varchar(128),
	"file_id" uuid,
	"size" bigint DEFAULT 0 NOT NULL,
	"content_hash" varchar(64),
	"current_version" integer DEFAULT 1 NOT NULL,
	"inherit_permissions" boolean DEFAULT true NOT NULL,
	"locked_by" integer,
	"locked_at" timestamp,
	"lock_expires_at" timestamp,
	"thumbnail_file_id" uuid,
	"deleted_at" timestamp,
	"deleted_by" integer,
	"deleted_root_id" integer,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_recent_access" (
	"user_id" integer NOT NULL,
	"node_id" integer NOT NULL,
	"action" "drive_activity_action" NOT NULL,
	"last_access_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "drive_recent_access_user_id_node_id_pk" PRIMARY KEY("user_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "drive_share_access_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drive_share_access_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"share_id" integer NOT NULL,
	"node_id" integer NOT NULL,
	"action" varchar(16) NOT NULL,
	"client_ip" varchar(64),
	"ok" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_share_links" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drive_share_links_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"node_id" integer NOT NULL,
	"token" varchar(64) NOT NULL,
	"token_encrypted" varchar(256),
	"password_hash" varchar(100),
	"permission" "drive_share_permission" DEFAULT 'preview' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"expire_at" timestamp,
	"max_access_count" integer,
	"access_count" integer DEFAULT 0 NOT NULL,
	"download_count" integer DEFAULT 0 NOT NULL,
	"session_version" integer DEFAULT 1 NOT NULL,
	"revoked_at" timestamp,
	"remark" varchar(256),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "drive_share_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "drive_space_members" (
	"space_id" integer NOT NULL,
	"subject_type" "drive_subject_type" NOT NULL,
	"subject_id" integer NOT NULL,
	"role" "drive_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "drive_space_members_space_id_subject_type_subject_id_pk" PRIMARY KEY("space_id","subject_type","subject_id")
);
--> statement-breakpoint
CREATE TABLE "drive_spaces" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drive_spaces_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" "drive_space_type" NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(300),
	"icon" varchar(50),
	"owner_id" integer,
	"department_id" integer,
	"default_member_role" "drive_role",
	"quota_bytes" bigint,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	"max_versions" integer,
	"allow_external_share" boolean DEFAULT true NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_tags" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drive_tags_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"space_id" integer NOT NULL,
	"name" varchar(50) NOT NULL,
	"color" varchar(20),
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "drive_tags_space_name_unique" UNIQUE("space_id","name")
);
--> statement-breakpoint
CREATE TABLE "drive_upload_bindings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drive_upload_bindings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"upload_id" varchar(64) NOT NULL,
	"space_id" integer NOT NULL,
	"parent_id" integer,
	"node_id" integer,
	"file_name" varchar(255) NOT NULL,
	"file_size" bigint NOT NULL,
	"conflict_policy" "drive_upload_conflict_policy" DEFAULT 'rename' NOT NULL,
	"expected_hash" varchar(64),
	"tenant_id" integer,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "drive_upload_bindings_upload_id_unique" UNIQUE("upload_id")
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
ALTER TABLE "tenant_package_features" ADD CONSTRAINT "tenant_package_features_package_id_tenant_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."tenant_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_packages" ADD CONSTRAINT "tenant_packages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_packages" ADD CONSTRAINT "tenant_packages_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_package_id_tenant_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."tenant_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_dept_scopes" ADD CONSTRAINT "user_dept_scopes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_dept_scopes" ADD CONSTRAINT "user_dept_scopes_dept_id_departments_id_fk" FOREIGN KEY ("dept_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_members" ADD CONSTRAINT "user_group_members_group_id_user_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_members" ADD CONSTRAINT "user_group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_roles" ADD CONSTRAINT "user_group_roles_group_id_user_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_roles" ADD CONSTRAINT "user_group_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "system_scheduler_runs" ADD CONSTRAINT "system_scheduler_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_scheduler_runs" ADD CONSTRAINT "system_scheduler_runs_alert_ack_by_users_id_fk" FOREIGN KEY ("alert_ack_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_feedbacks" ADD CONSTRAINT "user_feedbacks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_feedbacks" ADD CONSTRAINT "user_feedbacks_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "directory_sync_conflicts" ADD CONSTRAINT "directory_sync_conflicts_source_id_directory_sync_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."directory_sync_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_sync_conflicts" ADD CONSTRAINT "directory_sync_conflicts_run_id_directory_sync_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."directory_sync_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_sync_conflicts" ADD CONSTRAINT "directory_sync_conflicts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_sync_dept_links" ADD CONSTRAINT "directory_sync_dept_links_source_id_directory_sync_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."directory_sync_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_sync_dept_links" ADD CONSTRAINT "directory_sync_dept_links_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_sync_run_items" ADD CONSTRAINT "directory_sync_run_items_run_id_directory_sync_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."directory_sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_sync_runs" ADD CONSTRAINT "directory_sync_runs_source_id_directory_sync_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."directory_sync_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_sync_runs" ADD CONSTRAINT "directory_sync_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_sync_sources" ADD CONSTRAINT "directory_sync_sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_sync_sources" ADD CONSTRAINT "directory_sync_sources_identity_provider_id_tenant_identity_providers_id_fk" FOREIGN KEY ("identity_provider_id") REFERENCES "public"."tenant_identity_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_sync_sources" ADD CONSTRAINT "directory_sync_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_sync_sources" ADD CONSTRAINT "directory_sync_sources_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_sync_user_links" ADD CONSTRAINT "directory_sync_user_links_source_id_directory_sync_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."directory_sync_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_sync_user_links" ADD CONSTRAINT "directory_sync_user_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dict_items" ADD CONSTRAINT "dict_items_dict_id_dicts_id_fk" FOREIGN KEY ("dict_id") REFERENCES "public"."dicts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dict_items" ADD CONSTRAINT "dict_items_parent_id_dict_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."dict_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dict_items" ADD CONSTRAINT "dict_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dict_items" ADD CONSTRAINT "dict_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dicts" ADD CONSTRAINT "dicts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dicts" ADD CONSTRAINT "dicts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dicts" ADD CONSTRAINT "dicts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_logs" ADD CONSTRAINT "login_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_event_meta" ADD CONSTRAINT "analytics_event_meta_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_event_meta" ADD CONSTRAINT "analytics_event_meta_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_event_meta" ADD CONSTRAINT "analytics_event_meta_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_event_overrides" ADD CONSTRAINT "analytics_event_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_event_overrides" ADD CONSTRAINT "analytics_event_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_event_overrides" ADD CONSTRAINT "analytics_event_overrides_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_experiments" ADD CONSTRAINT "analytics_experiments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_experiments" ADD CONSTRAINT "analytics_experiments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_experiments" ADD CONSTRAINT "analytics_experiments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_identity_map" ADD CONSTRAINT "analytics_identity_map_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_saved_reports" ADD CONSTRAINT "analytics_saved_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_segment_campaigns" ADD CONSTRAINT "analytics_segment_campaigns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_segment_campaigns" ADD CONSTRAINT "analytics_segment_campaigns_segment_id_analytics_user_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."analytics_user_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_segment_campaigns" ADD CONSTRAINT "analytics_segment_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_segment_campaigns" ADD CONSTRAINT "analytics_segment_campaigns_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_segment_members" ADD CONSTRAINT "analytics_segment_members_segment_id_analytics_user_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."analytics_user_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_segment_members" ADD CONSTRAINT "analytics_segment_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_sessions" ADD CONSTRAINT "analytics_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_sessions" ADD CONSTRAINT "analytics_sessions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_settings" ADD CONSTRAINT "analytics_settings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_settings" ADD CONSTRAINT "analytics_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_sites" ADD CONSTRAINT "analytics_sites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_sites" ADD CONSTRAINT "analytics_sites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_sites" ADD CONSTRAINT "analytics_sites_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_user_profiles" ADD CONSTRAINT "analytics_user_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_user_segments" ADD CONSTRAINT "analytics_user_segments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_user_segments" ADD CONSTRAINT "analytics_user_segments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_user_segments" ADD CONSTRAINT "analytics_user_segments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_alert_logs" ADD CONSTRAINT "error_alert_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_alert_logs" ADD CONSTRAINT "error_alert_logs_rule_id_error_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."error_alert_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_alert_rules" ADD CONSTRAINT "error_alert_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_alert_rules" ADD CONSTRAINT "error_alert_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_alert_rules" ADD CONSTRAINT "error_alert_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_group_id_error_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."error_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_group_identities" ADD CONSTRAINT "error_group_identities_group_id_error_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."error_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_groups" ADD CONSTRAINT "error_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_groups" ADD CONSTRAINT "error_groups_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_groups" ADD CONSTRAINT "error_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_groups" ADD CONSTRAINT "error_groups_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replay_access_logs" ADD CONSTRAINT "replay_access_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replay_click_points" ADD CONSTRAINT "replay_click_points_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replay_segments" ADD CONSTRAINT "replay_segments_replay_id_replay_sessions_id_fk" FOREIGN KEY ("replay_id") REFERENCES "public"."replay_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replay_sessions" ADD CONSTRAINT "replay_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replay_sessions" ADD CONSTRAINT "replay_sessions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_maps" ADD CONSTRAINT "source_maps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_maps" ADD CONSTRAINT "source_maps_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_maps" ADD CONSTRAINT "source_maps_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_events" ADD CONSTRAINT "user_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_events" ADD CONSTRAINT "user_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_automation_runs" ADD CONSTRAINT "workflow_automation_runs_rule_id_workflow_automations_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."workflow_automations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_automation_runs" ADD CONSTRAINT "workflow_automation_runs_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_automation_runs" ADD CONSTRAINT "workflow_automation_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_automations" ADD CONSTRAINT "workflow_automations_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_automations" ADD CONSTRAINT "workflow_automations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_automations" ADD CONSTRAINT "workflow_automations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_automations" ADD CONSTRAINT "workflow_automations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_categories" ADD CONSTRAINT "workflow_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_categories" ADD CONSTRAINT "workflow_categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_categories" ADD CONSTRAINT "workflow_categories_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_comments" ADD CONSTRAINT "workflow_comments_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_comments" ADD CONSTRAINT "workflow_comments_task_id_workflow_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."workflow_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_comments" ADD CONSTRAINT "workflow_comments_parent_id_workflow_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."workflow_comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_comments" ADD CONSTRAINT "workflow_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_comments" ADD CONSTRAINT "workflow_comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_compensation_logs" ADD CONSTRAINT "workflow_compensation_logs_compensation_id_workflow_compensations_id_fk" FOREIGN KEY ("compensation_id") REFERENCES "public"."workflow_compensations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_compensation_logs" ADD CONSTRAINT "workflow_compensation_logs_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_compensation_logs" ADD CONSTRAINT "workflow_compensation_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_compensations" ADD CONSTRAINT "workflow_compensations_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "workflow_instance_migrations" ADD CONSTRAINT "workflow_instance_migrations_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "workflow_task_transfers" ADD CONSTRAINT "workflow_task_transfers_task_id_workflow_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."workflow_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_task_transfers" ADD CONSTRAINT "workflow_task_transfers_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_task_transfers" ADD CONSTRAINT "workflow_task_transfers_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_task_transfers" ADD CONSTRAINT "workflow_task_transfers_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_task_transfers" ADD CONSTRAINT "workflow_task_transfers_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_task_transfers" ADD CONSTRAINT "workflow_task_transfers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "broadcast_campaigns" ADD CONSTRAINT "broadcast_campaigns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_campaigns" ADD CONSTRAINT "broadcast_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_campaigns" ADD CONSTRAINT "broadcast_campaigns_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "notification_dispatches" ADD CONSTRAINT "notification_dispatches_outbox_id_notification_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."notification_outbox"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_dispatches" ADD CONSTRAINT "notification_dispatches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_event_overrides" ADD CONSTRAINT "notification_event_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_event_overrides" ADD CONSTRAINT "notification_event_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_event_overrides" ADD CONSTRAINT "notification_event_overrides_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_configs" ADD CONSTRAINT "push_configs_app_id_client_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."client_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_configs" ADD CONSTRAINT "push_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_configs" ADD CONSTRAINT "push_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_send_logs" ADD CONSTRAINT "push_send_logs_config_id_push_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."push_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_send_logs" ADD CONSTRAINT "push_send_logs_app_id_client_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."client_apps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_send_logs" ADD CONSTRAINT "push_send_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "rule_asset_versions" ADD CONSTRAINT "rule_asset_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_asset_versions" ADD CONSTRAINT "rule_asset_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_flows" ADD CONSTRAINT "rule_decision_flows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_flows" ADD CONSTRAINT "rule_decision_flows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_flows" ADD CONSTRAINT "rule_decision_flows_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_table_versions" ADD CONSTRAINT "rule_decision_table_versions_table_id_rule_decision_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."rule_decision_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_table_versions" ADD CONSTRAINT "rule_decision_table_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_table_versions" ADD CONSTRAINT "rule_decision_table_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_tables" ADD CONSTRAINT "rule_decision_tables_category_id_workflow_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."workflow_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_tables" ADD CONSTRAINT "rule_decision_tables_review_requested_by_users_id_fk" FOREIGN KEY ("review_requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_tables" ADD CONSTRAINT "rule_decision_tables_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_tables" ADD CONSTRAINT "rule_decision_tables_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_decision_tables" ADD CONSTRAINT "rule_decision_tables_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_executions" ADD CONSTRAINT "rule_executions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_executions" ADD CONSTRAINT "rule_executions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_list_items" ADD CONSTRAINT "rule_list_items_list_id_rule_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."rule_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_list_items" ADD CONSTRAINT "rule_list_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_lists" ADD CONSTRAINT "rule_lists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_lists" ADD CONSTRAINT "rule_lists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_lists" ADD CONSTRAINT "rule_lists_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_scorecards" ADD CONSTRAINT "rule_scorecards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_scorecards" ADD CONSTRAINT "rule_scorecards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_scorecards" ADD CONSTRAINT "rule_scorecards_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "chat_custom_emojis" ADD CONSTRAINT "chat_custom_emojis_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_invites" ADD CONSTRAINT "chat_group_invites_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_invites" ADD CONSTRAINT "chat_group_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_join_requests" ADD CONSTRAINT "chat_group_join_requests_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_join_requests" ADD CONSTRAINT "chat_group_join_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_join_requests" ADD CONSTRAINT "chat_group_join_requests_invite_id_chat_group_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."chat_group_invites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_group_join_requests" ADD CONSTRAINT "chat_group_join_requests_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_favorites" ADD CONSTRAINT "chat_message_favorites_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_favorites" ADD CONSTRAINT "chat_message_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_reactions" ADD CONSTRAINT "chat_message_reactions_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_reactions" ADD CONSTRAINT "chat_message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_quick_replies" ADD CONSTRAINT "chat_quick_replies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_scheduled_messages" ADD CONSTRAINT "chat_scheduled_messages_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_scheduled_messages" ADD CONSTRAINT "chat_scheduled_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "payment_apps" ADD CONSTRAINT "payment_apps_open_client_id_oauth2_clients_id_fk" FOREIGN KEY ("open_client_id") REFERENCES "public"."oauth2_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_apps" ADD CONSTRAINT "payment_apps_wechat_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("wechat_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_apps" ADD CONSTRAINT "payment_apps_alipay_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("alipay_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_apps" ADD CONSTRAINT "payment_apps_unionpay_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("unionpay_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_apps" ADD CONSTRAINT "payment_apps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_apps" ADD CONSTRAINT "payment_apps_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_apps" ADD CONSTRAINT "payment_apps_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_cashier_sessions" ADD CONSTRAINT "payment_cashier_sessions_link_id_payment_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."payment_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_cashier_sessions" ADD CONSTRAINT "payment_cashier_sessions_app_id_payment_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."payment_apps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_cashier_sessions" ADD CONSTRAINT "payment_cashier_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_channel_configs" ADD CONSTRAINT "payment_channel_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_channel_configs" ADD CONSTRAINT "payment_channel_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_channel_configs" ADD CONSTRAINT "payment_channel_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_contracts" ADD CONSTRAINT "payment_contracts_channel_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("channel_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_contracts" ADD CONSTRAINT "payment_contracts_app_id_payment_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."payment_apps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_contracts" ADD CONSTRAINT "payment_contracts_plan_id_payment_deduct_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."payment_deduct_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_contracts" ADD CONSTRAINT "payment_contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_contracts" ADD CONSTRAINT "payment_contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_contracts" ADD CONSTRAINT "payment_contracts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_deduct_plans" ADD CONSTRAINT "payment_deduct_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_deduct_plans" ADD CONSTRAINT "payment_deduct_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_deduct_plans" ADD CONSTRAINT "payment_deduct_plans_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_dispute_replies" ADD CONSTRAINT "payment_dispute_replies_dispute_id_payment_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."payment_disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_dispute_replies" ADD CONSTRAINT "payment_dispute_replies_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_fee_rules" ADD CONSTRAINT "payment_fee_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_fee_rules" ADD CONSTRAINT "payment_fee_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_fee_rules" ADD CONSTRAINT "payment_fee_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_fund_reservations" ADD CONSTRAINT "payment_fund_reservations_account_id_payment_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."payment_ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_fund_reservations" ADD CONSTRAINT "payment_fund_reservations_app_id_payment_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."payment_apps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_fund_reservations" ADD CONSTRAINT "payment_fund_reservations_channel_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("channel_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_fund_reservations" ADD CONSTRAINT "payment_fund_reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_fund_reservations" ADD CONSTRAINT "payment_fund_reservations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_fund_reservations" ADD CONSTRAINT "payment_fund_reservations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_journal_lines" ADD CONSTRAINT "payment_journal_lines_journal_id_payment_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."payment_journals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_journal_lines" ADD CONSTRAINT "payment_journal_lines_account_id_payment_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."payment_ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_journals" ADD CONSTRAINT "payment_journals_app_id_payment_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."payment_apps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_journals" ADD CONSTRAINT "payment_journals_channel_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("channel_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_journals" ADD CONSTRAINT "payment_journals_reversal_of_journal_id_payment_journals_id_fk" FOREIGN KEY ("reversal_of_journal_id") REFERENCES "public"."payment_journals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_journals" ADD CONSTRAINT "payment_journals_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_journals" ADD CONSTRAINT "payment_journals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_ledger_accounts" ADD CONSTRAINT "payment_ledger_accounts_app_id_payment_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."payment_apps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_ledger_accounts" ADD CONSTRAINT "payment_ledger_accounts_channel_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("channel_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_ledger_accounts" ADD CONSTRAINT "payment_ledger_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_ledger_accounts" ADD CONSTRAINT "payment_ledger_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_ledger_accounts" ADD CONSTRAINT "payment_ledger_accounts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_link_redemptions" ADD CONSTRAINT "payment_link_redemptions_link_id_payment_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."payment_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_link_redemptions" ADD CONSTRAINT "payment_link_redemptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_app_id_payment_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."payment_apps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_method_configs" ADD CONSTRAINT "payment_method_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_method_configs" ADD CONSTRAINT "payment_method_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_method_configs" ADD CONSTRAINT "payment_method_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_notify_logs" ADD CONSTRAINT "payment_notify_logs_channel_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("channel_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_notify_logs" ADD CONSTRAINT "payment_notify_logs_app_id_payment_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."payment_apps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_notify_logs" ADD CONSTRAINT "payment_notify_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_channel_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("channel_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_app_id_payment_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."payment_apps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_preauths" ADD CONSTRAINT "payment_preauths_channel_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("channel_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_preauths" ADD CONSTRAINT "payment_preauths_app_id_payment_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."payment_apps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_preauths" ADD CONSTRAINT "payment_preauths_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_preauths" ADD CONSTRAINT "payment_preauths_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_preauths" ADD CONSTRAINT "payment_preauths_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_preauths" ADD CONSTRAINT "payment_preauths_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_batches" ADD CONSTRAINT "payment_recon_batches_app_id_payment_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."payment_apps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_batches" ADD CONSTRAINT "payment_recon_batches_channel_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("channel_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_batches" ADD CONSTRAINT "payment_recon_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_batches" ADD CONSTRAINT "payment_recon_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_batches" ADD CONSTRAINT "payment_recon_batches_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_items" ADD CONSTRAINT "payment_recon_items_batch_id_payment_recon_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payment_recon_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_items" ADD CONSTRAINT "payment_recon_items_handled_by_id_users_id_fk" FOREIGN KEY ("handled_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_order_id_payment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."payment_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_applied_by_id_users_id_fk" FOREIGN KEY ("applied_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_risk_hits" ADD CONSTRAINT "payment_risk_hits_rule_id_payment_risk_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."payment_risk_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_risk_hits" ADD CONSTRAINT "payment_risk_hits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_risk_hits" ADD CONSTRAINT "payment_risk_hits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_risk_reviews" ADD CONSTRAINT "payment_risk_reviews_hit_id_payment_risk_hits_id_fk" FOREIGN KEY ("hit_id") REFERENCES "public"."payment_risk_hits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_risk_reviews" ADD CONSTRAINT "payment_risk_reviews_app_id_payment_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."payment_apps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_risk_reviews" ADD CONSTRAINT "payment_risk_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_risk_reviews" ADD CONSTRAINT "payment_risk_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_risk_reviews" ADD CONSTRAINT "payment_risk_reviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_risk_reviews" ADD CONSTRAINT "payment_risk_reviews_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_risk_rules" ADD CONSTRAINT "payment_risk_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_risk_rules" ADD CONSTRAINT "payment_risk_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_risk_rules" ADD CONSTRAINT "payment_risk_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlement_batches" ADD CONSTRAINT "payment_settlement_batches_app_id_payment_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."payment_apps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlement_batches" ADD CONSTRAINT "payment_settlement_batches_channel_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("channel_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlement_batches" ADD CONSTRAINT "payment_settlement_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlement_batches" ADD CONSTRAINT "payment_settlement_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlement_batches" ADD CONSTRAINT "payment_settlement_batches_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlement_items" ADD CONSTRAINT "payment_settlement_items_batch_id_payment_settlement_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payment_settlement_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlement_items" ADD CONSTRAINT "payment_settlement_items_journal_line_id_payment_journal_lines_id_fk" FOREIGN KEY ("journal_line_id") REFERENCES "public"."payment_journal_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlement_items" ADD CONSTRAINT "payment_settlement_items_app_id_payment_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."payment_apps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlement_items" ADD CONSTRAINT "payment_settlement_items_channel_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("channel_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlement_items" ADD CONSTRAINT "payment_settlement_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sharing_orders" ADD CONSTRAINT "payment_sharing_orders_receiver_id_payment_sharing_receivers_id_fk" FOREIGN KEY ("receiver_id") REFERENCES "public"."payment_sharing_receivers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sharing_orders" ADD CONSTRAINT "payment_sharing_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sharing_orders" ADD CONSTRAINT "payment_sharing_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sharing_orders" ADD CONSTRAINT "payment_sharing_orders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sharing_receivers" ADD CONSTRAINT "payment_sharing_receivers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sharing_receivers" ADD CONSTRAINT "payment_sharing_receivers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sharing_receivers" ADD CONSTRAINT "payment_sharing_receivers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sharing_reversals" ADD CONSTRAINT "payment_sharing_reversals_sharing_order_id_payment_sharing_orders_id_fk" FOREIGN KEY ("sharing_order_id") REFERENCES "public"."payment_sharing_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sharing_reversals" ADD CONSTRAINT "payment_sharing_reversals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sharing_reversals" ADD CONSTRAINT "payment_sharing_reversals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sharing_reversals" ADD CONSTRAINT "payment_sharing_reversals_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transfers" ADD CONSTRAINT "payment_transfers_app_id_payment_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."payment_apps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transfers" ADD CONSTRAINT "payment_transfers_channel_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("channel_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transfers" ADD CONSTRAINT "payment_transfers_applied_by_id_users_id_fk" FOREIGN KEY ("applied_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transfers" ADD CONSTRAINT "payment_transfers_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transfers" ADD CONSTRAINT "payment_transfers_fund_reservation_id_payment_fund_reservations_id_fk" FOREIGN KEY ("fund_reservation_id") REFERENCES "public"."payment_fund_reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transfers" ADD CONSTRAINT "payment_transfers_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transfers" ADD CONSTRAINT "payment_transfers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transfers" ADD CONSTRAINT "payment_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transfers" ADD CONSTRAINT "payment_transfers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_arena_votes" ADD CONSTRAINT "ai_arena_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_http_tools" ADD CONSTRAINT "ai_http_tools_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_http_tools" ADD CONSTRAINT "ai_http_tools_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_kb_chunks" ADD CONSTRAINT "ai_kb_chunks_kb_id_ai_knowledge_bases_id_fk" FOREIGN KEY ("kb_id") REFERENCES "public"."ai_knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_kb_chunks" ADD CONSTRAINT "ai_kb_chunks_doc_id_ai_kb_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."ai_kb_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_kb_documents" ADD CONSTRAINT "ai_kb_documents_kb_id_ai_knowledge_bases_id_fk" FOREIGN KEY ("kb_id") REFERENCES "public"."ai_knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_knowledge_bases" ADD CONSTRAINT "ai_knowledge_bases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompt_template_versions" ADD CONSTRAINT "ai_prompt_template_versions_template_id_ai_prompt_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."ai_prompt_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompt_template_versions" ADD CONSTRAINT "ai_prompt_template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompt_templates" ADD CONSTRAINT "ai_prompt_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompt_templates" ADD CONSTRAINT "ai_prompt_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompt_templates" ADD CONSTRAINT "ai_prompt_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_configs" ADD CONSTRAINT "ai_provider_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_configs" ADD CONSTRAINT "ai_provider_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_shared_conversations" ADD CONSTRAINT "ai_shared_conversations_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_shared_conversations" ADD CONSTRAINT "ai_shared_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_user_settings" ADD CONSTRAINT "ai_user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_ai_configs" ADD CONSTRAINT "user_ai_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_scopes" ADD CONSTRAINT "api_scopes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_scopes" ADD CONSTRAINT "api_scopes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_webhook_deliveries" ADD CONSTRAINT "app_webhook_deliveries_subscription_id_app_webhook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."app_webhook_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_webhook_deliveries" ADD CONSTRAINT "app_webhook_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_webhook_subscriptions" ADD CONSTRAINT "app_webhook_subscriptions_client_id_oauth2_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth2_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_webhook_subscriptions" ADD CONSTRAINT "app_webhook_subscriptions_cms_site_id_cms_sites_id_fk" FOREIGN KEY ("cms_site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_webhook_subscriptions" ADD CONSTRAINT "app_webhook_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_webhook_subscriptions" ADD CONSTRAINT "app_webhook_subscriptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_webhook_subscriptions" ADD CONSTRAINT "app_webhook_subscriptions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth2_authorization_codes" ADD CONSTRAINT "oauth2_authorization_codes_client_id_oauth2_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth2_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth2_authorization_codes" ADD CONSTRAINT "oauth2_authorization_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth2_clients" ADD CONSTRAINT "oauth2_clients_rate_plan_id_rate_plans_id_fk" FOREIGN KEY ("rate_plan_id") REFERENCES "public"."rate_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth2_clients" ADD CONSTRAINT "oauth2_clients_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth2_clients" ADD CONSTRAINT "oauth2_clients_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth2_clients" ADD CONSTRAINT "oauth2_clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth2_clients" ADD CONSTRAINT "oauth2_clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth2_clients" ADD CONSTRAINT "oauth2_clients_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth2_token_families" ADD CONSTRAINT "oauth2_token_families_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth2_tokens" ADD CONSTRAINT "oauth2_tokens_family_id_oauth2_token_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."oauth2_token_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth2_tokens" ADD CONSTRAINT "oauth2_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth2_user_grants" ADD CONSTRAINT "oauth2_user_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_profiles" ADD CONSTRAINT "ssh_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_recordings" ADD CONSTRAINT "terminal_recordings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_recordings" ADD CONSTRAINT "terminal_recordings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_hosts" ADD CONSTRAINT "ops_hosts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_hosts" ADD CONSTRAINT "ops_hosts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "member_notifications" ADD CONSTRAINT "member_notifications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_point_accounts" ADD CONSTRAINT "member_point_accounts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_point_transactions" ADD CONSTRAINT "member_point_transactions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_point_transactions" ADD CONSTRAINT "member_point_transactions_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_tag_bindings" ADD CONSTRAINT "member_tag_bindings_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_tag_bindings" ADD CONSTRAINT "member_tag_bindings_tag_id_member_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."member_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_tags" ADD CONSTRAINT "member_tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_tags" ADD CONSTRAINT "member_tags_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_vip_renewals" ADD CONSTRAINT "member_vip_renewals_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_wallet_transactions" ADD CONSTRAINT "member_wallet_transactions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_wallet_transactions" ADD CONSTRAINT "member_wallet_transactions_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_wallets" ADD CONSTRAINT "member_wallets_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_level_id_member_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."member_levels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_invited_by_members_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_alert_events" ADD CONSTRAINT "monitor_alert_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_alert_events" ADD CONSTRAINT "monitor_alert_events_rule_id_monitor_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."monitor_alert_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_alert_events" ADD CONSTRAINT "monitor_alert_events_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_alert_rules" ADD CONSTRAINT "monitor_alert_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_alert_rules" ADD CONSTRAINT "monitor_alert_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_alert_rules" ADD CONSTRAINT "monitor_alert_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssl_certificates" ADD CONSTRAINT "ssl_certificates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssl_certificates" ADD CONSTRAINT "ssl_certificates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_artifacts" ADD CONSTRAINT "app_artifacts_release_id_app_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."app_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_artifacts" ADD CONSTRAINT "app_artifacts_file_id_managed_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."managed_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_artifacts" ADD CONSTRAINT "app_artifacts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_artifacts" ADD CONSTRAINT "app_artifacts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_release_events" ADD CONSTRAINT "app_release_events_app_id_client_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."client_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_release_events" ADD CONSTRAINT "app_release_events_release_id_app_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."app_releases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_release_events" ADD CONSTRAINT "app_release_events_artifact_id_app_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."app_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_releases" ADD CONSTRAINT "app_releases_app_id_client_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."client_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_releases" ADD CONSTRAINT "app_releases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_releases" ADD CONSTRAINT "app_releases_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_apps" ADD CONSTRAINT "client_apps_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_apps" ADD CONSTRAINT "client_apps_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_devices" ADD CONSTRAINT "client_devices_app_id_client_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."client_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "report_alert_rules" ADD CONSTRAINT "report_alert_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_alert_rules" ADD CONSTRAINT "report_alert_rules_dataset_id_report_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."report_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_alert_rules" ADD CONSTRAINT "report_alert_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_alert_rules" ADD CONSTRAINT "report_alert_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_categories" ADD CONSTRAINT "report_dashboard_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_categories" ADD CONSTRAINT "report_dashboard_categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_categories" ADD CONSTRAINT "report_dashboard_categories_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_comments" ADD CONSTRAINT "report_dashboard_comments_dashboard_id_report_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."report_dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_comments" ADD CONSTRAINT "report_dashboard_comments_parent_id_report_dashboard_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."report_dashboard_comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_comments" ADD CONSTRAINT "report_dashboard_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_comments" ADD CONSTRAINT "report_dashboard_comments_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_comments" ADD CONSTRAINT "report_dashboard_comments_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_embed_tokens" ADD CONSTRAINT "report_dashboard_embed_tokens_dashboard_id_report_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."report_dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_embed_tokens" ADD CONSTRAINT "report_dashboard_embed_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_embed_tokens" ADD CONSTRAINT "report_dashboard_embed_tokens_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_favorites" ADD CONSTRAINT "report_dashboard_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_favorites" ADD CONSTRAINT "report_dashboard_favorites_dashboard_id_report_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."report_dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_shares" ADD CONSTRAINT "report_dashboard_shares_dashboard_id_report_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."report_dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_shares" ADD CONSTRAINT "report_dashboard_shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_shares" ADD CONSTRAINT "report_dashboard_shares_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_subscriptions" ADD CONSTRAINT "report_dashboard_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_subscriptions" ADD CONSTRAINT "report_dashboard_subscriptions_dashboard_id_report_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."report_dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_subscriptions" ADD CONSTRAINT "report_dashboard_subscriptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_subscriptions" ADD CONSTRAINT "report_dashboard_subscriptions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_versions" ADD CONSTRAINT "report_dashboard_versions_dashboard_id_report_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."report_dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_versions" ADD CONSTRAINT "report_dashboard_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_versions" ADD CONSTRAINT "report_dashboard_versions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboards" ADD CONSTRAINT "report_dashboards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboards" ADD CONSTRAINT "report_dashboards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboards" ADD CONSTRAINT "report_dashboards_folder_id_report_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."report_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboards" ADD CONSTRAINT "report_dashboards_category_id_report_dashboard_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."report_dashboard_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboards" ADD CONSTRAINT "report_dashboards_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboards" ADD CONSTRAINT "report_dashboards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboards" ADD CONSTRAINT "report_dashboards_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dataset_execution_logs" ADD CONSTRAINT "report_dataset_execution_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dataset_execution_logs" ADD CONSTRAINT "report_dataset_execution_logs_dataset_id_report_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."report_datasets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dataset_execution_logs" ADD CONSTRAINT "report_dataset_execution_logs_datasource_id_report_datasources_id_fk" FOREIGN KEY ("datasource_id") REFERENCES "public"."report_datasources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dataset_execution_logs" ADD CONSTRAINT "report_dataset_execution_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_datasets" ADD CONSTRAINT "report_datasets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_datasets" ADD CONSTRAINT "report_datasets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_datasets" ADD CONSTRAINT "report_datasets_folder_id_report_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."report_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_datasets" ADD CONSTRAINT "report_datasets_datasource_id_report_datasources_id_fk" FOREIGN KEY ("datasource_id") REFERENCES "public"."report_datasources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_datasets" ADD CONSTRAINT "report_datasets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_datasets" ADD CONSTRAINT "report_datasets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_datasources" ADD CONSTRAINT "report_datasources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_datasources" ADD CONSTRAINT "report_datasources_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_datasources" ADD CONSTRAINT "report_datasources_folder_id_report_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."report_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_datasources" ADD CONSTRAINT "report_datasources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_datasources" ADD CONSTRAINT "report_datasources_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_delivery_attempts" ADD CONSTRAINT "report_delivery_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_delivery_attempts" ADD CONSTRAINT "report_delivery_attempts_run_id_report_delivery_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."report_delivery_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_delivery_runs" ADD CONSTRAINT "report_delivery_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_delivery_runs" ADD CONSTRAINT "report_delivery_runs_subscription_id_report_dashboard_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."report_dashboard_subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_delivery_runs" ADD CONSTRAINT "report_delivery_runs_alert_rule_id_report_alert_rules_id_fk" FOREIGN KEY ("alert_rule_id") REFERENCES "public"."report_alert_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_delivery_runs" ADD CONSTRAINT "report_delivery_runs_dashboard_id_report_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."report_dashboards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_delivery_runs" ADD CONSTRAINT "report_delivery_runs_dataset_id_report_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."report_datasets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_delivery_runs" ADD CONSTRAINT "report_delivery_runs_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_delivery_runs" ADD CONSTRAINT "report_delivery_runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_folders" ADD CONSTRAINT "report_folders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_folders" ADD CONSTRAINT "report_folders_parent_id_report_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."report_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_folders" ADD CONSTRAINT "report_folders_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_folders" ADD CONSTRAINT "report_folders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_folders" ADD CONSTRAINT "report_folders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_print_templates" ADD CONSTRAINT "report_print_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_print_templates" ADD CONSTRAINT "report_print_templates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_print_templates" ADD CONSTRAINT "report_print_templates_folder_id_report_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."report_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_print_templates" ADD CONSTRAINT "report_print_templates_dataset_id_report_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."report_datasets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_print_templates" ADD CONSTRAINT "report_print_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_print_templates" ADD CONSTRAINT "report_print_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_share_access_logs" ADD CONSTRAINT "report_share_access_logs_share_id_report_dashboard_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."report_dashboard_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_asset_templates" ADD CONSTRAINT "report_asset_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_asset_templates" ADD CONSTRAINT "report_asset_templates_folder_id_report_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."report_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_asset_templates" ADD CONSTRAINT "report_asset_templates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_asset_templates" ADD CONSTRAINT "report_asset_templates_preview_file_id_managed_files_id_fk" FOREIGN KEY ("preview_file_id") REFERENCES "public"."managed_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_asset_templates" ADD CONSTRAINT "report_asset_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_asset_templates" ADD CONSTRAINT "report_asset_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_asset_usage_logs" ADD CONSTRAINT "report_asset_usage_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_asset_usage_logs" ADD CONSTRAINT "report_asset_usage_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_chatbi_messages" ADD CONSTRAINT "report_chatbi_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_chatbi_messages" ADD CONSTRAINT "report_chatbi_messages_session_id_report_chatbi_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."report_chatbi_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_chatbi_messages" ADD CONSTRAINT "report_chatbi_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_chatbi_messages" ADD CONSTRAINT "report_chatbi_messages_saved_dataset_id_report_datasets_id_fk" FOREIGN KEY ("saved_dataset_id") REFERENCES "public"."report_datasets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_chatbi_messages" ADD CONSTRAINT "report_chatbi_messages_saved_dashboard_id_report_dashboards_id_fk" FOREIGN KEY ("saved_dashboard_id") REFERENCES "public"."report_dashboards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_chatbi_sessions" ADD CONSTRAINT "report_chatbi_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_chatbi_sessions" ADD CONSTRAINT "report_chatbi_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_chatbi_sessions" ADD CONSTRAINT "report_chatbi_sessions_datasource_id_report_datasources_id_fk" FOREIGN KEY ("datasource_id") REFERENCES "public"."report_datasources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_chatbi_sessions" ADD CONSTRAINT "report_chatbi_sessions_dataset_id_report_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."report_datasets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_deprecation_notices" ADD CONSTRAINT "report_deprecation_notices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_deprecation_notices" ADD CONSTRAINT "report_deprecation_notices_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_deprecation_notices" ADD CONSTRAINT "report_deprecation_notices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_deprecation_notices" ADD CONSTRAINT "report_deprecation_notices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dq_anomalies" ADD CONSTRAINT "report_dq_anomalies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dq_anomalies" ADD CONSTRAINT "report_dq_anomalies_dataset_id_report_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."report_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dq_anomalies" ADD CONSTRAINT "report_dq_anomalies_rule_id_report_dq_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."report_dq_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dq_anomalies" ADD CONSTRAINT "report_dq_anomalies_run_id_report_dq_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."report_dq_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dq_anomalies" ADD CONSTRAINT "report_dq_anomalies_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dq_anomalies" ADD CONSTRAINT "report_dq_anomalies_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dq_rules" ADD CONSTRAINT "report_dq_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dq_rules" ADD CONSTRAINT "report_dq_rules_dataset_id_report_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."report_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dq_rules" ADD CONSTRAINT "report_dq_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dq_rules" ADD CONSTRAINT "report_dq_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dq_runs" ADD CONSTRAINT "report_dq_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dq_runs" ADD CONSTRAINT "report_dq_runs_rule_id_report_dq_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."report_dq_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dq_runs" ADD CONSTRAINT "report_dq_runs_dataset_id_report_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."report_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dq_runs" ADD CONSTRAINT "report_dq_runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dq_scores" ADD CONSTRAINT "report_dq_scores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dq_scores" ADD CONSTRAINT "report_dq_scores_dataset_id_report_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."report_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_environment_promotions" ADD CONSTRAINT "report_environment_promotions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_environment_promotions" ADD CONSTRAINT "report_environment_promotions_source_environment_id_report_environments_id_fk" FOREIGN KEY ("source_environment_id") REFERENCES "public"."report_environments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_environment_promotions" ADD CONSTRAINT "report_environment_promotions_target_environment_id_report_environments_id_fk" FOREIGN KEY ("target_environment_id") REFERENCES "public"."report_environments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_environment_promotions" ADD CONSTRAINT "report_environment_promotions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_environment_promotions" ADD CONSTRAINT "report_environment_promotions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_environment_promotions" ADD CONSTRAINT "report_environment_promotions_deployed_by_users_id_fk" FOREIGN KEY ("deployed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_environment_promotions" ADD CONSTRAINT "report_environment_promotions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_environment_promotions" ADD CONSTRAINT "report_environment_promotions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_environments" ADD CONSTRAINT "report_environments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_environments" ADD CONSTRAINT "report_environments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_environments" ADD CONSTRAINT "report_environments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_fill_records" ADD CONSTRAINT "report_fill_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_fill_records" ADD CONSTRAINT "report_fill_records_template_id_report_fill_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."report_fill_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_fill_records" ADD CONSTRAINT "report_fill_records_submitter_id_users_id_fk" FOREIGN KEY ("submitter_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_fill_records" ADD CONSTRAINT "report_fill_records_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_fill_records" ADD CONSTRAINT "report_fill_records_workflow_instance_id_workflow_instances_id_fk" FOREIGN KEY ("workflow_instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_fill_records" ADD CONSTRAINT "report_fill_records_generated_dataset_id_report_datasets_id_fk" FOREIGN KEY ("generated_dataset_id") REFERENCES "public"."report_datasets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_fill_records" ADD CONSTRAINT "report_fill_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_fill_records" ADD CONSTRAINT "report_fill_records_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_fill_templates" ADD CONSTRAINT "report_fill_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_fill_templates" ADD CONSTRAINT "report_fill_templates_folder_id_report_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."report_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_fill_templates" ADD CONSTRAINT "report_fill_templates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_fill_templates" ADD CONSTRAINT "report_fill_templates_workflow_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("workflow_definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_fill_templates" ADD CONSTRAINT "report_fill_templates_generated_dataset_id_report_datasets_id_fk" FOREIGN KEY ("generated_dataset_id") REFERENCES "public"."report_datasets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_fill_templates" ADD CONSTRAINT "report_fill_templates_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_fill_templates" ADD CONSTRAINT "report_fill_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_fill_templates" ADD CONSTRAINT "report_fill_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_materialization_snapshots" ADD CONSTRAINT "report_materialization_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_materialization_snapshots" ADD CONSTRAINT "report_materialization_snapshots_dataset_id_report_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."report_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_materialization_snapshots" ADD CONSTRAINT "report_materialization_snapshots_file_id_managed_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."managed_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_materialization_snapshots" ADD CONSTRAINT "report_materialization_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_materialization_snapshots" ADD CONSTRAINT "report_materialization_snapshots_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_metrics" ADD CONSTRAINT "report_metrics_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_metrics" ADD CONSTRAINT "report_metrics_folder_id_report_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."report_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_metrics" ADD CONSTRAINT "report_metrics_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_metrics" ADD CONSTRAINT "report_metrics_dataset_id_report_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."report_datasets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_metrics" ADD CONSTRAINT "report_metrics_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_metrics" ADD CONSTRAINT "report_metrics_deprecated_by_users_id_fk" FOREIGN KEY ("deprecated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_metrics" ADD CONSTRAINT "report_metrics_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_metrics" ADD CONSTRAINT "report_metrics_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_publish_approvals" ADD CONSTRAINT "report_publish_approvals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_publish_approvals" ADD CONSTRAINT "report_publish_approvals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_publish_approvals" ADD CONSTRAINT "report_publish_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_publish_approvals" ADD CONSTRAINT "report_publish_approvals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_publish_approvals" ADD CONSTRAINT "report_publish_approvals_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_query_cost_logs" ADD CONSTRAINT "report_query_cost_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_query_cost_logs" ADD CONSTRAINT "report_query_cost_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_query_cost_logs" ADD CONSTRAINT "report_query_cost_logs_dataset_id_report_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."report_datasets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_query_cost_logs" ADD CONSTRAINT "report_query_cost_logs_datasource_id_report_datasources_id_fk" FOREIGN KEY ("datasource_id") REFERENCES "public"."report_datasources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_query_quotas" ADD CONSTRAINT "report_query_quotas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_query_quotas" ADD CONSTRAINT "report_query_quotas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_query_quotas" ADD CONSTRAINT "report_query_quotas_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_query_quotas" ADD CONSTRAINT "report_query_quotas_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_resource_acls" ADD CONSTRAINT "report_resource_acls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_resource_acls" ADD CONSTRAINT "report_resource_acls_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_resource_acls" ADD CONSTRAINT "report_resource_acls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_resource_acls" ADD CONSTRAINT "report_resource_acls_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_resource_transfers" ADD CONSTRAINT "report_resource_transfers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_resource_transfers" ADD CONSTRAINT "report_resource_transfers_from_owner_id_users_id_fk" FOREIGN KEY ("from_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_resource_transfers" ADD CONSTRAINT "report_resource_transfers_to_owner_id_users_id_fk" FOREIGN KEY ("to_owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_resource_transfers" ADD CONSTRAINT "report_resource_transfers_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_resource_transfers" ADD CONSTRAINT "report_resource_transfers_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_resource_transfers" ADD CONSTRAINT "report_resource_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_resource_transfers" ADD CONSTRAINT "report_resource_transfers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sla_rules" ADD CONSTRAINT "report_sla_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sla_rules" ADD CONSTRAINT "report_sla_rules_dataset_id_report_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."report_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sla_rules" ADD CONSTRAINT "report_sla_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sla_rules" ADD CONSTRAINT "report_sla_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sla_violations" ADD CONSTRAINT "report_sla_violations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sla_violations" ADD CONSTRAINT "report_sla_violations_rule_id_report_sla_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."report_sla_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sla_violations" ADD CONSTRAINT "report_sla_violations_dataset_id_report_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."report_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sla_violations" ADD CONSTRAINT "report_sla_violations_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sla_violations" ADD CONSTRAINT "report_sla_violations_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_ad_events" ADD CONSTRAINT "cms_ad_events_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_ad_events" ADD CONSTRAINT "cms_ad_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_ad_slots" ADD CONSTRAINT "cms_ad_slots_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_ad_slots" ADD CONSTRAINT "cms_ad_slots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_ad_slots" ADD CONSTRAINT "cms_ad_slots_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_ad_stats" ADD CONSTRAINT "cms_ad_stats_ad_id_cms_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."cms_ads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_ads" ADD CONSTRAINT "cms_ads_slot_id_cms_ad_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."cms_ad_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_ads" ADD CONSTRAINT "cms_ads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_ads" ADD CONSTRAINT "cms_ads_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_channel_users" ADD CONSTRAINT "cms_channel_users_channel_id_cms_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."cms_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_channel_users" ADD CONSTRAINT "cms_channel_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_channels" ADD CONSTRAINT "cms_channels_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_channels" ADD CONSTRAINT "cms_channels_model_id_cms_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."cms_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_channels" ADD CONSTRAINT "cms_channels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_channels" ADD CONSTRAINT "cms_channels_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_collect_items" ADD CONSTRAINT "cms_collect_items_rule_id_cms_collect_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."cms_collect_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_collect_items" ADD CONSTRAINT "cms_collect_items_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_collect_rules" ADD CONSTRAINT "cms_collect_rules_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_collect_rules" ADD CONSTRAINT "cms_collect_rules_channel_id_cms_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."cms_channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_collect_rules" ADD CONSTRAINT "cms_collect_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_collect_rules" ADD CONSTRAINT "cms_collect_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_comments" ADD CONSTRAINT "cms_comments_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_comments" ADD CONSTRAINT "cms_comments_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_comments" ADD CONSTRAINT "cms_comments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_channels" ADD CONSTRAINT "cms_content_channels_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_channels" ADD CONSTRAINT "cms_content_channels_channel_id_cms_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."cms_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_favorites" ADD CONSTRAINT "cms_content_favorites_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_favorites" ADD CONSTRAINT "cms_content_favorites_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_likes" ADD CONSTRAINT "cms_content_likes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_likes" ADD CONSTRAINT "cms_content_likes_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_op_logs" ADD CONSTRAINT "cms_content_op_logs_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_op_logs" ADD CONSTRAINT "cms_content_op_logs_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_relations" ADD CONSTRAINT "cms_content_relations_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_relations" ADD CONSTRAINT "cms_content_relations_related_id_cms_contents_id_fk" FOREIGN KEY ("related_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_tags" ADD CONSTRAINT "cms_content_tags_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_tags" ADD CONSTRAINT "cms_content_tags_tag_id_cms_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."cms_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_tombstones" ADD CONSTRAINT "cms_content_tombstones_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_versions" ADD CONSTRAINT "cms_content_versions_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_versions" ADD CONSTRAINT "cms_content_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_content_versions" ADD CONSTRAINT "cms_content_versions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_channel_id_cms_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."cms_channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_model_id_cms_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."cms_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_mapping_source_id_cms_contents_id_fk" FOREIGN KEY ("mapping_source_id") REFERENCES "public"."cms_contents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_distribution_rule_id_cms_distribution_rules_id_fk" FOREIGN KEY ("distribution_rule_id") REFERENCES "public"."cms_distribution_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_distribution_source_id_cms_contents_id_fk" FOREIGN KEY ("distribution_source_id") REFERENCES "public"."cms_contents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_dept_id_departments_id_fk" FOREIGN KEY ("dept_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_contents" ADD CONSTRAINT "cms_contents_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_distribution_rules" ADD CONSTRAINT "cms_distribution_rules_source_site_id_cms_sites_id_fk" FOREIGN KEY ("source_site_id") REFERENCES "public"."cms_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_distribution_rules" ADD CONSTRAINT "cms_distribution_rules_source_channel_id_cms_channels_id_fk" FOREIGN KEY ("source_channel_id") REFERENCES "public"."cms_channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_distribution_rules" ADD CONSTRAINT "cms_distribution_rules_target_site_id_cms_sites_id_fk" FOREIGN KEY ("target_site_id") REFERENCES "public"."cms_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_distribution_rules" ADD CONSTRAINT "cms_distribution_rules_target_channel_id_cms_channels_id_fk" FOREIGN KEY ("target_channel_id") REFERENCES "public"."cms_channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_distribution_rules" ADD CONSTRAINT "cms_distribution_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_distribution_rules" ADD CONSTRAINT "cms_distribution_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_error_prone_words" ADD CONSTRAINT "cms_error_prone_words_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_error_prone_words" ADD CONSTRAINT "cms_error_prone_words_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_form_submissions" ADD CONSTRAINT "cms_form_submissions_form_id_cms_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."cms_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_forms" ADD CONSTRAINT "cms_forms_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_forms" ADD CONSTRAINT "cms_forms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_forms" ADD CONSTRAINT "cms_forms_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_friend_link_groups" ADD CONSTRAINT "cms_friend_link_groups_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_friend_link_groups" ADD CONSTRAINT "cms_friend_link_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_friend_link_groups" ADD CONSTRAINT "cms_friend_link_groups_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_friend_links" ADD CONSTRAINT "cms_friend_links_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_friend_links" ADD CONSTRAINT "cms_friend_links_group_id_cms_friend_link_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."cms_friend_link_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_friend_links" ADD CONSTRAINT "cms_friend_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_friend_links" ADD CONSTRAINT "cms_friend_links_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_hotword_groups" ADD CONSTRAINT "cms_hotword_groups_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_hotword_groups" ADD CONSTRAINT "cms_hotword_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_hotword_groups" ADD CONSTRAINT "cms_hotword_groups_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_hotwords" ADD CONSTRAINT "cms_hotwords_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_hotwords" ADD CONSTRAINT "cms_hotwords_group_id_cms_hotword_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."cms_hotword_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_hotwords" ADD CONSTRAINT "cms_hotwords_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_hotwords" ADD CONSTRAINT "cms_hotwords_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_interaction_answers" ADD CONSTRAINT "cms_interaction_answers_response_id_cms_interaction_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."cms_interaction_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_interaction_answers" ADD CONSTRAINT "cms_interaction_answers_question_id_cms_interaction_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."cms_interaction_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_interaction_questions" ADD CONSTRAINT "cms_interaction_questions_interaction_id_cms_interactions_id_fk" FOREIGN KEY ("interaction_id") REFERENCES "public"."cms_interactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_interaction_responses" ADD CONSTRAINT "cms_interaction_responses_interaction_id_cms_interactions_id_fk" FOREIGN KEY ("interaction_id") REFERENCES "public"."cms_interactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_interaction_responses" ADD CONSTRAINT "cms_interaction_responses_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_interactions" ADD CONSTRAINT "cms_interactions_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_interactions" ADD CONSTRAINT "cms_interactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_interactions" ADD CONSTRAINT "cms_interactions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_link_words" ADD CONSTRAINT "cms_link_words_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_link_words" ADD CONSTRAINT "cms_link_words_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_link_words" ADD CONSTRAINT "cms_link_words_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_member_subscriptions" ADD CONSTRAINT "cms_member_subscriptions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_member_subscriptions" ADD CONSTRAINT "cms_member_subscriptions_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_member_view_history" ADD CONSTRAINT "cms_member_view_history_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_member_view_history" ADD CONSTRAINT "cms_member_view_history_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_member_view_history" ADD CONSTRAINT "cms_member_view_history_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_model_fields" ADD CONSTRAINT "cms_model_fields_model_id_cms_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."cms_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_model_fields" ADD CONSTRAINT "cms_model_fields_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_model_fields" ADD CONSTRAINT "cms_model_fields_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_models" ADD CONSTRAINT "cms_models_owner_site_id_cms_sites_id_fk" FOREIGN KEY ("owner_site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_models" ADD CONSTRAINT "cms_models_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_models" ADD CONSTRAINT "cms_models_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_open_app_grants" ADD CONSTRAINT "cms_open_app_grants_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_open_app_grants" ADD CONSTRAINT "cms_open_app_grants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_open_app_grants" ADD CONSTRAINT "cms_open_app_grants_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_page_block_acls" ADD CONSTRAINT "cms_page_block_acls_page_id_cms_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."cms_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_pages" ADD CONSTRAINT "cms_pages_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_pages" ADD CONSTRAINT "cms_pages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_pages" ADD CONSTRAINT "cms_pages_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_publish_artifacts" ADD CONSTRAINT "cms_publish_artifacts_task_id_async_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."async_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_publish_artifacts" ADD CONSTRAINT "cms_publish_artifacts_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_publish_artifacts" ADD CONSTRAINT "cms_publish_artifacts_content_id_cms_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."cms_contents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_publish_artifacts" ADD CONSTRAINT "cms_publish_artifacts_channel_id_cms_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."cms_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_publish_artifacts" ADD CONSTRAINT "cms_publish_artifacts_page_id_cms_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."cms_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_push_logs" ADD CONSTRAINT "cms_push_logs_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_redirects" ADD CONSTRAINT "cms_redirects_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_redirects" ADD CONSTRAINT "cms_redirects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_redirects" ADD CONSTRAINT "cms_redirects_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_resource_folders" ADD CONSTRAINT "cms_resource_folders_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_resource_folders" ADD CONSTRAINT "cms_resource_folders_parent_id_cms_resource_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."cms_resource_folders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_resource_folders" ADD CONSTRAINT "cms_resource_folders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_resource_folders" ADD CONSTRAINT "cms_resource_folders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_resource_refs" ADD CONSTRAINT "cms_resource_refs_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_resource_refs" ADD CONSTRAINT "cms_resource_refs_resource_id_cms_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."cms_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_resources" ADD CONSTRAINT "cms_resources_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_resources" ADD CONSTRAINT "cms_resources_folder_id_cms_resource_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."cms_resource_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_resources" ADD CONSTRAINT "cms_resources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_resources" ADD CONSTRAINT "cms_resources_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_search_logs" ADD CONSTRAINT "cms_search_logs_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_search_words" ADD CONSTRAINT "cms_search_words_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_search_words" ADD CONSTRAINT "cms_search_words_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_search_words" ADD CONSTRAINT "cms_search_words_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_sensitive_words" ADD CONSTRAINT "cms_sensitive_words_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_sensitive_words" ADD CONSTRAINT "cms_sensitive_words_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_site_inheritances" ADD CONSTRAINT "cms_site_inheritances_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_site_inheritances" ADD CONSTRAINT "cms_site_inheritances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_site_inheritances" ADD CONSTRAINT "cms_site_inheritances_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_site_users" ADD CONSTRAINT "cms_site_users_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_site_users" ADD CONSTRAINT "cms_site_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_sites" ADD CONSTRAINT "cms_sites_parent_id_cms_sites_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."cms_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_sites" ADD CONSTRAINT "cms_sites_model_id_cms_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."cms_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_sites" ADD CONSTRAINT "cms_sites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_sites" ADD CONSTRAINT "cms_sites_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_tags" ADD CONSTRAINT "cms_tags_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_tags" ADD CONSTRAINT "cms_tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_tags" ADD CONSTRAINT "cms_tags_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_visit_logs" ADD CONSTRAINT "cms_visit_logs_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_widget_refs" ADD CONSTRAINT "cms_widget_refs_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_widget_refs" ADD CONSTRAINT "cms_widget_refs_widget_id_cms_widgets_id_fk" FOREIGN KEY ("widget_id") REFERENCES "public"."cms_widgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_widget_source_refs" ADD CONSTRAINT "cms_widget_source_refs_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_widget_source_refs" ADD CONSTRAINT "cms_widget_source_refs_widget_id_cms_widgets_id_fk" FOREIGN KEY ("widget_id") REFERENCES "public"."cms_widgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_widgets" ADD CONSTRAINT "cms_widgets_site_id_cms_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."cms_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_widgets" ADD CONSTRAINT "cms_widgets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_widgets" ADD CONSTRAINT "cms_widgets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_comments" ADD CONSTRAINT "wiki_comments_doc_id_wiki_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."wiki_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_comments" ADD CONSTRAINT "wiki_comments_parent_id_wiki_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."wiki_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_comments" ADD CONSTRAINT "wiki_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_doc_favorites" ADD CONSTRAINT "wiki_doc_favorites_doc_id_wiki_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."wiki_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_doc_favorites" ADD CONSTRAINT "wiki_doc_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_doc_read_receipts" ADD CONSTRAINT "wiki_doc_read_receipts_doc_id_wiki_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."wiki_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_doc_read_receipts" ADD CONSTRAINT "wiki_doc_read_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_doc_subscriptions" ADD CONSTRAINT "wiki_doc_subscriptions_doc_id_wiki_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."wiki_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_doc_subscriptions" ADD CONSTRAINT "wiki_doc_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_doc_tags" ADD CONSTRAINT "wiki_doc_tags_doc_id_wiki_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."wiki_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_doc_tags" ADD CONSTRAINT "wiki_doc_tags_tag_id_wiki_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."wiki_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_doc_versions" ADD CONSTRAINT "wiki_doc_versions_doc_id_wiki_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."wiki_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_doc_versions" ADD CONSTRAINT "wiki_doc_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_doc_views" ADD CONSTRAINT "wiki_doc_views_doc_id_wiki_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."wiki_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_doc_views" ADD CONSTRAINT "wiki_doc_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_docs" ADD CONSTRAINT "wiki_docs_space_id_wiki_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."wiki_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_docs" ADD CONSTRAINT "wiki_docs_parent_id_wiki_docs_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."wiki_docs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_docs" ADD CONSTRAINT "wiki_docs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_docs" ADD CONSTRAINT "wiki_docs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_docs" ADD CONSTRAINT "wiki_docs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_docs" ADD CONSTRAINT "wiki_docs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_review_records" ADD CONSTRAINT "wiki_review_records_doc_id_wiki_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."wiki_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_review_records" ADD CONSTRAINT "wiki_review_records_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_search_logs" ADD CONSTRAINT "wiki_search_logs_clicked_doc_id_wiki_docs_id_fk" FOREIGN KEY ("clicked_doc_id") REFERENCES "public"."wiki_docs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_search_logs" ADD CONSTRAINT "wiki_search_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_search_logs" ADD CONSTRAINT "wiki_search_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_space_members" ADD CONSTRAINT "wiki_space_members_space_id_wiki_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."wiki_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_space_members" ADD CONSTRAINT "wiki_space_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_spaces" ADD CONSTRAINT "wiki_spaces_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_spaces" ADD CONSTRAINT "wiki_spaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_spaces" ADD CONSTRAINT "wiki_spaces_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_tags" ADD CONSTRAINT "wiki_tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_tags" ADD CONSTRAINT "wiki_tags_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_templates" ADD CONSTRAINT "wiki_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_templates" ADD CONSTRAINT "wiki_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_link_clicks" ADD CONSTRAINT "short_link_clicks_link_id_short_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."short_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_link_daily_stats" ADD CONSTRAINT "short_link_daily_stats_link_id_short_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."short_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_links" ADD CONSTRAINT "short_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_links" ADD CONSTRAINT "short_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_links" ADD CONSTRAINT "short_links_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_participations" ADD CONSTRAINT "marketing_participations_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_participations" ADD CONSTRAINT "marketing_participations_prize_id_marketing_prizes_id_fk" FOREIGN KEY ("prize_id") REFERENCES "public"."marketing_prizes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_prizes" ADD CONSTRAINT "marketing_prizes_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_prizes" ADD CONSTRAINT "marketing_prizes_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_alarm_rules" ADD CONSTRAINT "iot_alarm_rules_product_id_iot_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."iot_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_alarm_rules" ADD CONSTRAINT "iot_alarm_rules_device_id_iot_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."iot_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_alarm_rules" ADD CONSTRAINT "iot_alarm_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_alarm_rules" ADD CONSTRAINT "iot_alarm_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_alarm_rules" ADD CONSTRAINT "iot_alarm_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_alarms" ADD CONSTRAINT "iot_alarms_rule_id_iot_alarm_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."iot_alarm_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_alarms" ADD CONSTRAINT "iot_alarms_device_id_iot_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."iot_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_automation_runs" ADD CONSTRAINT "iot_automation_runs_automation_id_iot_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."iot_automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_automation_runs" ADD CONSTRAINT "iot_automation_runs_device_id_iot_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."iot_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_automations" ADD CONSTRAINT "iot_automations_product_id_iot_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."iot_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_automations" ADD CONSTRAINT "iot_automations_device_id_iot_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."iot_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_automations" ADD CONSTRAINT "iot_automations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_automations" ADD CONSTRAINT "iot_automations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_automations" ADD CONSTRAINT "iot_automations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_commands" ADD CONSTRAINT "iot_commands_device_id_iot_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."iot_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_commands" ADD CONSTRAINT "iot_commands_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_commands" ADD CONSTRAINT "iot_commands_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_device_events" ADD CONSTRAINT "iot_device_events_device_id_iot_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."iot_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_device_group_members" ADD CONSTRAINT "iot_device_group_members_group_id_iot_device_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."iot_device_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_device_group_members" ADD CONSTRAINT "iot_device_group_members_device_id_iot_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."iot_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_device_groups" ADD CONSTRAINT "iot_device_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_device_groups" ADD CONSTRAINT "iot_device_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_device_groups" ADD CONSTRAINT "iot_device_groups_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_device_logs" ADD CONSTRAINT "iot_device_logs_device_id_iot_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."iot_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_device_state" ADD CONSTRAINT "iot_device_state_device_id_iot_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."iot_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_device_whitelist" ADD CONSTRAINT "iot_device_whitelist_product_id_iot_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."iot_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_device_whitelist" ADD CONSTRAINT "iot_device_whitelist_device_id_iot_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."iot_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_device_whitelist" ADD CONSTRAINT "iot_device_whitelist_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_device_whitelist" ADD CONSTRAINT "iot_device_whitelist_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_device_whitelist" ADD CONSTRAINT "iot_device_whitelist_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_devices" ADD CONSTRAINT "iot_devices_product_id_iot_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."iot_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_devices" ADD CONSTRAINT "iot_devices_gateway_id_iot_devices_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."iot_devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_devices" ADD CONSTRAINT "iot_devices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_devices" ADD CONSTRAINT "iot_devices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_devices" ADD CONSTRAINT "iot_devices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_firmwares" ADD CONSTRAINT "iot_firmwares_product_id_iot_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."iot_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_firmwares" ADD CONSTRAINT "iot_firmwares_file_id_managed_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."managed_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_firmwares" ADD CONSTRAINT "iot_firmwares_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_firmwares" ADD CONSTRAINT "iot_firmwares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_firmwares" ADD CONSTRAINT "iot_firmwares_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_forward_logs" ADD CONSTRAINT "iot_forward_logs_rule_id_iot_forward_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."iot_forward_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_forward_rules" ADD CONSTRAINT "iot_forward_rules_product_id_iot_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."iot_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_forward_rules" ADD CONSTRAINT "iot_forward_rules_group_id_iot_device_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."iot_device_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_forward_rules" ADD CONSTRAINT "iot_forward_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_forward_rules" ADD CONSTRAINT "iot_forward_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_forward_rules" ADD CONSTRAINT "iot_forward_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_maintenance_windows" ADD CONSTRAINT "iot_maintenance_windows_product_id_iot_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."iot_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_maintenance_windows" ADD CONSTRAINT "iot_maintenance_windows_group_id_iot_device_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."iot_device_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_maintenance_windows" ADD CONSTRAINT "iot_maintenance_windows_device_id_iot_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."iot_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_maintenance_windows" ADD CONSTRAINT "iot_maintenance_windows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_maintenance_windows" ADD CONSTRAINT "iot_maintenance_windows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_maintenance_windows" ADD CONSTRAINT "iot_maintenance_windows_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_ota_task_devices" ADD CONSTRAINT "iot_ota_task_devices_task_id_iot_ota_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."iot_ota_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_ota_task_devices" ADD CONSTRAINT "iot_ota_task_devices_device_id_iot_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."iot_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_ota_tasks" ADD CONSTRAINT "iot_ota_tasks_firmware_id_iot_firmwares_id_fk" FOREIGN KEY ("firmware_id") REFERENCES "public"."iot_firmwares"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_ota_tasks" ADD CONSTRAINT "iot_ota_tasks_product_id_iot_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."iot_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_ota_tasks" ADD CONSTRAINT "iot_ota_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_ota_tasks" ADD CONSTRAINT "iot_ota_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_ota_tasks" ADD CONSTRAINT "iot_ota_tasks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_product_events" ADD CONSTRAINT "iot_product_events_product_id_iot_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."iot_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_product_events" ADD CONSTRAINT "iot_product_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_product_events" ADD CONSTRAINT "iot_product_events_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_product_properties" ADD CONSTRAINT "iot_product_properties_product_id_iot_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."iot_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_product_properties" ADD CONSTRAINT "iot_product_properties_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_product_properties" ADD CONSTRAINT "iot_product_properties_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_product_services" ADD CONSTRAINT "iot_product_services_product_id_iot_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."iot_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_product_services" ADD CONSTRAINT "iot_product_services_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_product_services" ADD CONSTRAINT "iot_product_services_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_products" ADD CONSTRAINT "iot_products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_products" ADD CONSTRAINT "iot_products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_products" ADD CONSTRAINT "iot_products_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_schedule_runs" ADD CONSTRAINT "iot_schedule_runs_schedule_id_iot_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."iot_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_schedules" ADD CONSTRAINT "iot_schedules_product_id_iot_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."iot_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_schedules" ADD CONSTRAINT "iot_schedules_group_id_iot_device_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."iot_device_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_schedules" ADD CONSTRAINT "iot_schedules_device_id_iot_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."iot_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_schedules" ADD CONSTRAINT "iot_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_schedules" ADD CONSTRAINT "iot_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_schedules" ADD CONSTRAINT "iot_schedules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_telemetry" ADD CONSTRAINT "iot_telemetry_device_id_iot_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."iot_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_telemetry_hourly" ADD CONSTRAINT "iot_telemetry_hourly_device_id_iot_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."iot_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_activities" ADD CONSTRAINT "drive_activities_node_id_drive_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."drive_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_activities" ADD CONSTRAINT "drive_activities_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_activities" ADD CONSTRAINT "drive_activities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_file_versions" ADD CONSTRAINT "drive_file_versions_node_id_drive_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."drive_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_file_versions" ADD CONSTRAINT "drive_file_versions_file_id_managed_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."managed_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_file_versions" ADD CONSTRAINT "drive_file_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_node_comments" ADD CONSTRAINT "drive_node_comments_node_id_drive_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."drive_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_node_comments" ADD CONSTRAINT "drive_node_comments_parent_id_drive_node_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."drive_node_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_node_comments" ADD CONSTRAINT "drive_node_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_node_comments" ADD CONSTRAINT "drive_node_comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_node_permissions" ADD CONSTRAINT "drive_node_permissions_node_id_drive_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."drive_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_node_permissions" ADD CONSTRAINT "drive_node_permissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_node_permissions" ADD CONSTRAINT "drive_node_permissions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_node_permissions" ADD CONSTRAINT "drive_node_permissions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_node_stars" ADD CONSTRAINT "drive_node_stars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_node_stars" ADD CONSTRAINT "drive_node_stars_node_id_drive_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."drive_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_node_tags" ADD CONSTRAINT "drive_node_tags_node_id_drive_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."drive_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_node_tags" ADD CONSTRAINT "drive_node_tags_tag_id_drive_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."drive_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_node_texts" ADD CONSTRAINT "drive_node_texts_node_id_drive_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."drive_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_nodes" ADD CONSTRAINT "drive_nodes_space_id_drive_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."drive_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_nodes" ADD CONSTRAINT "drive_nodes_parent_id_drive_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."drive_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_nodes" ADD CONSTRAINT "drive_nodes_file_id_managed_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."managed_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_nodes" ADD CONSTRAINT "drive_nodes_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_nodes" ADD CONSTRAINT "drive_nodes_thumbnail_file_id_managed_files_id_fk" FOREIGN KEY ("thumbnail_file_id") REFERENCES "public"."managed_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_nodes" ADD CONSTRAINT "drive_nodes_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_nodes" ADD CONSTRAINT "drive_nodes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_nodes" ADD CONSTRAINT "drive_nodes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_nodes" ADD CONSTRAINT "drive_nodes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_recent_access" ADD CONSTRAINT "drive_recent_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_recent_access" ADD CONSTRAINT "drive_recent_access_node_id_drive_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."drive_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_share_access_logs" ADD CONSTRAINT "drive_share_access_logs_share_id_drive_share_links_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."drive_share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_share_links" ADD CONSTRAINT "drive_share_links_node_id_drive_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."drive_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_share_links" ADD CONSTRAINT "drive_share_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_share_links" ADD CONSTRAINT "drive_share_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_share_links" ADD CONSTRAINT "drive_share_links_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_space_members" ADD CONSTRAINT "drive_space_members_space_id_drive_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."drive_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_spaces" ADD CONSTRAINT "drive_spaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_spaces" ADD CONSTRAINT "drive_spaces_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_spaces" ADD CONSTRAINT "drive_spaces_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_spaces" ADD CONSTRAINT "drive_spaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_spaces" ADD CONSTRAINT "drive_spaces_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_tags" ADD CONSTRAINT "drive_tags_space_id_drive_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."drive_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_tags" ADD CONSTRAINT "drive_tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_tags" ADD CONSTRAINT "drive_tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_tags" ADD CONSTRAINT "drive_tags_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_upload_bindings" ADD CONSTRAINT "drive_upload_bindings_space_id_drive_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."drive_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_upload_bindings" ADD CONSTRAINT "drive_upload_bindings_parent_id_drive_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."drive_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_upload_bindings" ADD CONSTRAINT "drive_upload_bindings_node_id_drive_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."drive_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_upload_bindings" ADD CONSTRAINT "drive_upload_bindings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_upload_bindings" ADD CONSTRAINT "drive_upload_bindings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_dept_scopes_dept_idx" ON "role_dept_scopes" USING btree ("dept_id");--> statement-breakpoint
CREATE INDEX "role_menus_menu_idx" ON "role_menus" USING btree ("menu_id");--> statement-breakpoint
CREATE INDEX "user_dept_scopes_dept_idx" ON "user_dept_scopes" USING btree ("dept_id");--> statement-breakpoint
CREATE INDEX "user_group_members_user_idx" ON "user_group_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_group_roles_role_idx" ON "user_group_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "user_menus_menu_idx" ON "user_menus" USING btree ("menu_id");--> statement-breakpoint
CREATE INDEX "user_positions_position_idx" ON "user_positions" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "users_department_idx" ON "users" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "license_events_created_idx" ON "license_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "business_files_tenant_idx" ON "business_files" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "managed_files_tenant_idx" ON "managed_files" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "managed_files_content_hash_idx" ON "managed_files" USING btree ("tenant_id","content_hash");--> statement-breakpoint
CREATE INDEX "upload_sessions_tenant_idx" ON "upload_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "upload_sessions_created_at_idx" ON "upload_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "upload_sessions_status_idx" ON "upload_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "async_task_items_task_idx" ON "async_task_items" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "async_task_items_task_status_idx" ON "async_task_items" USING btree ("task_id","status");--> statement-breakpoint
CREATE INDEX "async_tasks_type_idx" ON "async_tasks" USING btree ("task_type");--> statement-breakpoint
CREATE INDEX "async_tasks_status_idx" ON "async_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "async_tasks_created_by_idx" ON "async_tasks" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "async_tasks_created_at_idx" ON "async_tasks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "async_tasks_trace_idx" ON "async_tasks" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "async_tasks_payload_trgm_idx" ON "async_tasks" USING gin (("payload"::text) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "async_tasks_result_trgm_idx" ON "async_tasks" USING gin (("result"::text) gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "async_tasks_idem_tenant_uq" ON "async_tasks" USING btree ("tenant_id","created_by","task_type","idempotency_key") WHERE "async_tasks"."idempotency_key" is not null and "async_tasks"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "async_tasks_idem_platform_uq" ON "async_tasks" USING btree ("created_by","task_type","idempotency_key") WHERE "async_tasks"."idempotency_key" is not null and "async_tasks"."tenant_id" is null;--> statement-breakpoint
CREATE INDEX "export_job_downloads_tenant_idx" ON "export_job_downloads" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "export_job_downloads_job_idx" ON "export_job_downloads" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "export_job_downloads_downloaded_by_idx" ON "export_job_downloads" USING btree ("downloaded_by");--> statement-breakpoint
CREATE INDEX "export_jobs_entity_idx" ON "export_jobs" USING btree ("entity");--> statement-breakpoint
CREATE INDEX "export_jobs_status_idx" ON "export_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "export_jobs_created_by_idx" ON "export_jobs" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "export_jobs_tenant_idx" ON "export_jobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "export_jobs_expires_at_idx" ON "export_jobs" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "cron_job_logs_started_at_idx" ON "cron_job_logs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "cron_job_logs_job_idx" ON "cron_job_logs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "maintenance_logs_started_at_idx" ON "maintenance_logs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "maintenance_logs_ended_at_idx" ON "maintenance_logs" USING btree ("ended_at");--> statement-breakpoint
CREATE INDEX "system_scheduler_nodes_active_idx" ON "system_scheduler_nodes" USING btree ("active");--> statement-breakpoint
CREATE INDEX "system_scheduler_nodes_last_heartbeat_idx" ON "system_scheduler_nodes" USING btree ("last_heartbeat_at");--> statement-breakpoint
CREATE INDEX "system_scheduler_runs_task_idx" ON "system_scheduler_runs" USING btree ("task_name");--> statement-breakpoint
CREATE INDEX "system_scheduler_runs_status_idx" ON "system_scheduler_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "system_scheduler_runs_started_at_idx" ON "system_scheduler_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "system_scheduler_runs_triggered_by_idx" ON "system_scheduler_runs" USING btree ("triggered_by");--> statement-breakpoint
CREATE INDEX "system_scheduler_runs_alert_ack_by_idx" ON "system_scheduler_runs" USING btree ("alert_ack_by");--> statement-breakpoint
CREATE INDEX "user_feedbacks_status_idx" ON "user_feedbacks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "user_feedbacks_user_idx" ON "user_feedbacks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_feedbacks_created_at_idx" ON "user_feedbacks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "login_risk_events_user_idx" ON "login_risk_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "login_risk_events_tenant_idx" ON "login_risk_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "login_risk_events_created_idx" ON "login_risk_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_api_tokens_user_idx" ON "user_api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_mfa_factors_user_idx" ON "user_mfa_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_mfa_factors_status_idx" ON "user_mfa_factors" USING btree ("status");--> statement-breakpoint
CREATE INDEX "user_oauth_accounts_user_idx" ON "user_oauth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_trusted_devices_user_device_uq" ON "user_trusted_devices" USING btree ("user_id","device_id_hash");--> statement-breakpoint
CREATE INDEX "user_trusted_devices_user_idx" ON "user_trusted_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_trusted_devices_trusted_until_idx" ON "user_trusted_devices" USING btree ("trusted_until");--> statement-breakpoint
CREATE INDEX "identity_provider_sync_logs_provider_idx" ON "identity_provider_sync_logs" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "identity_provider_sync_logs_status_idx" ON "identity_provider_sync_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tenant_identity_providers_tenant_idx" ON "tenant_identity_providers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_identity_providers_status_idx" ON "tenant_identity_providers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "user_identity_accounts_user_idx" ON "user_identity_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_identity_accounts_provider_idx" ON "user_identity_accounts" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "directory_sync_conflicts_source_idx" ON "directory_sync_conflicts" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "directory_sync_conflicts_status_idx" ON "directory_sync_conflicts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "directory_sync_dept_links_department_idx" ON "directory_sync_dept_links" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "directory_sync_run_items_run_idx" ON "directory_sync_run_items" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "directory_sync_run_items_action_idx" ON "directory_sync_run_items" USING btree ("action");--> statement-breakpoint
CREATE INDEX "directory_sync_runs_source_idx" ON "directory_sync_runs" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "directory_sync_runs_status_idx" ON "directory_sync_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "directory_sync_sources_status_idx" ON "directory_sync_sources" USING btree ("status");--> statement-breakpoint
CREATE INDEX "directory_sync_user_links_user_idx" ON "directory_sync_user_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "dict_items_parent_idx" ON "dict_items" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dict_items_dict_id_value_unique" ON "dict_items" USING btree ("dict_id","value");--> statement-breakpoint
CREATE INDEX "ip_access_logs_created_at_idx" ON "ip_access_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ip_access_logs_ip_idx" ON "ip_access_logs" USING btree ("ip");--> statement-breakpoint
CREATE INDEX "login_logs_tenant_idx" ON "login_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "login_logs_created_at_idx" ON "login_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "login_logs_user_idx" ON "login_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "login_logs_status_idx" ON "login_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "operation_logs_tenant_idx" ON "operation_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "operation_logs_created_at_idx" ON "operation_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "operation_logs_user_idx" ON "operation_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "operation_logs_module_idx" ON "operation_logs" USING btree ("module");--> statement-breakpoint
CREATE INDEX "operation_logs_request_idx" ON "operation_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "operation_logs_before_trgm_idx" ON "operation_logs" USING gin ("before_data" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "operation_logs_after_trgm_idx" ON "operation_logs" USING gin ("after_data" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "operation_logs_reqbody_trgm_idx" ON "operation_logs" USING gin ("request_body" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_rollup_uq" ON "analytics_daily_rollup" USING btree ("tenant_id","stat_date","metric","dim_type","dim_value");--> statement-breakpoint
CREATE INDEX "analytics_rollup_date_idx" ON "analytics_daily_rollup" USING btree ("stat_date");--> statement-breakpoint
CREATE INDEX "analytics_rollup_metric_idx" ON "analytics_daily_rollup" USING btree ("metric");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_event_meta_name_uq" ON "analytics_event_meta" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "analytics_event_meta_status_idx" ON "analytics_event_meta" USING btree ("status");--> statement-breakpoint
CREATE INDEX "analytics_event_meta_owner_idx" ON "analytics_event_meta" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_event_overrides_tenant_name_uq" ON "analytics_event_overrides" USING btree ("tenant_id","event_name");--> statement-breakpoint
CREATE INDEX "analytics_event_overrides_status_idx" ON "analytics_event_overrides" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_event_quality_daily_uq" ON "analytics_event_quality_daily" USING btree ("tenant_id","stat_date","event_name","issue_type");--> statement-breakpoint
CREATE INDEX "analytics_event_quality_daily_date_idx" ON "analytics_event_quality_daily" USING btree ("stat_date");--> statement-breakpoint
CREATE INDEX "analytics_event_quality_daily_tenant_idx" ON "analytics_event_quality_daily" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_experiments_tenant_key_uq" ON "analytics_experiments" USING btree (coalesce("tenant_id", 0),"exp_key");--> statement-breakpoint
CREATE INDEX "analytics_experiments_tenant_idx" ON "analytics_experiments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "analytics_experiments_status_idx" ON "analytics_experiments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_identity_map_tenant_anon_uq" ON "analytics_identity_map" USING btree (coalesce("tenant_id", 0),"anonymous_id");--> statement-breakpoint
CREATE INDEX "analytics_saved_reports_tenant_idx" ON "analytics_saved_reports" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "analytics_saved_reports_type_idx" ON "analytics_saved_reports" USING btree ("report_type");--> statement-breakpoint
CREATE INDEX "analytics_segment_campaigns_tenant_idx" ON "analytics_segment_campaigns" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "analytics_segment_campaigns_segment_idx" ON "analytics_segment_campaigns" USING btree ("segment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_segment_members_segment_distinct_uq" ON "analytics_segment_members" USING btree ("segment_id","distinct_id");--> statement-breakpoint
CREATE INDEX "analytics_segment_members_segment_idx" ON "analytics_segment_members" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "analytics_segment_members_tenant_idx" ON "analytics_segment_members" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "analytics_segment_members_member_idx" ON "analytics_segment_members" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_sessions_sid_uq" ON "analytics_sessions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "analytics_sessions_started_idx" ON "analytics_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "analytics_sessions_user_idx" ON "analytics_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "analytics_sessions_tenant_idx" ON "analytics_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "analytics_sessions_member_idx" ON "analytics_sessions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "analytics_sessions_tenant_started_idx" ON "analytics_sessions" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_settings_tenant_uq" ON "analytics_settings" USING btree (coalesce("tenant_id", 0));--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_sites_site_key_uq" ON "analytics_sites" USING btree ("site_key");--> statement-breakpoint
CREATE INDEX "analytics_sites_tenant_idx" ON "analytics_sites" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "analytics_user_profiles_tenant_idx" ON "analytics_user_profiles" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_user_profiles_tenant_distinct_uq" ON "analytics_user_profiles" USING btree (coalesce("tenant_id", 0),"distinct_id");--> statement-breakpoint
CREATE INDEX "analytics_user_profiles_user_idx" ON "analytics_user_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "analytics_user_profiles_member_idx" ON "analytics_user_profiles" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "analytics_user_profiles_last_seen_idx" ON "analytics_user_profiles" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "analytics_user_profiles_properties_gin_idx" ON "analytics_user_profiles" USING gin ("properties");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_user_segments_tenant_name_uq" ON "analytics_user_segments" USING btree ("tenant_id","name") WHERE "analytics_user_segments"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_user_segments_global_name_uq" ON "analytics_user_segments" USING btree ("name") WHERE "analytics_user_segments"."tenant_id" is null;--> statement-breakpoint
CREATE INDEX "analytics_user_segments_tenant_status_idx" ON "analytics_user_segments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "error_alert_logs_created_idx" ON "error_alert_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "error_alert_logs_rule_idx" ON "error_alert_logs" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "error_alert_logs_tenant_idx" ON "error_alert_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "error_alert_rules_tenant_idx" ON "error_alert_rules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "error_events_group_idx" ON "error_events" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "error_events_created_idx" ON "error_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "error_events_user_idx" ON "error_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "error_events_tenant_idx" ON "error_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "error_events_member_idx" ON "error_events" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "error_events_group_created_idx" ON "error_events" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE INDEX "error_events_replay_idx" ON "error_events" USING btree ("replay_id");--> statement-breakpoint
CREATE UNIQUE INDEX "error_groups_fingerprint_uq" ON "error_groups" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "error_groups_status_idx" ON "error_groups" USING btree ("status");--> statement-breakpoint
CREATE INDEX "error_groups_type_idx" ON "error_groups" USING btree ("error_type");--> statement-breakpoint
CREATE INDEX "error_groups_last_seen_idx" ON "error_groups" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "error_groups_tenant_idx" ON "error_groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "error_groups_assignee_idx" ON "error_groups" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "replay_access_logs_replay_idx" ON "replay_access_logs" USING btree ("replay_id");--> statement-breakpoint
CREATE INDEX "replay_access_logs_user_idx" ON "replay_access_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "replay_access_logs_created_idx" ON "replay_access_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "replay_access_logs_tenant_idx" ON "replay_access_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "replay_click_points_page_idx" ON "replay_click_points" USING btree ("page_path");--> statement-breakpoint
CREATE INDEX "replay_click_points_created_idx" ON "replay_click_points" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "replay_click_points_tenant_idx" ON "replay_click_points" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "replay_segments_replay_seq_uq" ON "replay_segments" USING btree ("replay_id","seq");--> statement-breakpoint
CREATE INDEX "replay_sessions_session_idx" ON "replay_sessions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "replay_sessions_started_idx" ON "replay_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "replay_sessions_status_activity_idx" ON "replay_sessions" USING btree ("status","last_activity_at");--> statement-breakpoint
CREATE INDEX "replay_sessions_tenant_idx" ON "replay_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "replay_sessions_user_idx" ON "replay_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "replay_sessions_member_idx" ON "replay_sessions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "source_maps_release_idx" ON "source_maps" USING btree ("release","file_name");--> statement-breakpoint
CREATE INDEX "source_maps_tenant_idx" ON "source_maps" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_events_event_id_uq" ON "user_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "user_events_created_idx" ON "user_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "user_events_type_idx" ON "user_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "user_events_name_idx" ON "user_events" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "user_events_page_idx" ON "user_events" USING btree ("page_path");--> statement-breakpoint
CREATE INDEX "user_events_user_idx" ON "user_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_events_session_idx" ON "user_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "user_events_tenant_idx" ON "user_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "user_events_distinct_idx" ON "user_events" USING btree ("distinct_id");--> statement-breakpoint
CREATE INDEX "user_events_member_idx" ON "user_events" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "user_events_tenant_created_type_idx" ON "user_events" USING btree ("tenant_id","created_at","event_type");--> statement-breakpoint
CREATE INDEX "user_events_tenant_created_name_idx" ON "user_events" USING btree ("tenant_id","created_at","event_name");--> statement-breakpoint
CREATE INDEX "user_events_source_created_idx" ON "user_events" USING btree ("source","created_at");--> statement-breakpoint
CREATE INDEX "user_events_perf_metric_idx" ON "user_events" USING btree ("metric_name","created_at") WHERE "user_events"."event_type" = 'perf';--> statement-breakpoint
CREATE INDEX "user_events_properties_gin_idx" ON "user_events" USING gin ("properties");--> statement-breakpoint
CREATE INDEX "user_events_anon_pending_idx" ON "user_events" USING btree ("anonymous_id") WHERE "user_events"."user_id" IS NULL AND "user_events"."member_id" IS NULL AND "user_events"."anonymous_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "announcements_tenant_idx" ON "announcements" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "workflow_automation_runs_rule_idx" ON "workflow_automation_runs" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "workflow_automation_runs_instance_idx" ON "workflow_automation_runs" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "workflow_automation_runs_created_idx" ON "workflow_automation_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "workflow_automations_definition_idx" ON "workflow_automations" USING btree ("definition_id");--> statement-breakpoint
CREATE INDEX "workflow_automations_tenant_idx" ON "workflow_automations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "workflow_comments_task_idx" ON "workflow_comments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "workflow_comments_parent_idx" ON "workflow_comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "workflow_comments_instance_idx" ON "workflow_comments" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "workflow_comments_user_idx" ON "workflow_comments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workflow_comments_tenant_idx" ON "workflow_comments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "workflow_compensation_logs_operator_idx" ON "workflow_compensation_logs" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "workflow_compensation_logs_tenant_idx" ON "workflow_compensation_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "wf_compensation_log_cid_idx" ON "workflow_compensation_logs" USING btree ("compensation_id");--> statement-breakpoint
CREATE INDEX "workflow_compensations_tenant_idx" ON "workflow_compensations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "wf_compensation_instance_idx" ON "workflow_compensations" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "wf_compensation_status_idx" ON "workflow_compensations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "workflow_connector_invocations_conn_idx" ON "workflow_connector_invocations" USING btree ("connector_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_definition_versions_tenant_idx" ON "workflow_definition_versions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "workflow_definitions_tenant_status_idx" ON "workflow_definitions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "workflow_definitions_flow_data_gin_idx" ON "workflow_definitions" USING gin ("flow_data" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "workflow_delegations_definition_idx" ON "workflow_delegations" USING btree ("definition_id");--> statement-breakpoint
CREATE INDEX "workflow_delegations_tenant_idx" ON "workflow_delegations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "workflow_engine_health_snapshots_created_at_idx" ON "workflow_engine_health_snapshots" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "workflow_event_subscriptions_definition_idx" ON "workflow_event_subscriptions" USING btree ("definition_id");--> statement-breakpoint
CREATE INDEX "workflow_event_subscriptions_tenant_idx" ON "workflow_event_subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "workflow_instance_migrations_tenant_idx" ON "workflow_instance_migrations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "wf_inst_migration_idx" ON "workflow_instance_migrations" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "workflow_instances_definition_idx" ON "workflow_instances" USING btree ("definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_instances_biz_key_uniq" ON "workflow_instances" USING btree (coalesce("tenant_id", 0),"biz_type","biz_id") WHERE "workflow_instances"."status" in ('draft', 'running', 'suspended', 'returned');--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_instances_parent_task_item_key_idx" ON "workflow_instances" USING btree ("parent_task_id","parent_task_item_key");--> statement-breakpoint
CREATE INDEX "workflow_instances_tenant_status_idx" ON "workflow_instances" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "workflow_instances_initiator_status_idx" ON "workflow_instances" USING btree ("initiator_id","status");--> statement-breakpoint
CREATE INDEX "workflow_job_executions_tenant_idx" ON "workflow_job_executions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "workflow_job_executions_job_idx" ON "workflow_job_executions" USING btree ("job_id","attempt");--> statement-breakpoint
CREATE INDEX "workflow_job_executions_type_idx" ON "workflow_job_executions" USING btree ("job_type","status");--> statement-breakpoint
CREATE INDEX "workflow_jobs_task_idx" ON "workflow_jobs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "workflow_jobs_tenant_idx" ON "workflow_jobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "workflow_jobs_due_idx" ON "workflow_jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "workflow_jobs_type_status_idx" ON "workflow_jobs" USING btree ("job_type","status");--> statement-breakpoint
CREATE INDEX "workflow_jobs_trace_idx" ON "workflow_jobs" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "workflow_jobs_instance_idx" ON "workflow_jobs" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "workflow_quick_phrases_user_idx" ON "workflow_quick_phrases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workflow_quick_phrases_tenant_idx" ON "workflow_quick_phrases" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "workflow_saved_views_user_idx" ON "workflow_saved_views" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workflow_saved_views_tenant_idx" ON "workflow_saved_views" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "workflow_schedules_definition_idx" ON "workflow_schedules" USING btree ("definition_id");--> statement-breakpoint
CREATE INDEX "workflow_schedules_tenant_idx" ON "workflow_schedules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "workflow_simulation_cases_tenant_idx" ON "workflow_simulation_cases" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "workflow_task_consults_task_idx" ON "workflow_task_consults" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "workflow_task_consults_instance_idx" ON "workflow_task_consults" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "workflow_task_consults_tenant_idx" ON "workflow_task_consults" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "workflow_task_transfers_operator_idx" ON "workflow_task_transfers" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "workflow_task_transfers_tenant_idx" ON "workflow_task_transfers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "wf_task_transfers_task_idx" ON "workflow_task_transfers" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "wf_task_transfers_instance_idx" ON "workflow_task_transfers" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "workflow_task_urges_task_idx" ON "workflow_task_urges" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "workflow_task_urges_instance_idx" ON "workflow_task_urges" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "workflow_tasks_instance_status_idx" ON "workflow_tasks" USING btree ("instance_id","status");--> statement-breakpoint
CREATE INDEX "workflow_tasks_assignee_status_idx" ON "workflow_tasks" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "wf_tasks_active_uniq" ON "workflow_tasks" USING btree ("instance_id","node_key","activation_id","assignee_id") WHERE "workflow_tasks"."status" in ('pending', 'waiting') and "workflow_tasks"."assignee_id" is not null;--> statement-breakpoint
CREATE INDEX "workflow_templates_tenant_idx" ON "workflow_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "workflow_tokens_tenant_idx" ON "workflow_tokens" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "workflow_tokens_instance_status_idx" ON "workflow_tokens" USING btree ("instance_id","status");--> statement-breakpoint
CREATE INDEX "workflow_tokens_parent_idx" ON "workflow_tokens" USING btree ("parent_token_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wf_tokens_active_uniq" ON "workflow_tokens" USING btree ("instance_id","node_key","branch_path") WHERE "workflow_tokens"."status" = 'active';--> statement-breakpoint
CREATE INDEX "broadcast_campaigns_status_idx" ON "broadcast_campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "broadcast_campaigns_created_at_idx" ON "broadcast_campaigns" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_send_logs_user_idx" ON "email_send_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_send_logs_tenant_idx" ON "email_send_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "email_send_logs_created_at_idx" ON "email_send_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_send_logs_status_idx" ON "email_send_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_templates_tenant_idx" ON "email_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "in_app_messages_tenant_idx" ON "in_app_messages" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "in_app_messages_user_created_idx" ON "in_app_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "in_app_messages_created_at_idx" ON "in_app_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "in_app_templates_tenant_idx" ON "in_app_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_dispatches_dedupe_uq" ON "notification_dispatches" USING btree ("dedupe_key") WHERE "notification_dispatches"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "notification_dispatches_recipient_idx" ON "notification_dispatches" USING btree ("recipient_type","recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_dispatches_event_idx" ON "notification_dispatches" USING btree ("event_key","created_at");--> statement-breakpoint
CREATE INDEX "notification_dispatches_outbox_idx" ON "notification_dispatches" USING btree ("outbox_id");--> statement-breakpoint
CREATE INDEX "notification_dispatches_decision_idx" ON "notification_dispatches" USING btree ("decision","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_event_overrides_tenant_uq" ON "notification_event_overrides" USING btree ("tenant_id","event_key","channel") WHERE "notification_event_overrides"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_event_overrides_global_uq" ON "notification_event_overrides" USING btree ("event_key","channel") WHERE "notification_event_overrides"."tenant_id" is null;--> statement-breakpoint
CREATE INDEX "notification_event_overrides_event_idx" ON "notification_event_overrides" USING btree ("event_key");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_outbox_dedupe_uq" ON "notification_outbox" USING btree ("dedupe_key") WHERE "notification_outbox"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "notification_outbox_pending_idx" ON "notification_outbox" USING btree ("status","scheduled_at") WHERE "notification_outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "notification_outbox_digest_idx" ON "notification_outbox" USING btree ("digest_key","scheduled_at") WHERE "notification_outbox"."digest_key" is not null;--> statement-breakpoint
CREATE INDEX "notification_outbox_event_idx" ON "notification_outbox" USING btree ("event_key","created_at");--> statement-breakpoint
CREATE INDEX "notification_outbox_tenant_idx" ON "notification_outbox" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "notification_outbox_trace_idx" ON "notification_outbox" USING btree ("trace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_uq" ON "notification_preferences" USING btree ("recipient_type","recipient_id","event_key","channel");--> statement-breakpoint
CREATE INDEX "notification_preferences_recipient_idx" ON "notification_preferences" USING btree ("recipient_type","recipient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_recipient_settings_uq" ON "notification_recipient_settings" USING btree ("recipient_type","recipient_id");--> statement-breakpoint
CREATE INDEX "push_send_logs_created_at_idx" ON "push_send_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "push_send_logs_status_idx" ON "push_send_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "push_send_logs_subject_idx" ON "push_send_logs" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "push_send_logs_provider_msg_id_idx" ON "push_send_logs" USING btree ("provider_msg_id");--> statement-breakpoint
CREATE INDEX "sms_configs_tenant_idx" ON "sms_configs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "sms_send_logs_user_idx" ON "sms_send_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sms_send_logs_tenant_idx" ON "sms_send_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "sms_send_logs_created_at_idx" ON "sms_send_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sms_send_logs_status_idx" ON "sms_send_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sms_templates_tenant_idx" ON "sms_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "db_admin_query_history_executed_at_idx" ON "db_admin_query_history" USING btree ("executed_at");--> statement-breakpoint
CREATE INDEX "db_admin_query_history_user_idx" ON "db_admin_query_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "db_query_favorites_user_idx" ON "db_query_favorites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rule_asset_versions_tenant_idx" ON "rule_asset_versions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "rule_decision_table_versions_tenant_idx" ON "rule_decision_table_versions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "rule_executions_tenant_idx" ON "rule_executions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "rule_executions_ref_idx" ON "rule_executions" USING btree ("ref_kind","ref_id");--> statement-breakpoint
CREATE INDEX "rule_executions_caller_idx" ON "rule_executions" USING btree ("caller");--> statement-breakpoint
CREATE INDEX "rule_executions_biz_ref_idx" ON "rule_executions" USING btree ("biz_ref");--> statement-breakpoint
CREATE INDEX "rule_list_items_list_idx" ON "rule_list_items" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "rule_test_cases_tenant_idx" ON "rule_test_cases" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "biz_leaves_tenant_idx" ON "biz_leaves" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "biz_pay_demos_tenant_idx" ON "biz_pay_demos" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "chat_conversation_members_user_idx" ON "chat_conversation_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_conversations_tenant_idx" ON "chat_conversations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "chat_custom_emojis_user_idx" ON "chat_custom_emojis" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_group_invites_conv_idx" ON "chat_group_invites" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "chat_group_join_requests_conv_status_idx" ON "chat_group_join_requests" USING btree ("conversation_id","status");--> statement-breakpoint
CREATE INDEX "chat_group_join_requests_user_idx" ON "chat_group_join_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_message_favorites_user_idx" ON "chat_message_favorites" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_message_reactions_user_idx" ON "chat_message_reactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_messages_conversation_id_idx" ON "chat_messages" USING btree ("conversation_id","id");--> statement-breakpoint
CREATE INDEX "chat_messages_sender_idx" ON "chat_messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "chat_quick_replies_user_idx" ON "chat_quick_replies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_scheduled_messages_conversation_idx" ON "chat_scheduled_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "chat_scheduled_messages_due_idx" ON "chat_scheduled_messages" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "chat_scheduled_messages_sender_idx" ON "chat_scheduled_messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "chat_webhooks_conversation_idx" ON "chat_webhooks" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "chat_webhooks_tenant_idx" ON "chat_webhooks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "channel_auto_replies_channel_idx" ON "channel_auto_replies" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "channel_conversations_user_idx" ON "channel_conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "channel_menus_channel_idx" ON "channel_menus" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "channel_message_targets_user_idx" ON "channel_message_targets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "channel_messages_channel_idx" ON "channel_messages" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "channel_quick_replies_channel_idx" ON "channel_quick_replies" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "channel_subscriptions_user_idx" ON "channel_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "channels_tenant_idx" ON "channels" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_apps_tenant_idx" ON "payment_apps" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_cashier_sessions_order_no_unique" ON "payment_cashier_sessions" USING btree ("order_no") WHERE "payment_cashier_sessions"."order_no" is not null;--> statement-breakpoint
CREATE INDEX "payment_cashier_sessions_link_idx" ON "payment_cashier_sessions" USING btree ("link_id");--> statement-breakpoint
CREATE INDEX "payment_cashier_sessions_link_slot_idx" ON "payment_cashier_sessions" USING btree ("link_id","use_slot_status","expires_at");--> statement-breakpoint
CREATE INDEX "payment_cashier_sessions_status_expiry_idx" ON "payment_cashier_sessions" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "payment_cashier_sessions_tenant_idx" ON "payment_cashier_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_channel_configs_tenant_idx" ON "payment_channel_configs" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_channel_configs_default_tenant_channel_uq" ON "payment_channel_configs" USING btree ("tenant_id","channel") WHERE "payment_channel_configs"."is_default" = true and "payment_channel_configs"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_channel_configs_default_global_channel_uq" ON "payment_channel_configs" USING btree ("channel") WHERE "payment_channel_configs"."is_default" = true and "payment_channel_configs"."tenant_id" is null;--> statement-breakpoint
CREATE INDEX "payment_contracts_tenant_idx" ON "payment_contracts" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_contracts_active_biz_uq" ON "payment_contracts" USING btree (coalesce("tenant_id", 0),"app_id","biz_type","biz_id","currency") WHERE "payment_contracts"."status" in ('pending', 'unknown', 'signed', 'paused');--> statement-breakpoint
CREATE UNIQUE INDEX "payment_contracts_member_renewal_active_uq" ON "payment_contracts" USING btree (coalesce("tenant_id", 0),"biz_type","biz_id","currency") WHERE "payment_contracts"."biz_type" = 'member_renewal' and "payment_contracts"."status" in ('pending', 'unknown', 'signed', 'paused');--> statement-breakpoint
CREATE INDEX "payment_contracts_status_idx" ON "payment_contracts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_contracts_next_deduct_idx" ON "payment_contracts" USING btree ("next_deduct_at");--> statement-breakpoint
CREATE INDEX "payment_contracts_biz_idx" ON "payment_contracts" USING btree ("tenant_id","app_id","biz_type","biz_id","currency");--> statement-breakpoint
CREATE INDEX "payment_deduct_plans_tenant_idx" ON "payment_deduct_plans" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_dispute_replies_operator_idx" ON "payment_dispute_replies" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "payment_dispute_replies_dispute_idx" ON "payment_dispute_replies" USING btree ("dispute_id");--> statement-breakpoint
CREATE INDEX "payment_disputes_tenant_idx" ON "payment_disputes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_disputes_status_idx" ON "payment_disputes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_disputes_order_no_idx" ON "payment_disputes" USING btree ("order_no");--> statement-breakpoint
CREATE INDEX "payment_disputes_deadline_idx" ON "payment_disputes" USING btree ("deadline");--> statement-breakpoint
CREATE INDEX "payment_disputes_route_idx" ON "payment_disputes" USING btree ("route");--> statement-breakpoint
CREATE INDEX "payment_events_tenant_idx" ON "payment_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_events_status_idx" ON "payment_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_fee_rules_tenant_idx" ON "payment_fee_rules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_fee_rules_channel_idx" ON "payment_fee_rules" USING btree ("channel");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_fund_reservations_source_scope_uq" ON "payment_fund_reservations" USING btree (coalesce("tenant_id", 0),"app_id","channel_config_id","currency","source_type","source_id");--> statement-breakpoint
CREATE INDEX "payment_fund_reservations_active_account_idx" ON "payment_fund_reservations" USING btree ("account_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "payment_fund_reservations_scope_idx" ON "payment_fund_reservations" USING btree ("tenant_id","app_id","channel_config_id","currency");--> statement-breakpoint
CREATE INDEX "payment_journal_lines_account_idx" ON "payment_journal_lines" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_journals_source_scope_uq" ON "payment_journals" USING btree (coalesce("tenant_id", 0),"app_id","channel_config_id","currency","source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_journals_reversal_once_uq" ON "payment_journals" USING btree ("reversal_of_journal_id") WHERE "payment_journals"."reversal_of_journal_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_journals_scope_posted_idx" ON "payment_journals" USING btree ("tenant_id","app_id","channel_config_id","currency","posted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_ledger_accounts_scope_code_uq" ON "payment_ledger_accounts" USING btree (coalesce("tenant_id", 0),"app_id","channel_config_id","currency","code");--> statement-breakpoint
CREATE INDEX "payment_ledger_accounts_scope_idx" ON "payment_ledger_accounts" USING btree ("tenant_id","app_id","channel_config_id","currency");--> statement-breakpoint
CREATE INDEX "payment_link_redemptions_link_idx" ON "payment_link_redemptions" USING btree ("link_id");--> statement-breakpoint
CREATE INDEX "payment_link_redemptions_tenant_idx" ON "payment_link_redemptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_links_tenant_idx" ON "payment_links" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_links_app_idx" ON "payment_links" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "payment_method_configs_tenant_idx" ON "payment_method_configs" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_method_configs_tenant_method_uq" ON "payment_method_configs" USING btree (coalesce("tenant_id", 0),"method");--> statement-breakpoint
CREATE INDEX "payment_notify_logs_tenant_idx" ON "payment_notify_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_notify_logs_config_idx" ON "payment_notify_logs" USING btree ("channel_config_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_notify_logs_provider_event_uq" ON "payment_notify_logs" USING btree ("channel_config_id","provider_event_id") WHERE "payment_notify_logs"."provider_event_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_notify_logs_order_no_idx" ON "payment_notify_logs" USING btree ("order_no");--> statement-breakpoint
CREATE INDEX "payment_orders_user_idx" ON "payment_orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payment_orders_tenant_idx" ON "payment_orders" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_orders_active_biz_uq" ON "payment_orders" USING btree (coalesce("tenant_id", 0),coalesce("app_id", 0),"biz_type","biz_id","currency") WHERE "payment_orders"."status" in ('pending', 'paying', 'unknown');--> statement-breakpoint
CREATE UNIQUE INDEX "payment_orders_idempotency_scope_uq" ON "payment_orders" USING btree (coalesce("tenant_id", 0),coalesce("app_id", 0),"idempotency_key") WHERE "payment_orders"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "payment_orders_biz_idx" ON "payment_orders" USING btree ("tenant_id","app_id","biz_type","biz_id","currency");--> statement-breakpoint
CREATE INDEX "payment_orders_status_idx" ON "payment_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_orders_expired_idx" ON "payment_orders" USING btree ("expired_at");--> statement-breakpoint
CREATE INDEX "payment_preauths_operator_idx" ON "payment_preauths" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "payment_preauths_tenant_idx" ON "payment_preauths" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_preauths_active_biz_uq" ON "payment_preauths" USING btree (coalesce("tenant_id", 0),"app_id","biz_type","biz_id","currency") WHERE "payment_preauths"."status" in ('pending', 'unknown', 'frozen');--> statement-breakpoint
CREATE INDEX "payment_preauths_status_idx" ON "payment_preauths" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_preauths_biz_idx" ON "payment_preauths" USING btree ("tenant_id","app_id","biz_type","biz_id","currency");--> statement-breakpoint
CREATE INDEX "payment_recon_batches_tenant_idx" ON "payment_recon_batches" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_recon_batches_date_idx" ON "payment_recon_batches" USING btree ("bill_date");--> statement-breakpoint
CREATE INDEX "payment_recon_batches_app_idx" ON "payment_recon_batches" USING btree ("app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_recon_scope_date_uq" ON "payment_recon_batches" USING btree (coalesce("tenant_id", 0),"app_id","channel_config_id","currency","bill_date");--> statement-breakpoint
CREATE INDEX "payment_recon_items_batch_idx" ON "payment_recon_items" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "payment_refunds_order_idx" ON "payment_refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payment_refunds_operator_idx" ON "payment_refunds" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "payment_refunds_tenant_idx" ON "payment_refunds" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_refunds_order_no_idx" ON "payment_refunds" USING btree ("order_no");--> statement-breakpoint
CREATE INDEX "payment_refunds_status_idx" ON "payment_refunds" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refunds_idempotency_scope_uq" ON "payment_refunds" USING btree (coalesce("tenant_id", 0),"order_id","idempotency_key") WHERE "payment_refunds"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "payment_risk_hits_user_idx" ON "payment_risk_hits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payment_risk_hits_tenant_idx" ON "payment_risk_hits" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_risk_hits_created_idx" ON "payment_risk_hits" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "payment_risk_hits_rule_idx" ON "payment_risk_hits" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "payment_risk_reviews_tenant_idx" ON "payment_risk_reviews" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_risk_reviews_pending_biz_scope_uq" ON "payment_risk_reviews" USING btree (coalesce("tenant_id", 0),coalesce("app_id", 0),"biz_type","biz_id","currency") WHERE "payment_risk_reviews"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "payment_risk_reviews_order_no_idx" ON "payment_risk_reviews" USING btree ("order_no");--> statement-breakpoint
CREATE INDEX "payment_risk_reviews_status_idx" ON "payment_risk_reviews" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_risk_reviews_biz_idx" ON "payment_risk_reviews" USING btree ("biz_type","biz_id");--> statement-breakpoint
CREATE INDEX "payment_risk_rules_tenant_idx" ON "payment_risk_rules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_risk_rules_scope_idx" ON "payment_risk_rules" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "payment_settlement_batches_tenant_idx" ON "payment_settlement_batches" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_settlement_batches_app_idx" ON "payment_settlement_batches" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "payment_settlement_batches_status_idx" ON "payment_settlement_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_settlement_items_batch_idx" ON "payment_settlement_items" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "payment_settlement_items_scope_idx" ON "payment_settlement_items" USING btree ("tenant_id","app_id","channel_config_id","currency");--> statement-breakpoint
CREATE INDEX "payment_sharing_orders_tenant_idx" ON "payment_sharing_orders" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_sharing_orders_order_no_idx" ON "payment_sharing_orders" USING btree ("order_no");--> statement-breakpoint
CREATE INDEX "payment_sharing_orders_receiver_idx" ON "payment_sharing_orders" USING btree ("receiver_id");--> statement-breakpoint
CREATE INDEX "payment_sharing_receivers_tenant_idx" ON "payment_sharing_receivers" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_sharing_reversals_idempotency_scope_uq" ON "payment_sharing_reversals" USING btree (coalesce("tenant_id", 0),"sharing_order_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "payment_sharing_reversals_tenant_status_idx" ON "payment_sharing_reversals" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "payment_transfers_operator_idx" ON "payment_transfers" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "payment_transfers_tenant_idx" ON "payment_transfers" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_transfers_idempotency_scope_uq" ON "payment_transfers" USING btree (coalesce("tenant_id", 0),"app_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "payment_transfers_status_idx" ON "payment_transfers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_transfers_biz_idx" ON "payment_transfers" USING btree ("biz_type","biz_id");--> statement-breakpoint
CREATE INDEX "ai_agents_user_idx" ON "ai_agents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_arena_votes_user_idx" ON "ai_arena_votes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_conversations_user_idx" ON "ai_conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_conversations_tenant_idx" ON "ai_conversations" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_http_tools_name_uq" ON "ai_http_tools" USING btree ("name");--> statement-breakpoint
CREATE INDEX "ai_knowledge_bases_user_idx" ON "ai_knowledge_bases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_messages_conversation_idx" ON "ai_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_messages_created_at_idx" ON "ai_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_prompt_templates_user_idx" ON "ai_prompt_templates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_shared_conversations_conversation_idx" ON "ai_shared_conversations" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "ai_shared_conversations_user_idx" ON "ai_shared_conversations" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_shared_conversations_token_uq" ON "ai_shared_conversations" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_user_settings_user_id_uq" ON "ai_user_settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_ai_configs_user_idx" ON "user_ai_configs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "app_webhook_deliveries_sub_idx" ON "app_webhook_deliveries" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "app_webhook_deliveries_tenant_client_idx" ON "app_webhook_deliveries" USING btree ("tenant_id","client_id");--> statement-breakpoint
CREATE INDEX "app_webhook_deliveries_status_idx" ON "app_webhook_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "app_webhook_deliveries_next_retry_idx" ON "app_webhook_deliveries" USING btree ("next_retry_at");--> statement-breakpoint
CREATE INDEX "app_webhook_deliveries_created_idx" ON "app_webhook_deliveries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "app_webhook_subscriptions_tenant_client_idx" ON "app_webhook_subscriptions" USING btree ("tenant_id","client_id");--> statement-breakpoint
CREATE INDEX "app_webhook_subscriptions_cms_site_idx" ON "app_webhook_subscriptions" USING btree ("cms_site_id");--> statement-breakpoint
CREATE INDEX "oauth2_authorization_codes_user_idx" ON "oauth2_authorization_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth2_clients_tenant_idx" ON "oauth2_clients" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "oauth2_token_families_client_idx" ON "oauth2_token_families" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth2_token_families_user_idx" ON "oauth2_token_families" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth2_tokens_user_idx" ON "oauth2_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth2_tokens_client_idx" ON "oauth2_tokens" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth2_tokens_family_idx" ON "oauth2_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "oauth2_tokens_active_expiry_idx" ON "oauth2_tokens" USING btree ("revoked","expires_at");--> statement-breakpoint
CREATE INDEX "oauth2_user_grants_client_idx" ON "oauth2_user_grants" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "open_api_call_logs_client_idx" ON "open_api_call_logs" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "open_api_call_logs_created_idx" ON "open_api_call_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "open_api_call_logs_path_idx" ON "open_api_call_logs" USING btree ("path");--> statement-breakpoint
CREATE INDEX "open_api_call_stats_daily_date_idx" ON "open_api_call_stats_daily" USING btree ("stat_date");--> statement-breakpoint
CREATE INDEX "open_api_call_stats_daily_client_idx" ON "open_api_call_stats_daily" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "open_quota_alerts_status_idx" ON "open_quota_alerts" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "ssh_profiles_user_idx" ON "ssh_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "terminal_recordings_user_idx" ON "terminal_recordings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "terminal_recordings_tenant_idx" ON "terminal_recordings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "terminal_sessions_user_state_idx" ON "terminal_sessions" USING btree ("user_id","state");--> statement-breakpoint
CREATE INDEX "terminal_sessions_tenant_started_idx" ON "terminal_sessions" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE INDEX "terminal_sessions_node_state_idx" ON "terminal_sessions" USING btree ("node_id","state");--> statement-breakpoint
CREATE INDEX "ops_hosts_enabled_idx" ON "ops_hosts" USING btree ("enabled","status");--> statement-breakpoint
CREATE INDEX "coupons_tenant_idx" ON "coupons" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "coupons_status_idx" ON "coupons" USING btree ("status");--> statement-breakpoint
CREATE INDEX "member_coupons_member_idx" ON "member_coupons" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "member_coupons_coupon_idx" ON "member_coupons" USING btree ("coupon_id");--> statement-breakpoint
CREATE INDEX "member_coupons_status_idx" ON "member_coupons" USING btree ("status");--> statement-breakpoint
CREATE INDEX "member_login_logs_member_created_idx" ON "member_login_logs" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "member_notifications_member_idx" ON "member_notifications" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "member_notifications_biz_idx" ON "member_notifications" USING btree ("type","biz_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_notifications_member_type_biz_uq" ON "member_notifications" USING btree ("member_id","type","biz_id") WHERE "member_notifications"."biz_id" is not null and "member_notifications"."type" = 'cms_content_published';--> statement-breakpoint
CREATE UNIQUE INDEX "member_point_accounts_member_unique" ON "member_point_accounts" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "member_point_transactions_operator_idx" ON "member_point_transactions" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "member_point_tx_member_idx" ON "member_point_transactions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "member_point_tx_biz_idx" ON "member_point_transactions" USING btree ("biz_type","biz_id");--> statement-breakpoint
CREATE INDEX "member_tag_bindings_tag_idx" ON "member_tag_bindings" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "member_vip_renewals_member_idx" ON "member_vip_renewals" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "member_wallet_transactions_operator_idx" ON "member_wallet_transactions" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "member_wallet_tx_member_idx" ON "member_wallet_transactions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "member_wallet_tx_biz_idx" ON "member_wallet_transactions" USING btree ("biz_type","biz_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_wallet_tx_payment_event_uq" ON "member_wallet_transactions" USING btree ("payment_event_id") WHERE "member_wallet_transactions"."payment_event_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "member_wallets_member_unique" ON "member_wallets" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "members_tenant_idx" ON "members" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_phone_unique" ON "members" USING btree ("phone") WHERE "members"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "members_email_unique" ON "members" USING btree ("email") WHERE "members"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "members_username_unique" ON "members" USING btree ("username") WHERE "members"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "members_invite_code_unique" ON "members" USING btree ("invite_code") WHERE "members"."invite_code" is not null;--> statement-breakpoint
CREATE INDEX "members_status_idx" ON "members" USING btree ("status");--> statement-breakpoint
CREATE INDEX "members_invited_by_idx" ON "members" USING btree ("invited_by");--> statement-breakpoint
CREATE INDEX "monitor_alert_events_rule_idx" ON "monitor_alert_events" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "monitor_alert_events_status_idx" ON "monitor_alert_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "monitor_alert_events_notify_status_idx" ON "monitor_alert_events" USING btree ("notify_status");--> statement-breakpoint
CREATE INDEX "monitor_alert_events_handle_status_idx" ON "monitor_alert_events" USING btree ("handle_status");--> statement-breakpoint
CREATE INDEX "monitor_alert_events_triggered_idx" ON "monitor_alert_events" USING btree ("triggered_at");--> statement-breakpoint
CREATE INDEX "monitor_alert_events_tenant_idx" ON "monitor_alert_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "monitor_alert_rules_tenant_idx" ON "monitor_alert_rules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "monitor_alert_rules_enabled_idx" ON "monitor_alert_rules" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "system_metric_samples_at_idx" ON "system_metric_samples" USING btree ("sampled_at");--> statement-breakpoint
CREATE INDEX "app_artifacts_release_idx" ON "app_artifacts" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "app_release_events_app_time_idx" ON "app_release_events" USING btree ("app_id","created_at");--> statement-breakpoint
CREATE INDEX "client_devices_app_active_idx" ON "client_devices" USING btree ("app_id","last_active_at");--> statement-breakpoint
CREATE INDEX "client_devices_subject_idx" ON "client_devices" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_devices_push_reg_unique" ON "client_devices" USING btree ("push_provider","push_registration_id");--> statement-breakpoint
CREATE INDEX "mp_accounts_tenant_idx" ON "mp_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "mp_auto_replies_tenant_idx" ON "mp_auto_replies" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "mp_auto_replies_account_type_idx" ON "mp_auto_replies" USING btree ("account_id","reply_type");--> statement-breakpoint
CREATE INDEX "mp_broadcasts_tenant_idx" ON "mp_broadcasts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "mp_broadcasts_account_idx" ON "mp_broadcasts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "mp_broadcasts_account_status_idx" ON "mp_broadcasts" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "mp_conditional_menus_tenant_idx" ON "mp_conditional_menus" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "mp_conditional_menus_account_idx" ON "mp_conditional_menus" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "mp_drafts_tenant_idx" ON "mp_drafts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "mp_drafts_account_idx" ON "mp_drafts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "mp_fans_tenant_idx" ON "mp_fans" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_fans_account_openid_uq" ON "mp_fans" USING btree ("account_id","openid");--> statement-breakpoint
CREATE INDEX "mp_fans_account_idx" ON "mp_fans" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "mp_fans_member_idx" ON "mp_fans" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "mp_kf_accounts_tenant_idx" ON "mp_kf_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_kf_accounts_account_kf_uq" ON "mp_kf_accounts" USING btree ("account_id","kf_account");--> statement-breakpoint
CREATE INDEX "mp_kf_accounts_account_idx" ON "mp_kf_accounts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "mp_kf_routing_configs_tenant_idx" ON "mp_kf_routing_configs" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_kf_routing_configs_account_uq" ON "mp_kf_routing_configs" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "mp_kf_session_events_operator_idx" ON "mp_kf_session_events" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "mp_kf_session_events_tenant_idx" ON "mp_kf_session_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "mp_kf_session_events_session_idx" ON "mp_kf_session_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "mp_kf_sessions_tenant_idx" ON "mp_kf_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_kf_sessions_open_uq" ON "mp_kf_sessions" USING btree ("account_id","openid") WHERE "mp_kf_sessions"."status" <> 'closed';--> statement-breakpoint
CREATE INDEX "mp_kf_sessions_account_status_idx" ON "mp_kf_sessions" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "mp_kf_sessions_kf_idx" ON "mp_kf_sessions" USING btree ("kf_id");--> statement-breakpoint
CREATE INDEX "mp_materials_tenant_idx" ON "mp_materials" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "mp_materials_account_type_idx" ON "mp_materials" USING btree ("account_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_materials_account_media_uq" ON "mp_materials" USING btree ("account_id","wechat_media_id") WHERE "mp_materials"."wechat_media_id" is not null;--> statement-breakpoint
CREATE INDEX "mp_menus_tenant_idx" ON "mp_menus" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "mp_message_templates_tenant_idx" ON "mp_message_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_message_templates_account_tpl_uq" ON "mp_message_templates" USING btree ("account_id","template_id");--> statement-breakpoint
CREATE INDEX "mp_messages_tenant_idx" ON "mp_messages" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "mp_messages_account_openid_idx" ON "mp_messages" USING btree ("account_id","openid");--> statement-breakpoint
CREATE INDEX "mp_messages_account_idx" ON "mp_messages" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_messages_account_msgid_uq" ON "mp_messages" USING btree ("account_id","msg_id") WHERE "mp_messages"."msg_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "mp_qrcodes_tenant_idx" ON "mp_qrcodes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "mp_qrcodes_account_idx" ON "mp_qrcodes" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "mp_qrcodes_account_scene_idx" ON "mp_qrcodes" USING btree ("account_id","scene_str");--> statement-breakpoint
CREATE INDEX "mp_tags_tenant_idx" ON "mp_tags" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_tags_account_name_uq" ON "mp_tags" USING btree ("account_id","name");--> statement-breakpoint
CREATE INDEX "mp_tags_account_idx" ON "mp_tags" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "mp_template_send_logs_tenant_idx" ON "mp_template_send_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "mp_template_send_logs_account_idx" ON "mp_template_send_logs" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "mp_unmatched_keywords_tenant_idx" ON "mp_unmatched_keywords" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mp_unmatched_keywords_account_kw_uq" ON "mp_unmatched_keywords" USING btree ("account_id","keyword");--> statement-breakpoint
CREATE INDEX "report_alert_rules_tenant_idx" ON "report_alert_rules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "report_alert_rules_dataset_idx" ON "report_alert_rules" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "report_alert_rules_metric_idx" ON "report_alert_rules" USING btree ("metric_id");--> statement-breakpoint
CREATE INDEX "report_alert_rules_next_run_idx" ON "report_alert_rules" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "report_dashboard_categories_tenant_idx" ON "report_dashboard_categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "report_dashboard_comments_user_idx" ON "report_dashboard_comments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "report_dashboard_comments_dashboard_idx" ON "report_dashboard_comments" USING btree ("dashboard_id");--> statement-breakpoint
CREATE INDEX "report_dashboard_comments_parent_idx" ON "report_dashboard_comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "report_dashboard_embed_tokens_dashboard_idx" ON "report_dashboard_embed_tokens" USING btree ("dashboard_id");--> statement-breakpoint
CREATE INDEX "report_dashboard_subscriptions_tenant_idx" ON "report_dashboard_subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "report_dashboard_subscriptions_dashboard_idx" ON "report_dashboard_subscriptions" USING btree ("dashboard_id");--> statement-breakpoint
CREATE INDEX "report_dashboard_subscriptions_next_run_idx" ON "report_dashboard_subscriptions" USING btree ("next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "report_dashboard_versions_dash_ver_uq" ON "report_dashboard_versions" USING btree ("dashboard_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "report_dashboards_tenant_name_uq" ON "report_dashboards" USING btree ("tenant_id","name") WHERE "report_dashboards"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_dashboards_global_name_uq" ON "report_dashboards" USING btree ("name") WHERE "report_dashboards"."tenant_id" is null;--> statement-breakpoint
CREATE INDEX "report_dashboards_tenant_lifecycle_idx" ON "report_dashboards" USING btree ("tenant_id","lifecycle_status");--> statement-breakpoint
CREATE INDEX "report_dashboards_category_idx" ON "report_dashboards" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "report_dashboards_folder_idx" ON "report_dashboards" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "report_dashboards_owner_idx" ON "report_dashboards" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "report_dataset_execution_logs_tenant_idx" ON "report_dataset_execution_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "report_dataset_execution_logs_dataset_idx" ON "report_dataset_execution_logs" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "report_dataset_execution_logs_datasource_idx" ON "report_dataset_execution_logs" USING btree ("datasource_id");--> statement-breakpoint
CREATE INDEX "report_dataset_execution_logs_scene_idx" ON "report_dataset_execution_logs" USING btree ("scene");--> statement-breakpoint
CREATE INDEX "report_dataset_execution_logs_user_idx" ON "report_dataset_execution_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "report_dataset_execution_logs_executed_idx" ON "report_dataset_execution_logs" USING btree ("executed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "report_datasets_tenant_name_uq" ON "report_datasets" USING btree ("tenant_id","name") WHERE "report_datasets"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_datasets_global_name_uq" ON "report_datasets" USING btree ("name") WHERE "report_datasets"."tenant_id" is null;--> statement-breakpoint
CREATE INDEX "report_datasets_tenant_status_idx" ON "report_datasets" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "report_datasets_datasource_idx" ON "report_datasets" USING btree ("datasource_id");--> statement-breakpoint
CREATE INDEX "report_datasets_folder_idx" ON "report_datasets" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "report_datasets_owner_idx" ON "report_datasets" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_datasources_tenant_name_uq" ON "report_datasources" USING btree ("tenant_id","name") WHERE "report_datasources"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_datasources_global_name_uq" ON "report_datasources" USING btree ("name") WHERE "report_datasources"."tenant_id" is null;--> statement-breakpoint
CREATE INDEX "report_datasources_tenant_status_idx" ON "report_datasources" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "report_datasources_folder_idx" ON "report_datasources" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "report_datasources_owner_idx" ON "report_datasources" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_delivery_attempts_run_channel_attempt_uq" ON "report_delivery_attempts" USING btree ("run_id","channel","attempt");--> statement-breakpoint
CREATE INDEX "report_delivery_attempts_run_idx" ON "report_delivery_attempts" USING btree ("run_id","id");--> statement-breakpoint
CREATE INDEX "report_delivery_attempts_tenant_idx" ON "report_delivery_attempts" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_delivery_runs_idempotency_uq" ON "report_delivery_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "report_delivery_runs_target_idx" ON "report_delivery_runs" USING btree ("target_type","subscription_id","alert_rule_id","id");--> statement-breakpoint
CREATE INDEX "report_delivery_runs_subscription_idx" ON "report_delivery_runs" USING btree ("subscription_id","id");--> statement-breakpoint
CREATE INDEX "report_delivery_runs_alert_idx" ON "report_delivery_runs" USING btree ("alert_rule_id","id");--> statement-breakpoint
CREATE INDEX "report_delivery_runs_retry_idx" ON "report_delivery_runs" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX "report_delivery_runs_tenant_idx" ON "report_delivery_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_folders_tenant_root_name_uq" ON "report_folders" USING btree ("tenant_id","resource_type","name") WHERE "report_folders"."tenant_id" is not null and "report_folders"."parent_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_folders_tenant_child_name_uq" ON "report_folders" USING btree ("tenant_id","parent_id","resource_type","name") WHERE "report_folders"."tenant_id" is not null and "report_folders"."parent_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_folders_global_root_name_uq" ON "report_folders" USING btree ("resource_type","name") WHERE "report_folders"."tenant_id" is null and "report_folders"."parent_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_folders_global_child_name_uq" ON "report_folders" USING btree ("parent_id","resource_type","name") WHERE "report_folders"."tenant_id" is null and "report_folders"."parent_id" is not null;--> statement-breakpoint
CREATE INDEX "report_folders_tenant_type_status_idx" ON "report_folders" USING btree ("tenant_id","resource_type","status");--> statement-breakpoint
CREATE INDEX "report_folders_parent_sort_idx" ON "report_folders" USING btree ("parent_id","sort");--> statement-breakpoint
CREATE INDEX "report_folders_owner_idx" ON "report_folders" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_print_templates_tenant_name_uq" ON "report_print_templates" USING btree ("tenant_id","name") WHERE "report_print_templates"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_print_templates_global_name_uq" ON "report_print_templates" USING btree ("name") WHERE "report_print_templates"."tenant_id" is null;--> statement-breakpoint
CREATE INDEX "report_print_templates_tenant_status_idx" ON "report_print_templates" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "report_print_templates_folder_idx" ON "report_print_templates" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "report_print_templates_owner_idx" ON "report_print_templates" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "report_share_access_logs_share_idx" ON "report_share_access_logs" USING btree ("share_id");--> statement-breakpoint
CREATE INDEX "report_share_access_logs_created_idx" ON "report_share_access_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "report_asset_templates_tenant_code_uq" ON "report_asset_templates" USING btree ("tenant_id","code") WHERE "report_asset_templates"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_asset_templates_global_code_uq" ON "report_asset_templates" USING btree ("code") WHERE "report_asset_templates"."tenant_id" is null;--> statement-breakpoint
CREATE INDEX "report_asset_templates_tenant_type_status_idx" ON "report_asset_templates" USING btree ("tenant_id","type","status");--> statement-breakpoint
CREATE INDEX "report_asset_templates_folder_idx" ON "report_asset_templates" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "report_asset_templates_owner_idx" ON "report_asset_templates" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "report_asset_usage_logs_resource_time_idx" ON "report_asset_usage_logs" USING btree ("tenant_id","resource_type","resource_id","occurred_at");--> statement-breakpoint
CREATE INDEX "report_asset_usage_logs_user_time_idx" ON "report_asset_usage_logs" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "report_chatbi_messages_user_idx" ON "report_chatbi_messages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "report_chatbi_messages_session_time_idx" ON "report_chatbi_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "report_chatbi_messages_tenant_user_time_idx" ON "report_chatbi_messages" USING btree ("tenant_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "report_chatbi_sessions_user_idx" ON "report_chatbi_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "report_chatbi_sessions_user_status_time_idx" ON "report_chatbi_sessions" USING btree ("tenant_id","user_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "report_chatbi_sessions_dataset_idx" ON "report_chatbi_sessions" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "report_chatbi_sessions_datasource_idx" ON "report_chatbi_sessions" USING btree ("datasource_id");--> statement-breakpoint
CREATE INDEX "report_deprecation_notices_resource_idx" ON "report_deprecation_notices" USING btree ("tenant_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "report_deprecation_notices_effective_idx" ON "report_deprecation_notices" USING btree ("tenant_id","effective_at","expires_at");--> statement-breakpoint
CREATE INDEX "report_dq_anomalies_dataset_status_idx" ON "report_dq_anomalies" USING btree ("dataset_id","status","created_at");--> statement-breakpoint
CREATE INDEX "report_dq_anomalies_tenant_severity_status_idx" ON "report_dq_anomalies" USING btree ("tenant_id","severity","status");--> statement-breakpoint
CREATE INDEX "report_dq_anomalies_run_idx" ON "report_dq_anomalies" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_dq_rules_tenant_dataset_name_uq" ON "report_dq_rules" USING btree ("tenant_id","dataset_id","name") WHERE "report_dq_rules"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_dq_rules_global_dataset_name_uq" ON "report_dq_rules" USING btree ("dataset_id","name") WHERE "report_dq_rules"."tenant_id" is null;--> statement-breakpoint
CREATE INDEX "report_dq_rules_dataset_enabled_idx" ON "report_dq_rules" USING btree ("dataset_id","enabled");--> statement-breakpoint
CREATE INDEX "report_dq_rules_schedule_idx" ON "report_dq_rules" USING btree ("enabled","cron");--> statement-breakpoint
CREATE INDEX "report_dq_runs_rule_time_idx" ON "report_dq_runs" USING btree ("rule_id","created_at");--> statement-breakpoint
CREATE INDEX "report_dq_runs_dataset_status_time_idx" ON "report_dq_runs" USING btree ("dataset_id","status","created_at");--> statement-breakpoint
CREATE INDEX "report_dq_runs_tenant_time_idx" ON "report_dq_runs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "report_dq_scores_dataset_time_idx" ON "report_dq_scores" USING btree ("dataset_id","measured_at");--> statement-breakpoint
CREATE INDEX "report_dq_scores_tenant_time_idx" ON "report_dq_scores" USING btree ("tenant_id","measured_at");--> statement-breakpoint
CREATE INDEX "report_environment_promotions_resource_idx" ON "report_environment_promotions" USING btree ("tenant_id","resource_type","resource_id","created_at");--> statement-breakpoint
CREATE INDEX "report_environment_promotions_target_status_idx" ON "report_environment_promotions" USING btree ("target_environment_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "report_environments_tenant_code_uq" ON "report_environments" USING btree ("tenant_id","code") WHERE "report_environments"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_environments_global_code_uq" ON "report_environments" USING btree ("code") WHERE "report_environments"."tenant_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_environments_tenant_default_uq" ON "report_environments" USING btree ("tenant_id") WHERE "report_environments"."tenant_id" is not null and "report_environments"."is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "report_environments_global_default_uq" ON "report_environments" USING btree ("is_default") WHERE "report_environments"."tenant_id" is null and "report_environments"."is_default" = true;--> statement-breakpoint
CREATE INDEX "report_environments_tenant_kind_status_idx" ON "report_environments" USING btree ("tenant_id","kind","status");--> statement-breakpoint
CREATE INDEX "report_fill_records_template_status_time_idx" ON "report_fill_records" USING btree ("template_id","status","created_at");--> statement-breakpoint
CREATE INDEX "report_fill_records_submitter_status_time_idx" ON "report_fill_records" USING btree ("tenant_id","submitter_id","status","created_at");--> statement-breakpoint
CREATE INDEX "report_fill_records_workflow_idx" ON "report_fill_records" USING btree ("workflow_instance_id");--> statement-breakpoint
CREATE INDEX "report_fill_records_dataset_idx" ON "report_fill_records" USING btree ("generated_dataset_id");--> statement-breakpoint
CREATE INDEX "report_fill_records_sync_idx" ON "report_fill_records" USING btree ("tenant_id","sync_status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "report_fill_templates_tenant_code_uq" ON "report_fill_templates" USING btree ("tenant_id","code") WHERE "report_fill_templates"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_fill_templates_global_code_uq" ON "report_fill_templates" USING btree ("code") WHERE "report_fill_templates"."tenant_id" is null;--> statement-breakpoint
CREATE INDEX "report_fill_templates_tenant_status_idx" ON "report_fill_templates" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "report_fill_templates_folder_idx" ON "report_fill_templates" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "report_fill_templates_owner_idx" ON "report_fill_templates" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "report_fill_templates_dataset_idx" ON "report_fill_templates" USING btree ("generated_dataset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_materialization_snapshots_dataset_revision_uq" ON "report_materialization_snapshots" USING btree ("dataset_id","revision");--> statement-breakpoint
CREATE INDEX "report_materialization_snapshots_dataset_status_idx" ON "report_materialization_snapshots" USING btree ("dataset_id","status","created_at");--> statement-breakpoint
CREATE INDEX "report_materialization_snapshots_tenant_expiry_idx" ON "report_materialization_snapshots" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "report_metrics_tenant_code_uq" ON "report_metrics" USING btree ("tenant_id","code") WHERE "report_metrics"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_metrics_global_code_uq" ON "report_metrics" USING btree ("code") WHERE "report_metrics"."tenant_id" is null;--> statement-breakpoint
CREATE INDEX "report_metrics_tenant_lifecycle_idx" ON "report_metrics" USING btree ("tenant_id","lifecycle_status");--> statement-breakpoint
CREATE INDEX "report_metrics_dataset_idx" ON "report_metrics" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "report_metrics_folder_idx" ON "report_metrics" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "report_metrics_owner_idx" ON "report_metrics" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "report_publish_approvals_resource_idx" ON "report_publish_approvals" USING btree ("tenant_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "report_publish_approvals_status_time_idx" ON "report_publish_approvals" USING btree ("tenant_id","status","requested_at");--> statement-breakpoint
CREATE INDEX "report_publish_approvals_requester_idx" ON "report_publish_approvals" USING btree ("requested_by");--> statement-breakpoint
CREATE UNIQUE INDEX "report_query_cost_logs_request_uq" ON "report_query_cost_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "report_query_cost_logs_tenant_time_idx" ON "report_query_cost_logs" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "report_query_cost_logs_user_time_idx" ON "report_query_cost_logs" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "report_query_cost_logs_dataset_time_idx" ON "report_query_cost_logs" USING btree ("dataset_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "report_query_quotas_tenant_scope_uq" ON "report_query_quotas" USING btree ("tenant_id","scope") WHERE "report_query_quotas"."tenant_id" is not null and "report_query_quotas"."scope" = 'tenant' and "report_query_quotas"."user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_query_quotas_global_scope_uq" ON "report_query_quotas" USING btree ("scope") WHERE "report_query_quotas"."tenant_id" is null and "report_query_quotas"."scope" = 'tenant' and "report_query_quotas"."user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_query_quotas_tenant_user_uq" ON "report_query_quotas" USING btree ("tenant_id","user_id") WHERE "report_query_quotas"."tenant_id" is not null and "report_query_quotas"."scope" = 'user' and "report_query_quotas"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_query_quotas_global_user_uq" ON "report_query_quotas" USING btree ("user_id") WHERE "report_query_quotas"."tenant_id" is null and "report_query_quotas"."scope" = 'user' and "report_query_quotas"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "report_query_quotas_enabled_idx" ON "report_query_quotas" USING btree ("tenant_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "report_resource_acls_tenant_subject_uq" ON "report_resource_acls" USING btree ("tenant_id","resource_type","resource_id","subject_type","subject_id","inherit_from_folder") WHERE "report_resource_acls"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_resource_acls_global_subject_uq" ON "report_resource_acls" USING btree ("resource_type","resource_id","subject_type","subject_id","inherit_from_folder") WHERE "report_resource_acls"."tenant_id" is null;--> statement-breakpoint
CREATE INDEX "report_resource_acls_resource_idx" ON "report_resource_acls" USING btree ("tenant_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "report_resource_acls_subject_idx" ON "report_resource_acls" USING btree ("tenant_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "report_resource_acls_expires_idx" ON "report_resource_acls" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "report_resource_transfers_resource_idx" ON "report_resource_transfers" USING btree ("tenant_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "report_resource_transfers_owner_status_idx" ON "report_resource_transfers" USING btree ("to_owner_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "report_sla_rules_tenant_dataset_name_uq" ON "report_sla_rules" USING btree ("tenant_id","dataset_id","name") WHERE "report_sla_rules"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_sla_rules_global_dataset_name_uq" ON "report_sla_rules" USING btree ("dataset_id","name") WHERE "report_sla_rules"."tenant_id" is null;--> statement-breakpoint
CREATE INDEX "report_sla_rules_dataset_enabled_idx" ON "report_sla_rules" USING btree ("dataset_id","enabled");--> statement-breakpoint
CREATE INDEX "report_sla_violations_rule_time_idx" ON "report_sla_violations" USING btree ("rule_id","created_at");--> statement-breakpoint
CREATE INDEX "report_sla_violations_tenant_status_idx" ON "report_sla_violations" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_ad_events_dedupe_uq" ON "cms_ad_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "cms_ad_events_site_time_idx" ON "cms_ad_events" USING btree ("site_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "cms_ad_events_ad_time_idx" ON "cms_ad_events" USING btree ("ad_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "cms_ad_events_slot_time_idx" ON "cms_ad_events" USING btree ("slot_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "cms_ad_events_type_device_time_idx" ON "cms_ad_events" USING btree ("event_type","device","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_ad_slots_site_code_uq" ON "cms_ad_slots" USING btree ("site_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_ad_stats_ad_date_uq" ON "cms_ad_stats" USING btree ("ad_id","stat_date");--> statement-breakpoint
CREATE INDEX "cms_channel_users_user_idx" ON "cms_channel_users" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_channels_site_path_uq" ON "cms_channels" USING btree ("site_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_channels_site_code_uq" ON "cms_channels" USING btree ("site_id","code");--> statement-breakpoint
CREATE INDEX "cms_channels_site_parent_idx" ON "cms_channels" USING btree ("site_id","parent_id");--> statement-breakpoint
CREATE INDEX "cms_collect_items_content_idx" ON "cms_collect_items" USING btree ("content_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_collect_items_rule_url_uq" ON "cms_collect_items" USING btree ("rule_id","url");--> statement-breakpoint
CREATE INDEX "cms_collect_items_rule_idx" ON "cms_collect_items" USING btree ("rule_id","created_at");--> statement-breakpoint
CREATE INDEX "cms_collect_rules_channel_idx" ON "cms_collect_rules" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "cms_collect_rules_site_idx" ON "cms_collect_rules" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "cms_comments_content_idx" ON "cms_comments" USING btree ("content_id","status");--> statement-breakpoint
CREATE INDEX "cms_comments_member_idx" ON "cms_comments" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "cms_content_channels_channel_idx" ON "cms_content_channels" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "cms_content_favorites_content_idx" ON "cms_content_favorites" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "cms_content_favorites_member_idx" ON "cms_content_favorites" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "cms_content_likes_content_idx" ON "cms_content_likes" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "cms_content_op_logs_operator_idx" ON "cms_content_op_logs" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "cms_content_op_logs_content_idx" ON "cms_content_op_logs" USING btree ("content_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_content_tombstones_content_uq" ON "cms_content_tombstones" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "cms_content_tombstones_sync_idx" ON "cms_content_tombstones" USING btree ("site_id","deleted_at","content_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_content_versions_content_ver_uq" ON "cms_content_versions" USING btree ("content_id","version");--> statement-breakpoint
CREATE INDEX "cms_contents_channel_idx" ON "cms_contents" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "cms_contents_site_channel_idx" ON "cms_contents" USING btree ("site_id","channel_id");--> statement-breakpoint
CREATE INDEX "cms_contents_status_idx" ON "cms_contents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cms_contents_published_at_idx" ON "cms_contents" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "cms_contents_search_idx" ON "cms_contents" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "cms_contents_title_trgm_idx" ON "cms_contents" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "cms_contents_member_idx" ON "cms_contents" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "cms_contents_mapping_source_idx" ON "cms_contents" USING btree ("mapping_source_id");--> statement-breakpoint
CREATE INDEX "cms_contents_distribution_source_idx" ON "cms_contents" USING btree ("distribution_rule_id","distribution_source_id");--> statement-breakpoint
CREATE INDEX "cms_contents_locked_at_idx" ON "cms_contents" USING btree ("locked_at");--> statement-breakpoint
CREATE INDEX "cms_contents_sync_idx" ON "cms_contents" USING btree ("site_id","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_contents_distribution_materialization_uq" ON "cms_contents" USING btree ("distribution_rule_id","distribution_source_id") WHERE "cms_contents"."distribution_rule_id" is not null and "cms_contents"."distribution_source_id" is not null and "cms_contents"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_contents_site_slug_uq" ON "cms_contents" USING btree ("site_id","slug") WHERE "cms_contents"."slug" is not null and "cms_contents"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_contents_site_static_path_uq" ON "cms_contents" USING btree ("site_id","static_path") WHERE "cms_contents"."static_path" is not null and "cms_contents"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "cms_distribution_rules_source_idx" ON "cms_distribution_rules" USING btree ("source_site_id","source_channel_id","status");--> statement-breakpoint
CREATE INDEX "cms_distribution_rules_target_idx" ON "cms_distribution_rules" USING btree ("target_site_id","target_channel_id","status");--> statement-breakpoint
CREATE INDEX "cms_distribution_rules_due_idx" ON "cms_distribution_rules" USING btree ("mode","status","next_run_at");--> statement-breakpoint
CREATE INDEX "cms_form_submissions_form_idx" ON "cms_form_submissions" USING btree ("form_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_forms_site_code_uq" ON "cms_forms" USING btree ("site_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_friend_link_groups_site_code_uq" ON "cms_friend_link_groups" USING btree ("site_id","code");--> statement-breakpoint
CREATE INDEX "cms_friend_link_groups_site_sort_idx" ON "cms_friend_link_groups" USING btree ("site_id","sort","id");--> statement-breakpoint
CREATE INDEX "cms_friend_links_site_group_idx" ON "cms_friend_links" USING btree ("site_id","group_id","sort","id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_hotword_groups_site_name_uq" ON "cms_hotword_groups" USING btree ("site_id","name");--> statement-breakpoint
CREATE INDEX "cms_hotword_groups_site_sort_idx" ON "cms_hotword_groups" USING btree ("site_id","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_hotwords_site_keyword_uq" ON "cms_hotwords" USING btree ("site_id","keyword");--> statement-breakpoint
CREATE INDEX "cms_hotwords_site_group_sort_idx" ON "cms_hotwords" USING btree ("site_id","group_id","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_interaction_answers_response_question_uq" ON "cms_interaction_answers" USING btree ("response_id","question_id");--> statement-breakpoint
CREATE INDEX "cms_interaction_answers_question_idx" ON "cms_interaction_answers" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "cms_interaction_questions_parent_idx" ON "cms_interaction_questions" USING btree ("interaction_id","sort");--> statement-breakpoint
CREATE INDEX "cms_interaction_responses_parent_time_idx" ON "cms_interaction_responses" USING btree ("interaction_id","created_at","id");--> statement-breakpoint
CREATE INDEX "cms_interaction_responses_member_idx" ON "cms_interaction_responses" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_interaction_responses_repeat_uq" ON "cms_interaction_responses" USING btree ("interaction_id","repeat_key") WHERE "cms_interaction_responses"."repeat_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_interaction_responses_request_uq" ON "cms_interaction_responses" USING btree ("interaction_id","request_key") WHERE "cms_interaction_responses"."request_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_interactions_site_code_uq" ON "cms_interactions" USING btree ("site_id","code");--> statement-breakpoint
CREATE INDEX "cms_interactions_site_status_idx" ON "cms_interactions" USING btree ("site_id","status","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_link_words_site_keyword_uq" ON "cms_link_words" USING btree ("site_id","keyword");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_member_subscriptions_subject_uq" ON "cms_member_subscriptions" USING btree ("member_id","site_id","subject_type","subject_key");--> statement-breakpoint
CREATE INDEX "cms_member_subscriptions_member_idx" ON "cms_member_subscriptions" USING btree ("member_id","active","created_at");--> statement-breakpoint
CREATE INDEX "cms_member_subscriptions_subject_idx" ON "cms_member_subscriptions" USING btree ("site_id","subject_type","subject_key","active");--> statement-breakpoint
CREATE INDEX "cms_member_view_history_content_idx" ON "cms_member_view_history" USING btree ("content_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_member_view_history_uq" ON "cms_member_view_history" USING btree ("member_id","content_id");--> statement-breakpoint
CREATE INDEX "cms_member_view_history_member_idx" ON "cms_member_view_history" USING btree ("member_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_model_fields_model_name_uq" ON "cms_model_fields" USING btree ("model_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_open_app_grants_client_site_uq" ON "cms_open_app_grants" USING btree ("client_id","site_id");--> statement-breakpoint
CREATE INDEX "cms_open_app_grants_client_idx" ON "cms_open_app_grants" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "cms_open_app_grants_site_idx" ON "cms_open_app_grants" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_page_block_acls_grant_uq" ON "cms_page_block_acls" USING btree ("page_id","block_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "cms_page_block_acls_block_idx" ON "cms_page_block_acls" USING btree ("page_id","block_id");--> statement-breakpoint
CREATE INDEX "cms_page_block_acls_subject_idx" ON "cms_page_block_acls" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_pages_site_slug_uq" ON "cms_pages" USING btree ("site_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_pages_site_path_uq" ON "cms_pages" USING btree ("site_id","path") WHERE "cms_pages"."path" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "cms_pages_site_idx" ON "cms_pages" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "cms_publish_artifacts_content_idx" ON "cms_publish_artifacts" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "cms_publish_artifacts_channel_idx" ON "cms_publish_artifacts" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_publish_artifacts_task_path_uq" ON "cms_publish_artifacts" USING btree ("task_id","path");--> statement-breakpoint
CREATE INDEX "cms_publish_artifacts_site_time_idx" ON "cms_publish_artifacts" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "cms_publish_artifacts_task_status_idx" ON "cms_publish_artifacts" USING btree ("task_id","status");--> statement-breakpoint
CREATE INDEX "cms_publish_artifacts_target_idx" ON "cms_publish_artifacts" USING btree ("target_type","content_id","channel_id");--> statement-breakpoint
CREATE INDEX "cms_push_logs_site_idx" ON "cms_push_logs" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_redirects_site_from_uq" ON "cms_redirects" USING btree ("site_id","from_path");--> statement-breakpoint
CREATE INDEX "cms_resource_folders_parent_idx" ON "cms_resource_folders" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_resource_folders_site_parent_name_uq" ON "cms_resource_folders" USING btree ("site_id","parent_id","name") WHERE "cms_resource_folders"."parent_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_resource_folders_site_root_name_uq" ON "cms_resource_folders" USING btree ("site_id","name") WHERE "cms_resource_folders"."parent_id" is null;--> statement-breakpoint
CREATE INDEX "cms_resource_folders_site_parent_idx" ON "cms_resource_folders" USING btree ("site_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_resource_refs_uq" ON "cms_resource_refs" USING btree ("resource_id","owner_type","owner_id","field");--> statement-breakpoint
CREATE INDEX "cms_resource_refs_resource_idx" ON "cms_resource_refs" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "cms_resource_refs_site_idx" ON "cms_resource_refs" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "cms_resource_refs_owner_idx" ON "cms_resource_refs" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "cms_resources_site_type_idx" ON "cms_resources" USING btree ("site_id","type");--> statement-breakpoint
CREATE INDEX "cms_resources_site_folder_idx" ON "cms_resources" USING btree ("site_id","folder_id");--> statement-breakpoint
CREATE INDEX "cms_resources_file_idx" ON "cms_resources" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_resources_site_url_uq" ON "cms_resources" USING btree ("site_id","url");--> statement-breakpoint
CREATE INDEX "cms_search_logs_site_time_idx" ON "cms_search_logs" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "cms_search_logs_keyword_idx" ON "cms_search_logs" USING btree ("site_id","keyword");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_search_words_site_type_word_uq" ON "cms_search_words" USING btree ("site_id","type","word");--> statement-breakpoint
CREATE INDEX "cms_search_words_site_group_idx" ON "cms_search_words" USING btree ("site_id","type","group_name");--> statement-breakpoint
CREATE INDEX "cms_site_users_user_idx" ON "cms_site_users" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_sites_domain_uq" ON "cms_sites" USING btree ("domain") WHERE "cms_sites"."domain" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_sites_default_uq" ON "cms_sites" USING btree ("is_default") WHERE "cms_sites"."is_default" = true;--> statement-breakpoint
CREATE INDEX "cms_sites_parent_idx" ON "cms_sites" USING btree ("parent_id","sort","id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_tags_site_name_uq" ON "cms_tags" USING btree ("site_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_tags_site_slug_uq" ON "cms_tags" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX "cms_visit_logs_site_time_idx" ON "cms_visit_logs" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "cms_visit_logs_content_idx" ON "cms_visit_logs" USING btree ("content_id") WHERE "cms_visit_logs"."content_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_widget_refs_owner_field_uq" ON "cms_widget_refs" USING btree ("owner_type","owner_id","field");--> statement-breakpoint
CREATE INDEX "cms_widget_refs_widget_idx" ON "cms_widget_refs" USING btree ("widget_id");--> statement-breakpoint
CREATE INDEX "cms_widget_refs_site_owner_idx" ON "cms_widget_refs" USING btree ("site_id","owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_widget_source_refs_widget_item_uq" ON "cms_widget_source_refs" USING btree ("widget_id","item_id");--> statement-breakpoint
CREATE INDEX "cms_widget_source_refs_source_idx" ON "cms_widget_source_refs" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "cms_widget_source_refs_site_idx" ON "cms_widget_source_refs" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cms_widgets_site_code_uq" ON "cms_widgets" USING btree ("site_id","code");--> statement-breakpoint
CREATE INDEX "cms_widgets_site_status_idx" ON "cms_widgets" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "wiki_comments_doc_idx" ON "wiki_comments" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "wiki_doc_views_doc_idx" ON "wiki_doc_views" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "wiki_doc_views_created_idx" ON "wiki_doc_views" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "wiki_docs_space_idx" ON "wiki_docs" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "wiki_docs_parent_idx" ON "wiki_docs" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "wiki_docs_status_idx" ON "wiki_docs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "wiki_docs_title_trgm_idx" ON "wiki_docs" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "wiki_docs_content_trgm_idx" ON "wiki_docs" USING gin ("content" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "wiki_review_records_doc_idx" ON "wiki_review_records" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "wiki_review_records_actor_idx" ON "wiki_review_records" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "wiki_search_logs_created_idx" ON "wiki_search_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "wiki_search_logs_keyword_idx" ON "wiki_search_logs" USING btree ("keyword");--> statement-breakpoint
CREATE INDEX "idx_short_link_clicks_link_time" ON "short_link_clicks" USING btree ("link_id","clicked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_short_link_daily_stats_link_date" ON "short_link_daily_stats" USING btree ("link_id","stat_date");--> statement-breakpoint
CREATE INDEX "idx_short_links_biz" ON "short_links" USING btree ("biz_type","biz_ref");--> statement-breakpoint
CREATE INDEX "idx_short_links_tenant" ON "short_links" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_marketing_campaigns_status" ON "marketing_campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_marketing_campaigns_tenant" ON "marketing_campaigns" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_marketing_participations_campaign_member" ON "marketing_participations" USING btree ("campaign_id","member_id");--> statement-breakpoint
CREATE INDEX "idx_marketing_participations_campaign_time" ON "marketing_participations" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_marketing_prizes_campaign" ON "marketing_prizes" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_iot_alarm_rules_product" ON "iot_alarm_rules" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_iot_alarms_device_time" ON "iot_alarms" USING btree ("device_id","fired_at");--> statement-breakpoint
CREATE INDEX "idx_iot_alarms_status" ON "iot_alarms" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_iot_alarms_active" ON "iot_alarms" USING btree ("rule_id","device_id") WHERE status <> 'resolved';--> statement-breakpoint
CREATE INDEX "idx_iot_automation_runs_automation" ON "iot_automation_runs" USING btree ("automation_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_iot_automation_runs_device" ON "iot_automation_runs" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_iot_automations_product" ON "iot_automations" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_iot_commands_device_time" ON "iot_commands" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_iot_commands_status" ON "iot_commands" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_iot_device_events_device_time" ON "iot_device_events" USING btree ("device_id","reported_at");--> statement-breakpoint
CREATE INDEX "idx_iot_device_groups_tenant" ON "iot_device_groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_iot_device_logs_device" ON "iot_device_logs" USING btree ("device_id","reported_at");--> statement-breakpoint
CREATE INDEX "idx_iot_device_logs_level" ON "iot_device_logs" USING btree ("device_id","level");--> statement-breakpoint
CREATE INDEX "idx_iot_device_whitelist_product" ON "iot_device_whitelist" USING btree ("product_id","used");--> statement-breakpoint
CREATE INDEX "idx_iot_devices_product" ON "iot_devices" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_iot_devices_tenant" ON "iot_devices" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_iot_devices_gateway" ON "iot_devices" USING btree ("gateway_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_iot_firmwares_product_version" ON "iot_firmwares" USING btree ("product_id","version");--> statement-breakpoint
CREATE INDEX "idx_iot_forward_logs_rule" ON "iot_forward_logs" USING btree ("rule_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_iot_forward_rules_source" ON "iot_forward_rules" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_iot_forward_rules_tenant" ON "iot_forward_rules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_iot_maintenance_windows_time" ON "iot_maintenance_windows" USING btree ("start_at","end_at");--> statement-breakpoint
CREATE INDEX "idx_iot_online_snapshots_time" ON "iot_online_snapshots" USING btree ("sampled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_iot_ota_task_devices" ON "iot_ota_task_devices" USING btree ("task_id","device_id");--> statement-breakpoint
CREATE INDEX "idx_iot_ota_task_devices_device" ON "iot_ota_task_devices" USING btree ("device_id","status");--> statement-breakpoint
CREATE INDEX "idx_iot_ota_tasks_product" ON "iot_ota_tasks" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_iot_ota_tasks_status" ON "iot_ota_tasks" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_iot_product_events_ident" ON "iot_product_events" USING btree ("product_id","identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_iot_product_properties_ident" ON "iot_product_properties" USING btree ("product_id","identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_iot_product_services_ident" ON "iot_product_services" USING btree ("product_id","identifier");--> statement-breakpoint
CREATE INDEX "idx_iot_products_tenant" ON "iot_products" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_iot_schedule_runs_schedule" ON "iot_schedule_runs" USING btree ("schedule_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_iot_schedules_next_run" ON "iot_schedules" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "idx_iot_schedules_product" ON "iot_schedules" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_iot_telemetry_device_time" ON "iot_telemetry" USING btree ("device_id","reported_at");--> statement-breakpoint
CREATE INDEX "idx_iot_telemetry_time_brin" ON "iot_telemetry" USING brin ("reported_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_iot_telemetry_hourly" ON "iot_telemetry_hourly" USING btree ("device_id","property","bucket");--> statement-breakpoint
CREATE INDEX "idx_iot_telemetry_hourly_bucket" ON "iot_telemetry_hourly" USING btree ("bucket");--> statement-breakpoint
CREATE INDEX "drive_activities_node_idx" ON "drive_activities" USING btree ("node_id","created_at");--> statement-breakpoint
CREATE INDEX "drive_activities_space_idx" ON "drive_activities" USING btree ("space_id","created_at");--> statement-breakpoint
CREATE INDEX "drive_activities_actor_idx" ON "drive_activities" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "drive_activities_created_idx" ON "drive_activities" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "drive_file_versions_file_idx" ON "drive_file_versions" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "drive_node_comments_node_idx" ON "drive_node_comments" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "drive_node_permissions_subject_idx" ON "drive_node_permissions" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "drive_node_stars_node_idx" ON "drive_node_stars" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "drive_node_tags_tag_idx" ON "drive_node_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "drive_node_texts_search_idx" ON "drive_node_texts" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "drive_nodes_space_parent_idx" ON "drive_nodes" USING btree ("space_id","parent_id","deleted_at");--> statement-breakpoint
CREATE INDEX "drive_nodes_ancestors_gin_idx" ON "drive_nodes" USING gin ("ancestor_ids");--> statement-breakpoint
CREATE INDEX "drive_nodes_file_idx" ON "drive_nodes" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "drive_nodes_deleted_root_idx" ON "drive_nodes" USING btree ("deleted_root_id");--> statement-breakpoint
CREATE INDEX "drive_nodes_content_hash_idx" ON "drive_nodes" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "drive_nodes_name_trgm_idx" ON "drive_nodes" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "drive_nodes_sibling_name_uq" ON "drive_nodes" USING btree ("space_id",coalesce("parent_id", 0),lower("name")) WHERE "drive_nodes"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "drive_recent_access_user_time_idx" ON "drive_recent_access" USING btree ("user_id","last_access_at");--> statement-breakpoint
CREATE INDEX "drive_share_access_logs_share_idx" ON "drive_share_access_logs" USING btree ("share_id");--> statement-breakpoint
CREATE INDEX "drive_share_access_logs_created_idx" ON "drive_share_access_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "drive_share_links_node_idx" ON "drive_share_links" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "drive_share_links_tenant_idx" ON "drive_share_links" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "drive_space_members_subject_idx" ON "drive_space_members" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drive_spaces_personal_owner_uq" ON "drive_spaces" USING btree ("owner_id") WHERE "drive_spaces"."type" = 'personal';--> statement-breakpoint
CREATE UNIQUE INDEX "drive_spaces_department_uq" ON "drive_spaces" USING btree ("department_id") WHERE "drive_spaces"."type" = 'department';--> statement-breakpoint
CREATE INDEX "drive_spaces_tenant_idx" ON "drive_spaces" USING btree ("tenant_id");