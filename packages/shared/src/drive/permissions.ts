import { definePermissions } from '../core/permissions';

/**
 * drive 域权限码注册表：code → 权限标题 / 所属页面（菜单 name）。
 * 操作权限只存在于本注册表；契约操作 / 路由门禁 / 前端按钮以 `Permission` 类型引用。
 * `uiOnly` = 服务端没有任何接口检查该码（纯前端门控或待清理）。
 */
export const DRIVE_PERMISSIONS = definePermissions({
  'drive:node:list': { label: '查询', menu: 'DriveWorkbench' },
  'drive:node:upload': { label: '上传', menu: 'DriveWorkbench' },
  'drive:node:download': { label: '下载', menu: 'DriveWorkbench' },
  'drive:node:edit': { label: '编辑（新建 / 重命名 / 移动 / 复制）', menu: 'DriveWorkbench' },
  'drive:node:delete': { label: '删除', menu: 'DriveWorkbench' },
  'drive:node:grant': { label: '协作授权', menu: 'DriveWorkbench' },
  'drive:link:create': { label: '外链分享', menu: 'DriveWorkbench' },
  'drive:recycle:list': { label: '回收站查看', menu: 'DriveWorkbench' },
  'drive:recycle:restore': { label: '回收站还原', menu: 'DriveWorkbench' },
  'drive:recycle:purge': { label: '彻底删除', menu: 'DriveWorkbench' },
  'drive:space:list': { label: '查询', menu: 'DriveSpaces' },
  'drive:space:create': { label: '新建协作空间', menu: 'DriveSpaces' },
  'drive:space:edit': { label: '编辑空间', menu: 'DriveSpaces' },
  'drive:space:delete': { label: '删除空间', menu: 'DriveSpaces' },
  'drive:space:grant': { label: '成员管理', menu: 'DriveSpaces' },
  'drive:admin:space:list': { label: '查询', menu: 'DriveAdminSpaces' },
  'drive:admin:space:edit': { label: '治理（配额 / 状态 / 转让 / 部门空间）', menu: 'DriveAdminSpaces' },
  'drive:admin:space:delete': { label: '删除空间', menu: 'DriveAdminSpaces' },
  'drive:admin:stats:view': { label: '统计概览', menu: 'DriveAdminSpaces' },
  'drive:admin:link:list': { label: '查询', menu: 'DriveAdminShareLinks' },
  'drive:admin:link:revoke': { label: '撤销外链', menu: 'DriveAdminShareLinks' },
  'drive:admin:link:export': { label: '导出访问日志', menu: 'DriveAdminShareLinks' },
  'drive:admin:activity:list': { label: '查询', menu: 'DriveAdminActivities' },
  'drive:admin:activity:export': { label: '导出', menu: 'DriveAdminActivities' },
  'drive:admin:legal-hold:edit': { label: '法律保留（设置 / 解除）', menu: 'DriveAdminGovernance' },
  'drive:admin:quota:approve': { label: '扩容审批', menu: 'DriveAdminGovernance' },
  'drive:admin:open-grant:edit': { label: '开放应用授权', menu: 'DriveAdminGovernance' },
  'drive:setting:view': { label: '查看', menu: 'DriveAdminSettings' },
  'drive:setting:edit': { label: '编辑', menu: 'DriveAdminSettings' },
});
