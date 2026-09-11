-- 会员鉴权主体校验缓存的跨实例失效：会员认证中间件（middleware/member-auth.ts）把 members 权威行放进进程内副本
--（与 0005 的 users / tenants 同构），这里复用 0001_extensions.sql 的通用触发器函数 notify_cache_invalidate()
-- 向 cache_invalidate 频道广播 { topic: 'members', key: id }，任何写路径在事务提交后都会让全部实例的副本失效。
-- tenants 上的触发器已在 0005 建立，会员侧直接复用其广播。
CREATE TRIGGER members_cache_invalidate
  AFTER INSERT OR UPDATE OR DELETE ON "members"
  FOR EACH ROW EXECUTE FUNCTION notify_cache_invalidate('id');