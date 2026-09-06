ALTER TYPE "public"."mask_type" ADD VALUE 'address' BEFORE 'custom';--> statement-breakpoint
ALTER TYPE "public"."mask_type" ADD VALUE 'redact' BEFORE 'custom';--> statement-breakpoint
DROP TABLE "data_mask_configs" CASCADE;--> statement-breakpoint
CREATE TABLE "data_mask_policies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "data_mask_policies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"entity" varchar(64) NOT NULL,
	"field" varchar(64) NOT NULL,
	"mask_type" "mask_type" NOT NULL,
	"custom_rule" jsonb,
	"exempt_permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"remark" varchar(256),
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "data_mask_policies_entity_field_unique" UNIQUE("entity","field")
);
--> statement-breakpoint
ALTER TABLE "data_mask_policies" ADD CONSTRAINT "data_mask_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_mask_policies" ADD CONSTRAINT "data_mask_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- 跨实例缓存失效：策略变更后所有实例的进程内策略缓存立即失效（lib/invalidation-bus 订阅 topic = 表名）
CREATE TRIGGER data_mask_policies_cache_invalidate
  AFTER INSERT OR UPDATE OR DELETE ON "data_mask_policies"
  FOR EACH ROW EXECUTE FUNCTION notify_cache_invalidate();--> statement-breakpoint
-- 数据脱敏菜单结构变更：敏感字段改由契约声明，不再有「新增 / 删除规则」，按钮改为「编辑策略」；
-- 新增按钮（免脱敏查看 2395 / 按需查看明文 2396）由 seed 补齐
DELETE FROM "menus" WHERE "id" IN (2392, 2394) AND "permission" IN ('system:data-mask:create', 'system:data-mask:delete');--> statement-breakpoint
UPDATE "menus" SET "title" = '编辑策略', "sort" = 1 WHERE "id" = 2393 AND "permission" = 'system:data-mask:update';