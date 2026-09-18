CREATE TYPE "public"."payment_channel_environment" AS ENUM('sandbox', 'production');--> statement-breakpoint
CREATE TYPE "public"."payment_recon_adjustment_status" AS ENUM('draft', 'pending', 'approved', 'rejected', 'executed', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."payment_recon_case_status" AS ENUM('open', 'investigating', 'suspended', 'resolved', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."payment_recon_case_type" AS ENUM('local_only', 'channel_only', 'amount_diff', 'status_diff', 'identity_diff', 'summary_diff', 'balance_diff');--> statement-breakpoint
CREATE TYPE "public"."payment_recon_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."payment_recon_run_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_statement_entry_type" AS ENUM('payment', 'refund', 'fee', 'settlement', 'transfer', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."payment_statement_period_status" AS ENUM('expected', 'waiting', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_statement_source" AS ENUM('provider_download', 'manual_upload', 'sandbox_generated');--> statement-breakpoint
CREATE TYPE "public"."payment_statement_status" AS ENUM('archived', 'validated', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."payment_statement_type" AS ENUM('trade', 'fund', 'bank');--> statement-breakpoint
CREATE TABLE "payment_channel_accounts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_channel_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(128) NOT NULL,
	"channel" "payment_channel" NOT NULL,
	"environment" "payment_channel_environment" NOT NULL,
	"merchant_id" varchar(128) NOT NULL,
	"sub_merchant_id" varchar(128) DEFAULT '' NOT NULL,
	"bill_timezone" varchar(64) DEFAULT 'Asia/Shanghai' NOT NULL,
	"status" "status" DEFAULT 'enabled' NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_channel_credential_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_channel_credential_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"channel_config_id" integer NOT NULL,
	"channel_account_id" integer NOT NULL,
	"version" integer NOT NULL,
	"encrypted_snapshot" text NOT NULL,
	"operator_id" integer,
	"tenant_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_channel_credential_versions_config_version_uq" UNIQUE("channel_config_id","version")
);
--> statement-breakpoint
CREATE TABLE "payment_bank_matches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_bank_matches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"account_id" integer NOT NULL,
	"bank_entry_id" integer NOT NULL,
	"settlement_entry_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_bank_matches_pair_unique" UNIQUE("bank_entry_id","settlement_entry_id"),
	CONSTRAINT "payment_bank_matches_positive_amount" CHECK ("payment_bank_matches"."amount" > 0),
	CONSTRAINT "payment_bank_matches_distinct_entries" CHECK ("payment_bank_matches"."bank_entry_id" <> "payment_bank_matches"."settlement_entry_id")
);
--> statement-breakpoint
CREATE TABLE "payment_recon_adjustments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_recon_adjustments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"case_id" integer NOT NULL,
	"case_version" integer NOT NULL,
	"application_id" integer NOT NULL,
	"channel_config_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	"direction" "payment_recon_direction" NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"status" "payment_recon_adjustment_status" DEFAULT 'draft' NOT NULL,
	"workflow_instance_id" integer,
	"journal_id" integer,
	"reversal_of_id" integer,
	"applicant_id" integer NOT NULL,
	"approver_id" integer,
	"approved_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_recon_adjustments_journal_unique" UNIQUE("journal_id"),
	CONSTRAINT "payment_recon_adjustments_positive_amount" CHECK ("payment_recon_adjustments"."amount" > 0),
	CONSTRAINT "payment_recon_adjustments_four_eyes" CHECK ("payment_recon_adjustments"."approver_id" is null or "payment_recon_adjustments"."approver_id" <> "payment_recon_adjustments"."applicant_id"),
	CONSTRAINT "payment_recon_adjustments_execution_journal" CHECK ("payment_recon_adjustments"."status" not in ('executed', 'reversed') or ("payment_recon_adjustments"."journal_id" is not null and "payment_recon_adjustments"."executed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "payment_recon_case_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_recon_case_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"case_id" integer NOT NULL,
	"action" varchar(64) NOT NULL,
	"actor_id" integer,
	"remark" text,
	"before" jsonb,
	"after" jsonb,
	"tenant_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_recon_cases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_recon_cases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"account_id" integer NOT NULL,
	"period_id" integer NOT NULL,
	"case_key" varchar(320) NOT NULL,
	"entry_key" varchar(256) NOT NULL,
	"type" "payment_recon_case_type" NOT NULL,
	"stage" "payment_statement_type" NOT NULL,
	"status" "payment_recon_case_status" DEFAULT 'open' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_run_id" integer NOT NULL,
	"application_id" integer,
	"order_id" integer,
	"refund_id" integer,
	"local_amount" bigint,
	"channel_amount" bigint,
	"currency" varchar(3) NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assigned_to" integer,
	"due_at" timestamp with time zone,
	"resolution" text,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_recon_cases_period_key_unique" UNIQUE("period_id","case_key"),
	CONSTRAINT "payment_recon_cases_positive_version" CHECK ("payment_recon_cases"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_recon_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_recon_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"statement_id" integer NOT NULL,
	"rule_version" varchar(64) NOT NULL,
	"status" "payment_recon_run_status" DEFAULT 'pending' NOT NULL,
	"local_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"snapshot_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"diff_count" integer DEFAULT 0 NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"task_id" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_statement_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_statement_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"statement_id" integer NOT NULL,
	"entry_key" varchar(256) NOT NULL,
	"type" "payment_statement_entry_type" NOT NULL,
	"merchant_order_no" varchar(128),
	"merchant_refund_no" varchar(128),
	"provider_transaction_id" varchar(128),
	"provider_refund_id" varchar(128),
	"reference" varchar(256),
	"currency" varchar(3) NOT NULL,
	"amount" bigint NOT NULL,
	"direction" "payment_recon_direction" NOT NULL,
	"status" varchar(64) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"application_id" integer,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"line_no" integer NOT NULL,
	"fee_amount" bigint,
	"net_amount" bigint,
	"balance" bigint,
	"tenant_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_statement_entries_statement_key_unique" UNIQUE("statement_id","entry_key"),
	CONSTRAINT "payment_statement_entries_nonnegative_amount" CHECK ("payment_statement_entries"."amount" >= 0),
	CONSTRAINT "payment_statement_entries_positive_line" CHECK ("payment_statement_entries"."line_no" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_statement_files" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_statement_files_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"statement_id" integer NOT NULL,
	"storage_key" varchar(1024) NOT NULL,
	"storage_config_id" integer,
	"storage_provider" varchar(32) NOT NULL,
	"bucket_name" varchar(256),
	"filename" varchar(255) NOT NULL,
	"mime_type" varchar(128) NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"provider_hash" varchar(256),
	"byte_length" integer NOT NULL,
	"tenant_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_statement_files_identity_unique" UNIQUE("statement_id","sha256","filename"),
	CONSTRAINT "payment_statement_files_nonnegative_length" CHECK ("payment_statement_files"."byte_length" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_statement_periods" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_statement_periods_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"account_id" integer NOT NULL,
	"bill_date" date NOT NULL,
	"type" "payment_statement_type" NOT NULL,
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"status" "payment_statement_period_status" DEFAULT 'expected' NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"last_error" text,
	"current_statement_id" integer,
	"task_id" integer,
	"generation" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_statement_periods_scope_unique" UNIQUE("account_id","bill_date","type","currency")
);
--> statement-breakpoint
CREATE TABLE "payment_statements" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_statements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"period_id" integer NOT NULL,
	"version" integer NOT NULL,
	"source" "payment_statement_source" NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"parser_version" varchar(64) NOT NULL,
	"status" "payment_statement_status" DEFAULT 'archived' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verification" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_statements_period_source_hash_unique" UNIQUE("period_id","source","content_hash"),
	CONSTRAINT "payment_statements_period_version_unique" UNIQUE("period_id","version"),
	CONSTRAINT "payment_statements_positive_version" CHECK ("payment_statements"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "payment_recon_batches" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_recon_items" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "payment_recon_batches" CASCADE;--> statement-breakpoint
DROP TABLE "payment_recon_items" CASCADE;--> statement-breakpoint
ALTER TABLE "payment_orders" DROP CONSTRAINT "payment_orders_config_out_trade_no_uq";--> statement-breakpoint
DROP INDEX "async_tasks_idem_tenant_uq";--> statement-breakpoint
DROP INDEX "async_tasks_idem_platform_uq";--> statement-breakpoint
DROP INDEX "payment_fund_reservations_source_scope_uq";--> statement-breakpoint
DROP INDEX "payment_fund_reservations_scope_idx";--> statement-breakpoint
DROP INDEX "payment_journals_source_scope_uq";--> statement-breakpoint
DROP INDEX "payment_journals_scope_posted_idx";--> statement-breakpoint
DROP INDEX "payment_ledger_accounts_scope_code_uq";--> statement-breakpoint
DROP INDEX "payment_ledger_accounts_scope_idx";--> statement-breakpoint
DROP INDEX "payment_settlement_items_scope_idx";--> statement-breakpoint
ALTER TABLE "payment_channel_configs" ADD COLUMN "channel_account_id" integer;--> statement-breakpoint
ALTER TABLE "payment_channel_configs" ADD COLUMN "credential_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_contracts" ADD COLUMN "credential_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_contracts" ADD COLUMN "channel_account_id" integer;--> statement-breakpoint
ALTER TABLE "payment_fund_reservations" ADD COLUMN "channel_account_id" integer;--> statement-breakpoint
ALTER TABLE "payment_journals" ADD COLUMN "credential_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_journals" ADD COLUMN "channel_account_id" integer;--> statement-breakpoint
ALTER TABLE "payment_ledger_accounts" ADD COLUMN "channel_account_id" integer;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN "credential_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN "channel_account_id" integer;--> statement-breakpoint
ALTER TABLE "payment_preauths" ADD COLUMN "credential_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_preauths" ADD COLUMN "channel_account_id" integer;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD COLUMN "credential_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD COLUMN "channel_account_id" integer;--> statement-breakpoint
ALTER TABLE "payment_settlement_batches" ADD COLUMN "credential_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_settlement_batches" ADD COLUMN "channel_account_id" integer;--> statement-breakpoint
ALTER TABLE "payment_settlement_items" ADD COLUMN "channel_account_id" integer;--> statement-breakpoint
ALTER TABLE "payment_transfers" ADD COLUMN "credential_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_transfers" ADD COLUMN "channel_account_id" integer;--> statement-breakpoint
-- Stable channel account backfill. Config identity is merchant + environment; unknown legacy credentials are quarantined instead of discarded.
INSERT INTO "payment_channel_accounts" ("name", "channel", "environment", "merchant_id", "sub_merchant_id", "status", "tenant_id")
SELECT DISTINCT
  left(c."name" || ' · ' || coalesce(CASE WHEN c."channel" = 'wechat' THEN c."wechat_mch_id" WHEN c."channel" = 'alipay' THEN c."alipay_seller_id" ELSE c."unionpay_mer_id" END, 'unconfigured:' || c."id"), 128),
  c."channel", CASE WHEN c."sandbox" THEN 'sandbox'::payment_channel_environment ELSE 'production'::payment_channel_environment END,
  coalesce(CASE WHEN c."channel" = 'wechat' THEN nullif(c."wechat_mch_id", '') WHEN c."channel" = 'alipay' THEN nullif(c."alipay_seller_id", '') ELSE nullif(c."unionpay_mer_id", '') END, 'unconfigured:' || c."id"), '',
  CASE WHEN (CASE WHEN c."channel" = 'wechat' THEN nullif(c."wechat_mch_id", '') WHEN c."channel" = 'alipay' THEN nullif(c."alipay_seller_id", '') ELSE nullif(c."unionpay_mer_id", '') END) IS NULL THEN 'disabled'::status ELSE 'enabled'::status END,
  c."tenant_id"
FROM "payment_channel_configs" c
ON CONFLICT DO NOTHING;
UPDATE "payment_channel_configs" c SET "channel_account_id" = a."id"
FROM "payment_channel_accounts" a
WHERE a."channel" = c."channel" AND a."environment" = CASE WHEN c."sandbox" THEN 'sandbox'::payment_channel_environment ELSE 'production'::payment_channel_environment END
  AND a."merchant_id" = coalesce(CASE WHEN c."channel" = 'wechat' THEN nullif(c."wechat_mch_id", '') WHEN c."channel" = 'alipay' THEN nullif(c."alipay_seller_id", '') ELSE nullif(c."unionpay_mer_id", '') END, 'unconfigured:' || c."id")
  AND a."sub_merchant_id" = '' AND coalesce(a."tenant_id", 0) = coalesce(c."tenant_id", 0);
UPDATE "payment_orders" o SET "channel_account_id" = c."channel_account_id" FROM "payment_channel_configs" c WHERE c."id" = o."channel_config_id";
UPDATE "payment_refunds" r SET "channel_account_id" = o."channel_account_id" FROM "payment_orders" o WHERE o."id" = r."order_id";
UPDATE "payment_contracts" x SET "channel_account_id" = c."channel_account_id" FROM "payment_channel_configs" c WHERE c."id" = x."channel_config_id";
UPDATE "payment_preauths" x SET "channel_account_id" = c."channel_account_id" FROM "payment_channel_configs" c WHERE c."id" = x."channel_config_id";
UPDATE "payment_transfers" x SET "channel_account_id" = c."channel_account_id" FROM "payment_channel_configs" c WHERE c."id" = x."channel_config_id";
UPDATE "payment_settlement_batches" x SET "channel_account_id" = c."channel_account_id" FROM "payment_channel_configs" c WHERE c."id" = x."channel_config_id";
UPDATE "payment_settlement_items" x SET "channel_account_id" = c."channel_account_id" FROM "payment_channel_configs" c WHERE c."id" = x."channel_config_id";
UPDATE "payment_journals" x SET "channel_account_id" = c."channel_account_id" FROM "payment_channel_configs" c WHERE c."id" = x."channel_config_id";
UPDATE "payment_ledger_accounts" x SET "channel_account_id" = c."channel_account_id" FROM "payment_channel_configs" c WHERE c."id" = x."channel_config_id";
UPDATE "payment_fund_reservations" x SET "channel_account_id" = c."channel_account_id" FROM "payment_channel_configs" c WHERE c."id" = x."channel_config_id";
-- Legacy facts must never remain outside a stable account scope.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['payment_channel_configs','payment_contracts','payment_fund_reservations','payment_journals','payment_ledger_accounts','payment_orders','payment_preauths','payment_refunds','payment_settlement_batches','payment_settlement_items','payment_transfers'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN channel_account_id SET NOT NULL', t);
  END LOOP;
END $$;
ALTER TABLE "payment_channel_accounts" ADD CONSTRAINT "payment_channel_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_channel_accounts" ADD CONSTRAINT "payment_channel_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_channel_accounts" ADD CONSTRAINT "payment_channel_accounts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_channel_credential_versions" ADD CONSTRAINT "payment_channel_credential_versions_channel_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("channel_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_channel_credential_versions" ADD CONSTRAINT "payment_channel_credential_versions_channel_account_id_payment_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."payment_channel_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_channel_credential_versions" ADD CONSTRAINT "payment_channel_credential_versions_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_channel_credential_versions" ADD CONSTRAINT "payment_channel_credential_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_bank_matches" ADD CONSTRAINT "payment_bank_matches_account_id_payment_channel_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."payment_channel_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_bank_matches" ADD CONSTRAINT "payment_bank_matches_bank_entry_id_payment_statement_entries_id_fk" FOREIGN KEY ("bank_entry_id") REFERENCES "public"."payment_statement_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_bank_matches" ADD CONSTRAINT "payment_bank_matches_settlement_entry_id_payment_statement_entries_id_fk" FOREIGN KEY ("settlement_entry_id") REFERENCES "public"."payment_statement_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_bank_matches" ADD CONSTRAINT "payment_bank_matches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_bank_matches" ADD CONSTRAINT "payment_bank_matches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_bank_matches" ADD CONSTRAINT "payment_bank_matches_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_adjustments" ADD CONSTRAINT "payment_recon_adjustments_case_id_payment_recon_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."payment_recon_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_adjustments" ADD CONSTRAINT "payment_recon_adjustments_application_id_payment_apps_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."payment_apps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_adjustments" ADD CONSTRAINT "payment_recon_adjustments_channel_config_id_payment_channel_configs_id_fk" FOREIGN KEY ("channel_config_id") REFERENCES "public"."payment_channel_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_adjustments" ADD CONSTRAINT "payment_recon_adjustments_workflow_instance_id_workflow_instances_id_fk" FOREIGN KEY ("workflow_instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_adjustments" ADD CONSTRAINT "payment_recon_adjustments_journal_id_payment_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."payment_journals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_adjustments" ADD CONSTRAINT "payment_recon_adjustments_reversal_of_id_payment_recon_adjustments_id_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."payment_recon_adjustments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_adjustments" ADD CONSTRAINT "payment_recon_adjustments_applicant_id_users_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_adjustments" ADD CONSTRAINT "payment_recon_adjustments_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_adjustments" ADD CONSTRAINT "payment_recon_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_adjustments" ADD CONSTRAINT "payment_recon_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_adjustments" ADD CONSTRAINT "payment_recon_adjustments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_case_events" ADD CONSTRAINT "payment_recon_case_events_case_id_payment_recon_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."payment_recon_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_case_events" ADD CONSTRAINT "payment_recon_case_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_case_events" ADD CONSTRAINT "payment_recon_case_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_cases" ADD CONSTRAINT "payment_recon_cases_account_id_payment_channel_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."payment_channel_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_cases" ADD CONSTRAINT "payment_recon_cases_period_id_payment_statement_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payment_statement_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_cases" ADD CONSTRAINT "payment_recon_cases_last_run_id_payment_recon_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."payment_recon_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_cases" ADD CONSTRAINT "payment_recon_cases_application_id_payment_apps_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."payment_apps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_cases" ADD CONSTRAINT "payment_recon_cases_order_id_payment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."payment_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_cases" ADD CONSTRAINT "payment_recon_cases_refund_id_payment_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."payment_refunds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_cases" ADD CONSTRAINT "payment_recon_cases_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_cases" ADD CONSTRAINT "payment_recon_cases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_cases" ADD CONSTRAINT "payment_recon_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_cases" ADD CONSTRAINT "payment_recon_cases_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_runs" ADD CONSTRAINT "payment_recon_runs_statement_id_payment_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."payment_statements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_runs" ADD CONSTRAINT "payment_recon_runs_task_id_async_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."async_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_runs" ADD CONSTRAINT "payment_recon_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_runs" ADD CONSTRAINT "payment_recon_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recon_runs" ADD CONSTRAINT "payment_recon_runs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_statement_entries" ADD CONSTRAINT "payment_statement_entries_statement_id_payment_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."payment_statements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_statement_entries" ADD CONSTRAINT "payment_statement_entries_application_id_payment_apps_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."payment_apps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_statement_entries" ADD CONSTRAINT "payment_statement_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_statement_files" ADD CONSTRAINT "payment_statement_files_statement_id_payment_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."payment_statements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_statement_files" ADD CONSTRAINT "payment_statement_files_storage_config_id_file_storage_configs_id_fk" FOREIGN KEY ("storage_config_id") REFERENCES "public"."file_storage_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_statement_files" ADD CONSTRAINT "payment_statement_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_statement_periods" ADD CONSTRAINT "payment_statement_periods_account_id_payment_channel_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."payment_channel_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_statement_periods" ADD CONSTRAINT "payment_statement_periods_task_id_async_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."async_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_statement_periods" ADD CONSTRAINT "payment_statement_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_statement_periods" ADD CONSTRAINT "payment_statement_periods_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_statement_periods" ADD CONSTRAINT "payment_statement_periods_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_statements" ADD CONSTRAINT "payment_statements_period_id_payment_statement_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payment_statement_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_statements" ADD CONSTRAINT "payment_statements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_statements" ADD CONSTRAINT "payment_statements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_statements" ADD CONSTRAINT "payment_statements_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_channel_accounts_identity_uq" ON "payment_channel_accounts" USING btree (coalesce("tenant_id", 0),"channel","environment","merchant_id","sub_merchant_id");--> statement-breakpoint
CREATE INDEX "payment_channel_accounts_tenant_idx" ON "payment_channel_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_bank_matches_account_idx" ON "payment_bank_matches" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "payment_bank_matches_tenant_idx" ON "payment_bank_matches" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_recon_adjustments_active_case_unique" ON "payment_recon_adjustments" USING btree ("case_id") WHERE "payment_recon_adjustments"."reversal_of_id" is null and "payment_recon_adjustments"."status" in ('draft', 'pending', 'approved', 'executed');--> statement-breakpoint
CREATE UNIQUE INDEX "payment_recon_adjustments_active_reversal_unique" ON "payment_recon_adjustments" USING btree ("reversal_of_id") WHERE "payment_recon_adjustments"."reversal_of_id" is not null and "payment_recon_adjustments"."status" <> 'rejected';--> statement-breakpoint
CREATE INDEX "payment_recon_adjustments_case_idx" ON "payment_recon_adjustments" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "payment_recon_adjustments_tenant_status_idx" ON "payment_recon_adjustments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "payment_recon_case_events_case_idx" ON "payment_recon_case_events" USING btree ("case_id","id");--> statement-breakpoint
CREATE INDEX "payment_recon_case_events_tenant_idx" ON "payment_recon_case_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_recon_cases_account_status_idx" ON "payment_recon_cases" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "payment_recon_cases_due_idx" ON "payment_recon_cases" USING btree ("due_at","status");--> statement-breakpoint
CREATE INDEX "payment_recon_cases_tenant_idx" ON "payment_recon_cases" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_recon_runs_statement_idx" ON "payment_recon_runs" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "payment_recon_runs_tenant_idx" ON "payment_recon_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_recon_runs_active_statement_unique" ON "payment_recon_runs" USING btree ("statement_id") WHERE "payment_recon_runs"."status" in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "payment_statement_entries_order_idx" ON "payment_statement_entries" USING btree ("merchant_order_no");--> statement-breakpoint
CREATE INDEX "payment_statement_entries_refund_idx" ON "payment_statement_entries" USING btree ("merchant_refund_no");--> statement-breakpoint
CREATE INDEX "payment_statement_entries_reference_idx" ON "payment_statement_entries" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "payment_statement_entries_tenant_idx" ON "payment_statement_entries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_statement_files_tenant_idx" ON "payment_statement_files" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_statement_periods_due_idx" ON "payment_statement_periods" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "payment_statement_periods_tenant_idx" ON "payment_statement_periods" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_statements_tenant_idx" ON "payment_statements" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "payment_channel_configs" ADD CONSTRAINT "payment_channel_configs_channel_account_id_payment_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."payment_channel_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_contracts" ADD CONSTRAINT "payment_contracts_channel_account_id_payment_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."payment_channel_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_fund_reservations" ADD CONSTRAINT "payment_fund_reservations_channel_account_id_payment_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."payment_channel_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_journals" ADD CONSTRAINT "payment_journals_channel_account_id_payment_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."payment_channel_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_ledger_accounts" ADD CONSTRAINT "payment_ledger_accounts_channel_account_id_payment_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."payment_channel_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_channel_account_id_payment_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."payment_channel_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_preauths" ADD CONSTRAINT "payment_preauths_channel_account_id_payment_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."payment_channel_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_channel_account_id_payment_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."payment_channel_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlement_batches" ADD CONSTRAINT "payment_settlement_batches_channel_account_id_payment_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."payment_channel_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlement_items" ADD CONSTRAINT "payment_settlement_items_channel_account_id_payment_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."payment_channel_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transfers" ADD CONSTRAINT "payment_transfers_channel_account_id_payment_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."payment_channel_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "async_tasks_idem_tenant_uq" ON "async_tasks" USING btree ("tenant_id",coalesce("created_by", 0),"task_type","idempotency_key") WHERE "async_tasks"."idempotency_key" is not null and "async_tasks"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "async_tasks_idem_platform_uq" ON "async_tasks" USING btree (coalesce("created_by", 0),"task_type","idempotency_key") WHERE "async_tasks"."idempotency_key" is not null and "async_tasks"."tenant_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_fund_reservations_source_scope_uq" ON "payment_fund_reservations" USING btree (coalesce("tenant_id", 0),"app_id","channel_account_id","currency","source_type","source_id");--> statement-breakpoint
CREATE INDEX "payment_fund_reservations_scope_idx" ON "payment_fund_reservations" USING btree ("tenant_id","app_id","channel_account_id","currency");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_journals_source_scope_uq" ON "payment_journals" USING btree (coalesce("tenant_id", 0),"app_id","channel_account_id","currency","source_type","source_id");--> statement-breakpoint
CREATE INDEX "payment_journals_scope_posted_idx" ON "payment_journals" USING btree ("tenant_id","app_id","channel_account_id","currency","posted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_ledger_accounts_scope_code_uq" ON "payment_ledger_accounts" USING btree (coalesce("tenant_id", 0),"app_id","channel_account_id","currency","code");--> statement-breakpoint
CREATE INDEX "payment_ledger_accounts_scope_idx" ON "payment_ledger_accounts" USING btree ("tenant_id","app_id","channel_account_id","currency");--> statement-breakpoint
CREATE INDEX "payment_settlement_items_scope_idx" ON "payment_settlement_items" USING btree ("tenant_id","app_id","channel_account_id","currency");--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_account_out_trade_no_uq" UNIQUE("channel_account_id","out_trade_no");--> statement-breakpoint
DROP TYPE "public"."payment_recon_handle_status";--> statement-breakpoint
DROP TYPE "public"."payment_recon_result";--> statement-breakpoint
DROP TYPE "public"."payment_recon_source";--> statement-breakpoint
DROP TYPE "public"."payment_recon_status";