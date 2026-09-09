-- 数据库备份并入数据库管理：`/api/db-backups` 与「系统设置 → 数据库备份」菜单（2110）及其按钮权限
-- system:db-backup:list / create / delete（2111–2113）已删除，备份能力改为数据库管理页的「备份」Tab，
-- 权限复用 system:db-admin:view（查看）与 system:db-admin:maintain（创建 / 删除）。
-- 清理已移除的菜单及其授权，避免死入口继续暴露；db_backups 表与既有备份记录不受影响。
DELETE FROM user_menus WHERE menu_id BETWEEN 2110 AND 2113;--> statement-breakpoint
DELETE FROM role_menus WHERE menu_id BETWEEN 2110 AND 2113;--> statement-breakpoint
DELETE FROM menus WHERE id BETWEEN 2110 AND 2113;