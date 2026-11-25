import { definePermissions } from '../core/permissions';

/**
 * short-link 域权限码注册表：code → 权限标题 / 所属页面（菜单 name）。
 * 操作权限只存在于本注册表；契约操作 / 路由门禁 / 前端按钮以 `Permission` 类型引用。
 * `uiOnly` = 服务端没有任何接口检查该码（纯前端门控或待清理）。
 */
export const SHORT_LINK_PERMISSIONS = definePermissions({
  'shortlink:link:list': { label: '查询', menu: 'GrowthShortLinks' },
  'shortlink:link:create': { label: '新增短链', menu: 'GrowthShortLinks' },
  'shortlink:link:update': { label: '编辑短链', menu: 'GrowthShortLinks' },
  'shortlink:link:delete': { label: '删除短链', menu: 'GrowthShortLinks' },
  'shortlink:link:export': { label: '导出', menu: 'GrowthShortLinks' },
  'shortlink:stats:view': { label: '访问统计', menu: 'GrowthShortLinks' },
  'shortlink:analysis:view': { label: '查询', menu: 'GrowthChannelAnalysis' },
});
