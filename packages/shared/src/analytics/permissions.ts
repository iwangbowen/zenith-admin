import { definePermissions } from '../core/permissions';

/**
 * analytics 域权限码注册表：code → 权限标题 / 所属页面（菜单 name）。
 * 操作权限只存在于本注册表；契约操作 / 路由门禁 / 前端按钮以 `Permission` 类型引用。
 * `uiOnly` = 服务端没有任何接口检查该码（纯前端门控或待清理）。
 */
export const ANALYTICS_PERMISSIONS = definePermissions({
  'analytics:view': { label: '查询', menu: 'AnalyticsBehavior' },
  'analytics:manage': { label: '查询', menu: 'AnalyticsData' },
  'analytics:clean': { label: '清除数据', menu: 'AnalyticsData' },
  'analytics:export': { label: '导出数据', menu: 'AnalyticsData' },
});
