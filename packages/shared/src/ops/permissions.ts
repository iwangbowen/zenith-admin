import { definePermissions } from '../core/permissions';

/**
 * ops 域权限码注册表：code → 权限标题 / 所属页面（菜单 name）。
 * 操作权限只存在于本注册表；契约操作 / 路由门禁 / 前端按钮以 `Permission` 类型引用。
 * `uiOnly` = 服务端没有任何接口检查该码（纯前端门控或待清理）。
 */
const CRITICAL_ACCESS = { riskLevel: 'critical', approvalPolicy: 'two_person', reviewIntervalDays: 30 } as const;
const HIGH_ACCESS = { riskLevel: 'high', approvalPolicy: 'manager_security', reviewIntervalDays: 90 } as const;

export const OPS_PERMISSIONS = definePermissions({
  'system:log:console': { label: '查询', menu: 'SystemConsoleLogs' },
  'system:log:files': { label: '查看日志', menu: 'SystemLogFiles' },
  'system:log:files:download': { label: '下载日志', menu: 'SystemLogFiles', ...HIGH_ACCESS },
  'system:log:files:delete': { label: '删除日志', menu: 'SystemLogFiles', ...HIGH_ACCESS },
  'system:db-admin:view': { label: '查询', menu: 'SystemDbAdmin' },
  'system:db-admin:workspace': { label: '管理查询历史与收藏', menu: 'SystemDbAdmin' },
  'system:db-admin:query': { label: '执行 SQL', menu: 'SystemDbAdmin', ...HIGH_ACCESS },
  'system:db-admin:export': { label: '导出结果', menu: 'SystemDbAdmin', ...CRITICAL_ACCESS },
  'system:db-admin:write': { label: '修改数据', menu: 'SystemDbAdmin', ...CRITICAL_ACCESS },
  'system:db-admin:maintain': { label: '运维操作', menu: 'SystemDbAdmin', ...CRITICAL_ACCESS },
  'system:db-admin:terminal': { label: '数据库终端', menu: 'SystemDbAdmin', ...CRITICAL_ACCESS },
  'system:maintenance:manage': { label: '开启/关闭', menu: 'SystemMaintenance' },
  'system:maintenance:view': { label: '查看维护', menu: 'SystemMaintenance' },
  'system:maintenance:log': { label: '维护记录', menu: 'SystemMaintenance' },
  'system:maintenance:bypass': { label: '维护业务通行', menu: 'SystemMaintenance', ...HIGH_ACCESS },
  'system:retention:view': { label: '查询', menu: 'SystemRetention' },
  'system:retention:edit': { label: '编辑策略', menu: 'SystemRetention' },
  'system:retention:run': { label: '立即清理', menu: 'SystemRetention', ...HIGH_ACCESS },
  'system:ops:overview': { label: '查询', menu: 'SystemOpsOverview' },
  'system:host:view': { label: '查询', menu: 'SystemOpsHosts' },
  'system:host:manage': { label: '管理主机', menu: 'SystemOpsHosts', ...CRITICAL_ACCESS },
  'system:host:use': { label: '远程操作', menu: 'SystemOpsHosts', ...CRITICAL_ACCESS },
  'system:terminal:execute': { label: '执行终端', menu: ['SystemTerminal', 'TerminalRecordings'], ...CRITICAL_ACCESS },
  'system:terminal:monitor': { label: '强制终止', menu: 'SystemTerminalSessions' },
  'system:file:use': { label: '查询', menu: 'SystemFileManager' },
  'system:file:write': { label: '修改主机文件', menu: 'SystemFileManager', selfRequestable: false, riskLevel: 'high' },
  'system:process:view': { label: '查询', menu: 'SystemProcesses' },
  'system:process:kill': { label: '结束进程', menu: ['SystemProcesses', 'SystemPorts'] },
  'system:process:priority': { label: '调整优先级', menu: 'SystemProcesses' },
  'system:port:view': { label: '查询', menu: 'SystemPorts' },
  'system:docker:view': { label: '查询', menu: 'SystemDocker' },
  'system:docker:manage': { label: '管理', menu: 'SystemDocker', ...CRITICAL_ACCESS },
  'system:service:view': { label: '查询', menu: 'SystemServices' },
  'system:service:manage': { label: '管理', menu: 'SystemServices', ...CRITICAL_ACCESS },
  'system:log:view': { label: '查询', menu: 'SystemLogViewer' },
  'system:network:diag': { label: '执行诊断', menu: 'SystemNetworkDiag' },
  'system:firewall:view': { label: '查询', menu: 'SystemFirewall' },
  'system:firewall:manage': { label: '管理规则', menu: 'SystemFirewall', ...CRITICAL_ACCESS },
  'system:nginx:view': { label: '查询', menu: 'SystemNginxSites' },
  'system:nginx:manage': { label: '管理站点', menu: 'SystemNginxSites', ...CRITICAL_ACCESS },
  'system:nginx:reload': { label: '重载 Nginx', menu: 'SystemNginxSites', ...HIGH_ACCESS },
  'system:ssl:view': { label: '查询', menu: 'SystemSslCertificates' },
  'system:ssl:create': { label: '新增证书', menu: 'SystemSslCertificates' },
  'system:ssl:delete': { label: '删除证书', menu: 'SystemSslCertificates' },
  'system:app-release:list': { label: '查询', menu: 'SystemAppReleases' },
  'system:app-release:create': { label: '新增版本', menu: 'SystemAppReleases' },
  'system:app-release:update': { label: '编辑版本', menu: 'SystemAppReleases' },
  'system:app-release:delete': { label: '删除版本', menu: 'SystemAppReleases' },
  'system:app-release:publish': { label: '发布/撤回', menu: 'SystemAppReleases' },
  'system:deploy:list': { label: '查询', menu: 'SystemDeploy' },
  'system:deploy:manage': { label: '管理目标', menu: 'SystemDeploy', ...CRITICAL_ACCESS },
  'system:deploy:execute': { label: '部署/回滚', menu: 'SystemDeploy', ...CRITICAL_ACCESS },
});
