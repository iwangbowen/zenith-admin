DROP TRIGGER IF EXISTS rate_limit_rules_cache_invalidate ON "rate_limit_rules";--> statement-breakpoint
CREATE TRIGGER rate_limit_rules_cache_invalidate AFTER INSERT OR UPDATE OR DELETE ON "rate_limit_rules"
  FOR EACH ROW EXECUTE FUNCTION notify_cache_invalidate();
