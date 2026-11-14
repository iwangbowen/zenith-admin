import { definePermissions } from '../core/permissions';

/**
 * tasks 域权限码注册表：code → 按钮标题 / 所属页面（菜单 name）。
 * 种子 button 节点由此生成（@zenith/shared/seed），契约操作 / 路由门禁 / 前端按钮以 `Permission` 类型引用。
 * `uiOnly` = 服务端没有任何接口检查该码（纯前端门控或待清理）。
 */
export const TASKS_PERMISSIONS = definePermissions({
  'system:cronjob:list': { label: '查询', menu: 'SystemCronJobs' },
  'system:cronjob:create': { label: '新增任务', menu: 'SystemCronJobs' },
  'system:cronjob:update': { label: '编辑任务', menu: 'SystemCronJobs' },
  'system:cronjob:delete': { label: '删除任务', menu: 'SystemCronJobs' },
  'system:cronjob:execute': { label: '立即执行', menu: 'SystemCronJobs' },
  'system:import-job:view': { label: '查询', menu: 'SystemImportCenter', uiOnly: true },
  'system:scheduler:view': { label: '查询', menu: 'SystemScheduler' },
  'system:scheduler:run': { label: '手动执行', menu: 'SystemScheduler' },
  'system:scheduler:config': { label: '调整策略', menu: 'SystemScheduler' },
  'system:scheduler:cleanup': { label: '清理日志', menu: 'SystemScheduler' },
  'system:scheduler:alert': { label: '确认告警', menu: 'SystemScheduler' },
  'system:export-job:list': { label: '查询', menu: 'SystemExportJobs', uiOnly: true },
  'system:export-job:download': { label: '下载文件', menu: 'SystemExportJobs', uiOnly: true },
  'system:export-preset:share': { label: '管理团队导出模板', menu: 'SystemExportJobs' },
  'system:export-preset:schedule': { label: '定时导出', menu: 'SystemExportJobs' },
  'system:export-job:manage': { label: '管理全部', menu: 'SystemExportJobs' },
  'system:export-job:tenant-manage': { label: '管理租户', menu: 'SystemExportJobs' },
  'system:export-job:delete': { label: '删除任务', menu: 'SystemExportJobs', uiOnly: true },
  'system:async-task:list': { label: '查询', menu: 'SystemTaskCenter' },
  'system:async-task:manage': { label: '管理任务', menu: 'SystemTaskCenter' },
  'system:async-task:cleanup': { label: '清理任务', menu: 'SystemTaskCenter' },
  'system:async-task:config': { label: '调整策略', menu: 'SystemTaskCenter' },
});
