-- 鉴权主体校验缓存的跨实例失效：认证中间件（middleware/auth.ts）把 users / tenants 权威行放进进程内副本，
-- 这里复用 0001_extensions.sql 的通用触发器函数 notify_cache_invalidate() 向 cache_invalidate 频道广播
-- { topic: 表名, key: id }，任何写路径（业务代码、seed、手工 SQL）在事务提交后都会让全部实例的副本失效。
CREATE TRIGGER users_cache_invalidate
  AFTER INSERT OR UPDATE OR DELETE ON "users"
  FOR EACH ROW EXECUTE FUNCTION notify_cache_invalidate('id');--> statement-breakpoint
CREATE TRIGGER tenants_cache_invalidate
  AFTER INSERT OR UPDATE OR DELETE ON "tenants"
  FOR EACH ROW EXECUTE FUNCTION notify_cache_invalidate('id');