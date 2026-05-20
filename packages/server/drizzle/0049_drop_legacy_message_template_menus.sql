-- 清理已废弃的"消息模板"菜单遗留数据（来自旧的 messageTemplates 子系统，已被 notification 子系统替代）
-- 影响菜单 id 范围：110-112（旧的消息中心入口 + 按钮）/ 220-223（旧的消息模板子菜单）
-- 同步清理 role_menus 关联（虽然有 ON DELETE CASCADE，但显式删除更安全）

DELETE FROM "role_menus" WHERE "menu_id" IN (110, 111, 112, 220, 221, 222, 223);--> statement-breakpoint
DELETE FROM "menus" WHERE "id" IN (110, 111, 112, 220, 221, 222, 223);--> statement-breakpoint

-- 兜底：按权限编码删除其他可能残留的"消息模板"权限按钮
DELETE FROM "role_menus" WHERE "menu_id" IN (SELECT "id" FROM "menus" WHERE "permission" LIKE 'system:message-template:%');--> statement-breakpoint
DELETE FROM "menus" WHERE "permission" LIKE 'system:message-template:%';
