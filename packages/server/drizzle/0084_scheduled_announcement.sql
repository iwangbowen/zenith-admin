-- 添加「定时发布」字典项到公告发布状态字典 (dictId: 7)
-- 仅当目标字典 (id=7) 已存在时插入，避免在全新数据库（迁移先于种子执行）上触发外键约束
INSERT INTO "dict_items" ("dict_id", "label", "value", "color", "sort", "status", "created_at", "updated_at")
SELECT 7, '定时发布', 'scheduled', 'blue', 4, 'enabled', NOW(), NOW()
WHERE EXISTS (SELECT 1 FROM "dicts" WHERE "id" = 7)
ON CONFLICT DO NOTHING;

-- 添加「定时公告自动发布」cron job
INSERT INTO "cron_jobs" ("name", "cron_expression", "handler", "status", "description", "retry_count", "retry_interval", "created_at", "updated_at")
VALUES ('定时公告自动发布', '*/5 * * * *', 'publishScheduledAnnouncements', 'enabled', '每 5 分钟检查并自动发布到期的定时公告', 0, 0, NOW(), NOW())
ON CONFLICT ("name") DO NOTHING;
