-- 套餐功能集进程内副本（lib/tenant-package.ts）的跨实例失效：租户改绑套餐已由 0005 的 tenants 触发器覆盖，
-- 这里给套餐本体与套餐-功能关联表挂同一通用触发器函数 notify_cache_invalidate()（0001_extensions.sql），
-- 以 package_id 为 key 广播——副本按 tenantId 键、无套餐反向索引，订阅方收到即整段清空。
-- 同一事务内相同载荷的 NOTIFY 会被 PostgreSQL 合并，replace 模式改写一个套餐的全部功能只产生一条通知。
CREATE TRIGGER tenant_packages_cache_invalidate
  AFTER INSERT OR UPDATE OR DELETE ON "tenant_packages"
  FOR EACH ROW EXECUTE FUNCTION notify_cache_invalidate('id');--> statement-breakpoint
CREATE TRIGGER tenant_package_features_cache_invalidate
  AFTER INSERT OR UPDATE OR DELETE ON "tenant_package_features"
  FOR EACH ROW EXECUTE FUNCTION notify_cache_invalidate('package_id');