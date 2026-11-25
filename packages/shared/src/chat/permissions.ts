import { definePermissions } from '../core/permissions';

/**
 * chat 域权限码注册表：code → 权限标题 / 所属页面（菜单 name）。
 * 操作权限只存在于本注册表；契约操作 / 路由门禁 / 前端按钮以 `Permission` 类型引用。
 * `uiOnly` = 服务端没有任何接口检查该码（纯前端门控或待清理）。
 */
export const CHAT_PERMISSIONS = definePermissions({
  'chat:bot:list': { label: '查询', menu: 'SystemChatBots' },
  'chat:bot:create': { label: '新增机器人', menu: 'SystemChatBots' },
  'chat:bot:update': { label: '编辑机器人', menu: 'SystemChatBots' },
  'chat:bot:delete': { label: '删除机器人', menu: 'SystemChatBots' },
  'chat:message:export': { label: '导出聊天记录', menu: 'ChatCenter' },
});
