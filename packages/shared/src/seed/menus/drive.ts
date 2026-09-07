import type { Menu } from '../../identity/contracts';
import { SEED_DATE } from '../_base';

/** 企业网盘（19000 段） */
export const SEED_MENUS_DRIVE: Menu[] = [
  { id: 19000, parentId: 0, title: '企业网盘', name: 'DriveCenter', icon: 'HardDrive', type: 'directory', sort: 19, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // ─── 我的网盘（工作台：空间 / 与我共享 / 收藏 / 最近 / 回收站 / 我的外链）──────
  { id: 19010, parentId: 19000, title: '我的网盘', name: 'DriveWorkbench', path: '/drive', component: 'drive/DriveWorkbenchPage', icon: 'FolderOpen', type: 'menu', sort: 1, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19011, parentId: 19010, title: '查询', type: 'button', permission: 'drive:node:list', sort: 0, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19012, parentId: 19010, title: '上传', type: 'button', permission: 'drive:node:upload', sort: 1, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19013, parentId: 19010, title: '下载', type: 'button', permission: 'drive:node:download', sort: 2, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19014, parentId: 19010, title: '编辑（新建 / 重命名 / 移动 / 复制）', type: 'button', permission: 'drive:node:edit', sort: 3, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19015, parentId: 19010, title: '删除', type: 'button', permission: 'drive:node:delete', sort: 4, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19016, parentId: 19010, title: '协作授权', type: 'button', permission: 'drive:node:grant', sort: 5, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19017, parentId: 19010, title: '外链分享', type: 'button', permission: 'drive:link:create', sort: 6, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19018, parentId: 19010, title: '回收站查看', type: 'button', permission: 'drive:recycle:list', sort: 7, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19019, parentId: 19010, title: '回收站还原', type: 'button', permission: 'drive:recycle:restore', sort: 8, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19020, parentId: 19010, title: '彻底删除', type: 'button', permission: 'drive:recycle:purge', sort: 9, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // ─── 共享空间 ──────────────────────────────────────────────────────────────
  { id: 19030, parentId: 19000, title: '共享空间', name: 'DriveSpaces', path: '/drive/spaces', component: 'drive/spaces/DriveSpacesPage', icon: 'Users', type: 'menu', sort: 2, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19031, parentId: 19030, title: '查询', type: 'button', permission: 'drive:space:list', sort: 0, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19032, parentId: 19030, title: '新建协作空间', type: 'button', permission: 'drive:space:create', sort: 1, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19033, parentId: 19030, title: '编辑空间', type: 'button', permission: 'drive:space:edit', sort: 2, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19034, parentId: 19030, title: '删除空间', type: 'button', permission: 'drive:space:delete', sort: 3, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19035, parentId: 19030, title: '成员管理', type: 'button', permission: 'drive:space:grant', sort: 4, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // ─── 网盘管理 ──────────────────────────────────────────────────────────────
  { id: 19100, parentId: 19000, title: '网盘管理', name: 'DriveAdmin', icon: 'ShieldCheck', type: 'directory', sort: 9, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },

  { id: 19110, parentId: 19100, title: '空间治理', name: 'DriveAdminSpaces', path: '/drive/admin/spaces', component: 'drive/admin/DriveAdminSpacesPage', icon: 'Database', type: 'menu', sort: 1, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19111, parentId: 19110, title: '查询', type: 'button', permission: 'drive:admin:space:list', sort: 0, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19112, parentId: 19110, title: '治理（配额 / 状态 / 转让 / 部门空间）', type: 'button', permission: 'drive:admin:space:edit', sort: 1, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19113, parentId: 19110, title: '删除空间', type: 'button', permission: 'drive:admin:space:delete', sort: 2, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19114, parentId: 19110, title: '统计概览', type: 'button', permission: 'drive:admin:stats:view', sort: 3, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },

  { id: 19120, parentId: 19100, title: '外链治理', name: 'DriveAdminShareLinks', path: '/drive/admin/share-links', component: 'drive/admin/DriveAdminShareLinksPage', icon: 'Link2', type: 'menu', sort: 2, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19121, parentId: 19120, title: '查询', type: 'button', permission: 'drive:admin:link:list', sort: 0, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19122, parentId: 19120, title: '撤销外链', type: 'button', permission: 'drive:admin:link:revoke', sort: 1, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19123, parentId: 19120, title: '导出访问日志', type: 'button', permission: 'drive:admin:link:export', sort: 2, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },

  { id: 19130, parentId: 19100, title: '动态审计', name: 'DriveAdminActivities', path: '/drive/admin/activities', component: 'drive/admin/DriveAdminActivitiesPage', icon: 'ScrollText', type: 'menu', sort: 3, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19131, parentId: 19130, title: '查询', type: 'button', permission: 'drive:admin:activity:list', sort: 0, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19132, parentId: 19130, title: '导出', type: 'button', permission: 'drive:admin:activity:export', sort: 1, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // 合规治理：法律保留 / 扩容审批 / 外链访问日志 / 开放应用授权（列表查询复用 drive:admin:space:list 与 drive:admin:link:list）
  { id: 19150, parentId: 19100, title: '合规治理', name: 'DriveAdminGovernance', path: '/drive/admin/governance', component: 'drive/admin/DriveAdminGovernancePage', icon: 'Scale', type: 'menu', sort: 4, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19151, parentId: 19150, title: '法律保留（设置 / 解除）', type: 'button', permission: 'drive:admin:legal-hold:edit', sort: 0, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19152, parentId: 19150, title: '扩容审批', type: 'button', permission: 'drive:admin:quota:approve', sort: 1, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19153, parentId: 19150, title: '开放应用授权', type: 'button', permission: 'drive:admin:open-grant:edit', sort: 2, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },

  { id: 19140, parentId: 19100, title: '网盘设置', name: 'DriveAdminSettings', path: '/drive/admin/settings', component: 'drive/admin/DriveAdminSettingsPage', icon: 'Settings2', type: 'menu', sort: 5, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19141, parentId: 19140, title: '查看', type: 'button', permission: 'drive:setting:view', sort: 0, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19142, parentId: 19140, title: '编辑', type: 'button', permission: 'drive:setting:edit', sort: 1, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];
