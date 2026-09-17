import type { Department, DirectorySyncSource, Position, Role, Tenant, TenantPackage } from '../identity/contracts';
import { CMS_RAW_EXPORT_MENU_IDS, CMS_ROOT_MENU_ID, DRIVE_ROOT_MENU_ID, DRIVE_WORKBENCH_MENU_ID, SEED_MENUS, WIKI_DOC_CENTER_MENU_ID, WIKI_ROOT_MENU_ID, collectMenuSubtreeIds } from './menus';
import { SEED_DATE } from './_base';

/**
 * 知识中心「只读」菜单集：文档中心子树的页面节点 + 仅「查询」权限按钮。
 * 写权限（新增/编辑/删除/发布/移动）由管理员按需显式分配，空间成员角色是服务端兜底。
 */
const WIKI_READONLY_MENU_IDS: number[] = [
  WIKI_ROOT_MENU_ID,
  ...collectMenuSubtreeIds(WIKI_DOC_CENTER_MENU_ID).filter((id) => {
    const menu = SEED_MENUS.find((m) => m.id === id);
    if (!menu) return false;
    return menu.type !== 'button' || menu.permission === 'wiki:doc:list';
  }),
];

/**
 * 企业网盘「个人使用」菜单集：工作台页面 + 查询 / 上传 / 下载 / 编辑 / 删除 / 协作授权 / 回收站查看与还原。
 * 外链分享、彻底删除、协作空间创建与治理权限由管理员按需显式分配，节点 ACL 仍是服务端兜底。
 */
const DRIVE_PERSONAL_PERMISSIONS: readonly string[] = [
  'drive:node:list', 'drive:node:upload', 'drive:node:download', 'drive:node:edit', 'drive:node:delete',
  'drive:node:grant', 'drive:recycle:list', 'drive:recycle:restore',
];
const DRIVE_PERSONAL_MENU_IDS: number[] = [
  DRIVE_ROOT_MENU_ID,
  ...collectMenuSubtreeIds(DRIVE_WORKBENCH_MENU_ID).filter((id) => {
    const menu = SEED_MENUS.find((m) => m.id === id);
    if (!menu) return false;
    return menu.type !== 'button' || (menu.permission !== undefined && DRIVE_PERSONAL_PERMISSIONS.includes(menu.permission));
  }),
];

// ─── 角色 ─────────────────────────────────────────────────────────────────────

export const SEED_ROLES: Role[] = [
  {
    id: 1,
    name: '超级管理员',
    code: 'super_admin',
    description: '拥有所有权限',
    dataScope: 'all',
    status: 'enabled',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
    menuIds: SEED_MENUS.map((m) => m.id),
  },
  {
    id: 2,
    name: '普通用户',
    code: 'user',
    description: '基础访问权限',
    dataScope: 'all',
    status: 'enabled',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
    // 首页 / 个人中心 / 公告中心 / 我的消息 + 消息中心（页面与其按钮权限分离，按钮需显式分配：
    // 5001 = 导出聊天记录，由 chat 注册表经 expandPermissionButtons 生成，id 与历史一致）
    // + 知识中心只读（查询按钮 + 页面；写权限由管理员显式分配，空间角色仍是服务端兜底）
    // + 企业网盘个人使用（个人空间完整可用；外链 / 彻底删除 / 协作空间由管理员显式分配）
    menuIds: [1, 11, 12, 13, 5000, 5001, ...WIKI_READONLY_MENU_IDS, ...DRIVE_PERSONAL_MENU_IDS],
  },
  {
    id: 3,
    name: 'CMS 编辑',
    code: 'cms_editor',
    description: 'CMS 非超管演示角色（受站点/栏目 ACL 约束）',
    dataScope: 'all',
    status: 'enabled',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
    // CMS 子树 + 个人中心（改密码）+ 公告中心 / 我的消息（收公告与审稿 / 退回通知）
    menuIds: [11, 12, 13, ...collectMenuSubtreeIds(CMS_ROOT_MENU_ID)
      .filter((id) => !CMS_RAW_EXPORT_MENU_IDS.includes(id))],
  },
];

// ─── 部门 ─────────────────────────────────────────────────────────────────────

export const SEED_DEPARTMENTS: Department[] = [
  { id: 1, parentId: 0, name: '总部',  code: 'headquarters', category: 'company', leaderId: 1, phone: '13800000000', email: 'admin@zenith.dev', sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, parentId: 1, name: '技术部', code: 'technology',   category: 'department', leaderId: 1, phone: '13800000001', email: 'tech@zenith.dev',  sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 岗位 ─────────────────────────────────────────────────────────────────────

export const SEED_POSITIONS: Position[] = [
  { id: 1, name: '系统管理员', code: 'system_admin', sort: 1, status: 'enabled', remark: '默认管理员岗位', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '开发工程师', code: 'developer',    sort: 2, status: 'enabled', remark: '默认技术岗位',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 租户示例 ───────────────────────────────────────────────────────────────────

export const SEED_TENANTS: Tenant[] = [
  { id: 1, name: '示例租户A', code: 'tenant_a', logo: null, contactName: '张三', contactPhone: '13800001111', status: 'enabled', expireAt: null, maxUsers: 50,   packageId: 2, remark: '演示用租户A', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '示例租户B', code: 'tenant_b', logo: null, contactName: '李四', contactPhone: '13800002222', status: 'enabled', expireAt: null, maxUsers: null, packageId: 1, remark: '演示用租户B', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 租户套餐 ─────────────────────────────────────────────────────────────────
// 套餐 = 一组可授权功能 + 配额。菜单可见性由 menus.featureKey 与套餐功能交集派生，
// 不再维护菜单 ID 白名单；页面级微调交给角色（RBAC）。
export const SEED_TENANT_PACKAGES: TenantPackage[] = [
  { id: 1, name: '基础版', status: 'enabled', remark: '基础功能套餐：核心管理 + 工作流 + 知识中心', features: ['workflow', 'wiki'], quotas: { maxUsers: 20 }, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '标准版', status: 'enabled', remark: '标准功能套餐：含数据分析、报表、CMS 与 AI', features: ['workflow', 'wiki', 'chat', 'analytics', 'report', 'cms', 'ai'], quotas: { maxUsers: 100 }, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 通讯录同步演示源（仅 Demo/Mock 使用，DB seed 不插入——真实同步源由管理员创建）───
export const SEED_DIRECTORY_SYNC_SOURCES: DirectorySyncSource[] = [
  {
    id: 1,
    name: '总部 AD 域',
    type: 'ldap',
    status: 'enabled',
    tenantId: null,
    identityProviderId: 1,
    identityProviderName: '企业 AD',
    oauthProvider: null,
    matchKey: 'username',
    fieldMapping: {},
    scopeConfig: {},
    conflictPolicy: 'suspend',
    lifecycle: { disableOnLeave: true, kickSessions: true, defaultRoleIds: [] },
    syncDepartments: true,
    cronExpression: '0 2 * * *',
    circuitBreakerPercent: 30,
    callbackUrlKey: 'demo-ldap-callback-key',
    callbackLastEventAt: null,
    nextRunAt: null,
    lastRunAt: null,
    lastRunStatus: 'success',
    remark: '每天凌晨 2 点全量同步',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 2,
    name: '钉钉通讯录',
    type: 'dingtalk',
    status: 'disabled',
    tenantId: null,
    identityProviderId: null,
    identityProviderName: null,
    oauthProvider: 'dingtalk',
    matchKey: 'phone',
    fieldMapping: {},
    scopeConfig: {},
    conflictPolicy: 'source',
    lifecycle: { disableOnLeave: true, kickSessions: false, defaultRoleIds: [] },
    syncDepartments: true,
    cronExpression: null,
    circuitBreakerPercent: 30,
    callbackUrlKey: 'demo-dingtalk-callback-key',
    callbackLastEventAt: null,
    nextRunAt: null,
    lastRunAt: null,
    lastRunStatus: 'partial',
    remark: '凭证复用 OAuth 配置的钉钉应用',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];
