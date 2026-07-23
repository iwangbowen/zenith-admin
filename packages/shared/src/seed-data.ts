/**
 * 种子数据 — 唯一来源
 *
 * 此文件同时被：
 *  - packages/server/src/db/seed.ts  （数据库初始化）
 *  - packages/web/src/mocks/data/*   （MSW Demo 模式 mock）
 *
 * 修改数据时只需改这一处，两端自动同步。
 */

import type {
  Menu, Role, Department, Position, Dict, DictItem, SystemConfig, CronJob, WorkflowForm,
  WorkflowCategory, WorkflowDataSource, Tag, DataMaskConfig, MemberLevel, MemberTag, Coupon,
  EmailTemplate, SmsTemplate, InAppTemplate, Tenant, TenantPackage, AiPromptTemplate, MpAccount,
  MpTag, MpFan, MpMessage, MpAutoReply, MpMenu, MpMaterial, MpDraft, MpMessageTemplate,
  MpBroadcast, MpQrcode, MpKfAccount, MpKfSessionStatus, MpKfSessionCloseReason,
  MpKfSessionEventType, MpKfRoutingStrategy, MpMenuButton, MpMenuMatchRule, MpMenuStatus,
  ReportDatasource, ReportDataset, ReportDashboard, ApiScope, RatePlan, ReportPrintTemplate,
  UserFeedback, ReportFolder, ReportMetric, ReportEnvironment, ReportDqRule, ReportQueryQuota,
  ReportSlaRule, ReportAssetTemplate, ReportFillTemplate, AnalyticsEventPropertyDef, AnalyticsSite,
  CmsSite, CmsPublishChannel, CmsModel, CmsChannel, CmsContent, CmsTag, CmsFragment, CmsFriendLink,
  CmsAdSlot, CmsAd, CmsForm, CmsSensitiveWord, CmsErrorProneWord, CmsLinkWord, CmsComment,
  CmsSurvey, CmsSurveyQuestion, CmsResource, CmsResourceFolder, CmsSearchWord, CmsHotwordGroup, CmsPoll,
  CmsContentVersion, CmsCollectRule, CmsCollectItem, CmsPage,
  CmsTemplate, CmsTemplateVersion, CmsThemePackage, CmsTemplateDslDocument,
} from './types';
import { ANALYTICS_EXPERIMENT_EXPOSURE_EVENT, ANALYTICS_SEMANTIC_EVENT_LABELS, type AnalyticsSemanticEventName } from './constants';

const SEED_DATE = '2024-01-01 00:00:00';

export const SEED_CMS_EDITOR_USER = {
  username: 'cms_editor',
  nickname: 'CMS 演示编辑',
  email: 'cms-editor@zenith.dev',
  password: '123456',
  roleId: 3,
  departmentId: 2,
} as const;

// ─── 菜单 ─────────────────────────────────────────────────────────────────────

export const SEED_MENUS: Menu[] = [
  { id: 1,  parentId: 0,  title: '首页',       name: 'Dashboard',           path: '/',                          component: 'dashboard/DashboardPage',                        icon: 'Home',              type: 'menu',      sort: 1,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2,  parentId: 0,  title: '系统管理',   name: 'System',              path: undefined,                    component: undefined,                                        icon: 'Settings',          type: 'directory', sort: 2,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3,  parentId: 2,  title: '用户管理',   name: 'SystemUsers',         path: '/system/users',              component: 'users/UsersPage',                                icon: 'UsersRound',        type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'system:user:list',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 10, parentId: 3,  title: '新增用户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:user:create',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 11, parentId: 3,  title: '编辑用户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:user:update',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 12, parentId: 3,  title: '删除用户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:user:delete',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 44, parentId: 3,  title: '导入用户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'system:user:import',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 528, parentId: 3, title: '导出用户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 5,  status: 'enabled', visible: true,  permission: 'system:user:export',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 529, parentId: 3, title: '明文导出',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 6,  status: 'enabled', visible: true,  permission: 'system:user:export-raw',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 548, parentId: 3, title: '用户授权',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 7,  status: 'enabled', visible: true,  permission: 'system:user:assign',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 36, parentId: 2,  title: '部门管理',   name: 'SystemDepartments',   path: '/system/departments',        component: 'system/departments/DepartmentsPage',             icon: 'Building2',         type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'system:department:list',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 37, parentId: 36, title: '新增部门',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:department:create',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 38, parentId: 36, title: '编辑部门',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:department:update',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 39, parentId: 36, title: '删除部门',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:department:delete',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 40, parentId: 2,  title: '岗位管理',   name: 'SystemPositions',     path: '/system/positions',          component: 'system/positions/PositionsPage',                 icon: 'BriefcaseBusiness', type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'system:position:list',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 41, parentId: 40, title: '新增岗位',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:position:create',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 42, parentId: 40, title: '编辑岗位',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:position:update',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 43, parentId: 40, title: '删除岗位',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:position:delete',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 240, parentId: 2,  title: '用户组',     name: 'SystemUserGroups',    path: '/system/user-groups',        component: 'system/user-groups/UserGroupsPage',              icon: 'Users',             type: 'menu',      sort: 4,  status: 'enabled', visible: true,  permission: 'system:user-groups:list',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 241, parentId: 240, title: '新增用户组', name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:user-groups:create',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 242, parentId: 240, title: '编辑用户组', name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:user-groups:update',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 243, parentId: 240, title: '删除用户组', name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:user-groups:delete',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 244, parentId: 240, title: '分配成员',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'system:user-groups:assign',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4,  parentId: 2,  title: '菜单管理',   name: 'SystemMenus',         path: '/system/menus',              component: 'system/menus/MenusPage',                         icon: 'LayoutList',        type: 'menu',      sort: 4,  status: 'enabled', visible: true,  permission: 'system:menu:list',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 13, parentId: 4,  title: '新增菜单',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:menu:create',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 14, parentId: 4,  title: '编辑菜单',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:menu:update',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 15, parentId: 4,  title: '删除菜单',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:menu:delete',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 5,  parentId: 2,  title: '角色管理',   name: 'SystemRoles',         path: '/system/roles',              component: 'system/roles/RolesPage',                         icon: 'ShieldCheck',       type: 'menu',      sort: 5,  status: 'enabled', visible: true,  permission: 'system:role:list',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 16, parentId: 5,  title: '新增角色',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:role:create',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 17, parentId: 5,  title: '编辑角色',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:role:update',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 18, parentId: 5,  title: '删除角色',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:role:delete',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19, parentId: 5,  title: '分配菜单',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'system:role:assign',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 6,  parentId: 2,  title: '字典管理',   name: 'SystemDicts',         path: '/system/dicts',              component: 'system/dicts/DictsPage',                         icon: 'NotepadText',       type: 'menu',      sort: 6,  status: 'enabled', visible: true,  permission: 'system:dict:list',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 20, parentId: 6,  title: '新增字典',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:dict:create',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 21, parentId: 6,  title: '编辑字典',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:dict:update',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 22, parentId: 6,  title: '删除字典',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:dict:delete',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 23, parentId: 6,  title: '管理字典项', name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'system:dict:item',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 210, parentId: 2,  title: '租户管理',   name: 'SystemTenants',       path: '/system/tenants',            component: 'system/tenants/TenantsPage',                     icon: 'Building',          type: 'menu',      sort: 7,  status: 'enabled', visible: true,  permission: 'system:tenant:list',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 211, parentId: 210, title: '新增租户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:tenant:create',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 212, parentId: 210, title: '编辑租户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:tenant:update',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 213, parentId: 210, title: '删除租户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:tenant:delete',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 890, parentId: 2,   title: '租户套餐',   name: 'SystemTenantPackages', path: '/system/tenant-packages',    component: 'system/tenant-packages/TenantPackagesPage',      icon: 'Package',           type: 'menu',      sort: 7,  status: 'enabled', visible: true,  permission: 'system:tenant-package:list',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 891, parentId: 890, title: '新增套餐',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:tenant-package:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 892, parentId: 890, title: '编辑套餐',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:tenant-package:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 893, parentId: 890, title: '删除套餐',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:tenant-package:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 894, parentId: 890, title: '分配菜单',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'system:tenant-package:assign', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 100, parentId: 2, title: '地区管理',  name: 'SystemRegions',       path: '/system/regions',            component: 'system/regions/RegionsPage',                     icon: 'MapPin',            type: 'menu',      sort: 8,  status: 'enabled', visible: true,  permission: 'system:region:list',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 101, parentId: 100, title: '新增地区', name: undefined,            path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:region:create',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 102, parentId: 100, title: '编辑地区', name: undefined,            path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:region:update',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 103, parentId: 100, title: '删除地区', name: undefined,            path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:region:delete',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 104, parentId: 100, title: '导出地区', name: undefined,            path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'system:region:export',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 200, parentId: 0, title: '系统设置',   name: 'SystemSettings',      path: undefined,                    component: undefined,                                        icon: 'Settings2',         type: 'directory', sort: 3,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 50, parentId: 200, title: '系统配置',   name: 'SystemConfigs',       path: '/system/configs',            component: 'system/configs/SystemConfigsPage',               icon: 'SlidersHorizontal', type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'system:config:list',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 51, parentId: 50, title: '新增配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:config:create',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 52, parentId: 50, title: '编辑配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:config:update',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 53, parentId: 50, title: '删除配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:config:delete',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 540, parentId: 200, title: '身份安全', name: 'SystemIdentitySecurity', path: '/system/identity-security', component: 'system/identity-security/IdentitySecurityPage', icon: 'Fingerprint', type: 'menu', sort: 2, status: 'enabled', visible: true, permission: 'system:identity-security:manage', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 541, parentId: 540, title: '管理策略', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'system:identity-security:manage', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 542, parentId: 200, title: '企业身份源', name: 'SystemIdentityProviders', path: '/system/identity-providers', component: 'system/identity-providers/IdentityProvidersPage', icon: 'Building2', type: 'menu', sort: 3, status: 'enabled', visible: true, permission: 'system:identity-provider:manage', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 543, parentId: 542, title: '管理身份源', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'system:identity-provider:manage', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 115, parentId: 200, title: 'OAuth配置',   name: 'SystemOAuthConfig',  path: '/system/oauth-config',       component: 'system/oauth-config/OAuthConfigPage',            icon: 'KeyRound',          type: 'menu',      sort: 4,  status: 'enabled', visible: true,  permission: 'system:oauth-config:view',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 116, parentId: 115, title: '保存配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:oauth-config:update',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 8,  parentId: 200, title: '文件管理',   name: 'SystemFiles',         path: undefined,                    component: undefined,                                        icon: 'FolderOpen',        type: 'directory', sort: 4,  status: 'enabled', visible: true,  permission: 'system:file:list',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 24, parentId: 8,  title: '文件配置',   name: 'SystemFileConfigs',   path: '/system/file-configs',       component: 'system/file-configs/FileStorageConfigsPage',     icon: 'HardDriveUpload',   type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'system:file:config',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 25, parentId: 8,  title: '文件列表',   name: 'SystemFileList',      path: '/system/files',              component: 'system/files/FilesPage',                         icon: 'Files',             type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'system:file:list',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 26, parentId: 24, title: '新增配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:file:config:create',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 27, parentId: 24, title: '编辑配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:file:config:update',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 28, parentId: 24, title: '删除配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:file:config:delete',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 29, parentId: 24, title: '设为默认',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'system:file:config:default',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 30, parentId: 25, title: '上传文件',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:file:upload',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 31, parentId: 25, title: '删除文件',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:file:delete',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 9,  parentId: 200, title: '服务监控',   name: 'SystemMonitor',       path: '/system/monitor',            component: 'system/monitor/MonitorPage',                     icon: 'Activity',          type: 'menu',      sort: 5,  status: 'enabled', visible: true,  permission: 'system:monitor:view',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 54, parentId: 200, title: '在线用户',   name: 'SystemSessions',      path: '/system/sessions',           component: 'system/sessions/OnlineSessionsPage',             icon: 'MonitorSmartphone', type: 'menu',      sort: 6,  status: 'enabled', visible: true,  permission: 'system:session:list',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 55, parentId: 54, title: '强制下线',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:session:forceLogout',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 56, parentId: 200, title: '定时任务',   name: 'SystemCronJobs',      path: '/system/cron-jobs',          component: 'system/cron-jobs/CronJobsPage',                  icon: 'Clock',             type: 'menu',      sort: 7,  status: 'enabled', visible: true,  permission: 'system:cronjob:list',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 57, parentId: 56, title: '新增任务',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:cronjob:create',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 58, parentId: 56, title: '编辑任务',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:cronjob:update',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 59, parentId: 56, title: '删除任务',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:cronjob:delete',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 60, parentId: 56, title: '立即执行',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'system:cronjob:execute',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 120, parentId: 200, title: '数据库备份', name: 'SystemDbBackups',     path: '/system/db-backups',         component: 'system/db-backups/DbBackupsPage',                icon: 'DatabaseBackup',    type: 'menu',      sort: 8,  status: 'enabled', visible: true,  permission: 'system:db-backup:list',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 121, parentId: 120, title: '创建备份',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:db-backup:create',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 123, parentId: 120, title: '删除备份',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:db-backup:delete',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 129, parentId: 200, title: '数据库管理', name: 'SystemDbAdmin',       path: '/system/db-admin',           component: 'system/db-admin/DbAdminPage',                    icon: 'Database',          type: 'menu',      sort: 16, status: 'enabled', visible: true,  permission: 'system:db-admin:view',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 130, parentId: 129, title: '执行 SQL',  name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:db-admin:query',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 131, parentId: 129, title: '导出结果',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:db-admin:export',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 132, parentId: 129, title: '修改数据',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:db-admin:write',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 133, parentId: 129, title: '运维操作',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'system:db-admin:maintain',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 470, parentId: 200, title: '数据脱敏',   name: 'SystemDataMask',      path: '/system/data-mask',          component: 'system/data-mask/DataMaskPage',                  icon: 'EyeOff',            type: 'menu',      sort: 17, status: 'enabled', visible: true,  permission: 'system:data-mask:list',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 471, parentId: 470, title: '新增规则',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:data-mask:create',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 472, parentId: 470, title: '编辑规则',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:data-mask:update',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 473, parentId: 470, title: '删除规则',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:data-mask:delete',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 480, parentId: 1300, title: '应用管理', name: 'SystemOAuth2Apps',   path: '/system/oauth2-apps',        component: 'system/oauth2-apps/OAuth2AppsPage',              icon: 'KeyRound',          type: 'menu',      sort: 1, status: 'enabled', visible: true,  permission: 'system:oauth2-apps:view',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 481, parentId: 480, title: '管理应用',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:oauth2-apps:manage',    createdAt: SEED_DATE, updatedAt: SEED_DATE },

  { id: 490, parentId: 200, title: '维护模式',   name: 'SystemMaintenance',   path: '/system/maintenance',        component: 'system/maintenance/MaintenancePage',             icon: 'Wrench',            type: 'menu',      sort: 19, status: 'enabled', visible: true,  permission: 'system:maintenance:manage',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 491, parentId: 490, title: '开启/关闭',  name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:maintenance:manage',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 535, parentId: 200, title: '系统调度',   name: 'SystemScheduler',    path: '/system/scheduler',          component: 'system/scheduler/SystemSchedulerPage',            icon: 'Timer',             type: 'menu',      sort: 18, status: 'enabled', visible: true,  permission: 'system:scheduler:view',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 536, parentId: 535, title: '手动执行',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:scheduler:run',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 537, parentId: 535, title: '调整策略',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:scheduler:config',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 538, parentId: 535, title: '清理日志',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:scheduler:cleanup',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 539, parentId: 535, title: '确认告警',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'system:scheduler:alert',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 530, parentId: 200, title: '导出中心',   name: 'SystemExportJobs',    path: '/system/export-jobs',        component: 'system/export-jobs/ExportJobsPage',              icon: 'Download',          type: 'menu',      sort: 19, status: 'enabled', visible: true,  permission: 'system:export-job:list',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 531, parentId: 530, title: '下载文件',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:export-job:download',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 532, parentId: 530, title: '管理全部',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:export-job:manage',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 533, parentId: 530, title: '管理租户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:export-job:tenant-manage', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 534, parentId: 530, title: '删除任务',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'system:export-job:delete',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 544, parentId: 200, title: '任务中心',   name: 'SystemTaskCenter',    path: '/system/task-center',        component: 'system/task-center/TaskCenterPage',              icon: 'ListChecks',        type: 'menu',      sort: 19, status: 'enabled', visible: true,  permission: 'system:async-task:list',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 545, parentId: 544, title: '管理任务',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:async-task:manage',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 546, parentId: 544, title: '清理任务',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:async-task:cleanup',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 547, parentId: 544, title: '调整策略',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:async-task:config',     createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // ── 系统运维 ──────────────────────────────────────────────────────────────────
  { id: 500, parentId: 200, title: '系统运维',   name: 'SystemOps',           path: undefined,                    component: undefined,                                        icon: 'Terminal',          type: 'directory', sort: 20, status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 501, parentId: 500, title: 'Web 终端',   name: 'SystemTerminal',      path: '/system/terminal',           component: 'system/terminal/TerminalPage',                   icon: 'TerminalSquare',    type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'system:terminal:execute',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 502, parentId: 501, title: '执行终端',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:terminal:execute',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 503, parentId: 500, title: '终端录屏',   name: 'TerminalRecordings',  path: '/system/terminal/recordings',component: 'system/terminal/TerminalRecordingsPage',         icon: 'Video',             type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'system:terminal:execute',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 504, parentId: 500, title: '文件管理器', name: 'SystemFileManager',   path: '/system/file-manager',       component: 'system/file-manager/FileManagerPage',            icon: 'HardDrive',         type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'system:terminal:execute',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 505, parentId: 500, title: '进程管理',  name: 'SystemProcesses',     path: '/system/processes',          component: 'system/processes/ProcessesPage',                 icon: 'Cpu',               type: 'menu',      sort: 4,  status: 'enabled', visible: true,  permission: 'system:process:view',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 506, parentId: 505, title: '结束进程',  name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:process:kill',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 507, parentId: 505, title: '调整优先级',name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:process:priority',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 508, parentId: 500, title: '端口监听',  name: 'SystemPorts',         path: '/system/ports',              component: 'system/ports/PortsPage',                         icon: 'Network',           type: 'menu',      sort: 5,  status: 'enabled', visible: true,  permission: 'system:process:view',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 509, parentId: 500, title: 'Docker',    name: 'SystemDocker',        path: '/system/docker',             component: 'system/docker/DockerPage',                       icon: 'Container',         type: 'menu',      sort: 6,  status: 'enabled', visible: true,  permission: 'system:process:view',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 510, parentId: 500, title: '网络诊断',  name: 'SystemNetworkDiag',   path: '/system/network-diag',       component: 'system/network-diag/NetworkDiagPage',            icon: 'Wifi',              type: 'menu',      sort: 7,  status: 'enabled', visible: true,  permission: 'system:process:view',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 511, parentId: 500, title: '服务管理',  name: 'SystemServices',      path: '/system/services',           component: 'system/services/ServicesPage',                   icon: 'Settings',          type: 'menu',      sort: 8,  status: 'enabled', visible: true,  permission: 'system:process:view',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 512, parentId: 500, title: '日志查看器',name: 'SystemLogViewer',     path: '/system/log-viewer',         component: 'system/log-viewer/LogViewerPage',                icon: 'FileText',          type: 'menu',      sort: 9,  status: 'enabled', visible: true,  permission: 'system:process:view',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 513, parentId: 500, title: '终端会话',  name: 'SystemTerminalSessions', path: '/system/terminal/sessions', component: 'system/terminal/TerminalSessionsPage',          icon: 'Monitor',           type: 'menu',      sort: 10, status: 'enabled', visible: true,  permission: 'system:terminal:monitor',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 514, parentId: 513, title: '强制终止',  name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:terminal:monitor',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 515, parentId: 500, title: '监控告警',   name: 'SystemMonitorAlerts', path: '/system/monitor-alerts',     component: 'system/monitor-alerts/MonitorAlertsPage',        icon: 'Siren',             type: 'menu',      sort: 11, status: 'enabled', visible: true,  permission: 'system:monitor:alert',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 516, parentId: 515, title: '新增规则',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:monitor:alert:manage',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 517, parentId: 515, title: '编辑规则',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:monitor:alert:manage',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 518, parentId: 515, title: '删除规则',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:monitor:alert:manage',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 519, parentId: 500, title: '告警记录',   name: 'SystemMonitorAlertEvents', path: '/system/monitor-alert-events', component: 'system/monitor-alert-events/MonitorAlertEventsPage', icon: 'History',     type: 'menu',      sort: 12, status: 'enabled', visible: true,  permission: 'system:monitor:alert',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 520, parentId: 500, title: '防火墙管理', name: 'SystemFirewall',      path: '/system/firewall',           component: 'system/firewall/FirewallPage',                  icon: 'Shield',      type: 'menu',      sort: 13, status: 'enabled', visible: true,  permission: 'system:firewall:view',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 521, parentId: 520, title: '管理规则',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,     type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:firewall:manage',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 522, parentId: 500, title: 'Nginx 站点', name: 'SystemNginxSites', path: '/system/nginx-sites', component: 'system/nginx-sites/NginxSitesPage', icon: 'Globe', type: 'menu', sort: 14, status: 'enabled', visible: true, permission: 'system:nginx:view', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 523, parentId: 522, title: '管理站点', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'system:nginx:manage', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 524, parentId: 522, title: '重载 Nginx', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 2, status: 'enabled', visible: true, permission: 'system:nginx:reload', createdAt: SEED_DATE, updatedAt: SEED_DATE },

  { id: 482, parentId: 480, title: '管理应用',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:oauth2-apps:manage',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 34, parentId: 200, title: '审计日志',   name: 'SystemAuditLogs',     path: undefined,                    component: undefined,                                        icon: 'ClipboardMinus',    type: 'directory', sort: 9,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 32, parentId: 34, title: '登录日志',   name: 'SystemLoginLogs',     path: '/system/login-logs',         component: 'system/login-logs/LoginLogsPage',                icon: 'List',              type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'system:log:login',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 33, parentId: 34, title: '操作日志',   name: 'SystemOperationLogs', path: '/system/operation-logs',     component: 'system/operation-logs/OperationLogsPage',        icon: 'ClipboardList',     type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'system:log:operation',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 303, parentId: 34, title: '日志文件',  name: 'SystemLogFiles',      path: '/system/log-files',          component: 'system/log-files/LogFilesPage',                  icon: 'FileText',          type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'system:log:files',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 304, parentId: 303, title: '查看日志', name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:log:files',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 305, parentId: 303, title: '下载日志', name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:log:files:download',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 306, parentId: 303, title: '删除日志', name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:log:files:delete',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 35, parentId: 200, title: '公告管理',   name: 'SystemAnnouncements', path: '/system/announcements',      component: 'system/announcements/AnnouncementsPage',         icon: 'Megaphone',         type: 'menu',      sort: 10, status: 'enabled', visible: true,  permission: 'system:announcement:list',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 61, parentId: 35, title: '新增公告',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:announcement:create',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 62, parentId: 35, title: '编辑公告',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:announcement:update',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 63, parentId: 35, title: '删除公告',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:announcement:delete',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1370, parentId: 200, title: '意见反馈', name: 'SystemFeedbacks',     path: '/system/feedbacks',          component: 'system/feedbacks/FeedbacksPage',                 icon: 'MessageSquareHeart', type: 'menu',     sort: 11, status: 'enabled', visible: true,  permission: 'system:feedback:list',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1371, parentId: 1370, title: '处理反馈', name: undefined,            path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:feedback:handle',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1372, parentId: 1370, title: '删除反馈', name: undefined,            path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:feedback:delete',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // ── 内置隐藏菜单（不显示在侧边栏，供面包屑/标签页标题使用）──────────────────────────────
  { id: 202, parentId: 0, title: '个人中心',   name: 'Profile',             path: '/profile',                   component: 'profile/ProfilePage',                            icon: 'UserRound',         type: 'menu',      sort: 99, status: 'enabled', visible: false, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 203, parentId: 0, title: '公告中心',   name: 'Announcements',       path: '/announcements',             component: 'announcements/AnnouncementsPage',                icon: 'Megaphone',         type: 'menu',      sort: 100, status: 'enabled', visible: false, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 204, parentId: 0, title: '我的消息',   name: 'Inbox',               path: '/inbox',                     component: 'inbox/InboxPage',                                icon: 'Inbox',             type: 'menu',      sort: 101, status: 'enabled', visible: false, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 125, parentId: 200, title: 'IP访问控制', name: 'SystemIpAccess',      path: '/system/ip-access',          component: 'system/ip-access/IpAccessPage',                  icon: 'ShieldBan',         type: 'menu',      sort: 11, status: 'enabled', visible: true,  permission: 'system:ip-access:view',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 126, parentId: 125, title: '保存配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:ip-access:update',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 135, parentId: 125, title: '查看拦截日志', name: undefined,           path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:ip-access:log',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 127, parentId: 200, title: '缓存管理',   name: 'SystemCache',         path: '/system/cache',              component: 'system/cache/CacheManagePage',                   icon: 'BrainCircuit',      type: 'menu',      sort: 12, status: 'enabled', visible: true,  permission: 'system:cache:list',            createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 128, parentId: 127, title: '删除缓存',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:cache:delete',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 134, parentId: 127, title: '编辑缓存',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:cache:update',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // ── 通知管理（邮件 / 短信 / 站内信）─────────────────────────────────────────
  { id: 400, parentId: 200, title: '通知管理',     name: 'SystemNotification',   path: undefined,                       component: undefined,                                                icon: 'BellRing',          type: 'directory', sort: 13, status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 邮件管理
  { id: 410, parentId: 400, title: '邮件管理',     name: 'NotificationEmail',    path: undefined,                       component: undefined,                                                icon: 'Mail',              type: 'directory', sort: 1,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 411, parentId: 410, title: '邮件配置',     name: 'NotificationEmailConfig', path: '/system/email-config',       component: 'system/email-config/EmailConfigPage',                    icon: 'MailCheck',         type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'system:email-config:view',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 412, parentId: 411, title: '保存配置',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:email-config:update',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 413, parentId: 411, title: '测试邮件',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:email-config:update',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 415, parentId: 410, title: '邮件模板',     name: 'NotificationEmailTemplates', path: '/system/email-templates', component: 'system/email-templates/EmailTemplatesPage',              icon: 'MailPlus',          type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'system:email-template:list',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 416, parentId: 415, title: '新增模板',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:email-template:create',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 417, parentId: 415, title: '编辑模板',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:email-template:update',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 418, parentId: 415, title: '删除模板',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:email-template:delete',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 420, parentId: 410, title: '邮件发送记录', name: 'NotificationEmailSendLogs', path: '/system/email-send-logs',  component: 'system/email-send-logs/EmailSendLogsPage',               icon: 'MailX',             type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'system:email-send-log:list',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 421, parentId: 420, title: '删除记录',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:email-send-log:delete',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 422, parentId: 420, title: '导出记录',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:email-send-log:export',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 短信管理
  { id: 430, parentId: 400, title: '短信管理',     name: 'NotificationSms',      path: undefined,                       component: undefined,                                                icon: 'MessageSquareText', type: 'directory', sort: 2,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 431, parentId: 430, title: '短信配置',     name: 'NotificationSmsConfigs', path: '/system/sms-configs',         component: 'system/sms-configs/SmsConfigsPage',                      icon: 'Smartphone',        type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'system:sms-config:list',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 432, parentId: 431, title: '新增配置',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:sms-config:create',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 433, parentId: 431, title: '编辑配置',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:sms-config:update',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 434, parentId: 431, title: '删除配置',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:sms-config:delete',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 435, parentId: 431, title: '设为默认',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'system:sms-config:default',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 437, parentId: 430, title: '短信模板',     name: 'NotificationSmsTemplates', path: '/system/sms-templates',     component: 'system/sms-templates/SmsTemplatesPage',                  icon: 'MessageSquarePlus', type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'system:sms-template:list',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 438, parentId: 437, title: '新增模板',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:sms-template:create',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 439, parentId: 437, title: '编辑模板',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:sms-template:update',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 440, parentId: 437, title: '删除模板',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:sms-template:delete',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 442, parentId: 430, title: '短信发送记录', name: 'NotificationSmsSendLogs', path: '/system/sms-send-logs',     component: 'system/sms-send-logs/SmsSendLogsPage',                   icon: 'MessageSquareX',    type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'system:sms-send-log:list',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 443, parentId: 442, title: '测试发送',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:sms-send-log:test',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 444, parentId: 442, title: '删除记录',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:sms-send-log:delete',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 445, parentId: 442, title: '导出记录',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:sms-send-log:export',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 站内信管理
  { id: 450, parentId: 400, title: '站内信管理',   name: 'NotificationInApp',    path: undefined,                       component: undefined,                                                icon: 'Inbox',             type: 'directory', sort: 3,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 451, parentId: 450, title: '站内信模板',   name: 'NotificationInAppTemplates', path: '/system/in-app-templates', component: 'system/in-app-templates/InAppTemplatesPage',           icon: 'Newspaper',         type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'system:in-app-template:list',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 452, parentId: 451, title: '新增模板',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:in-app-template:create',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 453, parentId: 451, title: '编辑模板',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:in-app-template:update',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 454, parentId: 451, title: '删除模板',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:in-app-template:delete',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 456, parentId: 450, title: '收件记录',     name: 'NotificationInAppMessages', path: '/system/in-app-messages',  component: 'system/in-app-messages/InAppMessagesPage',               icon: 'MailOpen',          type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'system:in-app-message:list',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 457, parentId: 456, title: '标记已读',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:in-app-message:read',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 458, parentId: 456, title: '删除记录',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:in-app-message:delete',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 频道管理（站内公众号）
  { id: 1100, parentId: 400, title: '频道管理',     name: 'NotificationChannels', path: '/system/channels',              component: 'system/channels/ChannelsPage',                           icon: 'Radio',             type: 'menu',      sort: 4,  status: 'enabled', visible: true,  permission: 'channel:channel:list',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1101, parentId: 1100, title: '新建频道',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'channel:channel:create',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1102, parentId: 1100, title: '编辑频道',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'channel:channel:update',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1103, parentId: 1100, title: '删除频道',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'channel:channel:delete',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1104, parentId: 1100, title: '群发消息',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'channel:message:publish',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1105, parentId: 1100, title: '菜单配置',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 5,  status: 'enabled', visible: true,  permission: 'channel:menu:save',                createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1106, parentId: 1100, title: '自动回复',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 6,  status: 'enabled', visible: true,  permission: 'channel:reply:list',               createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1107, parentId: 1100, title: '保存自动回复', name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 7,  status: 'enabled', visible: true,  permission: 'channel:reply:save',               createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1108, parentId: 1100, title: '删除自动回复', name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 8,  status: 'enabled', visible: true,  permission: 'channel:reply:delete',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 497, parentId: 400, title: '客服工作台',   name: 'ChannelCustomerService', path: '/system/channel-cs',          component: 'system/channel-cs/ChannelCustomerServicePage',           icon: 'Headset',           type: 'menu',      sort: 5,  status: 'enabled', visible: true,  permission: 'channel:cs',                       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1109, parentId: 400, title: '频道数据',     name: 'ChannelDashboard',      path: '/system/channel-dashboard',     component: 'system/channel-dashboard/ChannelDashboardPage',          icon: 'ChartColumn',       type: 'menu',      sort: 6,  status: 'enabled', visible: true,  permission: 'channel:dashboard',                createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 311, parentId: 200, title: '标签管理',   name: 'SystemTags',          path: '/system/tags',               component: 'system/tags/TagsPage',                           icon: 'Tags',              type: 'menu',      sort: 14, status: 'enabled', visible: true,  permission: 'system:tag:list',              createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 312, parentId: 311, title: '新增标签',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:tag:create',            createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 313, parentId: 311, title: '编辑标签',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:tag:update',            createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 314, parentId: 311, title: '删除标签',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:tag:delete',            createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 320, parentId: 200, title: '接口限流',   name: 'SystemRateLimit',     path: '/system/rate-limit',         component: 'system/rate-limit/RateLimitPage',                icon: 'Gauge',             type: 'menu',      sort: 15, status: 'enabled', visible: true,  permission: 'system:rate-limit:view',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 321, parentId: 320, title: '编辑规则',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:rate-limit:manage',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 322, parentId: 320, title: '解封/重置', name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:rate-limit:manage',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 330, parentId: 200, title: 'Webhook 机器人', name: 'SystemChatBots', path: '/system/chat-bots', component: 'system/chat-bots/ChatBotsPage', icon: 'Bot', type: 'menu', sort: 16, status: 'enabled', visible: true, permission: 'chat:bot:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 331, parentId: 330, title: '新增机器人', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'chat:bot:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 332, parentId: 330, title: '编辑机器人', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 2, status: 'enabled', visible: true, permission: 'chat:bot:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 333, parentId: 330, title: '删除机器人', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 3, status: 'enabled', visible: true, permission: 'chat:bot:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 525, parentId: 500, title: 'SSL 证书', name: 'SystemSslCertificates', path: '/system/ssl-certificates', component: 'system/ssl-certificates/SslCertificatesPage', icon: 'Lock', type: 'menu', sort: 15, status: 'enabled', visible: true, permission: 'system:ssl:view', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 526, parentId: 525, title: '新增证书', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'system:ssl:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 527, parentId: 525, title: '删除证书', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 2, status: 'enabled', visible: true, permission: 'system:ssl:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // ── 工作流引擎 ────────────────────────────────────────────────────────────────────────────────
  // ── 智能助手 ─────────────────────────────────────────────────────────────────────────────────
  { id: 300, parentId: 0,   title: '智能助手',    name: 'AiFeatures',              path: undefined,                    component: undefined,                                        icon: 'Sparkles',          type: 'directory', sort: 5,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 301, parentId: 300, title: '智能对话',    name: 'AiChat',                  path: '/ai/chat',                   component: 'ai/chat/AIChatPage',                             icon: 'MessageSquare',     type: 'menu',      sort: 1,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 302, parentId: 300, title: 'AI 服务商',  name: 'AiProviders',             path: '/ai/providers',              component: 'ai/providers/AIProvidersPage',                   icon: 'Cpu',               type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'ai:provider:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 492, parentId: 300, title: 'AI 反馈',    name: 'AiFeedback',              path: '/ai/feedback',               component: 'ai/feedback/AiFeedbackPage',                     icon: 'ThumbsUp',          type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'ai:feedback:view', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 463, parentId: 302, title: '新增',        name: undefined,                 path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'ai:provider:create',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 464, parentId: 302, title: '编辑',        name: undefined,                 path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'ai:provider:edit',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 465, parentId: 302, title: '删除',        name: undefined,                 path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'ai:provider:delete',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 870, parentId: 300, title: '提示词模板',  name: 'AiPromptTemplates',       path: '/ai/prompts',                component: 'ai/prompts/PromptTemplatesPage',                 icon: 'BookText',          type: 'menu',      sort: 4,  status: 'enabled', visible: true,  permission: 'ai:prompt:list',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 871, parentId: 870, title: '新增',        name: undefined,                 path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'ai:prompt:create',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 872, parentId: 870, title: '编辑',        name: undefined,                 path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'ai:prompt:edit',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 873, parentId: 870, title: '删除',        name: undefined,                 path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'ai:prompt:delete',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 875, parentId: 300, title: '用量统计',    name: 'AiUsage',                 path: '/ai/usage',                  component: 'ai/usage/AiUsagePage',                           icon: 'BarChart3',         type: 'menu',      sort: 5,  status: 'enabled', visible: true,  permission: 'ai:usage:view',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 876, parentId: 492, title: '处理反馈',    name: undefined,                 path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'ai:feedback:handle', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1620, parentId: 300, title: '对话审计',   name: 'AiAudit',                 path: '/ai/audit',                  component: 'ai/audit/AiAuditPage',                           icon: 'ShieldCheck',       type: 'menu',      sort: 6,  status: 'enabled', visible: true,  permission: 'ai:audit:view',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1621, parentId: 300, title: '知识库',     name: 'AiKnowledge',             path: '/ai/knowledge',              component: 'ai/knowledge/AiKnowledgePage',                   icon: 'Library',           type: 'menu',      sort: 7,  status: 'enabled', visible: true,  permission: 'ai:kb:list',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1622, parentId: 1621, title: '新增',      name: undefined,                 path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'ai:kb:create',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1623, parentId: 1621, title: '编辑',      name: undefined,                 path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'ai:kb:edit',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1624, parentId: 1621, title: '删除',      name: undefined,                 path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'ai:kb:delete',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1625, parentId: 300, title: '智能体',     name: 'AiAgents',                path: '/ai/agents',                 component: 'ai/agents/AiAgentsPage',                         icon: 'Bot',               type: 'menu',      sort: 8,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1626, parentId: 1625, title: '上架审核',  name: undefined,                 path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'ai:agent:review',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1627, parentId: 300, title: 'AI 工具',    name: 'AiTools',                 path: '/ai/tools',                  component: 'ai/tools/AiToolsPage',                           icon: 'Wrench',            type: 'menu',      sort: 9,  status: 'enabled', visible: true,  permission: 'ai:tool:list',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1628, parentId: 1627, title: '管理',      name: undefined,                 path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'ai:tool:manage',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1629, parentId: 300, title: '模型评测',   name: 'AiEval',                  path: '/ai/eval',                   component: 'ai/eval/AiEvalPage',                             icon: 'FlaskConical',      type: 'menu',      sort: 10, status: 'enabled', visible: true,  permission: 'ai:eval:list',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1630, parentId: 1629, title: '管理',      name: undefined,                 path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'ai:eval:manage',     createdAt: SEED_DATE, updatedAt: SEED_DATE },

  { id: 230, parentId: 0,   title: '工作流引擎', name: 'Workflow',                path: undefined,                    component: undefined,                                        icon: 'GitFork',           type: 'directory', sort: 6,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 231, parentId: 230, title: '流程定义',   name: 'WorkflowDefinitions',    path: '/workflow/definitions',       component: 'workflow/definitions/WorkflowDefinitionsPage',   icon: 'Workflow',          type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'workflow:definition:list',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 232, parentId: 231, title: '新建流程',   name: undefined,                path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'workflow:definition:create',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 233, parentId: 231, title: '编辑流程',   name: undefined,                path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'workflow:definition:edit',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 234, parentId: 231, title: '删除流程',   name: undefined,                path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'workflow:definition:delete',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 235, parentId: 231, title: '发布/禁用',  name: undefined,                path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'workflow:definition:publish',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 238, parentId: 231, title: '流程设计',   name: 'WorkflowDesigner',       path: '/workflow/designer',          component: 'workflow/designer/WorkflowDesignerPage',         icon: undefined,           type: 'menu',      sort: 5,  status: 'enabled', visible: false, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 910, parentId: 230, title: '流程模板',   name: 'WorkflowTemplates',      path: '/workflow/templates',         component: 'workflow/templates/WorkflowTemplatesPage',       icon: 'LayoutTemplate',    type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'workflow:definition:list',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 466, parentId: 230, title: '表单库',     name: 'WorkflowForms',          path: '/workflow/forms',             component: 'workflow/forms/WorkflowFormsPage',               icon: 'LayoutList',        type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'workflow:form:list',            createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 467, parentId: 466, title: '新建表单',   name: undefined,                path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'workflow:form:create',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 468, parentId: 466, title: '编辑表单',   name: undefined,                path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'workflow:form:edit',            createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 469, parentId: 466, title: '删除表单',   name: undefined,                path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'workflow:form:delete',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 474, parentId: 466, title: '表单设计',   name: 'WorkflowFormDesigner',   path: '/workflow/forms/designer',    component: 'workflow/forms/WorkflowFormDesignerPage',        icon: undefined,           type: 'menu',      sort: 4,  status: 'enabled', visible: false, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 236, parentId: 230, title: '我的申请',   name: 'MyApplications',         path: '/workflow/applications',     component: 'workflow/instances/MyApplicationsPage',          icon: 'FilePlus2',         type: 'menu',      sort: 4,  status: 'enabled', visible: true,  permission: 'workflow:instance:list',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 950, parentId: 236, title: '发起申请',   name: undefined,                path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'workflow:instance:create',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 237, parentId: 230, title: '待我审批',   name: 'PendingApprovals',       path: '/workflow/pending',          component: 'workflow/tasks/PendingApprovalsPage',            icon: 'ClipboardCheck',    type: 'menu',      sort: 5,  status: 'enabled', visible: true,  permission: 'workflow:task:handle',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 239, parentId: 230, title: '流程监控',   name: 'WorkflowMonitor',         path: '/workflow/monitor',           component: 'workflow/monitor/WorkflowMonitorPage',            icon: 'BarChart2',         type: 'menu',      sort: 8,  status: 'enabled', visible: true,  permission: 'workflow:instance:monitor',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 476, parentId: 239, title: '取消流程',   name: undefined,                 path: undefined,                     component: undefined,                                         icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'workflow:instance:cancel',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 477, parentId: 239, title: '删除流程',   name: undefined,                 path: undefined,                     component: undefined,                                         icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'workflow:instance:delete',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 478, parentId: 239, title: '引擎运维',   name: undefined,                 path: undefined,                     component: undefined,                                         icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'workflow:engine:operate',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 494, parentId: 239, title: '离职交接',   name: undefined,                 path: undefined,                     component: undefined,                                         icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'workflow:task:handover',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 460, parentId: 230, title: '事件订阅',   name: 'WorkflowEventSubscriptions', path: '/workflow/event-subscriptions', component: 'workflow/event-subscriptions/WorkflowEventSubscriptionsPage', icon: 'Webhook', type: 'menu', sort: 9,  status: 'enabled', visible: true,  permission: 'workflow:event-subscription:view', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 951, parentId: 460, title: '新建订阅',   name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'workflow:event-subscription:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 952, parentId: 460, title: '编辑订阅',   name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 2, status: 'enabled', visible: true, permission: 'workflow:event-subscription:edit',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 953, parentId: 460, title: '删除订阅',   name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 3, status: 'enabled', visible: true, permission: 'workflow:event-subscription:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 954, parentId: 460, title: '投递记录',   name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 4, status: 'enabled', visible: true, permission: 'workflow:event-delivery:view',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 955, parentId: 460, title: '重试投递',   name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 5, status: 'enabled', visible: true, permission: 'workflow:event-delivery:retry',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 461, parentId: 230, title: '触发器执行', name: 'WorkflowTriggerExecutions', path: '/workflow/trigger-executions', component: 'workflow/trigger-executions/WorkflowTriggerExecutionsPage', icon: 'Zap', type: 'menu', sort: 10,  status: 'enabled', visible: true,  permission: 'workflow:trigger-execution:view', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 462, parentId: 230, title: '流程自动化', name: 'WorkflowAutomations', path: '/workflow/automations', component: 'workflow/automations/WorkflowAutomationsPage', icon: 'Bot', type: 'menu', sort: 11,  status: 'enabled', visible: true,  permission: 'workflow:definition:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 493, parentId: 230, title: '健康巡检', name: 'WorkflowHealth', path: '/workflow/health', component: 'workflow/health/WorkflowHealthPage', icon: 'Activity', type: 'menu', sort: 12, status: 'enabled', visible: true, permission: 'workflow:health:view', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 487, parentId: 462, title: '新建规则',   name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'workflow:definition:edit', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 488, parentId: 462, title: '编辑规则',   name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 2, status: 'enabled', visible: true, permission: 'workflow:definition:edit', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 489, parentId: 462, title: '删除规则',   name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 3, status: 'enabled', visible: true, permission: 'workflow:definition:edit', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 898, parentId: 230, title: '审批代理', name: 'WorkflowDelegations', path: '/workflow/delegations', component: 'workflow/delegations/WorkflowDelegationsPage', icon: 'UserRoundCog', type: 'menu', sort: 13,  status: 'enabled', visible: true,  permission: 'workflow:delegation:view', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 479, parentId: 898, title: '管理审批代理', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'workflow:delegation:manage', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 895, parentId: 230, title: '发起工作台', name: 'WorkflowLaunchpad',  path: '/workflow/launchpad', component: 'workflow/launchpad/WorkflowLaunchpadPage', icon: 'LayoutGrid',     type: 'menu', sort: 0, status: 'enabled', visible: true, permission: 'workflow:instance:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 896, parentId: 230, title: '抄送我的',   name: 'WorkflowCcToMe',     path: '/workflow/cc',        component: 'workflow/cc/CcToMePage',                  icon: 'Send',           type: 'menu', sort: 6, status: 'enabled', visible: true, permission: 'workflow:instance:list',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 897, parentId: 230, title: '我已办',     name: 'WorkflowHandled',    path: '/workflow/handled',   component: 'workflow/handled/HandledPage',            icon: 'CircleCheckBig',  type: 'menu', sort: 7, status: 'enabled', visible: true, permission: 'workflow:task:handle',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 483, parentId: 230, title: '定时发起',   name: 'WorkflowSchedules',  path: '/workflow/schedules', component: 'workflow/schedules/WorkflowSchedulesPage', icon: 'CalendarClock',  type: 'menu', sort: 14, status: 'enabled', visible: true, permission: 'workflow:schedule:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 920, parentId: 230, title: '远程数据源', name: 'WorkflowDataSources', path: '/workflow/data-sources', component: 'workflow/data-sources/WorkflowDataSourcesPage', icon: 'DatabaseZap', type: 'menu', sort: 15, status: 'enabled', visible: true, permission: 'workflow:datasource:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 921, parentId: 920, title: '新增数据源', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'workflow:datasource:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 922, parentId: 920, title: '编辑数据源', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 2, status: 'enabled', visible: true, permission: 'workflow:datasource:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 923, parentId: 920, title: '删除数据源', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 3, status: 'enabled', visible: true, permission: 'workflow:datasource:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 930, parentId: 230, title: '连接器',     name: 'WorkflowConnectors', path: '/workflow/connectors', component: 'workflow/connectors/WorkflowConnectorsPage', icon: 'Cable', type: 'menu', sort: 16, status: 'enabled', visible: true, permission: 'workflow:connector:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 931, parentId: 930, title: '新增连接器', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'workflow:connector:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 932, parentId: 930, title: '编辑连接器', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 2, status: 'enabled', visible: true, permission: 'workflow:connector:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 933, parentId: 930, title: '删除连接器', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 3, status: 'enabled', visible: true, permission: 'workflow:connector:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 934, parentId: 930, title: '测试连接器', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 4, status: 'enabled', visible: true, permission: 'workflow:connector:test', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 484, parentId: 483, title: '新建定时',   name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'workflow:schedule:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 485, parentId: 483, title: '编辑定时',   name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 2, status: 'enabled', visible: true, permission: 'workflow:schedule:edit',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 486, parentId: 483, title: '删除定时',   name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 3, status: 'enabled', visible: true, permission: 'workflow:schedule:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // ── 规则中心 ─────────────────────────────────────────────────────────────────
  { id: 940, parentId: 0,   title: '规则中心',   name: 'RuleCenter',     path: undefined,            component: undefined,                          icon: 'Table2',  type: 'directory', sort: 7,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 941, parentId: 940, title: '决策表',     name: 'RuleTables',     path: '/rules/tables',      component: 'rules/tables/RuleTablesPage',      icon: 'Grid3x3', type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'rule:table:list',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 942, parentId: 941, title: '新增决策表', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'rule:table:create',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 943, parentId: 941, title: '编辑决策表', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 2, status: 'enabled', visible: true, permission: 'rule:table:update',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 944, parentId: 941, title: '删除决策表', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 3, status: 'enabled', visible: true, permission: 'rule:table:delete',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 945, parentId: 941, title: '发布决策表', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 4, status: 'enabled', visible: true, permission: 'rule:table:publish',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 946, parentId: 941, title: '求值测试',   name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 5, status: 'enabled', visible: true, permission: 'rule:table:evaluate', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 965, parentId: 941, title: '审批发布',   name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 6, status: 'enabled', visible: true, permission: 'rule:table:approve',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 947, parentId: 940, title: '决策执行记录', name: 'RuleExecutions', path: '/rules/executions', component: 'rules/executions/RuleExecutionsPage', icon: 'History', type: 'menu', sort: 2, status: 'enabled', visible: true, permission: 'rule:table:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 948, parentId: 940, title: '决策流',     name: 'RuleFlows',      path: '/rules/flows',      component: 'rules/flows/RuleFlowsPage',           icon: 'GitBranch', type: 'menu', sort: 3, status: 'enabled', visible: true, permission: 'rule:flow:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 956, parentId: 948, title: '新增决策流', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'rule:flow:create',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 957, parentId: 948, title: '编辑决策流', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 2, status: 'enabled', visible: true, permission: 'rule:flow:update',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 958, parentId: 948, title: '删除决策流', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 3, status: 'enabled', visible: true, permission: 'rule:flow:delete',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 959, parentId: 948, title: '发布决策流', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 4, status: 'enabled', visible: true, permission: 'rule:flow:publish',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 960, parentId: 948, title: '决策流求值', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 5, status: 'enabled', visible: true, permission: 'rule:flow:evaluate', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 949, parentId: 940, title: '名单库',     name: 'RuleLists',      path: '/rules/lists',      component: 'rules/lists/RuleListsPage',           icon: 'ShieldBan', type: 'menu', sort: 4, status: 'enabled', visible: true, permission: 'rule:list:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 961, parentId: 949, title: '新增名单',   name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'rule:list:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 962, parentId: 949, title: '编辑名单',   name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 2, status: 'enabled', visible: true, permission: 'rule:list:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 963, parentId: 949, title: '删除名单',   name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 3, status: 'enabled', visible: true, permission: 'rule:list:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 964, parentId: 949, title: '条目管理',   name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 4, status: 'enabled', visible: true, permission: 'rule:list:item',   createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // ── 消息中心 ─────────────────────────────────────────────────────────────────
  { id: 310, parentId: 0,   title: '消息中心',   name: 'ChatCenter',              path: '/chat',                      component: 'chat/ChatPage',                                  icon: 'MessagesSquare',    type: 'menu',      sort: 7,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 315, parentId: 310, title: '导出聊天记录', name: undefined,               path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'chat:message:export', createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // ── 数据分析 ─────────────────────────────────────────────────────────────────
  { id: 600, parentId: 0, title: '数据分析',   name: 'Analytics',               path: undefined,                    component: undefined,                                        icon: 'BarChart2',         type: 'directory', sort: 8,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 601, parentId: 600, title: '行为分析', name: 'AnalyticsBehavior',        path: '/analytics/behavior',        component: 'analytics/AnalyticsPage',                        icon: 'Activity',          type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'analytics:view',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 602, parentId: 600, title: '数据管理', name: 'AnalyticsData',            path: '/analytics/data',            component: 'analytics/AnalyticsDataPage',                    icon: 'Database',          type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'analytics:manage',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 603, parentId: 602, title: '清除数据', name: undefined,                  path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'analytics:clean',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 604, parentId: 600, title: '错误监控', name: 'FrontendErrors',           path: '/analytics/errors',          component: 'analytics/FrontendErrorsPage',                   icon: 'AlertCircle',       type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'monitor:error:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 605, parentId: 604, title: '清除错误', name: undefined,                  path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'monitor:error:manage', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 606, parentId: 602, title: '导出数据', name: undefined,                  path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'analytics:export',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 607, parentId: 604, title: '告警查看', name: undefined,                  path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'monitor:alert:list',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 608, parentId: 604, title: '告警管理', name: undefined,                  path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'monitor:alert:manage', createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // ── 支付中心 ─────────────────────────────────────────────────────────────────
  { id: 700, parentId: 0,   title: '支付中心', name: 'PaymentCenter',   path: undefined,            component: undefined,                     icon: 'Wallet',     type: 'directory', sort: 9,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 701, parentId: 700, title: '支付渠道', name: 'PaymentChannels', path: '/payment/channels',  component: 'payment/PaymentChannelsPage', icon: 'CreditCard', type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'payment:channel:list',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 702, parentId: 701, title: '新增渠道', name: undefined,         path: undefined,            component: undefined,                     icon: undefined,    type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'payment:channel:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 703, parentId: 701, title: '编辑渠道', name: undefined,         path: undefined,            component: undefined,                     icon: undefined,    type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'payment:channel:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 704, parentId: 701, title: '删除渠道', name: undefined,         path: undefined,            component: undefined,                     icon: undefined,    type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'payment:channel:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 710, parentId: 700, title: '支付订单', name: 'PaymentOrders',   path: '/payment/orders',    component: 'payment/PaymentOrdersPage',   icon: 'ScrollText', type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'payment:order:list',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 711, parentId: 710, title: '发起支付', name: undefined,         path: undefined,            component: undefined,                     icon: undefined,    type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'payment:order:create',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 712, parentId: 710, title: '关闭订单', name: undefined,         path: undefined,            component: undefined,                     icon: undefined,    type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'payment:order:close',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 713, parentId: 710, title: '发起退款', name: undefined,         path: undefined,            component: undefined,                     icon: undefined,    type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'payment:order:refund',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 720, parentId: 700, title: '退款记录', name: 'PaymentRefunds',  path: '/payment/refunds',   component: 'payment/PaymentRefundsPage',  icon: 'Undo2',      type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'payment:refund:list',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 730, parentId: 700, title: '回调日志', name: 'PaymentLogs',     path: '/payment/logs',      component: 'payment/PaymentLogsPage',     icon: 'FileClock',  type: 'menu',      sort: 4,  status: 'enabled', visible: true,  permission: 'payment:log:list',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 740, parentId: 700, title: '对账中心', name: 'PaymentRecon',    path: '/payment/recon',     component: 'payment/PaymentReconPage',    icon: 'FileCheck',  type: 'menu',      sort: 5,  status: 'enabled', visible: true,  permission: 'payment:recon:list',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 741, parentId: 740, title: '新建对账', name: undefined,         path: undefined,            component: undefined,                     icon: undefined,    type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'payment:recon:create',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 742, parentId: 740, title: '删除对账', name: undefined,         path: undefined,            component: undefined,                     icon: undefined,    type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'payment:recon:delete',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 743, parentId: 740, title: '处理差异', name: undefined,         path: undefined,            component: undefined,                     icon: undefined,    type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'payment:recon:handle',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 745, parentId: 700, title: '资金台账', name: 'PaymentLedger',   path: '/payment/ledger',    component: 'payment/PaymentLedgerPage',   icon: 'BookOpen',   type: 'menu',      sort: 6,  status: 'enabled', visible: true,  permission: 'payment:ledger:list',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 750, parentId: 700, title: 'Webhook',  name: 'PaymentWebhooks', path: '/payment/webhooks',  component: 'payment/PaymentWebhooksPage', icon: 'Webhook',    type: 'menu',      sort: 7,  status: 'enabled', visible: true,  permission: 'payment:webhook:list',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 751, parentId: 750, title: '新建端点', name: undefined,         path: undefined,            component: undefined,                     icon: undefined,    type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'payment:webhook:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 752, parentId: 750, title: '编辑端点', name: undefined,         path: undefined,            component: undefined,                     icon: undefined,    type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'payment:webhook:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 753, parentId: 750, title: '删除端点', name: undefined,         path: undefined,            component: undefined,                     icon: undefined,    type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'payment:webhook:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 760, parentId: 700, title: '支付事件', name: 'PaymentEvents',   path: '/payment/events',    component: 'payment/PaymentEventsPage',   icon: 'Activity',   type: 'menu',      sort: 8,  status: 'enabled', visible: true,  permission: 'payment:ops:manage',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 770, parentId: 720, title: '退款审批', name: undefined,         path: undefined,            component: undefined,                     icon: undefined,    type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'payment:refund:approve', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 支付中心 · B 档（费率 / 结算 / 分账 / 支付链接 / 风控 / 支付方式 / 报表）
  { id: 765, parentId: 700, title: '费率管理', name: 'PaymentFeeRules',  path: '/payment/fee-rules',   component: 'payment/PaymentFeeRulesPage',    icon: 'Percent',      type: 'menu',   sort: 9,  status: 'enabled', visible: true,  permission: 'payment:fee:list',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 766, parentId: 765, title: '新增费率', name: undefined,          path: undefined,              component: undefined,                        icon: undefined,      type: 'button', sort: 1,  status: 'enabled', visible: true,  permission: 'payment:fee:create',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 767, parentId: 765, title: '编辑费率', name: undefined,          path: undefined,              component: undefined,                        icon: undefined,      type: 'button', sort: 2,  status: 'enabled', visible: true,  permission: 'payment:fee:update',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 768, parentId: 765, title: '删除费率', name: undefined,          path: undefined,              component: undefined,                        icon: undefined,      type: 'button', sort: 3,  status: 'enabled', visible: true,  permission: 'payment:fee:delete',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 772, parentId: 700, title: '结算管理', name: 'PaymentSettlements', path: '/payment/settlements', component: 'payment/PaymentSettlementsPage', icon: 'Banknote',     type: 'menu',   sort: 10, status: 'enabled', visible: true,  permission: 'payment:settlement:list',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 773, parentId: 772, title: '生成结算', name: undefined,          path: undefined,              component: undefined,                        icon: undefined,      type: 'button', sort: 1,  status: 'enabled', visible: true,  permission: 'payment:settlement:generate', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 774, parentId: 772, title: '标记结算', name: undefined,          path: undefined,              component: undefined,                        icon: undefined,      type: 'button', sort: 2,  status: 'enabled', visible: true,  permission: 'payment:settlement:settle', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 775, parentId: 700, title: '分账管理', name: 'PaymentSharing',   path: '/payment/sharing',     component: 'payment/PaymentSharingPage',     icon: 'Split',        type: 'menu',   sort: 11, status: 'enabled', visible: true,  permission: 'payment:sharing:list',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 776, parentId: 775, title: '接收方管理', name: undefined,        path: undefined,              component: undefined,                        icon: undefined,      type: 'button', sort: 1,  status: 'enabled', visible: true,  permission: 'payment:sharing:manage',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 777, parentId: 775, title: '发起分账', name: undefined,          path: undefined,              component: undefined,                        icon: undefined,      type: 'button', sort: 2,  status: 'enabled', visible: true,  permission: 'payment:sharing:dispatch',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 780, parentId: 700, title: '支付链接', name: 'PaymentLinks',     path: '/payment/links',       component: 'payment/PaymentLinksPage',       icon: 'Link',         type: 'menu',   sort: 12, status: 'enabled', visible: true,  permission: 'payment:link:list',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 781, parentId: 780, title: '新增链接', name: undefined,          path: undefined,              component: undefined,                        icon: undefined,      type: 'button', sort: 1,  status: 'enabled', visible: true,  permission: 'payment:link:create',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 782, parentId: 780, title: '编辑链接', name: undefined,          path: undefined,              component: undefined,                        icon: undefined,      type: 'button', sort: 2,  status: 'enabled', visible: true,  permission: 'payment:link:update',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 783, parentId: 780, title: '删除链接', name: undefined,          path: undefined,              component: undefined,                        icon: undefined,      type: 'button', sort: 3,  status: 'enabled', visible: true,  permission: 'payment:link:delete',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 785, parentId: 700, title: '风控中心', name: 'PaymentRiskRules', path: '/payment/risk-rules',  component: 'payment/PaymentRiskRulesPage',   icon: 'ShieldAlert',  type: 'menu',   sort: 13, status: 'enabled', visible: true,  permission: 'payment:risk:list',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 786, parentId: 785, title: '新增规则', name: undefined,          path: undefined,              component: undefined,                        icon: undefined,      type: 'button', sort: 1,  status: 'enabled', visible: true,  permission: 'payment:risk:create',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 787, parentId: 785, title: '编辑规则', name: undefined,          path: undefined,              component: undefined,                        icon: undefined,      type: 'button', sort: 2,  status: 'enabled', visible: true,  permission: 'payment:risk:update',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 788, parentId: 785, title: '删除规则', name: undefined,          path: undefined,              component: undefined,                        icon: undefined,      type: 'button', sort: 3,  status: 'enabled', visible: true,  permission: 'payment:risk:delete',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 790, parentId: 700, title: '支付方式', name: 'PaymentMethods',   path: '/payment/methods',     component: 'payment/PaymentMethodsPage',     icon: 'Wallet',       type: 'menu',   sort: 14, status: 'enabled', visible: true,  permission: 'payment:method:list',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 791, parentId: 790, title: '编辑方式', name: undefined,          path: undefined,              component: undefined,                        icon: undefined,      type: 'button', sort: 1,  status: 'enabled', visible: true,  permission: 'payment:method:update',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 795, parentId: 700, title: '财务报表', name: 'PaymentReports',   path: '/payment/reports',     component: 'payment/PaymentReportsPage',     icon: 'ChartColumn',  type: 'menu',   sort: 15, status: 'enabled', visible: true,  permission: 'payment:report:view',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 796, parentId: 700, title: '转账管理', name: 'PaymentTransfers', path: '/payment/transfers',   component: 'payment/PaymentTransfersPage',   icon: 'SendHorizontal', type: 'menu', sort: 16, status: 'enabled', visible: true,  permission: 'payment:transfer:list',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 797, parentId: 796, title: '发起转账', name: undefined,          path: undefined,              component: undefined,                        icon: undefined,      type: 'button', sort: 1,  status: 'enabled', visible: true,  permission: 'payment:transfer:create',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 798, parentId: 700, title: '应用管理', name: 'PaymentApps',      path: '/payment/apps',        component: 'payment/PaymentAppsPage',        icon: 'LayoutGrid',   type: 'menu',   sort: 17, status: 'enabled', visible: true,  permission: 'payment:app:list',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 799, parentId: 798, title: '管理应用', name: undefined,          path: undefined,              component: undefined,                        icon: undefined,      type: 'button', sort: 1,  status: 'enabled', visible: true,  permission: 'payment:app:manage',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 支付中心 · 签约代扣（700 段已满，扩展使用 1600 段）
  { id: 1600, parentId: 700,  title: '签约代扣', name: 'PaymentContracts', path: '/payment/contracts',  component: 'payment/PaymentContractsPage',   icon: 'Repeat',       type: 'menu',   sort: 18, status: 'enabled', visible: true,  permission: 'payment:contract:list',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1601, parentId: 1600, title: '协议操作', name: undefined,          path: undefined,              component: undefined,                        icon: undefined,      type: 'button', sort: 1,  status: 'enabled', visible: true,  permission: 'payment:contract:manage',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1602, parentId: 1600, title: '计划管理', name: undefined,          path: undefined,              component: undefined,                        icon: undefined,      type: 'button', sort: 2,  status: 'enabled', visible: true,  permission: 'payment:contract:plan',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1603, parentId: 700,  title: '交易投诉', name: 'PaymentDisputes',  path: '/payment/disputes',    component: 'payment/PaymentDisputesPage',    icon: 'MessageSquareWarning', type: 'menu', sort: 19, status: 'enabled', visible: true, permission: 'payment:dispute:list',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1604, parentId: 1603, title: '处理投诉', name: undefined,          path: undefined,              component: undefined,                        icon: undefined,      type: 'button', sort: 1,  status: 'enabled', visible: true,  permission: 'payment:dispute:handle',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1605, parentId: 785,  title: '风控审核', name: undefined,          path: undefined,              component: undefined,                        icon: undefined,      type: 'button', sort: 4,  status: 'enabled', visible: true,  permission: 'payment:risk:review',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1606, parentId: 745,  title: '账户调账', name: undefined,          path: undefined,              component: undefined,                        icon: undefined,      type: 'button', sort: 1,  status: 'enabled', visible: true,  permission: 'payment:account:adjust',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1607, parentId: 700,  title: '预授权',   name: 'PaymentPreauths',  path: '/payment/preauths',    component: 'payment/PaymentPreauthsPage',    icon: 'Snowflake',    type: 'menu',   sort: 20, status: 'enabled', visible: true,  permission: 'payment:preauth:list',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1608, parentId: 1607, title: '预授权操作', name: undefined,        path: undefined,              component: undefined,                        icon: undefined,      type: 'button', sort: 1,  status: 'enabled', visible: true,  permission: 'payment:preauth:manage',    createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // ── 会员中心 ─────────────────────────────────────────────────────────────────
  { id: 800, parentId: 0,   title: '会员中心', name: 'MemberCenter',   path: undefined,                 component: undefined,                    icon: 'Crown',       type: 'directory', sort: 10, status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 805, parentId: 800, title: '会员看板', name: 'MemberDashboard', path: '/member/dashboard',       component: 'member/MemberDashboardPage', icon: 'LayoutDashboard', type: 'menu',  sort: 0,  status: 'enabled', visible: true,  permission: 'member:dashboard:view', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 801, parentId: 800, title: '会员管理', name: 'MemberList',     path: '/member/members',         component: 'member/MembersPage',         icon: 'UserRound',   type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'member:member:list',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 802, parentId: 801, title: '新增会员', name: undefined,        path: undefined,                 component: undefined,                    icon: undefined,     type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'member:member:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 803, parentId: 801, title: '编辑会员', name: undefined,        path: undefined,                 component: undefined,                    icon: undefined,     type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'member:member:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 804, parentId: 801, title: '删除会员', name: undefined,        path: undefined,                 component: undefined,                    icon: undefined,     type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'member:member:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 810, parentId: 800, title: '会员等级', name: 'MemberLevels',   path: '/member/levels',          component: 'member/MemberLevelsPage',    icon: 'Medal',       type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'member:level:list',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 811, parentId: 810, title: '新增等级', name: undefined,        path: undefined,                 component: undefined,                    icon: undefined,     type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'member:level:create',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 812, parentId: 810, title: '编辑等级', name: undefined,        path: undefined,                 component: undefined,                    icon: undefined,     type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'member:level:update',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 813, parentId: 810, title: '删除等级', name: undefined,        path: undefined,                 component: undefined,                    icon: undefined,     type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'member:level:delete',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 820, parentId: 800, title: '积分管理', name: 'MemberPoints',   path: '/member/points',          component: 'member/MemberPointsPage',    icon: 'Coins',       type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'member:point:list',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 821, parentId: 820, title: '调整积分', name: undefined,        path: undefined,                 component: undefined,                    icon: undefined,     type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'member:point:adjust',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 830, parentId: 800, title: '钱包管理', name: 'MemberWallets',  path: '/member/wallets',         component: 'member/MemberWalletPage',    icon: 'WalletCards', type: 'menu',      sort: 4,  status: 'enabled', visible: true,  permission: 'member:wallet:list',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 831, parentId: 830, title: '调整余额', name: undefined,        path: undefined,                 component: undefined,                    icon: undefined,     type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'member:wallet:adjust', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 832, parentId: 830, title: '退款',     name: undefined,        path: undefined,                 component: undefined,                    icon: undefined,     type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'member:wallet:refund', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 840, parentId: 800, title: '优惠券',   name: 'Coupons',        path: '/member/coupons',         component: 'member/CouponsPage',         icon: 'Ticket',      type: 'menu',      sort: 5,  status: 'enabled', visible: true,  permission: 'member:coupon:list',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 841, parentId: 840, title: '新增优惠券', name: undefined,      path: undefined,                 component: undefined,                    icon: undefined,     type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'member:coupon:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 842, parentId: 840, title: '编辑优惠券', name: undefined,      path: undefined,                 component: undefined,                    icon: undefined,     type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'member:coupon:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 843, parentId: 840, title: '删除优惠券', name: undefined,      path: undefined,                 component: undefined,                    icon: undefined,     type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'member:coupon:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 844, parentId: 840, title: '发放优惠券', name: undefined,      path: undefined,                 component: undefined,                    icon: undefined,     type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'member:coupon:issue',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 845, parentId: 840, title: '作废券码', name: undefined,        path: undefined,                 component: undefined,                    icon: undefined,     type: 'button',    sort: 5,  status: 'enabled', visible: true,  permission: 'member:coupon:revoke', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 850, parentId: 800, title: '领券记录', name: 'CouponRecords',  path: '/member/coupon-records',  component: 'member/CouponRecordsPage',   icon: 'TicketCheck', type: 'menu',      sort: 6,  status: 'enabled', visible: true,  permission: 'member:coupon:list',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 860, parentId: 800, title: '会员签到', name: 'MemberCheckin',   path: undefined,                 component: undefined,                    icon: 'CalendarCheck', type: 'directory', sort: 7, status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 861, parentId: 860, title: '签到配置', name: 'CheckinRules',    path: '/member/checkin-rules',   component: 'member/CheckinRulesPage',    icon: 'Settings', type: 'menu', sort: 1, status: 'enabled', visible: true, permission: 'member:checkin:rule:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 862, parentId: 860, title: '签到记录', name: 'CheckinLogs',     path: '/member/checkin-logs',    component: 'member/CheckinLogsPage',     icon: 'CalendarDays', type: 'menu', sort: 2, status: 'enabled', visible: true, permission: 'member:checkin:log:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 863, parentId: 861, title: '新增规则', name: undefined,         path: undefined,                 component: undefined,                    icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'member:checkin:rule:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 864, parentId: 861, title: '编辑规则', name: undefined,         path: undefined,                 component: undefined,                    icon: undefined, type: 'button', sort: 2, status: 'enabled', visible: true, permission: 'member:checkin:rule:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 865, parentId: 861, title: '删除规则', name: undefined,         path: undefined,                 component: undefined,                    icon: undefined, type: 'button', sort: 3, status: 'enabled', visible: true, permission: 'member:checkin:rule:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 866, parentId: 860, title: '里程碑配置', name: 'CheckinMilestones', path: '/member/checkin-milestones', component: 'member/CheckinMilestonesPage', icon: 'Trophy', type: 'menu', sort: 3, status: 'enabled', visible: true, permission: 'member:checkin:milestone:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 867, parentId: 866, title: '新增里程碑', name: undefined,       path: undefined,                 component: undefined,                    icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'member:checkin:milestone:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 868, parentId: 866, title: '编辑里程碑', name: undefined,       path: undefined,                 component: undefined,                    icon: undefined, type: 'button', sort: 2, status: 'enabled', visible: true, permission: 'member:checkin:milestone:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 869, parentId: 866, title: '删除里程碑', name: undefined,       path: undefined,                 component: undefined,                    icon: undefined, type: 'button', sort: 3, status: 'enabled', visible: true, permission: 'member:checkin:milestone:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 880, parentId: 861, title: '签到设置', name: undefined,         path: undefined,                 component: undefined,                    icon: undefined, type: 'button', sort: 4, status: 'enabled', visible: true, permission: 'member:checkin:setting:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 877, parentId: 862, title: '会员补签', name: undefined,         path: undefined,                 component: undefined,                    icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'member:checkin:makeup', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 878, parentId: 800, title: '登录日志', name: 'MemberLoginLogs', path: '/member/login-logs',      component: 'member/MemberLoginLogsPage', icon: 'LogIn',       type: 'menu',      sort: 8,  status: 'enabled', visible: true,  permission: 'member:loginlog:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 879, parentId: 800, title: '充值记录', name: 'MemberRecharges', path: '/member/recharges',       component: 'member/MemberRechargesPage', icon: 'CreditCard',  type: 'menu',      sort: 9,  status: 'enabled', visible: true,  permission: 'member:recharge:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // ── 公众号管理（多公众号 + 租户隔离）──
  { id: 1000, parentId: 0,    title: '公众号管理', name: 'MpCenter',   path: undefined,      component: undefined,           icon: 'MessageCircle', type: 'directory', sort: 11, status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1001, parentId: 1000, title: '公众号账号', name: 'MpAccounts', path: '/mp/accounts', component: 'mp/MpAccountsPage', icon: 'BadgeCheck',    type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'mp:account:list',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1002, parentId: 1001, title: '新增公众号', name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'mp:account:create',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1003, parentId: 1001, title: '编辑公众号', name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'mp:account:update',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1004, parentId: 1001, title: '删除公众号', name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'mp:account:delete',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1005, parentId: 1001, title: '设为默认',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'mp:account:default', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1006, parentId: 1001, title: '测试连接',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 5,  status: 'enabled', visible: true,  permission: 'mp:account:token',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1007, parentId: 1001, title: '内容安全检测', name: undefined,  path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 6,  status: 'enabled', visible: true,  permission: 'mp:security:check',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1010, parentId: 1000, title: '标签管理',   name: 'MpTags',     path: '/mp/tags',     component: 'mp/MpTagsPage',     icon: 'Tags',          type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'mp:tag:list',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1011, parentId: 1010, title: '新增标签',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'mp:tag:create',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1012, parentId: 1010, title: '编辑标签',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'mp:tag:update',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1013, parentId: 1010, title: '删除标签',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'mp:tag:delete',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1014, parentId: 1010, title: '同步标签',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'mp:tag:sync',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1020, parentId: 1000, title: '粉丝管理',   name: 'MpFans',     path: '/mp/fans',     component: 'mp/MpFansPage',     icon: 'Users',         type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'mp:fan:list',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1021, parentId: 1020, title: '同步粉丝',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'mp:fan:sync',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1022, parentId: 1020, title: '编辑粉丝',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'mp:fan:update',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1023, parentId: 1020, title: '会员绑定',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'mp:fan:bind',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1024, parentId: 1020, title: '黑名单管理', name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'mp:fan:blacklist',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1030, parentId: 1000, title: '消息管理',   name: 'MpMessages', path: '/mp/messages', component: 'mp/MpMessagesPage', icon: 'MessagesSquare', type: 'menu',      sort: 4,  status: 'enabled', visible: true,  permission: 'mp:message:list',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1031, parentId: 1030, title: '发送消息',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'mp:message:send',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1040, parentId: 1000, title: '自动回复',   name: 'MpAutoReplies', path: '/mp/auto-replies', component: 'mp/MpAutoRepliesPage', icon: 'Reply',     type: 'menu',      sort: 5,  status: 'enabled', visible: true,  permission: 'mp:reply:list',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1041, parentId: 1040, title: '新增回复',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'mp:reply:create',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1042, parentId: 1040, title: '编辑回复',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'mp:reply:update',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1043, parentId: 1040, title: '删除回复',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'mp:reply:delete',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1050, parentId: 1000, title: '自定义菜单', name: 'MpMenu',     path: '/mp/menu',     component: 'mp/MpMenuPage',     icon: 'Menu',          type: 'menu',      sort: 6,  status: 'enabled', visible: true,  permission: 'mp:menu:list',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1051, parentId: 1050, title: '保存菜单',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'mp:menu:save',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1052, parentId: 1050, title: '发布菜单',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'mp:menu:publish',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1053, parentId: 1050, title: '拉取菜单',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'mp:menu:pull',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1054, parentId: 1050, title: '删除菜单',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'mp:menu:delete',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1060, parentId: 1000, title: '素材管理',   name: 'MpMaterials', path: '/mp/materials', component: 'mp/MpMaterialsPage', icon: 'Image',       type: 'menu',      sort: 7,  status: 'enabled', visible: true,  permission: 'mp:material:list',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1061, parentId: 1060, title: '新增素材',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'mp:material:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1062, parentId: 1060, title: '重命名素材', name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'mp:material:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1063, parentId: 1060, title: '删除素材',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'mp:material:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1064, parentId: 1060, title: '同步素材',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'mp:material:sync',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1070, parentId: 1000, title: '图文草稿',   name: 'MpDrafts',   path: '/mp/drafts',   component: 'mp/MpDraftsPage',   icon: 'Newspaper',     type: 'menu',      sort: 8,  status: 'enabled', visible: true,  permission: 'mp:draft:list',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1071, parentId: 1070, title: '新增图文',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'mp:draft:create',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1072, parentId: 1070, title: '编辑图文',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'mp:draft:update',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1073, parentId: 1070, title: '删除图文',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'mp:draft:delete',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1074, parentId: 1070, title: '推送图文',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'mp:draft:push',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1080, parentId: 1000, title: '模板消息',   name: 'MpTemplates', path: '/mp/template-messages', component: 'mp/MpTemplateMessagesPage', icon: 'MailCheck', type: 'menu', sort: 9, status: 'enabled', visible: true, permission: 'mp:template:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1081, parentId: 1080, title: '同步模板',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'mp:template:sync',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1082, parentId: 1080, title: '发送模板',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'mp:template:send',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1083, parentId: 1080, title: '删除模板',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'mp:template:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1090, parentId: 1000, title: '数据统计',   name: 'MpStatistics', path: '/mp/statistics', component: 'mp/MpStatisticsPage', icon: 'BarChart3', type: 'menu', sort: 10, status: 'enabled', visible: true, permission: 'mp:statistics:view', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1120, parentId: 1000, title: '群发消息',   name: 'MpBroadcasts', path: '/mp/broadcasts', component: 'mp/MpBroadcastsPage', icon: 'Send', type: 'menu', sort: 11, status: 'enabled', visible: true, permission: 'mp:broadcast:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1121, parentId: 1120, title: '新增群发',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'mp:broadcast:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1122, parentId: 1120, title: '编辑群发',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'mp:broadcast:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1123, parentId: 1120, title: '发送群发',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'mp:broadcast:send',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1124, parentId: 1120, title: '删除群发',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'mp:broadcast:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1130, parentId: 1000, title: '带参二维码', name: 'MpQrcodes',  path: '/mp/qrcodes',  component: 'mp/MpQrcodesPage',  icon: 'QrCode',        type: 'menu',      sort: 12, status: 'enabled', visible: true,  permission: 'mp:qrcode:list',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1131, parentId: 1130, title: '生成二维码', name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'mp:qrcode:create',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1132, parentId: 1130, title: '删除二维码', name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'mp:qrcode:delete',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1140, parentId: 1000, title: '网页授权',   name: 'MpOAuth',    path: '/mp/oauth',    component: 'mp/MpOAuthPage',     icon: 'KeyRound',      type: 'menu',      sort: 13, status: 'enabled', visible: true,  permission: 'mp:oauth:build',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1141, parentId: 1140, title: 'JS-SDK签名', name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'mp:jssdk:config',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1150, parentId: 1000, title: '多客服',     name: 'MpKfAccounts', path: '/mp/kf-accounts', component: 'mp/MpKfAccountsPage', icon: 'Headphones', type: 'menu',  sort: 14, status: 'enabled', visible: true,  permission: 'mp:kf:list',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1151, parentId: 1150, title: '添加客服',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'mp:kf:create',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1152, parentId: 1150, title: '编辑客服',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'mp:kf:update',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1153, parentId: 1150, title: '删除客服',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'mp:kf:delete',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1154, parentId: 1150, title: '同步客服',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'mp:kf:sync',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1160, parentId: 1000, title: '会话工作台', name: 'MpKfSessions', path: '/mp/kf-sessions', component: 'mp/MpKfSessionsPage', icon: 'Headset', type: 'menu',   sort: 15, status: 'enabled', visible: true,  permission: 'mp:kf:session:list',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1161, parentId: 1160, title: '接入会话',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'mp:kf:session:accept',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1162, parentId: 1160, title: '转接会话',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'mp:kf:session:transfer', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1163, parentId: 1160, title: '结束会话',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'mp:kf:session:close',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1164, parentId: 1160, title: '会话回复',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'mp:kf:session:reply',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1165, parentId: 1160, title: '路由配置',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 5,  status: 'enabled', visible: true,  permission: 'mp:kf:session:config',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1170, parentId: 1000, title: '个性化菜单', name: 'MpConditionalMenus', path: '/mp/conditional-menus', component: 'mp/MpConditionalMenusPage', icon: 'ListTree', type: 'menu', sort: 16, status: 'enabled', visible: true, permission: 'mp:condmenu:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1171, parentId: 1170, title: '新增菜单',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'mp:condmenu:create',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1172, parentId: 1170, title: '编辑菜单',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'mp:condmenu:update',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1173, parentId: 1170, title: '发布菜单',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'mp:condmenu:publish', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1174, parentId: 1170, title: '删除菜单',   name: undefined,    path: undefined,      component: undefined,           icon: undefined,       type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'mp:condmenu:delete',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // ── 业务接入示例（请假，业务模块自有实体 + 工作流编排）──
  { id: 900, parentId: 0,   title: '业务示例', name: 'BizDemo',          path: undefined,        component: undefined,            icon: 'Briefcase',     type: 'directory', sort: 12, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 901, parentId: 900, title: '请假管理', name: 'BizLeave',         path: '/biz/leave',     component: 'biz/leave/LeavePage', icon: 'CalendarClock', type: 'menu',      sort: 1,  status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 902, parentId: 900, title: '支付接入示例', name: 'BizPayDemo',     path: '/biz/pay-demo',  component: 'biz/pay-demo/PayDemoPage', icon: 'Wallet',     type: 'menu',      sort: 2,  status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 903, parentId: 900, title: '异步任务示例', name: 'BizTaskDemo',    path: '/biz/task-demo', component: 'biz/task-demo/TaskDemoPage', icon: 'ListTodo', type: 'menu',      sort: 3,  status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // ── 报表中心（通用报表设计器 / 数据大屏）──────────────────────────────────────
  { id: 1200, parentId: 0,    title: '报表中心', name: 'ReportCenter',      path: undefined,              component: undefined,                  icon: 'BarChart3',      type: 'directory', sort: 13, status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1210, parentId: 1200, title: '数据源',   name: 'ReportDatasources', path: '/report/datasources',  component: 'report/DataSourcesPage',   icon: 'Database',       type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'report:datasource:list',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1211, parentId: 1210, title: '新增数据源', name: undefined,         path: undefined,              component: undefined,                  icon: undefined,        type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'report:datasource:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1212, parentId: 1210, title: '编辑数据源', name: undefined,         path: undefined,              component: undefined,                  icon: undefined,        type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'report:datasource:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1213, parentId: 1210, title: '删除数据源', name: undefined,         path: undefined,              component: undefined,                  icon: undefined,        type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'report:datasource:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1220, parentId: 1200, title: '数据集',   name: 'ReportDatasets',    path: '/report/datasets',     component: 'report/DatasetsPage',      icon: 'Layers',         type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'report:dataset:list',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1221, parentId: 1220, title: '新增数据集', name: undefined,         path: undefined,              component: undefined,                  icon: undefined,        type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'report:dataset:create',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1222, parentId: 1220, title: '编辑数据集', name: undefined,         path: undefined,              component: undefined,                  icon: undefined,        type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'report:dataset:update',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1223, parentId: 1220, title: '删除数据集', name: undefined,         path: undefined,              component: undefined,                  icon: undefined,        type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'report:dataset:delete',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1230, parentId: 1200, title: '仪表盘',   name: 'ReportDashboards',  path: '/report/dashboards',   component: 'report/DashboardListPage', icon: 'LayoutDashboard', type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'report:dashboard:list',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1231, parentId: 1230, title: '新增仪表盘', name: undefined,         path: undefined,              component: undefined,                  icon: undefined,        type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'report:dashboard:create',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1232, parentId: 1230, title: '编辑仪表盘', name: undefined,         path: undefined,              component: undefined,                  icon: undefined,        type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'report:dashboard:update',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1233, parentId: 1230, title: '删除仪表盘', name: undefined,         path: undefined,              component: undefined,                  icon: undefined,        type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'report:dashboard:delete',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1240, parentId: 1200, title: '订阅推送', name: 'ReportSubscriptions', path: '/report/subscriptions', component: 'report/SubscriptionsPage', icon: 'BellRing',     type: 'menu',      sort: 4,  status: 'enabled', visible: true,  permission: 'report:subscription:list',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1241, parentId: 1240, title: '新增订阅', name: undefined,         path: undefined,              component: undefined,                  icon: undefined,        type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'report:subscription:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1242, parentId: 1240, title: '编辑订阅', name: undefined,         path: undefined,              component: undefined,                  icon: undefined,        type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'report:subscription:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1243, parentId: 1240, title: '删除订阅', name: undefined,         path: undefined,              component: undefined,                  icon: undefined,        type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'report:subscription:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1250, parentId: 1200, title: '打印报表', name: 'ReportPrintTemplates', path: '/report/print',     component: 'report/PrintTemplatesPage', icon: 'Printer',      type: 'menu',      sort: 5,  status: 'enabled', visible: true,  permission: 'report:print:list',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1251, parentId: 1250, title: '新增打印报表', name: undefined,       path: undefined,              component: undefined,                  icon: undefined,        type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'report:print:create',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1252, parentId: 1250, title: '编辑打印报表', name: undefined,       path: undefined,              component: undefined,                  icon: undefined,        type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'report:print:update',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1253, parentId: 1250, title: '删除打印报表', name: undefined,       path: undefined,              component: undefined,                  icon: undefined,        type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'report:print:delete',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1260, parentId: 1200, title: '数据预警', name: 'ReportAlerts',     path: '/report/alerts',       component: 'report/AlertsPage',        icon: 'BellPlus',     type: 'menu',      sort: 6,  status: 'enabled', visible: true,  permission: 'report:alert:list',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1261, parentId: 1260, title: '新增预警', name: undefined,         path: undefined,              component: undefined,                  icon: undefined,        type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'report:alert:create',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1262, parentId: 1260, title: '编辑预警', name: undefined,         path: undefined,              component: undefined,                  icon: undefined,        type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'report:alert:update',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1263, parentId: 1260, title: '删除预警', name: undefined,         path: undefined,              component: undefined,                  icon: undefined,        type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'report:alert:delete',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1400, parentId: 1200, title: '指标中心', name: 'ReportMetrics',    path: '/report/metrics',       component: 'report/MetricsPage',       icon: 'Target',         type: 'menu',      sort: 7,  status: 'enabled', visible: true,  permission: 'report:metric:list',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1401, parentId: 1400, title: '新增指标', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'report:metric:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1402, parentId: 1400, title: '编辑指标', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 2, status: 'enabled', visible: true, permission: 'report:metric:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1403, parentId: 1400, title: '删除指标', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 3, status: 'enabled', visible: true, permission: 'report:metric:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1404, parentId: 1400, title: '评估指标', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 4, status: 'enabled', visible: true, permission: 'report:metric:evaluate', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1405, parentId: 1400, title: '发布指标', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 5, status: 'enabled', visible: true, permission: 'report:metric:publish', createdAt: SEED_DATE, updatedAt: SEED_DATE },

  { id: 1410, parentId: 1200, title: '数据质量', name: 'ReportQuality',    path: '/report/quality',       component: 'report/QualityPage',       icon: 'BadgeCheck',     type: 'menu',      sort: 8,  status: 'enabled', visible: true,  permission: 'report:dq:list',            createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1411, parentId: 1410, title: '新增质量规则', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'report:dq:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1412, parentId: 1410, title: '编辑质量规则', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 2, status: 'enabled', visible: true, permission: 'report:dq:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1413, parentId: 1410, title: '删除质量规则', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 3, status: 'enabled', visible: true, permission: 'report:dq:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1414, parentId: 1410, title: '执行质量规则', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 4, status: 'enabled', visible: true, permission: 'report:dq:run', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1415, parentId: 1410, title: '导出质量记录', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 5, status: 'enabled', visible: true, permission: 'report:dq:export', createdAt: SEED_DATE, updatedAt: SEED_DATE },

  { id: 1420, parentId: 1200, title: '资源治理', name: 'ReportGovernance', path: '/report/governance',    component: 'report/ReportGovernancePage', icon: 'ShieldCheck', type: 'menu', sort: 9, status: 'enabled', visible: true, permission: 'report:folder:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1421, parentId: 1420, title: '新增资源目录', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'report:folder:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1422, parentId: 1420, title: '编辑资源目录', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 2, status: 'enabled', visible: true, permission: 'report:folder:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1423, parentId: 1420, title: '删除资源目录', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 3, status: 'enabled', visible: true, permission: 'report:folder:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1424, parentId: 1420, title: '管理资源权限', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 4, status: 'enabled', visible: true, permission: 'report:resource:acl', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1425, parentId: 1420, title: '查看有效权限', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 5, status: 'enabled', visible: true, permission: 'report:resource:access', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1426, parentId: 1420, title: '转移资源所有权', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 6, status: 'enabled', visible: true, permission: 'report:resource:transfer', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1427, parentId: 1420, title: '查看发布审批', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 7, status: 'enabled', visible: true, permission: 'report:approval:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1428, parentId: 1420, title: '申请发布审批', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 8, status: 'enabled', visible: true, permission: 'report:approval:request', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1429, parentId: 1420, title: '处理发布审批', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 9, status: 'enabled', visible: true, permission: 'report:approval:approve', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1430, parentId: 1420, title: '查看报表环境', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 10, status: 'enabled', visible: true, permission: 'report:environment:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1431, parentId: 1420, title: '新增报表环境', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 11, status: 'enabled', visible: true, permission: 'report:environment:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1432, parentId: 1420, title: '编辑报表环境', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 12, status: 'enabled', visible: true, permission: 'report:environment:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1433, parentId: 1420, title: '删除报表环境', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 13, status: 'enabled', visible: true, permission: 'report:environment:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1434, parentId: 1420, title: '环境发布回滚', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 14, status: 'enabled', visible: true, permission: 'report:environment:promote', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1435, parentId: 1420, title: '查看物化快照', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 15, status: 'enabled', visible: true, permission: 'report:materialization:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1436, parentId: 1420, title: '刷新物化快照', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 16, status: 'enabled', visible: true, permission: 'report:materialization:refresh', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1437, parentId: 1420, title: '清理物化快照', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 17, status: 'enabled', visible: true, permission: 'report:materialization:purge', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1438, parentId: 1420, title: '查看查询配额', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 18, status: 'enabled', visible: true, permission: 'report:query-quota:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1439, parentId: 1420, title: '新增查询配额', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 19, status: 'enabled', visible: true, permission: 'report:query-quota:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1440, parentId: 1420, title: '编辑查询配额', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 20, status: 'enabled', visible: true, permission: 'report:query-quota:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1441, parentId: 1420, title: '删除查询配额', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 21, status: 'enabled', visible: true, permission: 'report:query-quota:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1442, parentId: 1420, title: '查看查询成本', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 22, status: 'enabled', visible: true, permission: 'report:query-cost:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1443, parentId: 1420, title: '查看 SLA', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 23, status: 'enabled', visible: true, permission: 'report:sla:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1444, parentId: 1420, title: '新增 SLA', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 24, status: 'enabled', visible: true, permission: 'report:sla:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1445, parentId: 1420, title: '编辑 SLA', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 25, status: 'enabled', visible: true, permission: 'report:sla:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1446, parentId: 1420, title: '删除 SLA', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 26, status: 'enabled', visible: true, permission: 'report:sla:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1447, parentId: 1420, title: '评估 SLA', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 27, status: 'enabled', visible: true, permission: 'report:sla:evaluate', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1448, parentId: 1420, title: '导出查询成本', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 28, status: 'enabled', visible: true, permission: 'report:query-cost:export', createdAt: SEED_DATE, updatedAt: SEED_DATE },

  { id: 1460, parentId: 1200, title: '资产目录', name: 'ReportAssets', path: '/report/assets', component: 'report/AssetsPage', icon: 'Library', type: 'menu', sort: 10, status: 'enabled', visible: true, permission: 'report:asset:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1461, parentId: 1460, title: '查看资产用量', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'report:asset:usage', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1462, parentId: 1460, title: '查看弃用公告', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 2, status: 'enabled', visible: true, permission: 'report:deprecation:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1463, parentId: 1460, title: '新增弃用公告', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 3, status: 'enabled', visible: true, permission: 'report:deprecation:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1464, parentId: 1460, title: '编辑弃用公告', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 4, status: 'enabled', visible: true, permission: 'report:deprecation:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1465, parentId: 1460, title: '发布弃用公告', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 5, status: 'enabled', visible: true, permission: 'report:deprecation:publish', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1466, parentId: 1460, title: '删除弃用公告', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 6, status: 'enabled', visible: true, permission: 'report:deprecation:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1467, parentId: 1460, title: '查看资产模板', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 7, status: 'enabled', visible: true, permission: 'report:asset-template:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1468, parentId: 1460, title: '新增资产模板', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 8, status: 'enabled', visible: true, permission: 'report:asset-template:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1469, parentId: 1460, title: '编辑资产模板', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 9, status: 'enabled', visible: true, permission: 'report:asset-template:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1470, parentId: 1460, title: '应用资产模板', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 10, status: 'enabled', visible: true, permission: 'report:asset-template:apply', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1471, parentId: 1460, title: '删除资产模板', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 11, status: 'enabled', visible: true, permission: 'report:asset-template:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1472, parentId: 1460, title: '导出资产目录', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 12, status: 'enabled', visible: true, permission: 'report:asset:export', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1480, parentId: 1200, title: '智能问数', name: 'ReportChatBi', path: '/report/chatbi', component: 'report/ChatBiPage', icon: 'MessageSquareText', type: 'menu', sort: 11, status: 'enabled', visible: true, permission: 'report:chatbi:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1481, parentId: 1480, title: '创建问数会话', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'report:chatbi:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1482, parentId: 1480, title: '编辑问数会话', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 2, status: 'enabled', visible: true, permission: 'report:chatbi:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1483, parentId: 1480, title: '删除问数会话', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 3, status: 'enabled', visible: true, permission: 'report:chatbi:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1484, parentId: 1480, title: '执行智能问数', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 4, status: 'enabled', visible: true, permission: 'report:chatbi:ask', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1485, parentId: 1480, title: '保存问数结果', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 5, status: 'enabled', visible: true, permission: 'report:chatbi:save', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1486, parentId: 1480, title: '查看问数审计', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 6, status: 'enabled', visible: true, permission: 'report:chatbi:audit', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1487, parentId: 1480, title: '管理问数配额', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 7, status: 'enabled', visible: true, permission: 'report:chatbi:manage', createdAt: SEED_DATE, updatedAt: SEED_DATE },

  { id: 1500, parentId: 1200, title: '填报模板', name: 'ReportFillTemplates', path: '/report/fill-templates', component: 'report/FillTemplatesPage', icon: 'ClipboardList', type: 'menu', sort: 12, status: 'enabled', visible: true, permission: 'report:fill:template:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1501, parentId: 1500, title: '新增填报模板', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'report:fill:template:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1502, parentId: 1500, title: '编辑填报模板', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 2, status: 'enabled', visible: true, permission: 'report:fill:template:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1503, parentId: 1500, title: '发布/下线模板', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 3, status: 'enabled', visible: true, permission: 'report:fill:template:publish', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1504, parentId: 1500, title: '克隆填报模板', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 4, status: 'enabled', visible: true, permission: 'report:fill:template:clone', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1505, parentId: 1500, title: '删除填报模板', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 5, status: 'enabled', visible: true, permission: 'report:fill:template:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },

  { id: 1520, parentId: 1200, title: '填报记录', name: 'ReportFillRecords', path: '/report/fill-records', component: 'report/FillRecordsPage', icon: 'ListChecks', type: 'menu', sort: 13, status: 'enabled', visible: true, permission: 'report:fill:record:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1521, parentId: 1520, title: '创建填报记录', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 1, status: 'enabled', visible: true, permission: 'report:fill:record:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1522, parentId: 1520, title: '编辑填报记录', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 2, status: 'enabled', visible: true, permission: 'report:fill:record:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1523, parentId: 1520, title: '提交填报记录', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 3, status: 'enabled', visible: true, permission: 'report:fill:record:submit', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1524, parentId: 1520, title: '撤回填报记录', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 4, status: 'enabled', visible: true, permission: 'report:fill:record:cancel', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1525, parentId: 1520, title: '审核填报记录', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 5, status: 'enabled', visible: true, permission: 'report:fill:record:review', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1526, parentId: 1520, title: '导出填报记录', name: undefined, path: undefined, component: undefined, icon: undefined, type: 'button', sort: 6, status: 'enabled', visible: true, permission: 'report:fill:record:export', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // ─── 开放平台 / 开发者门户 ────────────────────────────────────────────────────
  { id: 1300, parentId: 0,    title: '开放平台',   name: 'OpenPlatform',  path: undefined,                       component: undefined,                                   icon: 'Boxes',         type: 'directory', sort: 14, status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1305, parentId: 1300, title: '我的应用',   name: 'OpenMyApps',    path: '/open-platform/my-apps',        component: 'open-platform/my-apps/MyAppsPage',          icon: 'AppWindow',     type: 'menu',      sort: 1,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1310, parentId: 1300, title: 'API Scope',  name: 'OpenApiScopes', path: '/open-platform/api-scopes',     component: 'open-platform/api-scopes/ApiScopesPage',    icon: 'KeySquare',     type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'open:scope:view',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1311, parentId: 1310, title: '管理 Scope', name: undefined,       path: undefined,                       component: undefined,                                   icon: undefined,       type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'open:scope:manage',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1320, parentId: 1300, title: '限流套餐',   name: 'OpenRatePlans', path: '/open-platform/rate-plans',     component: 'open-platform/rate-plans/RatePlansPage',    icon: 'Gauge',         type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'open:rate-plan:view',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1321, parentId: 1320, title: '管理套餐',   name: undefined,       path: undefined,                       component: undefined,                                   icon: undefined,       type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'open:rate-plan:manage', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1330, parentId: 1300, title: '调用统计',   name: 'OpenApiStats',  path: '/open-platform/stats',          component: 'open-platform/stats/OpenApiStatsPage',      icon: 'LineChart',     type: 'menu',      sort: 4,  status: 'enabled', visible: true,  permission: 'open:stats:view',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1340, parentId: 1300, title: '签名验签',   name: 'OpenSignature', path: '/open-platform/signature',      component: 'open-platform/signature/SignatureToolPage', icon: 'FileSignature', type: 'menu',      sort: 5,  status: 'enabled', visible: true,  permission: 'open:signature:use',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1350, parentId: 1300, title: 'Webhook 订阅', name: 'OpenWebhooks',  path: '/open-platform/webhooks',       component: 'open-platform/webhooks/WebhooksPage',       icon: 'Webhook',       type: 'menu',      sort: 6,  status: 'enabled', visible: true,  permission: 'open:webhook:view',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1351, parentId: 1350, title: '管理 Webhook', name: undefined,      path: undefined,                       component: undefined,                                   icon: undefined,       type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'open:webhook:manage',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1360, parentId: 1300, title: 'SDK 示例',   name: 'OpenSdk',       path: '/open-platform/sdk',            component: 'open-platform/sdk/SdkExamplesPage',         icon: 'Code2',         type: 'menu',      sort: 7,  status: 'enabled', visible: true,  permission: 'open:sdk:view',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1380, parentId: 1300, title: 'API 调试台', name: 'OpenApiDebug',  path: '/open-platform/debug',          component: 'open-platform/debug/ApiDebugConsolePage',   icon: 'Terminal',      type: 'menu',      sort: 8,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // ─── CMS 内容管理（1700 段）────────────────────────────────────────────────────
  { id: 1700, parentId: 0,    title: 'CMS 内容管理', name: 'CmsCenter',        path: undefined,          component: undefined,                    icon: 'Newspaper',    type: 'directory', sort: 15, status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1701, parentId: 1700, title: '数据看板',     name: 'CmsDashboard',     path: '/cms/dashboard',   component: 'cms/CmsDashboardPage',       icon: 'LayoutDashboard', type: 'menu',   sort: 0,  status: 'enabled', visible: true,  permission: 'cms:dashboard:view', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1705, parentId: 1700, title: '站点管理',     name: 'CmsSites',         path: '/cms/sites',       component: 'cms/SitesPage',              icon: 'Globe',        type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'cms:site:list',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1706, parentId: 1705, title: '新增站点',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'cms:site:create',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1707, parentId: 1705, title: '编辑站点',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'cms:site:update',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1708, parentId: 1705, title: '删除站点',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'cms:site:delete',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1795, parentId: 1700, title: '发布通道',     name: 'CmsPublishChannels', path: '/cms/publish-channels', component: 'cms/PublishChannelsPage', icon: 'Radio',   type: 'menu',      sort: 17, status: 'enabled', visible: true,  permission: 'cms:publish-channel:list',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1796, parentId: 1795, title: '新增通道',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'cms:publish-channel:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1797, parentId: 1795, title: '编辑通道',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'cms:publish-channel:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1798, parentId: 1795, title: '删除通道',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'cms:publish-channel:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1710, parentId: 1700, title: '栏目管理',     name: 'CmsChannels',      path: '/cms/channels',    component: 'cms/ChannelsPage',           icon: 'FolderTree',   type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'cms:channel:list',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1711, parentId: 1710, title: '新增栏目',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'cms:channel:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1712, parentId: 1710, title: '编辑栏目',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'cms:channel:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1713, parentId: 1710, title: '删除栏目',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'cms:channel:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1715, parentId: 1700, title: '内容管理',     name: 'CmsContents',      path: '/cms/contents',    component: 'cms/ContentsPage',           icon: 'FileText',     type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'cms:content:list',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1716, parentId: 1715, title: '新增内容',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'cms:content:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1717, parentId: 1715, title: '编辑内容',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'cms:content:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1718, parentId: 1715, title: '删除内容',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'cms:content:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1719, parentId: 1715, title: '发布内容',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'cms:content:publish', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1720, parentId: 1715, title: '审核内容',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 5,  status: 'enabled', visible: true,  permission: 'cms:content:audit',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1799, parentId: 1715, title: '锁定内容',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 6,  status: 'enabled', visible: true,  permission: 'cms:content:lock',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1721, parentId: 1715, title: '内容编辑页',   name: 'CmsContentEdit',   path: '/cms/contents/edit', component: 'cms/ContentEditPage',      icon: undefined,      type: 'menu',      sort: 7,  status: 'enabled', visible: false, permission: 'cms:content:list',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1746, parentId: 1700, title: '素材中心',     name: 'CmsResources',     path: '/cms/resources',   component: 'cms/ResourcesPage',          icon: 'Image',        type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'cms:resource:list',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1747, parentId: 1746, title: '上传素材',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'cms:resource:upload', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1748, parentId: 1746, title: '编辑素材',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'cms:resource:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1749, parentId: 1746, title: '删除素材',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'cms:resource:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1725, parentId: 1700, title: '内容模型',     name: 'CmsModels',        path: '/cms/models',      component: 'cms/ModelsPage',             icon: 'Blocks',       type: 'menu',      sort: 4,  status: 'enabled', visible: true,  permission: 'cms:model:list',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1726, parentId: 1725, title: '新增模型',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'cms:model:create',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1727, parentId: 1725, title: '编辑模型',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'cms:model:update',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1728, parentId: 1725, title: '删除模型',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'cms:model:delete',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1730, parentId: 1700, title: '标签管理',     name: 'CmsTags',          path: '/cms/tags',        component: 'cms/TagsPage',               icon: 'Tags',         type: 'menu',      sort: 5,  status: 'enabled', visible: true,  permission: 'cms:tag:list',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1731, parentId: 1730, title: '新增标签',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'cms:tag:create',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1732, parentId: 1730, title: '编辑标签',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'cms:tag:update',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1733, parentId: 1730, title: '删除标签',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'cms:tag:delete',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1735, parentId: 1700, title: '碎片管理',     name: 'CmsFragments',     path: '/cms/fragments',   component: 'cms/FragmentsPage',          icon: 'Puzzle',       type: 'menu',      sort: 6,  status: 'enabled', visible: true,  permission: 'cms:fragment:list',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1736, parentId: 1735, title: '新增碎片',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'cms:fragment:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1737, parentId: 1735, title: '编辑碎片',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'cms:fragment:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1738, parentId: 1735, title: '删除碎片',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'cms:fragment:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1740, parentId: 1700, title: '友情链接',     name: 'CmsFriendLinks',   path: '/cms/friend-links', component: 'cms/FriendLinksPage',       icon: 'Link2',        type: 'menu',      sort: 7,  status: 'enabled', visible: true,  permission: 'cms:link:list',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1741, parentId: 1740, title: '新增友链',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'cms:link:create',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1742, parentId: 1740, title: '编辑友链',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'cms:link:update',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1743, parentId: 1740, title: '删除友链',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'cms:link:delete',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1745, parentId: 1705, title: '全站静态化',   name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'cms:publish:build',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1750, parentId: 1700, title: '检索管理',     name: 'CmsSearch',        path: '/cms/search',      component: 'cms/SearchAdminPage',        icon: 'SearchCheck',  type: 'menu',      sort: 9,  status: 'enabled', visible: true,  permission: 'cms:search:manage',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1755, parentId: 1700, title: 'SEO 管理',     name: 'CmsSeo',           path: '/cms/seo',         component: 'cms/SeoPage',                icon: 'TrendingUp',   type: 'menu',      sort: 10, status: 'enabled', visible: true,  permission: 'cms:seo:manage',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1756, parentId: 1755, title: '搜索引擎推送', name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'cms:seo:push',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1760, parentId: 1700, title: '评论管理',     name: 'CmsComments',      path: '/cms/comments',    component: 'cms/CommentsPage',           icon: 'MessageSquare', type: 'menu',     sort: 11, status: 'enabled', visible: true,  permission: 'cms:comment:list',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1761, parentId: 1760, title: '审核评论',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'cms:comment:audit',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1762, parentId: 1760, title: '删除评论',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'cms:comment:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1765, parentId: 1700, title: '广告管理',     name: 'CmsAds',           path: '/cms/ads',         component: 'cms/AdsPage',                icon: 'Megaphone',    type: 'menu',      sort: 12, status: 'enabled', visible: true,  permission: 'cms:ad:list',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1766, parentId: 1765, title: '管理广告',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'cms:ad:manage',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1770, parentId: 1700, title: '表单管理',     name: 'CmsForms',         path: '/cms/forms',       component: 'cms/FormsPage',              icon: 'ClipboardList', type: 'menu',     sort: 13, status: 'enabled', visible: true,  permission: 'cms:form:list',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1771, parentId: 1770, title: '管理表单',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'cms:form:manage',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1775, parentId: 1700, title: '敏感词库',     name: 'CmsSensitiveWords', path: '/cms/sensitive-words', component: 'cms/SensitiveWordsPage', icon: 'ShieldAlert',  type: 'menu',      sort: 14, status: 'enabled', visible: true,  permission: 'cms:sensitive:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1776, parentId: 1775, title: '管理敏感词',   name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'cms:sensitive:manage', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1790, parentId: 1700, title: '易错词库',     name: 'CmsErrorProneWords', path: '/cms/error-prone-words', component: 'cms/ErrorProneWordsPage', icon: 'SpellCheck', type: 'menu',  sort: 18, status: 'enabled', visible: true,  permission: 'cms:word:list',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1791, parentId: 1790, title: '管理易错词',   name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'cms:word:manage',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1792, parentId: 1700, title: '问卷调查',     name: 'CmsSurveys',       path: '/cms/surveys',     component: 'cms/SurveysPage',            icon: 'ListChecks',   type: 'menu',      sort: 19, status: 'enabled', visible: true,  permission: 'cms:survey:list',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1793, parentId: 1792, title: '管理问卷',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'cms:survey:manage',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1751, parentId: 1700, title: '投票管理',     name: 'CmsPolls',         path: '/cms/polls',       component: 'cms/PollsPage',              icon: 'Vote',         type: 'menu',      sort: 19, status: 'enabled', visible: true,  permission: 'cms:poll:list',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1752, parentId: 1751, title: '管理投票',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'cms:poll:manage',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1794, parentId: 1700, title: '访问统计',     name: 'CmsStats',         path: '/cms/stats',       component: 'cms/StatsPage',              icon: 'ChartLine',    type: 'menu',      sort: 20, status: 'enabled', visible: true,  permission: 'cms:stat:view',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1780, parentId: 1700, title: '采集中心',     name: 'CmsCollect',       path: '/cms/collect',     component: 'cms/CollectPage',            icon: 'Download',     type: 'menu',      sort: 15, status: 'enabled', visible: true,  permission: 'cms:collect:list',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1781, parentId: 1780, title: '新增规则',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'cms:collect:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1782, parentId: 1780, title: '编辑规则',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'cms:collect:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1783, parentId: 1780, title: '删除规则',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'cms:collect:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1784, parentId: 1780, title: '执行采集',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'cms:collect:run',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1785, parentId: 1700, title: '页面搭建',     name: 'CmsPages',         path: '/cms/pages',       component: 'cms/PagesPage',              icon: 'LayoutTemplate', type: 'menu',    sort: 16, status: 'enabled', visible: true,  permission: 'cms:page:list',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1786, parentId: 1785, title: '新增页面',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'cms:page:create',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1787, parentId: 1785, title: '编辑页面',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'cms:page:update',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1788, parentId: 1785, title: '删除页面',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'cms:page:delete',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1800, parentId: 1700, title: '模板与主题',   name: 'CmsThemes',        path: '/cms/themes',      component: 'cms/ThemesPage',             icon: 'PanelsTopLeft', type: 'menu',     sort: 21, status: 'enabled', visible: true,  permission: 'cms:theme:view',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1801, parentId: 1800, title: '导入主题包',   name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'cms:theme:import',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1802, parentId: 1800, title: '激活主题包',   name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'cms:theme:activate',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1803, parentId: 1800, title: '导出主题包',   name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'cms:theme:export',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1804, parentId: 1800, title: '查看模板',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'cms:template:view',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1805, parentId: 1800, title: '管理模板',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 5,  status: 'enabled', visible: true,  permission: 'cms:template:manage',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1806, parentId: 1800, title: '激活模板',     name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 6,  status: 'enabled', visible: true,  permission: 'cms:template:activate', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1810, parentId: 1700, title: '发布中心',     name: 'CmsPublishing',    path: '/cms/publishing',  component: 'cms/PublishingPage',         icon: 'Rocket',       type: 'menu',      sort: 22, status: 'enabled', visible: true,  permission: 'cms:publish:view',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1811, parentId: 1810, title: '管理发布任务', name: undefined,          path: undefined,          component: undefined,                    icon: undefined,      type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'cms:publish:manage',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
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
    menuIds: [1, 202, 203, 310, 315],
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
    menuIds: SEED_MENUS.filter((menu) => menu.id >= 1700 && menu.id < 1900).map((menu) => menu.id),
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

// ─── 字典 ─────────────────────────────────────────────────────────────────────

export const SEED_DICTS: Dict[] = [
  { id: 1, name: '通用状态',     code: 'common_status',         description: '通用启用/禁用状态',  status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, name: '菜单类型',     code: 'menu_type',             description: '菜单节点类型',       status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4, name: '用户性别',     code: 'user_gender',           description: '用户性别',           status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 5, name: '显示状态',     code: 'menu_visible',          description: '菜单显示/隐藏状态',  status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 6, name: '公告类型',     code: 'announcement_type',           description: '公告类型',       status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 7, name: '公告发布状态', code: 'announcement_publish_status', description: '公告的发布状态', status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 8, name: '公告优先级',   code: 'announcement_priority',       description: '公告优先级',     status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 9, name: '系统配置类型', code: 'system_config_type',    description: '系统配置项值类型',   status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 10, name: '部门类别',   code: 'department_category',   description: '部门类别',           status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 11, name: '请假类型',   code: 'leave_type',            description: '请假申请的类型（业务示例）', status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 12, name: 'AI 点踩理由', code: 'ai_dislike_reason',    description: 'AI 对话点踩时的理由选项', status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 13, name: 'AI 敏感词', code: 'ai_sensitive_word',     description: 'AI 对话输入侧敏感词过滤词库（配合 ai_content_filter_enabled 开关）', status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 字典项 ───────────────────────────────────────────────────────────────────

export const SEED_DICT_ITEMS: DictItem[] = [
  // 通用状态 (dictId: 1)
  { id: 1,  dictId: 1, label: '启用',   value: 'enabled',      color: 'green',  sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2,  dictId: 1, label: '禁用',   value: 'disabled',     color: 'grey',   sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 菜单类型 (dictId: 3)
  { id: 3,  dictId: 3, label: '目录',   value: 'directory',    color: 'blue',   sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4,  dictId: 3, label: '菜单',   value: 'menu',         color: 'green',  sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 5,  dictId: 3, label: '按钮',   value: 'button',       color: 'orange', sort: 3, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 用户性别 (dictId: 4)
  { id: 6,  dictId: 4, label: '男',     value: 'male',         color: 'blue',   sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 7,  dictId: 4, label: '女',     value: 'female',       color: 'pink',   sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 8,  dictId: 4, label: '保密',   value: 'secret',       color: 'grey',   sort: 3, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 显示状态 (dictId: 5)
  { id: 9,  dictId: 5, label: '显示',   value: 'show',         color: 'green',  sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 10, dictId: 5, label: '隐藏',   value: 'hidden',       color: 'grey',   sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 公告类型 (dictId: 6)
  { id: 11, dictId: 6, label: '通知',   value: 'notice',       color: 'blue',   sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 12, dictId: 6, label: '公告',   value: 'announcement', color: 'cyan',   sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 13, dictId: 6, label: '警告',   value: 'warning',      color: 'orange', sort: 3, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 公告发布状态 (dictId: 7)
  { id: 14, dictId: 7, label: '草稿',   value: 'draft',        color: 'grey',   sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 15, dictId: 7, label: '已发布', value: 'published',    color: 'green',  sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 16, dictId: 7, label: '已撤回', value: 'recalled',     color: 'orange', sort: 3, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 公告优先级 (dictId: 8)
  { id: 17, dictId: 8, label: '低',     value: 'low',          color: 'grey',   sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 18, dictId: 8, label: '中',     value: 'medium',       color: 'blue',   sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19, dictId: 8, label: '高',     value: 'high',         color: 'red',    sort: 3, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 系统配置类型 (dictId: 9)
  { id: 20, dictId: 9, label: '字符串', value: 'string',       color: 'blue',   sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 21, dictId: 9, label: '数字',   value: 'number',       color: 'green',  sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 22, dictId: 9, label: '布尔值', value: 'boolean',      color: 'orange', sort: 3, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 23, dictId: 9, label: 'JSON',   value: 'json',         color: 'cyan',   sort: 4, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 公告发布状态扩展 (dictId: 7)
  { id: 24, dictId: 7, label: '定时发布', value: 'scheduled',   color: 'blue',   sort: 4, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 部门类别 (dictId: 10)
  { id: 25, dictId: 10, label: '集团',   value: 'group',       color: 'purple', sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 26, dictId: 10, label: '公司',   value: 'company',     color: 'blue',   sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 27, dictId: 10, label: '部门',   value: 'department',  color: 'green',  sort: 3, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 请假类型 (dictId: 11)
  { id: 28, dictId: 11, label: '年假',   value: 'annual',      color: 'green',  sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 29, dictId: 11, label: '病假',   value: 'sick',        color: 'orange', sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 30, dictId: 11, label: '事假',   value: 'personal',    color: 'blue',   sort: 3, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 31, dictId: 11, label: '婚假',   value: 'marriage',    color: 'pink',   sort: 4, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 32, dictId: 11, label: '其他',   value: 'other',       color: 'grey',   sort: 5, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // AI 点踩理由 (dictId: 12)
  { id: 33, dictId: 12, label: '不准确', value: 'inaccurate',  color: 'red',    sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 34, dictId: 12, label: '不相关', value: 'irrelevant',  color: 'orange', sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 35, dictId: 12, label: '有害信息', value: 'harmful',   color: 'violet', sort: 3, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 36, dictId: 12, label: '其他',   value: 'other',       color: 'grey',   sort: 4, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // AI 敏感词 (dictId: 13) —— 示例词条，value 即敏感词本身
  { id: 37, dictId: 13, label: '示例敏感词', value: '示例敏感词', color: 'red', sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 系统配置 ─────────────────────────────────────────────────────────────────

export const SEED_SYSTEM_CONFIGS: SystemConfig[] = [
  { id: 1, configKey: 'captcha_enabled',            configValue: 'false',        configType: 'boolean', description: '是否开启登录验证码',                createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, configKey: 'site_name',                  configValue: 'Zenith Admin', configType: 'string',  description: '站点名称，显示在浏览器标签页',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, configKey: 'user_default_password',      configValue: '123456',       configType: 'string',  description: '新增用户时的默认密码',               createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4, configKey: 'login_max_attempts',         configValue: '10',           configType: 'number',  description: '登录失败最大次数，超出后锁定账号',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 5, configKey: 'login_lock_duration_minutes',   configValue: '30',    configType: 'number',  description: '账号锁定时长（分钟）',               createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 6, configKey: 'password_min_length',           configValue: '6',     configType: 'number',  description: '密码最小长度',                       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 7, configKey: 'password_require_uppercase',    configValue: 'false', configType: 'boolean', description: '密码是否必须包含大写字母',            createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 8, configKey: 'password_require_special_char', configValue: 'false', configType: 'boolean', description: '密码是否必须包含特殊字符',            createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 9, configKey: 'password_expiry_enabled',       configValue: 'false', configType: 'boolean', description: '是否开启密码过期强制重置',            createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 10, configKey: 'password_expiry_days',         configValue: '90',    configType: 'number',  description: '密码过期天数',                       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 11, configKey: 'allow_registration',           configValue: 'false', configType: 'boolean', description: '是否允许新用户注册',                 createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 12, configKey: 'forgot_password_enabled',       configValue: 'false', configType: 'boolean', description: '是否开启忘记密码/邮件重置功能',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 13, configKey: 'watermark_enabled',             configValue: 'false', configType: 'boolean', description: '是否开启页面水印（防截图泄漏）',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 14, configKey: 'watermark_content',             configValue: '',      configType: 'string',  description: '水印文本内容，留空则自动显示当前用户名', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 15, configKey: 'watermark_font_size',           configValue: '14',    configType: 'number',  description: '水印字体大小（px）',                 createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 16, configKey: 'watermark_opacity',             configValue: '15',    configType: 'number',  description: '水印透明度（1-100，实际值除以100）',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 17, configKey: 'quick_chat_enabled',            configValue: 'false', configType: 'boolean', description: '是否显示快捷聊天按钮（全局开关，关闭后偏好设置中的相关选项也同步隐藏）', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 18, configKey: 'ai_allow_user_custom_key',      configValue: 'false', configType: 'boolean', description: '是否允许用户配置自己的 AI API Key（关闭时所有用户均使用系统默认服务商）', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19, configKey: 'file_upload_validate_type',     configValue: 'true',  configType: 'boolean', description: '上传文件时基于 magic bytes 校验真实文件类型（防止伪造 MIME type 绕过校验）', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 20, configKey: 'file_upload_allowed_types',     configValue: 'image/*,video/*,audio/*,application/pdf,text/plain,application/zip,application/x-zip-compressed,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-excel,application/msword,application/vnd.ms-powerpoint', configType: 'string', description: '允许上传的文件 MIME 类型，逗号分隔，支持通配符（如 image/*）；设为 */* 或 * 则允许所有类型', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 21, configKey: 'terminal_recording_enabled',  configValue: 'false', configType: 'boolean', description: '是否启用 Web 终端录屏（关闭后终端操作不再自动录制）',              createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 22, configKey: 'terminal_recording_retain_days', configValue: '30',  configType: 'number',  description: '终端录屏保留天数，超过此天数的录屏将在每日清理任务中删除（0 表示不按天数清理）', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 23, configKey: 'terminal_recording_max_size_mb', configValue: '500', configType: 'number',  description: '终端录屏总容量上限（MB），超出上限后按时间从旧到新删除（0 表示不限制容量）',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 24, configKey: 'file_upload_max_size_mb',       configValue: '0',     configType: 'number',  description: '单个文件上传大小上限（MB），0 表示不限制；超过该值的上传（含分片上传）将被拒绝', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 25, configKey: 'upload_session_ttl_hours',      configValue: '24',    configType: 'number',  description: '分片上传会话保留时长（小时）；超过该时长仍未完成的会话及其临时分片将被定时清理', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 26, configKey: 'mfa_enabled',                    configValue: 'false', configType: 'boolean', description: '是否启用 MFA 多因素认证',              createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 27, configKey: 'mfa_mode',                       configValue: 'off',   configType: 'string',  description: 'MFA 模式：off/optional/required',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 28, configKey: 'mfa_remember_device_days',       configValue: '30',    configType: 'number',  description: '可信设备免 MFA 天数',                    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 29, configKey: 'login_risk_enabled',             configValue: 'false', configType: 'boolean', description: '是否启用登录风险策略',                    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 30, configKey: 'login_risk_new_device_action',   configValue: 'allow', configType: 'string',  description: '新设备登录动作：allow/challenge',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 31, configKey: 'member_point_expire_days',       configValue: '0',     configType: 'number',  description: '会员积分不活跃过期天数：账户超过 N 天无任何积分变动时余额自动过期清零（expire 流水可审计），0 表示积分永不过期', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 32, configKey: 'member_login_log_retention_days', configValue: '180',  configType: 'number',  description: '会员登录日志保留天数，超期日志由每日例行维护任务删除，0 表示不清理', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 33, configKey: 'member_birthday_points',         configValue: '0',     configType: 'number',  description: '会员生日礼积分：生日当天自动发放的积分数量（每年一次，流水 bizType=birthday），0 表示不发放', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 34, configKey: 'member_birthday_coupon_id',      configValue: '0',     configType: 'number',  description: '会员生日礼优惠券模板 ID：生日当天自动发放该券（每年一次），0 表示不发放', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 35, configKey: 'member_invite_reward_points',    configValue: '0',     configType: 'number',  description: '邀请奖励积分：新会员通过邀请码注册成功后发给邀请人的积分（流水 bizType=invite），0 表示不奖励', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 36, configKey: 'feedback_entry_enabled',         configValue: 'false', configType: 'boolean', description: '是否显示意见反馈入口（用户头像下拉菜单），关闭后用户无法提交反馈', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 37, configKey: 'captcha_complexity',             configValue: 'medium', configType: 'string', description: '验证码复杂度：low（干扰少、易识别）/ medium（默认）/ high（干扰强、识别难度高），仅在开启登录验证码后生效', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 38, configKey: 'ai_daily_token_quota',           configValue: '0',     configType: 'number',  description: '每用户每日 AI 对话 token 配额（输入+输出合计），0 表示不限制；超限后当日无法继续对话', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 39, configKey: 'ai_content_filter_enabled',      configValue: 'false', configType: 'boolean', description: '是否启用 AI 对话输入侧敏感词过滤（词库维护在字典「AI 敏感词」中，命中直接拒绝发送）', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 40, configKey: 'ai_embedding_model',             configValue: '',      configType: 'string',  description: '知识库向量化 embedding 模型名称（使用系统默认 AI 服务商的 /embeddings 接口）；留空则知识库退化为关键词检索', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 41, configKey: 'ai_image_model',                 configValue: '',      configType: 'string',  description: '图片生成模型名称（使用系统默认 AI 服务商的 /images/generations 接口）；留空则关闭 generate_image 工具', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 42, configKey: 'rule_publish_approval',          configValue: 'false', configType: 'boolean', description: '决策表发布审批（四眼原则）：开启后发布需先提交申请，由具有「审批发布」权限的其他用户批准后生效', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 限流规则 ─────────────────────────────────────────────────────────────────

export const SEED_RATE_LIMIT_RULES = [
  {
    name: 'analytics-ingest',
    description: '匿名埋点事件上报限流',
    windowMs: 60 * 1000,
    limit: 120,
    keyType: 'ip' as const,
    enabled: true,
    blockedMessage: '埋点上报过于频繁，请稍后再试',
    pathPatterns: [],
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    name: 'error-report',
    description: '匿名前端错误上报限流',
    windowMs: 60 * 1000,
    limit: 60,
    keyType: 'ip' as const,
    enabled: true,
    blockedMessage: '错误上报过于频繁，请稍后再试',
    pathPatterns: [],
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    name: 'workflow_public_callback',
    description: '工作流公开回调接口限流',
    windowMs: 60 * 1000,
    limit: 120,
    keyType: 'ip_path' as const,
    enabled: true,
    blockedMessage: '工作流回调请求过于频繁，请稍后再试',
    pathPatterns: [
      '/api/public/workflow/external-callback/*',
      '/api/public/workflow/trigger-callback/*',
    ],
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    name: 'report_public_share',
    description: '报表公开分享访问限流（无需登录，防滥用/防爆破）',
    windowMs: 60 * 1000,
    limit: 120,
    keyType: 'ip' as const,
    enabled: true,
    blockedMessage: '访问过于频繁，请稍后再试',
    pathPatterns: ['/api/report/public/*'],
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    name: 'chat_send',
    description: '聊天消息发送限流（按用户）',
    windowMs: 60 * 1000,
    limit: 60,
    keyType: 'user' as const,
    enabled: true,
    blockedMessage: '消息发送过于频繁，请稍后再试',
    pathPatterns: [],
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    name: 'ai_chat_send',
    description: 'AI 对话发送限流（按用户）',
    windowMs: 60 * 1000,
    limit: 15,
    keyType: 'user' as const,
    enabled: true,
    blockedMessage: 'AI 对话过于频繁，请稍后再试',
    pathPatterns: [],
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    name: 'ai_share_view',
    description: 'AI 对话分享页访问限流（无需登录，防滥用）',
    windowMs: 60 * 1000,
    limit: 60,
    keyType: 'ip' as const,
    enabled: true,
    blockedMessage: '访问过于频繁，请稍后再试',
    pathPatterns: [],
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

// ─── 定时任务 ─────────────────────────────────────────────────────────────────

export const SEED_CRON_JOBS: CronJob[] = [
  {
    id: 1,
    name: '清理过期验证码',
    cronExpression: '0 */30 * * * *',
    handler: 'cleanExpiredCaptchas',
    params: null,
    status: 'enabled',
    description: '每30分钟清理过期的验证码',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: '2024-01-01 00:30:00',
    lastRunStatus: 'success',
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 2,
    name: '清理过期会话',
    cronExpression: '0 0 * * * *',
    handler: 'cleanExpiredSessions',
    params: null,
    status: 'enabled',
    description: '每小时清理超过8小时无活动的会话',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: '2024-01-01 01:00:00',
    lastRunStatus: 'success',
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 4,
    name: '定时公告自动发布',
    cronExpression: '*/5 * * * *',
    handler: 'publishScheduledAnnouncements',
    params: null,
    status: 'enabled',
    description: '每 5 分钟检查并自动发布到期的定时公告',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 5,
    name: '清理过期终端录屏',
    cronExpression: '0 4 * * *',
    handler: 'cleanupTerminalRecordings',
    params: null,
    status: 'enabled',
    description: '每天凌晨 4 点根据系统配置（保留天数 / 容量上限）自动清理终端录屏',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 6,
    name: '补投支付事件',
    cronExpression: '0 * * * * *',
    handler: 'dispatchPaymentEvents',
    params: null,
    status: 'enabled',
    description: '每分钟补投支付/退款成功的 outbox 事件，确保进程崩溃后履约不丢失',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 7,
    name: '关闭过期支付订单',
    cronExpression: '0 */5 * * * *',
    handler: 'closeExpiredPaymentOrders',
    params: null,
    status: 'enabled',
    description: '每5分钟关闭已过期仍未支付的订单',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 8,
    name: '支付对账',
    cronExpression: '0 */10 * * * *',
    handler: 'paymentReconciliation',
    params: null,
    status: 'enabled',
    description: '每10分钟对支付中的订单主动查单，纠正状态（回调兜底）',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 9,
    name: '行为数据每日聚合',
    cronExpression: '0 0 1 * * *',
    handler: 'analyticsRollupDaily',
    params: '2',
    status: 'enabled',
    description: '每天 01:00 重建埋点每日聚合（趋势提速）',
    retryCount: 1,
    retryInterval: 60,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 10,
    name: '行为/错误数据保留清理',
    cronExpression: '0 0 2 * * *',
    handler: 'analyticsRetention',
    params: null,
    status: 'enabled',
    description: '每天 02:00 按保留策略清理过期埋点/会话/错误数据',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 11,
    name: '错误告警评估',
    cronExpression: '0 */5 * * * *',
    handler: 'evaluateErrorAlerts',
    params: null,
    status: 'enabled',
    description: '每5分钟评估错误告警规则并触发通知',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 12,
    name: '系统指标采样',
    cronExpression: '0 * * * * *',
    handler: 'sampleSystemMetrics',
    params: null,
    status: 'enabled',
    description: '每分钟将系统监控指标快照落库，用于历史趋势与容量规划',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 13,
    name: '监控告警评估',
    cronExpression: '30 * * * * *',
    handler: 'evaluateMonitorAlerts',
    params: null,
    status: 'enabled',
    description: '每分钟评估系统监控告警规则，达阈触发、恢复解除',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 14,
    name: '清理系统指标采样',
    cronExpression: '0 10 4 * * *',
    handler: 'cleanupSystemMetrics',
    params: '30',
    status: 'enabled',
    description: '每天凌晨 4:10 清理超过保留天数（默认 30 天，与历史趋势「近 30 天」范围对齐）的系统指标采样',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 15,
    name: '清理过期分片上传',
    cronExpression: '0 30 4 * * *',
    handler: 'cleanupUploadSessions',
    params: null,
    status: 'enabled',
    description: '每天凌晨 4:30 清理超过保留时长（upload_session_ttl_hours，默认 24 小时）仍未完成的分片上传会话、临时分片与孤儿目录',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 19,
    name: '报表订阅推送分发',
    cronExpression: '30 * * * * *',
    handler: 'dispatchReportSubscriptions',
    params: null,
    status: 'enabled',
    description: '每分钟扫描启用的报表订阅，按各自 Cron 判断到期并推送仪表盘指标摘要（邮件/站内信）',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 20,
    name: '报表物化快照刷新',
    cronExpression: '15 * * * * *',
    handler: 'refreshReportMaterializations',
    params: null,
    status: 'enabled',
    description: '每分钟扫描启用物化的数据集，按各自 Cron 判断到期并刷新快照（给大屏/高频报表降压）',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 21,
    name: '报表数据预警评估',
    cronExpression: '45 * * * * *',
    handler: 'dispatchReportAlerts',
    params: null,
    status: 'enabled',
    description: '每分钟扫描启用的数据预警规则，按各自 Cron 判断到期并评估阈值，触发时通知（站内信/邮件）',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 22,
    name: '重试失败分账单',
    cronExpression: '0 */10 * * * *',
    handler: 'retryFailedSharing',
    params: null,
    status: 'enabled',
    description: '每10分钟重试渠道调用失败的分账单（渠道未受理且未达重试上限），防止分账单永久卡在失败态',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 23,
    name: 'T+1 自动结算',
    cronExpression: '0 10 1 * * *',
    handler: 'generateDailySettlements',
    params: null,
    status: 'enabled',
    description: '每日 01:10 为昨日账期按渠道×租户自动生成结算批次（无交易跳过，已生成幂等跳过）',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 24,
    name: '同步处理中转账单',
    cronExpression: '0 */5 * * * *',
    handler: 'syncPaymentTransfers',
    params: null,
    status: 'enabled',
    description: '每5分钟查询渠道转账结果，同步处理中转账单的终态（成功/失败）',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 25,
    name: '自动拉取渠道账单对账',
    cronExpression: '0 0 2 * * *',
    handler: 'autoPaymentRecon',
    params: null,
    status: 'enabled',
    description: '每日 02:00 拉取昨日渠道账单自动对账（沙箱渠道生成模拟账单；已有批次跳过）',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 26,
    name: '支付报表快照重建',
    cronExpression: '0 20 0 * * *',
    handler: 'rebuildPaymentReportDaily',
    params: '2',
    status: 'enabled',
    description: '每日 00:20 重建近 2 天财务报表日切快照（历史查询走快照降实时聚合压力）',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 27,
    name: '执行到期签约代扣',
    cronExpression: '0 * * * * *',
    handler: 'executeDueDeductions',
    params: null,
    status: 'enabled',
    description: '每分钟扫描已签约且到期的代扣协议执行周期扣款（失败次日重试，达上限自动暂停）',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 28,
    name: '同步渠道交易投诉',
    cronExpression: '0 */5 * * * *',
    handler: 'syncPaymentDisputes',
    params: null,
    status: 'enabled',
    description: '每5分钟拉取渠道投诉单（沙箱渠道对近期成功订单生成模拟投诉，演示用）',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 29,
    name: '清理决策执行记录',
    cronExpression: '0 20 4 * * *',
    handler: 'cleanupRuleExecutions',
    params: '90',
    status: 'enabled',
    description: '每天凌晨 4:20 清理超过保留天数（默认 90 天）的规则中心决策执行记录，防止流水表无界膨胀',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

// ─── 工作流表单库 ───────────────────────────────────────────────────────────────

export const SEED_WORKFLOW_FORMS: WorkflowForm[] = [
  {
    id: 1,
    name: '请假申请表',
    code: 'leave_request',
    description: '员工请假申请通用表单，覆盖年假、病假、事假等场景',
    categoryId: null,
    schema: {
      fields: [
        { key: 'leaveType', label: '请假类型', type: 'select', required: true, options: ['年假', '病假', '事假', '陪产假', '婚假'] },
        { key: 'leaveDates', label: '开始结束日期', type: 'dateRange', required: true, dateFormat: 'yyyy-MM-dd' },
        { key: 'days', label: '请假天数', type: 'number', required: true, unit: '天', min: 0.5, precision: 1, daysFromKey: 'leaveDates' },
        { key: 'reason', label: '请假事由', type: 'textarea', required: true, maxLength: 500 },
      ],
      settings: { description: '请如实填写请假时间与事由，提交后将进入主管审批。', submitButtonText: '提交请假申请', labelPosition: 'top' },
    },
    status: 'enabled',
    revision: 1,
    tenantId: 1,
    createdBy: 1,
    createdByName: '张三',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 2,
    name: '报销申请表',
    code: 'expense_request',
    description: '日常费用、差旅费用报销申请表',
    categoryId: null,
    schema: {
      fields: [
        { key: 'expenseType', label: '报销类型', type: 'select', required: true, options: ['差旅费', '交通费', '餐饮费', '办公用品', '其他'] },
        { key: 'amount', label: '报销金额', type: 'amount', required: true, currency: 'CNY', precision: 2, min: 0, unit: '元' },
        { key: 'totalAmount', label: '预计总金额', type: 'formula', formula: '{amount}', precision: 2, unit: '元', helpText: '用于金额条件审批判断' },
        { key: 'occurDate', label: '发生日期', type: 'date', required: true, dateFormat: 'yyyy-MM-dd' },
        { key: 'description', label: '费用说明', type: 'textarea', required: true, maxLength: 500 },
        { key: 'receipts', label: '票据附件', type: 'attachment', required: true, maxCount: 10, helpText: '请上传发票、行程单等凭证' },
      ],
      settings: { description: '请确认票据真实有效，金额将按审批流程自动流转。', submitButtonText: '提交报销申请', labelPosition: 'top' },
    },
    status: 'enabled',
    revision: 1,
    tenantId: 1,
    createdBy: 1,
    createdByName: '张三',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 3,
    name: '采购申请表',
    code: 'purchase_request',
    description: '设备、物资采购审批表单',
    categoryId: null,
    schema: {
      fields: [
        { key: 'itemName', label: '采购物品', type: 'text', required: true, maxLength: 100 },
        { key: 'quantity', label: '数量', type: 'number', required: true, min: 1, precision: 0, unit: '件' },
        { key: 'estimatedCost', label: '预估金额', type: 'amount', required: true, currency: 'CNY', precision: 2, min: 0, unit: '元' },
        { key: 'purpose', label: '用途说明', type: 'textarea', required: true, maxLength: 500 },
        { key: 'attachments', label: '采购附件', type: 'attachment', maxCount: 5 },
      ],
      settings: { description: '请填写采购用途并上传报价单等附件。', submitButtonText: '提交采购申请', labelPosition: 'top' },
    },
    status: 'enabled',
    revision: 1,
    tenantId: 1,
    createdBy: 2,
    createdByName: '李四',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

// ─── 工作流内置模板 ─────────────────────────────────────────────────────────

export interface SeedWorkflowTemplate {
  id: number;
  name: string;
  code: string;
  description: string;
  categoryName: string | null;
  icon: string | null;
  color: string | null;
  flowData: Record<string, unknown>;
  formSchema: Record<string, unknown> | null;
  sort: number;
  builtin: boolean;
  tenantId: number | null;
  createdAt: string;
  updatedAt: string;
}

interface SeedFlowStep {
  key: string;
  name: string;
  nodeType?: 'approver' | 'handler' | 'cc';
  props?: Record<string, unknown>;
}

const APPROVER_DEFAULT_PROPS: Record<string, unknown> = {
  approvalType: 'manual',
  approveMethod: 'or',
  rejectStrategy: 'terminate',
  emptyStrategy: 'autoApprove',
  operations: ['approve', 'reject', 'comment'],
  fieldPermissions: {},
};

function mapSeedNodeType(t: 'approver' | 'handler' | 'cc'): string {
  if (t === 'handler') return 'handler';
  if (t === 'cc') return 'ccNode';
  return 'approve';
}

/**
 * 构造线性流程的 flowData（含设计器 process 树 + 引擎 nodes/edges 扁平结构）。
 * 与 packages/web 的 designer/utils.ts treeToFlat() 对线性链的输出保持一致：
 * nodes 顺序固定为 [start, end, ...审批节点]，data.key 即节点 key。
 */
function buildLinearFlow(steps: SeedFlowStep[], settings?: Record<string, unknown>): Record<string, unknown> {
  let child: Record<string, unknown> | undefined;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    const nodeType = s.nodeType ?? 'approver';
    const props = nodeType === 'approver' ? { ...APPROVER_DEFAULT_PROPS, ...(s.props ?? {}) } : { ...(s.props ?? {}) };
    child = { id: s.key, key: s.key, type: nodeType, name: s.name, props, children: child };
  }
  const process = {
    initiator: { id: 'initiator', type: 'initiator', name: '发起人', props: { fieldPermissions: {} }, children: child },
  };

  const nodes: Array<Record<string, unknown>> = [
    { id: 'node-start', type: 'workflowNode', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '发起' } },
    { id: 'node-end', type: 'workflowNode', position: { x: 0, y: 0 }, data: { key: 'end', type: 'end', label: '结束' } },
  ];
  const edges: Array<Record<string, unknown>> = [];
  let prevId = 'node-start';
  for (const s of steps) {
    const nodeType = s.nodeType ?? 'approver';
    const flatId = `node-${s.key}`;
    const props = nodeType === 'approver' ? { ...APPROVER_DEFAULT_PROPS, ...(s.props ?? {}) } : { ...(s.props ?? {}) };
    nodes.push({ id: flatId, type: 'workflowNode', position: { x: 0, y: 0 }, data: { key: s.key, type: mapSeedNodeType(nodeType), label: s.name, ...props } });
    edges.push({ id: `e-${prevId}-${flatId}`, source: prevId, target: flatId });
    prevId = flatId;
  }
  edges.push({ id: `e-${prevId}-node-end`, source: prevId, target: 'node-end' });

  const flow: Record<string, unknown> = { process, nodes, edges };
  if (settings) flow.settings = settings;
  return flow;
}

const TEMPLATE_SETTINGS: Record<string, unknown> = { allowWithdraw: true, allowComment: true, serialNo: { enabled: false } };

// ─── 表单远程数据源 初始数据 ───────────────────────────────────────────────
export const SEED_WORKFLOW_DATA_SOURCES: WorkflowDataSource[] = [
  {
    id: 1,
    name: '示例-用户列表',
    method: 'GET',
    url: 'https://jsonplaceholder.typicode.com/users',
    headers: null,
    itemsPath: null,
    valueField: 'id',
    labelField: 'name',
    keywordParam: null,
    status: 'enabled',
    remark: '公共测试接口，演示远程数据源',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

export const SEED_WORKFLOW_CONNECTORS = [
  {
    id: 1,
    name: '示例 HTTP（httpbin）',
    code: 'demo_httpbin',
    description: '公共回声 API，用于连接器演示与一键测试',
    type: 'http' as const,
    config: { baseUrl: 'https://httpbin.org', method: 'GET' as const, authType: 'none' as const },
    timeoutMs: 10000,
    retryMax: 0,
    circuitBreakerEnabled: true,
    failureThreshold: 5,
    cooldownSec: 60,
    rateLimitEnabled: false,
    rateLimitWindowSec: 1,
    rateLimitMax: 0,
    status: 'enabled' as const,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

export const SEED_WORKFLOW_TEMPLATES: SeedWorkflowTemplate[] = [
  {
    id: 1,
    name: '请假审批',
    code: 'tpl_leave',
    description: '员工请假申请，提交后由直属主管审批。',
    categoryName: '人事行政',
    icon: 'CalendarDays',
    color: '#52c41a',
    flowData: buildLinearFlow([
      { key: 'approve_manager', name: '直属主管审批', props: { assigneeType: 'manager', managerLevel: 1 } },
    ], { ...TEMPLATE_SETTINGS, summaryFields: ['leaveType', 'leaveDates', 'days'] }),
    formSchema: SEED_WORKFLOW_FORMS[0].schema as unknown as Record<string, unknown>,
    sort: 1,
    builtin: true,
    tenantId: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 2,
    name: '报销审批',
    code: 'tpl_expense',
    description: '费用报销申请，直属主管 + 部门负责人两级审批。',
    categoryName: '财务报销',
    icon: 'Receipt',
    color: '#fa8c16',
    flowData: buildLinearFlow([
      { key: 'approve_manager', name: '直属主管审批', props: { assigneeType: 'manager', managerLevel: 1 } },
      { key: 'approve_dept_head', name: '部门负责人审批', props: { assigneeType: 'department' } },
    ], { ...TEMPLATE_SETTINGS, summaryFields: ['expenseType', 'amount', 'occurDate'] }),
    formSchema: SEED_WORKFLOW_FORMS[1].schema as unknown as Record<string, unknown>,
    sort: 2,
    builtin: true,
    tenantId: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 3,
    name: '采购申请',
    code: 'tpl_purchase',
    description: '物资/设备采购申请，直属主管审批后抄送发起人。',
    categoryName: '采购审批',
    icon: 'ShoppingCart',
    color: '#1890ff',
    flowData: buildLinearFlow([
      { key: 'approve_manager', name: '直属主管审批', props: { assigneeType: 'manager', managerLevel: 1 } },
      { key: 'cc_initiator', name: '抄送发起人', nodeType: 'cc', props: { assigneeType: 'initiator', onlyOnApprove: true, fieldPermissions: {} } },
    ], TEMPLATE_SETTINGS),
    formSchema: SEED_WORKFLOW_FORMS[2].schema as unknown as Record<string, unknown>,
    sort: 3,
    builtin: true,
    tenantId: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 4,
    name: '加班申请',
    code: 'tpl_overtime',
    description: '员工加班申请，直属主管审批。',
    categoryName: '人事行政',
    icon: 'Clock',
    color: '#13c2c2',
    flowData: buildLinearFlow([
      { key: 'approve_manager', name: '直属主管审批', props: { assigneeType: 'manager', managerLevel: 1 } },
    ], TEMPLATE_SETTINGS),
    formSchema: {
      fields: [
        { key: 'overtimeDate', label: '加班日期', type: 'date', required: true, dateFormat: 'yyyy-MM-dd' },
        { key: 'overtimeRange', label: '加班时间段', type: 'text', required: true, maxLength: 50, placeholder: '如 18:00-21:00' },
        { key: 'hours', label: '加班时长(小时)', type: 'number', required: true, min: 0.5, precision: 1, unit: '小时' },
        { key: 'reason', label: '加班事由', type: 'textarea', required: true, maxLength: 500 },
      ],
      settings: { description: '请如实填写加班时间与事由。', submitButtonText: '提交加班申请', labelPosition: 'top' },
    },
    sort: 4,
    builtin: true,
    tenantId: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 5,
    name: '外出申请',
    code: 'tpl_outing',
    description: '因公外出报备，直属主管审批后抄送发起人。',
    categoryName: '人事行政',
    icon: 'MapPin',
    color: '#2f54eb',
    flowData: buildLinearFlow([
      { key: 'approve_manager', name: '直属主管审批', props: { assigneeType: 'manager', managerLevel: 1 } },
      { key: 'cc_initiator', name: '抄送发起人', nodeType: 'cc', props: { assigneeType: 'initiator', onlyOnApprove: true, fieldPermissions: {} } },
    ], TEMPLATE_SETTINGS),
    formSchema: {
      fields: [
        { key: 'outDates', label: '外出时间', type: 'dateRange', required: true, dateFormat: 'yyyy-MM-dd HH:mm' },
        { key: 'destination', label: '外出地点', type: 'text', required: true, maxLength: 100 },
        { key: 'reason', label: '外出事由', type: 'textarea', required: true, maxLength: 500 },
      ],
      settings: { description: '因公外出请提前报备。', submitButtonText: '提交外出申请', labelPosition: 'top' },
    },
    sort: 5,
    builtin: true,
    tenantId: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 6,
    name: '转正申请',
    code: 'tpl_regular',
    description: '试用期转正，直属主管 + 部门负责人两级审批。',
    categoryName: '人事行政',
    icon: 'UserCheck',
    color: '#52c41a',
    flowData: buildLinearFlow([
      { key: 'approve_manager', name: '直属主管评估', props: { assigneeType: 'manager', managerLevel: 1 } },
      { key: 'approve_dept_head', name: '部门负责人审批', props: { assigneeType: 'department' } },
    ], TEMPLATE_SETTINGS),
    formSchema: {
      fields: [
        { key: 'entryDate', label: '入职日期', type: 'date', required: true, dateFormat: 'yyyy-MM-dd' },
        { key: 'regularDate', label: '期望转正日期', type: 'date', required: true, dateFormat: 'yyyy-MM-dd' },
        { key: 'summary', label: '试用期工作总结', type: 'textarea', required: true, maxLength: 1000 },
        { key: 'attachments', label: '附件', type: 'attachment', maxCount: 5 },
      ],
      settings: { description: '请填写试用期工作总结。', submitButtonText: '提交转正申请', labelPosition: 'top' },
    },
    sort: 6,
    builtin: true,
    tenantId: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 7,
    name: '用章申请',
    code: 'tpl_seal',
    description: '公司用章/盖章申请，直属主管 + 部门负责人审批。',
    categoryName: '人事行政',
    icon: 'Stamp',
    color: '#fa541c',
    flowData: buildLinearFlow([
      { key: 'approve_manager', name: '直属主管审批', props: { assigneeType: 'manager', managerLevel: 1 } },
      { key: 'approve_dept_head', name: '部门负责人审批', props: { assigneeType: 'department' } },
    ], TEMPLATE_SETTINGS),
    formSchema: {
      fields: [
        { key: 'sealType', label: '印章类型', type: 'select', required: true, options: ['公章', '合同章', '财务章', '法人章'] },
        { key: 'useFor', label: '用章事由', type: 'textarea', required: true, maxLength: 500 },
        { key: 'count', label: '盖章份数', type: 'number', required: true, min: 1, precision: 0, unit: '份' },
        { key: 'files', label: '待盖章文件', type: 'attachment', required: true, maxCount: 10 },
      ],
      settings: { description: '请上传待盖章文件并说明用途。', submitButtonText: '提交用章申请', labelPosition: 'top' },
    },
    sort: 7,
    builtin: true,
    tenantId: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 8,
    name: '付款申请',
    code: 'tpl_payment',
    description: '对外付款申请，直属主管 + 部门负责人 + 财务审批。',
    categoryName: '财务报销',
    icon: 'CreditCard',
    color: '#fa8c16',
    flowData: buildLinearFlow([
      { key: 'approve_manager', name: '直属主管审批', props: { assigneeType: 'manager', managerLevel: 1 } },
      { key: 'approve_dept_head', name: '部门负责人审批', props: { assigneeType: 'department' } },
    ], TEMPLATE_SETTINGS),
    formSchema: {
      fields: [
        { key: 'payee', label: '收款方', type: 'text', required: true, maxLength: 100 },
        { key: 'amount', label: '付款金额', type: 'amount', required: true, currency: 'CNY', precision: 2, min: 0, unit: '元' },
        { key: 'payDate', label: '期望付款日期', type: 'date', required: true, dateFormat: 'yyyy-MM-dd' },
        { key: 'purpose', label: '付款用途', type: 'textarea', required: true, maxLength: 500 },
        { key: 'invoice', label: '发票/合同附件', type: 'attachment', required: true, maxCount: 10 },
      ],
      settings: { description: '请上传发票或合同凭证。', submitButtonText: '提交付款申请', labelPosition: 'top' },
    },
    sort: 8,
    builtin: true,
    tenantId: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

// ─── 流程定义（业务接入示例：请假审批，formType=external）────────────────────────
// 由「请假管理」业务模块通过 startWorkflowForBiz 发起并关联；审批人查看 LeaveApprovalView。
// 不指定显式 id（避免 serial 序列冲突），biz-leave 服务按名称查找该已发布定义。
export const SEED_WORKFLOW_DEFINITIONS = [
  {
    id: 1,
    name: '请假审批',
    description: '业务接入示例：由「请假管理」业务模块发起并关联的审批流程（formType=external）',
    initiatorScopeType: 'all' as const,
    flowData: buildLinearFlow(
      [{ key: 'approve_admin', name: '管理员审批', props: { assigneeType: 'user', assigneeIds: [1] } }],
      TEMPLATE_SETTINGS,
    ),
    formType: 'external' as const,
    customForm: {
      createComponent: '',
      viewComponent: 'biz/leave/LeaveApprovalView',
      icon: 'CalendarClock',
      variables: [{ key: 'days', label: '请假天数', type: 'number' as const }],
    },
    status: 'published' as const,
    version: 1,
    tenantId: null,
  },
  {
    id: 2,
    name: 'CMS 内容审核',
    description: 'CMS 站点开启工作流审核模式后，内容提交审核时自动发起本流程；审批通过自动发布并刷新静态页，驳回回写驳回状态',
    initiatorScopeType: 'all' as const,
    flowData: buildLinearFlow(
      [{ key: 'approve_editor', name: '主编审核', props: { assigneeType: 'user', assigneeIds: [1] } }],
      TEMPLATE_SETTINGS,
    ),
    formType: 'external' as const,
    customForm: {
      createComponent: '',
      viewComponent: 'cms/ContentApprovalView',
      icon: 'FileCheck',
      variables: [
        { key: 'siteName', label: '所属站点', type: 'text' as const },
        { key: 'channelName', label: '所属栏目', type: 'text' as const },
        { key: 'contentTitle', label: '内容标题', type: 'text' as const },
      ],
    },
    status: 'published' as const,
    version: 1,
    tenantId: null,
  },
];

// ─── 标签 ─────────────────────────────────────────────────────────────────────

export const SEED_TAGS: Tag[] = [
  { id: 1, name: '重要',   color: '#ef4444', groupName: '优先级',   description: '高优先级事项',    status: 'enabled', sortOrder: 1, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '紧急',   color: '#f97316', groupName: '优先级',   description: '需要立即处理',    status: 'enabled', sortOrder: 2, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, name: '普通',   color: '#6b7280', groupName: '优先级',   description: '常规事项',        status: 'enabled', sortOrder: 3, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4, name: '新用户', color: '#2563eb', groupName: '用户标签', description: '新注册用户',      status: 'enabled', sortOrder: 1, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 5, name: 'VIP',    color: '#a855f7', groupName: '用户标签', description: 'VIP 会员用户',   status: 'enabled', sortOrder: 2, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 6, name: '待处理', color: '#f59e0b', groupName: '状态标签', description: '等待处理的事项', status: 'enabled', sortOrder: 1, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 7, name: '已完成', color: '#10b981', groupName: '状态标签', description: '已完成的事项',   status: 'enabled', sortOrder: 2, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 数据脱敏规则 ─────────────────────────────────────────────────────────────

export const SEED_DATA_MASK_CONFIGS: DataMaskConfig[] = [
  { id: 1, entity: 'user', field: 'phone',  label: '手机号',   maskType: 'phone',   customRule: null, exemptRoleCodes: ['super_admin'], enabled: true,  remark: '手机号脱敏，超管豁免',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, entity: 'user', field: 'email',  label: '邮箱',     maskType: 'email',   customRule: null, exemptRoleCodes: ['super_admin'], enabled: true,  remark: '邮箱脱敏，超管豁免',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, entity: 'user', field: 'idCard', label: '身份证号', maskType: 'id_card', customRule: null, exemptRoleCodes: ['super_admin'], enabled: false, remark: '身份证脱敏规则（示例，默认禁用）', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 会员等级 ─────────────────────────────────────────────────────────────────

export const SEED_MEMBER_LEVELS: MemberLevel[] = [
  { id: 1, name: '普通会员', level: 1, growthThreshold: 0,     discount: 100, icon: null, benefits: ['基础积分权益'],                                   description: null, sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '银卡会员', level: 2, growthThreshold: 1000,  discount: 98,  icon: null, benefits: ['98 折优惠', '生日积分翻倍'],                        description: null, sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, name: '金卡会员', level: 3, growthThreshold: 5000,  discount: 95,  icon: null, benefits: ['95 折优惠', '生日积分翻倍', '专属客服'],             description: null, sort: 3, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4, name: '钻石会员', level: 4, growthThreshold: 20000, discount: 90,  icon: null, benefits: ['9 折优惠', '积分翻倍', '专属客服', '优先发货'],      description: null, sort: 4, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 优惠券模板 ──────────────────────────────────────────────────────────────

export const SEED_COUPONS: Coupon[] = [
  { id: 1, name: '新人满100减10', type: 'amount',  faceValue: 1000, threshold: 10000, maxDiscount: null, totalQuantity: 1000, issuedQuantity: 0, perLimit: 1, validType: 'relative', validStart: null, validEnd: null, validDays: 30, exchangePoints: 0,   status: 'active', description: '新人专享满减券',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '全场9折券',    type: 'percent', faceValue: 90,   threshold: 0,     maxDiscount: 5000, totalQuantity: 500,  issuedQuantity: 0, perLimit: 1, validType: 'relative', validStart: null, validEnd: null, validDays: 15, exchangePoints: 200, status: 'active', description: '限时9折，最高减50元；可用 200 积分兑换', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 会员标签（示例）──────────────────────────────────────────────────────────
export const SEED_MEMBER_TAGS: MemberTag[] = [
  { id: 1, name: '高价值', color: 'red',    description: '累计充值较高的重点会员', sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '易流失', color: 'orange', description: '长期未登录，需要唤醒运营', sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, name: '新客',   color: 'green',  description: '注册 30 天内的新会员', sort: 3, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 公众号账号（示例占位，需填实际凭证后启用）──────────────────────────────────
export const SEED_MP_ACCOUNTS: MpAccount[] = [
  { id: 1, name: '示例服务号', account: 'gh_demo_service', appId: 'wxdemoservice0001', appSecret: 'DemoAppSecretReplaceMe', token: 'zenithdemotoken', encodingAesKey: null, encryptMode: 'plaintext', type: 'service', qrCodeUrl: null, isDefault: true,  autoCreateMember: false, contentCheckEnabled: false, status: 'disabled', remark: '初始占位配置，需填实际 AppSecret 后启用', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '示例测试号', account: null,              appId: 'wxdemotest00000001', appSecret: 'DemoTestSecret',        token: 'zenithtesttoken', encodingAesKey: null, encryptMode: 'plaintext', type: 'test',    qrCodeUrl: null, isDefault: false, autoCreateMember: false, contentCheckEnabled: false, status: 'disabled', remark: '微信测试号占位',                createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 公众号标签（示例）────────────────────────────────────────────────────────
export const SEED_MP_TAGS: MpTag[] = [
  { id: 1, accountId: 1, wechatTagId: 100, name: '星标用户', fansCount: 2, tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, accountId: 1, wechatTagId: 101, name: '活跃粉丝', fansCount: 1, tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, accountId: 1, wechatTagId: null, name: '潜在客户', fansCount: 0, tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 公众号粉丝（示例）────────────────────────────────────────────────────────
export const SEED_MP_FANS: MpFan[] = [
  { id: 1, accountId: 1, openid: 'oDemoFan0000000000000001', nickname: '小明', avatar: null, sex: 1, country: '中国', province: '广东', city: '深圳', language: 'zh_CN', subscribe: 'subscribed',   subscribeTime: SEED_DATE, remark: 'VIP客户', tagIds: [1, 2], unionid: null, memberId: null, blacklisted: false, tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, accountId: 1, openid: 'oDemoFan0000000000000002', nickname: '小红', avatar: null, sex: 2, country: '中国', province: '浙江', city: '杭州', language: 'zh_CN', subscribe: 'subscribed',   subscribeTime: SEED_DATE, remark: null,    tagIds: [1],    unionid: null, memberId: null, blacklisted: false, tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, accountId: 1, openid: 'oDemoFan0000000000000003', nickname: '老王', avatar: null, sex: 1, country: '中国', province: '北京', city: '北京', language: 'zh_CN', subscribe: 'unsubscribed', subscribeTime: SEED_DATE, remark: null,    tagIds: [],     unionid: null, memberId: null, blacklisted: false, tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 公众号消息（示例会话）──────────────────────────────────────────────────────
export const SEED_MP_MESSAGES: MpMessage[] = [
  { id: 1, accountId: 1, openid: 'oDemoFan0000000000000001', direction: 'in',  msgType: 'event', content: 'subscribe',                 mediaId: null, mediaUrl: null, event: 'subscribe', msgId: null,   status: 'received', errorMsg: null, createdAt: '2025-03-01 10:00:00' },
  { id: 2, accountId: 1, openid: 'oDemoFan0000000000000001', direction: 'in',  msgType: 'text',  content: '你好，请问怎么开通会员？',   mediaId: null, mediaUrl: null, event: null,        msgId: '2001', status: 'received', errorMsg: null, createdAt: '2025-03-01 10:01:00' },
  { id: 3, accountId: 1, openid: 'oDemoFan0000000000000001', direction: 'out', msgType: 'text',  content: '您好！点击底部菜单「会员中心」即可开通～', mediaId: null, mediaUrl: null, event: null, msgId: null, status: 'sent', errorMsg: null, createdAt: '2025-03-01 10:02:00' },
  { id: 4, accountId: 1, openid: 'oDemoFan0000000000000002', direction: 'in',  msgType: 'text',  content: '最近有优惠券吗？',           mediaId: null, mediaUrl: null, event: null,        msgId: '2002', status: 'received', errorMsg: null, createdAt: '2025-03-02 09:00:00' },
];

// ─── 公众号自动回复（示例）──────────────────────────────────────────────────────
export const SEED_MP_AUTO_REPLIES: MpAutoReply[] = [
  { id: 1, accountId: 1, replyType: 'subscribe', keyword: null,     matchType: 'contain', contentType: 'text', content: '欢迎关注 Zenith 公众号！回复「会员」了解会员权益。', mediaId: null, newsArticles: null, transferToKf: false, status: 'enabled', sort: 0, tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, accountId: 1, replyType: 'keyword',   keyword: '会员',   matchType: 'contain', contentType: 'text', content: '点击底部菜单「会员中心」即可开通会员～',           mediaId: null, newsArticles: null, transferToKf: false, status: 'enabled', sort: 1, tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, accountId: 1, replyType: 'keyword',   keyword: '优惠券', matchType: 'contain', contentType: 'news', content: null, mediaId: null, newsArticles: [{ title: '最新优惠券领取攻略', description: '点击查看本月可领取的优惠券与使用规则', picUrl: 'https://mmbiz.qpic.cn/demo/coupon.png', url: 'https://example.com/coupons' }], transferToKf: false, status: 'enabled', sort: 2, tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4, accountId: 1, replyType: 'keyword',   keyword: '人工',   matchType: 'contain', contentType: 'text', content: '正在为您转接人工客服，请稍候～',                     mediaId: null, newsArticles: null, transferToKf: true,  status: 'enabled', sort: 3, tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 5, accountId: 1, replyType: 'default',   keyword: null,     matchType: 'contain', contentType: 'text', content: '感谢留言，我们会尽快回复您～',                       mediaId: null, newsArticles: null, transferToKf: false, status: 'enabled', sort: 0, tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 公众号自定义菜单（示例草稿）────────────────────────────────────────────────
export const SEED_MP_MENUS: MpMenu[] = [
  {
    id: 1, accountId: 1, status: 'draft', publishedAt: null, tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE,
    buttons: [
      { name: '会员中心', sub_button: [
        { name: '我的会员', type: 'view', url: 'https://example.com/member' },
        { name: '积分商城', type: 'view', url: 'https://example.com/points' },
      ] },
      { name: '最新活动', type: 'click', key: 'LATEST_EVENT' },
      { name: '联系我们', type: 'view', url: 'https://example.com/contact' },
    ],
  },
];

// ─── 公众号素材（示例）──────────────────────────────────────────────────────────
export const SEED_MP_MATERIALS: MpMaterial[] = [
  { id: 1, accountId: 1, type: 'image', name: '会员海报', wechatMediaId: 'demo_media_001', url: 'https://picsum.photos/seed/mp1/400/300', fileSize: 102400, tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, accountId: 1, type: 'image', name: '活动banner', wechatMediaId: null, url: 'https://picsum.photos/seed/mp2/400/300', fileSize: 88500, tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, accountId: 1, type: 'thumb', name: '图文封面缩略图', wechatMediaId: 'demo_thumb_001', url: 'https://picsum.photos/seed/mp3/200/200', fileSize: 35200, tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 公众号图文草稿（示例）──────────────────────────────────────────────────────
export const SEED_MP_DRAFTS: MpDraft[] = [
  {
    id: 1, accountId: 1, title: '会员权益全新升级', wechatMediaId: null, status: 'draft', tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE,
    articles: [
      { title: '会员权益全新升级', author: '运营团队', digest: '更多积分、更多优惠等你来', content: '<p>尊敬的会员，本月起会员权益全面升级……</p>', thumbUrl: 'https://picsum.photos/seed/mp3/200/200', showCoverPic: true },
    ],
  },
];

// ─── 公众号模板消息模板（示例）──────────────────────────────────────────────────
export const SEED_MP_MESSAGE_TEMPLATES: MpMessageTemplate[] = [
  { id: 1, accountId: 1, templateId: 'DEMO_TPL_ORDER_PAID', title: '订单支付成功通知', content: '您的订单已支付成功\n订单号：{{order_no.DATA}}\n金额：{{amount.DATA}}', example: '您的订单已支付成功\n订单号：202603230001\n金额：￥99.00', tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, accountId: 1, templateId: 'DEMO_TPL_POINTS', title: '积分变动通知', content: '您的积分有变动\n变动：{{change.DATA}}\n余额：{{balance.DATA}}', example: '您的积分有变动\n变动：+100\n余额：1200', tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 公众号群发消息（示例）────────────────────────────────────────────────────
export const SEED_MP_BROADCASTS: MpBroadcast[] = [
  { id: 1, accountId: 1, msgType: 'text', target: 'all', tagId: null, content: '【Zenith 周报】本周上新会员权益，点击菜单「会员中心」查看详情～', mediaId: null, status: 'draft', wechatMsgId: null, scheduledAt: null, errorMsg: null, sentAt: null, tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, accountId: 1, msgType: 'text', target: 'tag', tagId: 1, content: '尊敬的星标用户，您有一张专属优惠券待领取！', mediaId: null, status: 'draft', wechatMsgId: null, scheduledAt: null, errorMsg: null, sentAt: null, tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 公众号带参数二维码（示例）─────────────────────────────────────────────────
export const SEED_MP_QRCODES: MpQrcode[] = [
  { id: 1, accountId: 1, type: 'permanent', sceneStr: 'channel_offline_store', name: '线下门店物料', ticket: 'DEMO_TICKET_OFFLINE', url: 'https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=DEMO_TICKET_OFFLINE', expireSeconds: null, scanCount: 128, rewardPoints: 0, tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, accountId: 1, type: 'permanent', sceneStr: 'event_2026_spring', name: '春季活动推广', ticket: 'DEMO_TICKET_SPRING', url: 'https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=DEMO_TICKET_SPRING', expireSeconds: null, scanCount: 36, rewardPoints: 50, tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 公众号多客服账号（示例）───────────────────────────────────────────────────
export const SEED_MP_KF_ACCOUNTS: MpKfAccount[] = [
  { id: 1, accountId: 1, kfAccount: 'kf2001@gh_demo_service', nickname: '客服小柒', avatar: null, kfId: '1001', inviteStatus: 'bound', inviteWx: 'zenith_cs_01', status: 'enabled', tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, accountId: 1, kfAccount: 'kf2002@gh_demo_service', nickname: '客服小满', avatar: null, kfId: '1002', inviteStatus: 'inviting', inviteWx: null, status: 'enabled', tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 多客服会话治理（路由配置 + 会话状态机 + 事件流水）──────────────────────────
export interface SeedMpKfRoutingConfig {
  accountId: number;
  enabled: boolean;
  strategy: MpKfRoutingStrategy;
  maxConcurrent: number;
  waitTimeoutMinutes: number;
  idleTimeoutMinutes: number;
  autoCloseEnabled: boolean;
  welcomeText: string | null;
}
export const SEED_MP_KF_ROUTING_CONFIGS: SeedMpKfRoutingConfig[] = [
  { accountId: 1, enabled: true, strategy: 'least_active', maxConcurrent: 5, waitTimeoutMinutes: 3, idleTimeoutMinutes: 15, autoCloseEnabled: true, welcomeText: '您好，很高兴为您服务，请问有什么可以帮您？' },
];

export interface SeedMpKfSession {
  id: number;
  accountId: number;
  openid: string;
  kfId: number | null;
  status: MpKfSessionStatus;
  unreadCount: number;
  source: string;
  closeReason: MpKfSessionCloseReason | null;
}
export const SEED_MP_KF_SESSIONS: SeedMpKfSession[] = [
  { id: 1, accountId: 1, openid: 'oDemoFan0000000000000001', kfId: 1, status: 'active', unreadCount: 0, source: 'text', closeReason: null },
  { id: 2, accountId: 1, openid: 'oDemoFan0000000000000002', kfId: null, status: 'waiting', unreadCount: 1, source: 'text', closeReason: null },
  { id: 3, accountId: 1, openid: 'oDemoFan0000000000000003', kfId: 2, status: 'closed', unreadCount: 0, source: 'text', closeReason: 'manual' },
];

export interface SeedMpKfSessionEvent {
  id: number;
  sessionId: number;
  accountId: number;
  type: MpKfSessionEventType;
  fromKfId: number | null;
  toKfId: number | null;
  detail: string;
}
export const SEED_MP_KF_SESSION_EVENTS: SeedMpKfSessionEvent[] = [
  { id: 1, sessionId: 1, accountId: 1, type: 'create', fromKfId: null, toKfId: null, detail: '粉丝发起会话' },
  { id: 2, sessionId: 1, accountId: 1, type: 'assign', fromKfId: null, toKfId: 1, detail: '系统自动分配' },
  { id: 3, sessionId: 2, accountId: 1, type: 'create', fromKfId: null, toKfId: null, detail: '粉丝发起会话' },
  { id: 4, sessionId: 3, accountId: 1, type: 'create', fromKfId: null, toKfId: null, detail: '粉丝发起会话' },
  { id: 5, sessionId: 3, accountId: 1, type: 'accept', fromKfId: null, toKfId: 2, detail: '人工接入' },
  { id: 6, sessionId: 3, accountId: 1, type: 'close', fromKfId: 2, toKfId: null, detail: '手动结束' },
];

// ─── 个性化菜单（示例）────────────────────────────────────────────────────────
export interface SeedMpConditionalMenu {
  id: number;
  accountId: number;
  name: string;
  buttons: MpMenuButton[];
  matchRule: MpMenuMatchRule;
  status: MpMenuStatus;
}
export const SEED_MP_CONDITIONAL_MENUS: SeedMpConditionalMenu[] = [
  {
    id: 1, accountId: 1, name: '女性用户菜单', status: 'draft',
    matchRule: { sex: '2' },
    buttons: [
      { name: '美妆专区', type: 'view', url: 'https://example.com/beauty' },
      { name: '会员中心', type: 'click', key: 'MEMBER_CENTER' },
    ],
  },
  {
    id: 2, accountId: 1, name: '星标用户菜单', status: 'draft',
    matchRule: { tagId: '100' },
    buttons: [
      { name: '专属客服', type: 'click', key: 'VIP_KF' },
      {
        name: '更多', type: '', sub_button: [
          { name: '官网', type: 'view', url: 'https://example.com' },
          { name: '积分商城', type: 'view', url: 'https://example.com/points' },
        ],
      },
    ],
  },
];

// ─── 签到里程碑（累计签到天数达标奖励）──────────────────────────────────────────

export interface SeedCheckinMilestone {
  id: number;
  title: string;
  cumulativeDays: number;
  rewardType: 'points' | 'coupon';
  rewardPoints: number;
  couponId: number | null;
  enabled: boolean;
  remark: string | null;
}

export const SEED_CHECKIN_MILESTONES: SeedCheckinMilestone[] = [
  { id: 1, title: '累计签到 7 天',   cumulativeDays: 7,   rewardType: 'points', rewardPoints: 50,  couponId: null, enabled: true, remark: '累计签到满 7 天奖励' },
  { id: 2, title: '累计签到 30 天',  cumulativeDays: 30,  rewardType: 'points', rewardPoints: 300, couponId: null, enabled: true, remark: '累计签到满 30 天奖励' },
  { id: 3, title: '累计签到 100 天', cumulativeDays: 100, rewardType: 'coupon', rewardPoints: 0,   couponId: 2,    enabled: true, remark: '累计签到满 100 天赠送优惠券' },
];

// ─── 邮件模板 ─────────────────────────────────────────────────────────────────

export const SEED_EMAIL_TEMPLATES: EmailTemplate[] = [
  { id: 1, name: '欢迎注册邮件', code: 'user_welcome',        subject: '欢迎加入 {{appName}}', content: '<p>Hi {{nickname}}，欢迎注册 {{appName}}！请点击 {{verifyLink}} 完成账户验证（24 小时内有效）。</p>', variables: 'nickname,appName,verifyLink', status: 'enabled',  remark: '新用户注册后发送的激活邮件', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '密码重置邮件', code: 'user_reset_password', subject: '重置您的密码',         content: '<p>Hi {{nickname}}，请点击 {{resetLink}} 重置密码（2 小时内有效）。如未发起此请求，请忽略本邮件。</p>', variables: 'nickname,resetLink',          status: 'enabled',  remark: '用户密码重置流程所用模板',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, name: '系统告警通知', code: 'system_alert',         subject: '【告警】{{title}}',    content: '<p>{{description}}</p>',                                                                              variables: 'title,description',           status: 'disabled', remark: '仅运维使用',                 createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 短信模板 ─────────────────────────────────────────────────────────────────

export const SEED_SMS_TEMPLATES: SmsTemplate[] = [
  { id: 1, name: '登录验证码', code: 'login_code',    templateCode: 'SMS_DEMO_LOGIN',    signName: 'Zenith', content: '您的登录验证码是 ${code}，5 分钟内有效。',          variables: 'code',    provider: 'aliyun', status: 'enabled', remark: '登录场景', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '注册验证码', code: 'register_code', templateCode: 'SMS_DEMO_REGISTER', signName: 'Zenith', content: '您的注册验证码是 ${code}，10 分钟内有效。',         variables: 'code',    provider: 'aliyun', status: 'enabled', remark: '注册场景', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, name: '订单通知',   code: 'order_notify',  templateCode: 'SMS_DEMO_ORDER',    signName: 'Zenith', content: '您的订单 ${orderId} 已发货，请注意查收。', variables: 'orderId', provider: 'aliyun', status: 'enabled', remark: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 站内信模板 ────────────────────────────────────────────────────────────────

export const SEED_INAPP_TEMPLATES: InAppTemplate[] = [
  { id: 1, name: '系统升级通知', code: 'system_upgrade',  title: '系统将于 {{time}} 升级',   content: '系统将于 {{time}} 进行升级，预计耗时 {{duration}}。', type: 'info',    variables: 'time,duration', status: 'enabled', remark: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '审批通过',     code: 'approval_passed', title: '您的申请已通过',        content: '您提交的【{{title}}】已通过审批。',                          type: 'success', variables: 'title',        status: 'enabled', remark: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, name: '异常告警',     code: 'system_warning',  title: '系统异常告警',             content: '检测到异常：{{message}}，请尽快处理。',                type: 'warning', variables: 'message',      status: 'enabled', remark: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 租户示例 ───────────────────────────────────────────────────────────────────

export const SEED_TENANTS: Tenant[] = [
  { id: 1, name: '示例租户A', code: 'tenant_a', logo: null, contactName: '张三', contactPhone: '13800001111', status: 'enabled', expireAt: null, maxUsers: 50,   packageId: 2, remark: '演示用租户A', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '示例租户B', code: 'tenant_b', logo: null, contactName: '李四', contactPhone: '13800002222', status: 'enabled', expireAt: null, maxUsers: null, packageId: 1, remark: '演示用租户B', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 租户套餐 ─────────────────────────────────────────────────────────────────
// 套餐 = 一组菜单白名单，租户绑定套餐圈定其可用功能范围。menuIds 引用 SEED_MENUS 中的菜单 ID。
export const SEED_TENANT_PACKAGES: TenantPackage[] = [
  { id: 1, name: '基础版', status: 'enabled', remark: '基础功能套餐：仪表盘 + 用户/角色/字典', menuIds: [1, 2, 3, 5, 6], createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '标准版', status: 'enabled', remark: '标准功能套餐：含部门/岗位/菜单管理', menuIds: [1, 2, 3, 4, 5, 6, 36, 40], createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 工作流分类 ─────────────────────────────────────────────────────────────────

export const SEED_WORKFLOW_CATEGORIES: WorkflowCategory[] = [
  { id: 1, name: '采购审批', code: 'purchase',  icon: 'ShoppingCart', color: '#1890ff', sort: 1, description: '采购申请相关审批流程', tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '人事行政', code: 'hr',         icon: 'Users',        color: '#52c41a', sort: 2, description: '人事及行政审批流程',   tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, name: '财务报销', code: 'finance',    icon: 'DollarSign',   color: '#fa8c16', sort: 3, description: '财务费用报销流程',     tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4, name: 'IT运维',   code: 'it',         icon: 'Monitor',      color: '#722ed1', sort: 4, description: 'IT及运维相关审批',     tenantId: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── AI 提示词模板（内置预设角色）─────────────────────────────────────────────────

export const SEED_AI_PROMPT_TEMPLATES: AiPromptTemplate[] = [
  { id: 1, name: '通用助手', content: '你是一个乐于助人、知识渊博的 AI 助手。请用简洁、准确、友好的语气回答用户的问题，必要时给出步骤化的说明。', description: '默认的通用对话助手', category: '通用', scope: 'system', userId: null, isBuiltin: true, sort: 1, usageCount: 0, isEnabled: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '翻译助手', content: '你是一名专业的中英互译翻译。当用户输入中文时翻译为地道的英文，输入英文时翻译为通顺的中文。只输出翻译结果，不要附加解释，保留原文的语气与专业术语。', description: '中英互译', category: '翻译', scope: 'system', userId: null, isBuiltin: true, sort: 2, usageCount: 0, isEnabled: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, name: '编程助手', content: '你是一名资深软件工程师。请提供清晰、可运行、符合最佳实践的代码，并对关键部分给出简要说明。优先考虑可读性、性能与安全性，必要时指出潜在的边界情况。', description: '代码编写与排错', category: '编程', scope: 'system', userId: null, isBuiltin: true, sort: 3, usageCount: 0, isEnabled: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4, name: '文案写作', content: '你是一名专业的中文文案策划。请根据用户的主题创作富有吸引力、结构清晰、符合目标受众语气的文案，可提供多个备选标题或版本。', description: '营销与内容创作', category: '写作', scope: 'system', userId: null, isBuiltin: true, sort: 4, usageCount: 0, isEnabled: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 5, name: '内容总结', content: '你是一名擅长信息提炼的助手。请将用户提供的内容总结为要点清晰的摘要，突出关键信息与结论，使用简洁的分点表达，避免冗余。', description: '长文本摘要提炼', category: '总结', scope: 'system', userId: null, isBuiltin: true, sort: 5, usageCount: 0, isEnabled: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 支付方式配置（支付中心 · B 档）─────────────────────────────────────────────
export interface SeedPaymentMethodConfig {
  id: number;
  method: string;
  channel: string;
  label: string;
  icon: string | null;
  enabled: boolean;
  sort: number;
}

export const SEED_PAYMENT_METHOD_CONFIGS: SeedPaymentMethodConfig[] = [
  { id: 1, method: 'wechat_native', channel: 'wechat', label: '微信扫码', icon: 'QrCode', enabled: true, sort: 1 },
  { id: 2, method: 'wechat_jsapi', channel: 'wechat', label: '微信 JSAPI', icon: 'MessageCircle', enabled: true, sort: 2 },
  { id: 3, method: 'wechat_h5', channel: 'wechat', label: '微信 H5', icon: 'Smartphone', enabled: true, sort: 3 },
  { id: 4, method: 'alipay_page', channel: 'alipay', label: '支付宝电脑网站', icon: 'Monitor', enabled: true, sort: 4 },
  { id: 5, method: 'alipay_wap', channel: 'alipay', label: '支付宝手机网站', icon: 'Smartphone', enabled: true, sort: 5 },
  { id: 6, method: 'alipay_app', channel: 'alipay', label: '支付宝 APP', icon: 'AppWindow', enabled: true, sort: 6 },
  { id: 7, method: 'unionpay_qr', channel: 'unionpay', label: '云闪付扫码', icon: 'QrCode', enabled: true, sort: 7 },
  // 签约代扣方式（服务端发起，非收银台可选项，默认停用展示）
  { id: 8, method: 'wechat_papay', channel: 'wechat', label: '微信委托代扣', icon: 'Repeat', enabled: false, sort: 8 },
  { id: 9, method: 'alipay_cycle', channel: 'alipay', label: '支付宝周期扣款', icon: 'Repeat', enabled: false, sort: 9 },
  // 预授权转支付（服务端发起，非收银台可选项，默认停用展示）
  { id: 10, method: 'wechat_preauth', channel: 'wechat', label: '微信预授权转支付', icon: 'Snowflake', enabled: false, sort: 10 },
  { id: 11, method: 'alipay_preauth', channel: 'alipay', label: '支付宝预授权转支付', icon: 'Snowflake', enabled: false, sort: 11 },
];

// ─── 扣款计划（支付中心 · 签约代扣）────────────────────────────────────────────
export interface SeedPaymentDeductPlan {
  id: number;
  name: string;
  period: 'daily' | 'weekly' | 'monthly' | 'custom';
  customDays: number | null;
  amount: number;
  maxRetries: number;
  status: 'enabled' | 'disabled';
  remark: string | null;
}

export const SEED_PAYMENT_DEDUCT_PLANS: SeedPaymentDeductPlan[] = [
  { id: 1, name: '连续包月 VIP', period: 'monthly', customDays: null, amount: 1500, maxRetries: 3, status: 'enabled', remark: '每月自动续费 15 元' },
  { id: 2, name: '连续包周 VIP', period: 'weekly', customDays: null, amount: 500, maxRetries: 3, status: 'enabled', remark: '每周自动续费 5 元' },
  { id: 3, name: '90 天畅享卡', period: 'custom', customDays: 90, amount: 3900, maxRetries: 3, status: 'enabled', remark: '每 90 天自动续费 39 元' },
];

// ─── Channel（站内公众号 / 系统号）────────────────────────────────────────────
export interface SeedChannel {
  id: number;
  code: string;
  name: string;
  avatar: string | null;
  description: string | null;
  type: 'system' | 'business';
  builtin: boolean;
}

export const SEED_CHANNELS: SeedChannel[] = [
  {
    id: 1,
    code: 'system-assistant',
    name: 'Zenith 助手',
    avatar: null,
    description: '系统通知与工作流提醒',
    type: 'system',
    builtin: true,
  },
];

// ─── Channel 客服快捷回复（channelId 为 null = 全局，所有运营号通用） ───────────
export interface SeedChannelQuickReply {
  channelId: number | null;
  title: string;
  content: string;
  sort: number;
}

export const SEED_CHANNEL_QUICK_REPLIES: SeedChannelQuickReply[] = [
  { channelId: null, title: '欢迎语', content: '您好！很高兴为您服务，请问有什么可以帮您？', sort: 1 },
  { channelId: null, title: '稍等', content: '请稍等，正在为您查询，马上回复您～', sort: 2 },
  { channelId: null, title: '结束语', content: '感谢您的咨询，祝您生活愉快！如有问题随时联系我们。', sort: 3 },
  { channelId: null, title: '工作时间', content: '我们的客服工作时间为工作日 9:00-18:00，非工作时间留言我们会尽快回复。', sort: 4 },
];

// ─── 报表中心：示例数据源 / 数据集 / 仪表盘 ─────────────────────────────────────
export const SEED_REPORT_DATASOURCES: ReportDatasource[] = [
  { id: 1, name: '内置主库', type: 'sql', config: { connection: 'internal' }, status: 'enabled', remark: '应用 PostgreSQL 主库（只读）', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '静态数据', type: 'static', config: {}, status: 'enabled', remark: '静态/文件数据集容器（JSON / Excel / CSV 上传）', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_REPORT_DATASETS: ReportDataset[] = [
  {
    id: 1,
    name: '菜单类型分布',
    datasourceId: 1,
    type: 'sql',
    content: { sql: "SELECT type AS name, count(*)::int AS value FROM menus WHERE (${mstatus} = '' OR status::text = ${mstatus}) GROUP BY type ORDER BY value DESC" },
    fields: [
      { name: 'name', label: '类型', type: 'string' },
      { name: 'value', label: '数量', type: 'number' },
    ],
    params: [
      { name: 'mstatus', label: '菜单状态', type: 'string', defaultValue: '' },
    ],
    computedFields: [],
    cacheTtl: 0,
    status: 'enabled',
    remark: '示例：按类型统计菜单数量',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 2,
    name: '部门用户榜',
    datasourceId: 1,
    type: 'sql',
    content: { sql: 'SELECT d.name AS name, count(u.id)::int AS value FROM departments d LEFT JOIN users u ON u.department_id = d.id GROUP BY d.name ORDER BY value DESC LIMIT 20' },
    fields: [
      { name: 'name', label: '部门', type: 'string' },
      { name: 'value', label: '人数', type: 'number' },
    ],
    params: [],
    computedFields: [],
    cacheTtl: 30,
    status: 'enabled',
    remark: '示例：各部门用户数排行（大屏滚动榜单数据源）',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  // ─── 行为中心阶段 1：报表中心接入（复用内置主库，租户视角安全）────────────────
  {
    id: 3,
    name: '行为事件趋势',
    datasourceId: 1,
    type: 'sql',
    content: {
      sql: "SELECT to_char(timezone('Asia/Shanghai', created_at), 'YYYY-MM-DD') AS name, count(*)::int AS value FROM user_events WHERE created_at >= now() - (${days}::int * INTERVAL '1 day') AND (${__tenantId}::int IS NULL OR tenant_id = ${__tenantId}) GROUP BY 1 ORDER BY 1",
    },
    fields: [
      { name: 'name', label: '日期', type: 'string' },
      { name: 'value', label: '事件数', type: 'number' },
    ],
    params: [
      { name: 'days', label: '统计天数', type: 'number', defaultValue: 30 },
    ],
    computedFields: [],
    cacheTtl: 60,
    status: 'enabled',
    remark: '行为中心：按天统计埋点事件量趋势（平台超管不选租户时看全平台，选定租户/普通租户用户仅看本租户）',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 4,
    name: '行为事件来源分布',
    datasourceId: 1,
    type: 'sql',
    content: {
      sql: "SELECT source AS name, count(*)::int AS value FROM user_events WHERE created_at >= now() - (${days}::int * INTERVAL '1 day') AND (${__tenantId}::int IS NULL OR tenant_id = ${__tenantId}) GROUP BY source ORDER BY value DESC",
    },
    fields: [
      { name: 'name', label: '来源', type: 'string' },
      { name: 'value', label: '事件数', type: 'number' },
    ],
    params: [
      { name: 'days', label: '统计天数', type: 'number', defaultValue: 30 },
    ],
    computedFields: [],
    cacheTtl: 60,
    status: 'enabled',
    remark: '行为中心：按来源（web_admin/web_member/server）统计埋点事件占比',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 5,
    name: '埋点质量趋势',
    datasourceId: 1,
    type: 'sql',
    content: {
      sql: "SELECT to_char(stat_date, 'YYYY-MM-DD') AS name, sum(count)::int AS value FROM analytics_event_quality_daily WHERE stat_date >= (now() - (${days}::int * INTERVAL '1 day'))::date AND (${__tenantId}::int IS NULL OR tenant_id = ${__tenantId}) GROUP BY 1 ORDER BY 1",
    },
    fields: [
      { name: 'name', label: '日期', type: 'string' },
      { name: 'value', label: '问题事件数', type: 'number' },
    ],
    params: [
      { name: 'days', label: '统计天数', type: 'number', defaultValue: 30 },
    ],
    computedFields: [],
    cacheTtl: 60,
    status: 'enabled',
    remark: '行为中心：埋点质量日聚合问题事件量趋势（缺失必填/类型不符/非法枚举/事件已停用）',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

export const SEED_REPORT_DASHBOARDS: ReportDashboard[] = [
  {
    id: 1,
    name: '示例仪表盘',
    layout: [
      { i: 'w1', x: 0, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
      { i: 'w2', x: 3, y: 0, w: 5, h: 6, minW: 2, minH: 2 },
      { i: 'w3', x: 8, y: 0, w: 4, h: 6, minW: 2, minH: 2 },
    ],
    canvasLayout: [],
    widgets: [
      { i: 'w1', type: 'kpi', title: '菜单总数', datasetId: 1, options: { valueField: 'value', aggregate: 'sum', unit: '个' }, paramBindings: [{ filterId: 'f_status', param: 'mstatus' }] },
      { i: 'w2', type: 'bar', title: '菜单类型分布', datasetId: 1, options: { categoryField: 'name', valueFields: ['value'] }, paramBindings: [{ filterId: 'f_status', param: 'mstatus' }] },
      { i: 'w3', type: 'pie', title: '类型占比', datasetId: 1, options: { categoryField: 'name', valueFields: ['value'] }, paramBindings: [{ filterId: 'f_status', param: 'mstatus' }] },
    ],
    filters: [
      { id: 'f_status', label: '菜单状态', type: 'select', defaultValue: '', optionSource: { kind: 'static', options: [{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }] } },
    ],
    config: { theme: 'light' },
    status: 'enabled',
    lifecycleStatus: 'published',
    revision: 1,
    publishedSnapshot: {
      name: '示例仪表盘',
      layout: [
        { i: 'w1', x: 0, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
        { i: 'w2', x: 3, y: 0, w: 5, h: 6, minW: 2, minH: 2 },
        { i: 'w3', x: 8, y: 0, w: 4, h: 6, minW: 2, minH: 2 },
      ],
      canvasLayout: [],
      widgets: [
        { i: 'w1', type: 'kpi', title: '菜单总数', datasetId: 1, options: { valueField: 'value', aggregate: 'sum', unit: '个' }, paramBindings: [{ filterId: 'f_status', param: 'mstatus' }] },
        { i: 'w2', type: 'bar', title: '菜单类型分布', datasetId: 1, options: { categoryField: 'name', valueFields: ['value'] }, paramBindings: [{ filterId: 'f_status', param: 'mstatus' }] },
        { i: 'w3', type: 'pie', title: '类型占比', datasetId: 1, options: { categoryField: 'name', valueFields: ['value'] }, paramBindings: [{ filterId: 'f_status', param: 'mstatus' }] },
      ],
      filters: [
        { id: 'f_status', label: '菜单状态', type: 'select', defaultValue: '', optionSource: { kind: 'static', options: [{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }] } },
      ],
      config: { theme: 'light' },
      categoryId: null,
      remark: '内置示例，可直接编辑或删除',
    },
    publishedAt: SEED_DATE,
    publishedBy: 1,
    publishedByName: '系统',
    remark: '内置示例，可直接编辑或删除',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 2,
    name: '运营数据大屏',
    layout: [
      { i: 's1', x: 0, y: 0, w: 4, h: 3 },
      { i: 's2', x: 0, y: 3, w: 4, h: 6 },
      { i: 's3', x: 4, y: 3, w: 4, h: 6 },
      { i: 's4', x: 8, y: 0, w: 4, h: 9 },
    ],
    canvasLayout: [
      { i: 's1', x: 40, y: 40, w: 560, h: 180, z: 1 },
      { i: 's2', x: 40, y: 250, w: 560, h: 360, z: 1 },
      { i: 's3', x: 640, y: 250, w: 560, h: 360, z: 1 },
      { i: 's4', x: 1240, y: 40, w: 640, h: 570, z: 1 },
    ],
    widgets: [
      { i: 's1', type: 'flipper', title: '菜单总数', datasetId: 1, options: { valueField: 'value', aggregate: 'sum', unit: '个', flipDigits: 4 } },
      { i: 's2', type: 'bar', title: '菜单类型分布', datasetId: 1, options: { categoryField: 'name', valueFields: ['value'] } },
      { i: 's3', type: 'pie', title: '类型占比', datasetId: 1, options: { categoryField: 'name', valueFields: ['value'] } },
      { i: 's4', type: 'scrollList', title: '部门用户榜', datasetId: 2, options: { categoryField: 'name', valueFields: ['value'], showRank: true, scrollSpeed: 1 } },
    ],
    filters: [],
    config: { theme: 'dark', layoutMode: 'canvas', screenConfig: { width: 1920, height: 1080, scaleMode: 'fit', background: '#0a1330' }, refreshInterval: 30 },
    status: 'enabled',
    lifecycleStatus: 'published',
    revision: 1,
    publishedSnapshot: {
      name: '运营数据大屏',
      layout: [
        { i: 's1', x: 0, y: 0, w: 4, h: 3 },
        { i: 's2', x: 0, y: 3, w: 4, h: 6 },
        { i: 's3', x: 4, y: 3, w: 4, h: 6 },
        { i: 's4', x: 8, y: 0, w: 4, h: 9 },
      ],
      canvasLayout: [
        { i: 's1', x: 40, y: 40, w: 560, h: 180, z: 1 },
        { i: 's2', x: 40, y: 250, w: 560, h: 360, z: 1 },
        { i: 's3', x: 640, y: 250, w: 560, h: 360, z: 1 },
        { i: 's4', x: 1240, y: 40, w: 640, h: 570, z: 1 },
      ],
      widgets: [
        { i: 's1', type: 'flipper', title: '菜单总数', datasetId: 1, options: { valueField: 'value', aggregate: 'sum', unit: '个', flipDigits: 4 } },
        { i: 's2', type: 'bar', title: '菜单类型分布', datasetId: 1, options: { categoryField: 'name', valueFields: ['value'] } },
        { i: 's3', type: 'pie', title: '类型占比', datasetId: 1, options: { categoryField: 'name', valueFields: ['value'] } },
        { i: 's4', type: 'scrollList', title: '部门用户榜', datasetId: 2, options: { categoryField: 'name', valueFields: ['value'], showRank: true, scrollSpeed: 1 } },
      ],
      filters: [],
      config: { theme: 'dark', layoutMode: 'canvas', screenConfig: { width: 1920, height: 1080, scaleMode: 'fit', background: '#0a1330' }, refreshInterval: 30 },
      categoryId: null,
      remark: '内置大屏示例：自由画布 + 深色科技皮肤 + 翻牌器/滚动榜单',
    },
    publishedAt: SEED_DATE,
    publishedBy: 1,
    publishedByName: '系统',
    remark: '内置大屏示例：自由画布 + 深色科技皮肤 + 翻牌器/滚动榜单',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 3,
    name: '行为分析概览',
    layout: [
      { i: 'a1', x: 0, y: 0, w: 12, h: 6, minW: 4, minH: 3 },
      { i: 'a2', x: 0, y: 6, w: 6, h: 6, minW: 3, minH: 3 },
      { i: 'a3', x: 6, y: 6, w: 6, h: 6, minW: 3, minH: 3 },
    ],
    canvasLayout: [],
    widgets: [
      { i: 'a1', type: 'line', title: '行为事件趋势', datasetId: 3, options: { categoryField: 'name', valueFields: ['value'] } },
      { i: 'a2', type: 'bar', title: '事件来源分布', datasetId: 4, options: { categoryField: 'name', valueFields: ['value'] } },
      { i: 'a3', type: 'line', title: '埋点质量趋势', datasetId: 5, options: { categoryField: 'name', valueFields: ['value'] } },
    ],
    filters: [],
    config: { theme: 'light' },
    status: 'enabled',
    lifecycleStatus: 'published',
    revision: 1,
    publishedSnapshot: {
      name: '行为分析概览',
      layout: [
        { i: 'a1', x: 0, y: 0, w: 12, h: 6, minW: 4, minH: 3 },
        { i: 'a2', x: 0, y: 6, w: 6, h: 6, minW: 3, minH: 3 },
        { i: 'a3', x: 6, y: 6, w: 6, h: 6, minW: 3, minH: 3 },
      ],
      canvasLayout: [],
      widgets: [
        { i: 'a1', type: 'line', title: '行为事件趋势', datasetId: 3, options: { categoryField: 'name', valueFields: ['value'] } },
        { i: 'a2', type: 'bar', title: '事件来源分布', datasetId: 4, options: { categoryField: 'name', valueFields: ['value'] } },
        { i: 'a3', type: 'line', title: '埋点质量趋势', datasetId: 5, options: { categoryField: 'name', valueFields: ['value'] } },
      ],
      filters: [],
      config: { theme: 'light' },
      categoryId: null,
      remark: '行为中心阶段 1：内置看板，绑定事件趋势/来源分布/质量趋势 3 个数据集，直接获得分享/订阅能力',
    },
    publishedAt: SEED_DATE,
    publishedBy: 1,
    publishedByName: '系统',
    remark: '行为中心阶段 1：内置看板，绑定事件趋势/来源分布/质量趋势 3 个数据集，直接获得分享/订阅能力',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

export const SEED_REPORT_PRINT_TEMPLATES: ReportPrintTemplate[] = [
  {
    id: 1,
    name: '部门用户统计表',
    datasetId: 2,
    content: {
      grid: {
        rows: 4,
        cols: 2,
        colWidths: [220, 120],
        cells: [
          { row: 0, col: 0, v: '部门用户统计表', s: { bold: true, fontSize: 16, align: 'center' } },
          { row: 1, col: 0, v: '部门', s: { bold: true, align: 'center', border: true, background: '#f0f0f0' } },
          { row: 1, col: 1, v: '人数', s: { bold: true, align: 'center', border: true, background: '#f0f0f0' } },
          { row: 2, col: 0, v: '${name}', s: { border: true } },
          { row: 2, col: 1, v: '${value}', s: { border: true, align: 'right' } },
          { row: 3, col: 0, v: '合计', s: { bold: true, border: true } },
          { row: 3, col: 1, v: '${SUM(value)}', s: { bold: true, border: true, align: 'right' } },
        ],
        merges: [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }],
      },
    },
    params: [],
    pageConfig: { paper: 'A4', orientation: 'portrait', margin: { top: 20, right: 20, bottom: 20, left: 20 }, header: '部门用户统计', footer: '第 {page} 页 / 共 {pages} 页' },
    status: 'enabled',
    remark: '内置示例：表头 + 明细纵向扩展 + 合计行（${SUM}），可直接预览/打印/导出',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

// ─── 报表中心 P2：治理、质量、容量、资产与填报基线 ─────────────────────────────
export const SEED_REPORT_FOLDERS: ReportFolder[] = [
  { id: 1, tenantId: null, parentId: null, name: '示例数据源', resourceType: 'datasource', ownerId: 1, sort: 10, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, tenantId: null, parentId: null, name: '示例数据集', resourceType: 'dataset', ownerId: 1, sort: 20, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, tenantId: null, parentId: null, name: '示例仪表盘', resourceType: 'dashboard', ownerId: 1, sort: 30, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4, tenantId: null, parentId: null, name: '语义指标', resourceType: 'metric', ownerId: 1, sort: 40, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 5, tenantId: null, parentId: null, name: '打印模板', resourceType: 'print_template', ownerId: 1, sort: 50, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 6, tenantId: null, parentId: null, name: '资产模板', resourceType: 'asset_template', ownerId: 1, sort: 60, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 7, tenantId: null, parentId: null, name: '填报模板', resourceType: 'fill_template', ownerId: 1, sort: 70, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_REPORT_ENVIRONMENTS: ReportEnvironment[] = [
  { id: 1, tenantId: null, code: 'dev', name: '开发环境', kind: 'development', description: '报表资源开发与联调环境', baseUrl: null, config: {}, isDefault: true, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, tenantId: null, code: 'staging', name: '预发布环境', kind: 'staging', description: '发布审批后的验收环境', baseUrl: null, config: {}, isDefault: false, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, tenantId: null, code: 'prod', name: '生产环境', kind: 'production', description: '仅允许审批通过的版本发布', baseUrl: null, config: {}, isDefault: false, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_REPORT_METRICS: ReportMetric[] = [
  {
    id: 1,
    tenantId: null,
    folderId: 4,
    ownerId: 1,
    code: 'department_user_total',
    name: '部门用户总数',
    description: '基于部门用户榜数据集汇总各部门用户数量',
    type: 'simple',
    datasetId: 2,
    sourceField: 'value',
    formula: null,
    aggregate: 'sum',
    dimensions: ['name'],
    timeField: null,
    unit: '人',
    format: '#,##0',
    caliber: '按当前数据集筛选条件汇总 value 字段；不包含已删除用户。',
    lifecycleStatus: 'published',
    revision: 1,
    publishedSnapshot: {
      code: 'department_user_total',
      name: '部门用户总数',
      type: 'simple',
      datasetId: 2,
      sourceField: 'value',
      aggregate: 'sum',
      dimensions: ['name'],
      unit: '人',
      format: '#,##0',
    },
    publishedAt: SEED_DATE,
    publishedBy: 1,
    deprecatedAt: null,
    deprecatedBy: null,
    deprecationReason: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

export const SEED_REPORT_DQ_RULES: ReportDqRule[] = [
  {
    id: 1, tenantId: null, datasetId: 2, name: '部门名称不能为空', type: 'not_null',
    field: 'name', severity: 'high', config: {}, cron: '0 7 * * *', timezone: 'Asia/Shanghai',
    enabled: true, lastRunAt: null, lastStatus: null, createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 2, tenantId: null, datasetId: 2, name: '部门榜至少包含一行', type: 'row_count',
    field: null, severity: 'medium', config: { minRows: 1 }, cron: null, timezone: 'Asia/Shanghai',
    enabled: true, lastRunAt: null, lastStatus: null, createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

/** 数值 0 表示对应日配额不限；仍保留并发上限保护数据库。 */
export const SEED_REPORT_QUERY_QUOTAS: ReportQueryQuota[] = [
  {
    id: 1, tenantId: null, scope: 'tenant', userId: null, maxConcurrent: 20,
    dailyQueryLimit: 0, dailyRowLimit: 0, dailyByteLimit: 0, dailyCostLimit: 0,
    resetTimezone: 'Asia/Shanghai', enabled: true, createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

export const SEED_REPORT_SLA_RULES: ReportSlaRule[] = [
  {
    id: 1, tenantId: null, datasetId: 2, name: '部门用户榜质量分',
    type: 'dq_score', targetValue: 95, warningValue: 98, windowMinutes: 1440,
    cron: '15 7 * * *', timezone: 'Asia/Shanghai', severity: 'high', channels: ['inApp'],
    recipients: null, webhookUrl: null, silenceMins: 120, enabled: true,
    lastEvaluatedAt: null, lastNotifiedAt: null, createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

export const SEED_REPORT_ASSET_TEMPLATES: ReportAssetTemplate[] = [
  {
    id: 1, tenantId: null, folderId: 6, ownerId: 1, code: 'standard_analysis_dashboard',
    name: '标准分析仪表盘', type: 'dashboard', description: '带筛选区的空白分析仪表盘，可复用后绑定数据集。',
    content: {
      layout: [],
      canvasLayout: [],
      widgets: [],
      filters: [],
      config: { theme: 'light', refreshInterval: 0 },
      status: 'enabled',
      remark: '由报表资产模板创建',
    },
    previewFileId: null, version: 1, usageCount: 0, status: 'enabled',
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

export const SEED_REPORT_FILL_TEMPLATES: ReportFillTemplate[] = [
  {
    id: 1,
    tenantId: null,
    folderId: 7,
    ownerId: 1,
    code: 'monthly_operation_fill',
    name: '月度运营数据填报',
    description: '示例填报模板：提交后进入人工审核，通过后同步到生成数据集。',
    formSchema: {
      fields: [
        { key: 'period', label: '统计月份', type: 'date', dateFormat: 'YYYY-MM', required: true },
        { key: 'department', label: '部门', type: 'text', required: true, maxLength: 64 },
        { key: 'activeUsers', label: '活跃用户数', type: 'number', required: true, min: 0, precision: 0, unit: '人' },
        { key: 'revenue', label: '营业收入', type: 'amount', required: true, min: 0, precision: 2, currency: 'CNY', unit: '元' },
        { key: 'remark', label: '备注', type: 'textarea', required: false, maxLength: 500 },
      ],
      settings: {
        description: '请按月填报运营数据。审核通过后数据会异步同步到报表数据集。',
        submitButtonText: '提交审核',
        labelPosition: 'left',
        labelWidth: 96,
      },
    },
    publishedSchema: {
      fields: [
        { key: 'period', label: '统计月份', type: 'date', dateFormat: 'YYYY-MM', required: true },
        { key: 'department', label: '部门', type: 'text', required: true, maxLength: 64 },
        { key: 'activeUsers', label: '活跃用户数', type: 'number', required: true, min: 0, precision: 0, unit: '人' },
        { key: 'revenue', label: '营业收入', type: 'amount', required: true, min: 0, precision: 2, currency: 'CNY', unit: '元' },
        { key: 'remark', label: '备注', type: 'textarea', required: false, maxLength: 500 },
      ],
      settings: {
        description: '请按月填报运营数据。审核通过后数据会异步同步到报表数据集。',
        submitButtonText: '提交审核',
        labelPosition: 'left',
        labelWidth: 96,
      },
    },
    publishedRevision: 1,
    workflowDefinitionId: null,
    needReview: true,
    generatedDatasetId: null,
    status: 'published',
    revision: 1,
    publishedAt: SEED_DATE,
    publishedBy: 1,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

// ─── 开放平台：API Scope 注册表 ───────────────────────────────────────────────
export const SEED_API_SCOPES: ApiScope[] = [
  { id: 1, code: 'openid',         name: 'OpenID（身份）',   description: '确认用户身份（用户 ID）',   scopeGroup: 'user',    status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, code: 'profile',        name: 'Profile（资料）',  description: '读取基本信息（昵称、头像）', scopeGroup: 'user',    status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, code: 'email',          name: 'Email（邮箱）',    description: '读取邮箱地址',              scopeGroup: 'user',    status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4, code: 'offline_access', name: '离线访问',         description: '允许在用户离线时续签令牌',   scopeGroup: 'user',    status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 5, code: 'user:read',      name: '读取用户',         description: '读取开放平台用户资源',       scopeGroup: 'user',    status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 6, code: 'data:read',      name: '读取数据',         description: '调用只读数据类接口',         scopeGroup: 'data',    status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 7, code: 'data:write',     name: '写入数据',         description: '调用写入/变更类接口',        scopeGroup: 'data',    status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 8, code: 'order:read',     name: '读取订单',         description: '读取订单数据',              scopeGroup: 'order',   status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 9, code: 'cms:read',       name: '读取 CMS 内容',    description: '读取 CMS 栏目与已发布内容（Headless API）', scopeGroup: 'data', status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 开放平台：限流套餐 ───────────────────────────────────────────────────────
export const SEED_RATE_PLANS: RatePlan[] = [
  { id: 1, code: 'free',       name: '免费版',   description: '默认套餐，适合接入调试',     qpsLimit: 5,   dailyQuota: 10000,    monthlyQuota: 200000,    isDefault: true,  status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, code: 'pro',        name: '专业版',   description: '适合中小规模生产调用',       qpsLimit: 50,  dailyQuota: 500000,   monthlyQuota: 10000000,  isDefault: false, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, code: 'enterprise', name: '企业版',   description: '高并发，配额不限',           qpsLimit: 500, dailyQuota: 0,        monthlyQuota: 0,         isDefault: false, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 规则中心：决策表种子 ────────────────────────────────────────────────────────
export const SEED_DECISION_TABLES = [
  {
    id: 1,
    key: 'member_level',
    name: '会员等级判定',
    description: '按累计消费金额判定会员等级',
    hitPolicy: 'first' as const,
    inputs: [{ key: 'amount', label: '累计金额', expr: 'form.amount', type: 'number' as const }],
    outputs: [{ key: 'level', label: '等级', type: 'string' as const }, { key: 'discount', label: '折扣', type: 'number' as const }],
    rules: [
      { id: 'r1', when: ['>= 10000'], then: { level: 'gold', discount: 0.8 } },
      { id: 'r2', when: ['>= 3000'], then: { level: 'silver', discount: 0.9 } },
      { id: 'r3', when: ['-'], then: { level: 'normal', discount: 1 } },
    ],
  },
];

// ─── 规则中心：决策流种子 ────────────────────────────────────────────────────────
export const SEED_DECISION_FLOWS = [
  {
    id: 1,
    key: 'member_benefit_flow',
    name: '会员权益决策流',
    description: '示例：先判定会员等级，再基于等级输出叠加计算（步骤输出并入 scope 供后续引用）',
    steps: [
      { id: 's1', tableKey: 'member_level', label: '等级判定' },
    ],
  },
];

// ─── 规则中心：名单库种子 ────────────────────────────────────────────────────────
export const SEED_RULE_LISTS = [
  { id: 1, key: 'risk_blacklist', name: '风控黑名单', type: 'black' as const, description: '命中即拒绝的高风险主体（手机号/用户ID/IP 等）', status: 'enabled' as const },
  { id: 2, key: 'vip_whitelist',  name: 'VIP 白名单', type: 'white' as const, description: '免风控校验的可信主体', status: 'enabled' as const },
];

export const SEED_RULE_LIST_ITEMS = [
  { id: 1, listId: 1, value: '13800000000', label: '演示黑名单手机号', expiresAt: null, remark: '示例数据' },
  { id: 2, listId: 1, value: '198.51.100.23', label: '恶意 IP', expiresAt: null, remark: '示例数据' },
  { id: 3, listId: 2, value: 'member_1001', label: '演示 VIP 会员', expiresAt: null, remark: '示例数据' },
];

// ─── 意见反馈初始数据 ─────────────────────────────────────────────────────────
export const SEED_USER_FEEDBACKS: UserFeedback[] = [
  { id: 1, userId: 1, userNickname: '管理员', score: 5, category: 'suggestion', content: '整体体验很流畅，希望列表页支持自定义每页条数的默认值', pagePath: '/system/users', status: 'resolved', handleRemark: '已在偏好设置中支持', handledBy: 1, handlerNickname: '管理员', handledAt: '2024-01-02 10:00:00', createdAt: SEED_DATE, updatedAt: '2024-01-02 10:00:00' },
  { id: 2, userId: 1, userNickname: '管理员', score: 3, category: 'bug', content: '导出中心偶尔出现任务状态不刷新的情况，需要手动点刷新', pagePath: '/system/export-jobs', status: 'processing', handleRemark: '排查中，疑似 WS 断线重连问题', handledBy: 1, handlerNickname: '管理员', handledAt: '2024-01-03 15:30:00', createdAt: '2024-01-03 09:00:00', updatedAt: '2024-01-03 15:30:00' },
  { id: 3, userId: 1, userNickname: '管理员', score: 4, category: 'ux', content: '暗色模式下部分图表文字对比度偏低', pagePath: '/', status: 'pending', handleRemark: null, handledBy: null, handlerNickname: null, handledAt: null, createdAt: '2024-01-05 14:20:00', updatedAt: '2024-01-05 14:20:00' },
  { id: 4, userId: 1, userNickname: '管理员', score: null, category: 'other', content: '建议文档站增加全文搜索', pagePath: '/system/configs', status: 'ignored', handleRemark: '文档站已有搜索入口', handledBy: 1, handlerNickname: '管理员', handledAt: '2024-01-06 11:00:00', createdAt: '2024-01-06 08:45:00', updatedAt: '2024-01-06 11:00:00' },
];

// ─── 行为中心阶段 1：服务端权威语义事件 Tracking Plan 初始种子 ─────────────────
// 首批服务端事件（支付 / 工作流 / 会员关键操作）的事件字典契约，供 DB 种子与 MSW mock 共同派生，
// eventName 必须与 ANALYTICS_SEMANTIC_EVENT_NAMES（constants.ts）以及各来源事件总线订阅者产出的
// eventName 完全一致，否则 Tracking Plan 治理（propertySchema 校验）与事件字典展示会失配。
export interface SeedAnalyticsEventMeta {
  /** 仅供 MSW mock 内存列表展示排序使用，不写入 DB（DB 侧以 eventName 唯一索引 upsert，id 由数据库自增）*/
  id: number;
  eventName: AnalyticsSemanticEventName;
  displayName: string;
  category: 'payment' | 'workflow' | 'member' | 'system';
  description: string;
  propertySchema: AnalyticsEventPropertyDef[];
  strictMode: boolean;
}

const PAYMENT_BASE_SCHEMA: AnalyticsEventPropertyDef[] = [
  { key: 'orderNo', type: 'string', required: true, description: '支付订单号' },
  { key: 'bizType', type: 'string', required: true, description: '业务类型（如 member_recharge）' },
  { key: 'bizId', type: 'string', required: true, description: '业务记录主键' },
  { key: 'channel', type: 'string', description: '支付渠道' },
  { key: 'amount', type: 'number', required: true, description: '金额（分）' },
];

const REFUND_SCHEMA: AnalyticsEventPropertyDef[] = [
  { key: 'orderNo', type: 'string', required: true, description: '原支付订单号' },
  { key: 'bizType', type: 'string', description: '业务类型' },
  { key: 'bizId', type: 'string', description: '业务记录主键' },
  { key: 'refundNo', type: 'string', required: true, description: '退款单号' },
  { key: 'refundAmount', type: 'number', required: true, description: '退款金额（分）' },
];

const WORKFLOW_INSTANCE_SCHEMA: AnalyticsEventPropertyDef[] = [
  { key: 'instanceId', type: 'number', required: true, description: '流程实例 ID' },
  { key: 'definitionId', type: 'number', description: '流程定义 ID' },
  { key: 'status', type: 'string', description: '实例状态' },
];

const WORKFLOW_NODE_SCHEMA: AnalyticsEventPropertyDef[] = [
  { key: 'instanceId', type: 'number', required: true, description: '流程实例 ID' },
  { key: 'nodeKey', type: 'string', required: true, description: '节点 key' },
  { key: 'nodeName', type: 'string', description: '节点名称' },
  { key: 'nodeType', type: 'string', description: '节点类型' },
];

const WORKFLOW_TASK_SCHEMA: AnalyticsEventPropertyDef[] = [
  { key: 'instanceId', type: 'number', required: true, description: '流程实例 ID' },
  { key: 'taskId', type: 'number', required: true, description: '审批任务 ID' },
  { key: 'nodeKey', type: 'string', description: '所在节点 key' },
  { key: 'status', type: 'string', description: '任务状态' },
];

const MEMBER_POINTS_SCHEMA: AnalyticsEventPropertyDef[] = [
  { key: 'memberId', type: 'number', required: true, description: '会员 ID' },
  { key: 'amount', type: 'number', required: true, description: '带符号变动量' },
  { key: 'balanceAfter', type: 'number', required: true, description: '变动后余额' },
  { key: 'bizType', type: 'string', description: '业务类型' },
  { key: 'bizId', type: 'string', description: '业务记录主键' },
];

const MEMBER_COUPON_SCHEMA: AnalyticsEventPropertyDef[] = [
  { key: 'memberId', type: 'number', required: true, description: '会员 ID' },
  { key: 'couponId', type: 'number', required: true, description: '优惠券模板 ID' },
  { key: 'memberCouponId', type: 'number', description: '会员领券记录 ID' },
  { key: 'bizType', type: 'string', description: '核销业务类型' },
  { key: 'bizId', type: 'string', description: '核销业务记录主键' },
];


export const SEED_ANALYTICS_SITES: AnalyticsSite[] = [
  { id: 1, tenantId: null, tenantName: null, name: '管理后台', appId: 'admin', siteKey: 'zk_admin_default_0000000000000000', allowedOrigins: null, dailyEventQuota: null, todayUsage: 0, status: 'enabled', remark: '平台默认管理后台站点', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, tenantId: null, tenantName: null, name: '会员端', appId: 'member', siteKey: 'zk_member_default_000000000000000', allowedOrigins: null, dailyEventQuota: null, todayUsage: 0, status: 'enabled', remark: '平台默认会员端站点', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_ANALYTICS_EVENT_META: SeedAnalyticsEventMeta[] = [
  // ── A/B 实验（source=web_*，SDK getVariant 自动上报）──
  { id: 1050, eventName: ANALYTICS_EXPERIMENT_EXPOSURE_EVENT, displayName: ANALYTICS_SEMANTIC_EVENT_LABELS[ANALYTICS_EXPERIMENT_EXPOSURE_EVENT], category: 'system', description: 'A/B 实验变体曝光（SDK getVariant 自动上报）', propertySchema: [
    { key: 'expKey', type: 'string', required: true, description: '实验标识' },
    { key: 'variantKey', type: 'string', required: true, description: '变体标识' },
  ], strictMode: true },
  // ── 支付中心（source=server，来自 paymentEventBus）──
  { id: 1001, eventName: 'payment.succeeded', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['payment.succeeded'], category: 'payment', description: '支付订单支付成功（服务端权威事件，来自 paymentEventBus）', propertySchema: PAYMENT_BASE_SCHEMA, strictMode: false },
  { id: 1002, eventName: 'payment.closed', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['payment.closed'], category: 'payment', description: '支付订单超时关闭（服务端权威事件，来自 paymentEventBus）', propertySchema: PAYMENT_BASE_SCHEMA, strictMode: false },
  { id: 1003, eventName: 'payment.failed', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['payment.failed'], category: 'payment', description: '支付订单支付失败（服务端权威事件，来自 paymentEventBus）', propertySchema: PAYMENT_BASE_SCHEMA, strictMode: false },
  { id: 1004, eventName: 'refund.succeeded', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['refund.succeeded'], category: 'payment', description: '退款成功（服务端权威事件，来自 paymentEventBus）', propertySchema: REFUND_SCHEMA, strictMode: false },
  { id: 1005, eventName: 'refund.failed', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['refund.failed'], category: 'payment', description: '退款失败（服务端权威事件，来自 paymentEventBus）', propertySchema: REFUND_SCHEMA, strictMode: false },
  // ── 工作流（source=server，来自 workflowEventBus，经 event_dispatch 作业投递）──
  { id: 1010, eventName: 'workflow.instance.created', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.instance.created'], category: 'workflow', description: '流程实例发起（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_INSTANCE_SCHEMA, strictMode: false },
  { id: 1011, eventName: 'workflow.instance.approved', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.instance.approved'], category: 'workflow', description: '流程实例审批通过（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_INSTANCE_SCHEMA, strictMode: false },
  { id: 1012, eventName: 'workflow.instance.rejected', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.instance.rejected'], category: 'workflow', description: '流程实例被驳回（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_INSTANCE_SCHEMA, strictMode: false },
  { id: 1013, eventName: 'workflow.instance.withdrawn', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.instance.withdrawn'], category: 'workflow', description: '流程实例被撤回（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_INSTANCE_SCHEMA, strictMode: false },
  { id: 1014, eventName: 'workflow.node.entered', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.node.entered'], category: 'workflow', description: '流程节点进入（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_NODE_SCHEMA, strictMode: false },
  { id: 1015, eventName: 'workflow.node.left', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.node.left'], category: 'workflow', description: '流程节点离开（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_NODE_SCHEMA, strictMode: false },
  { id: 1016, eventName: 'workflow.task.created', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.task.created'], category: 'workflow', description: '审批任务创建（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_TASK_SCHEMA, strictMode: false },
  { id: 1017, eventName: 'workflow.task.assigned', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.task.assigned'], category: 'workflow', description: '审批任务分配（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_TASK_SCHEMA, strictMode: false },
  { id: 1018, eventName: 'workflow.task.approved', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.task.approved'], category: 'workflow', description: '审批任务通过（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_TASK_SCHEMA, strictMode: false },
  { id: 1019, eventName: 'workflow.task.rejected', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.task.rejected'], category: 'workflow', description: '审批任务驳回（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_TASK_SCHEMA, strictMode: false },
  { id: 1020, eventName: 'workflow.task.skipped', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.task.skipped'], category: 'workflow', description: '审批任务自动跳过（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_TASK_SCHEMA, strictMode: false },
  { id: 1021, eventName: 'workflow.task.transferred', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.task.transferred'], category: 'workflow', description: '审批任务转办/改派（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_TASK_SCHEMA, strictMode: false },
  { id: 1022, eventName: 'workflow.task.addSigned', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.task.addSigned'], category: 'workflow', description: '审批任务加签（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_TASK_SCHEMA, strictMode: false },
  { id: 1023, eventName: 'workflow.task.reduceSigned', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.task.reduceSigned'], category: 'workflow', description: '审批任务减签（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_TASK_SCHEMA, strictMode: false },
  { id: 1024, eventName: 'workflow.task.urged', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['workflow.task.urged'], category: 'workflow', description: '审批任务催办（服务端权威事件，来自 workflowEventBus）', propertySchema: WORKFLOW_TASK_SCHEMA, strictMode: false },
  // ── 会员关键操作（source=server，业务 service 成功后直接调用）──
  { id: 1030, eventName: 'member.registered', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['member.registered'], category: 'member', description: '会员注册成功（服务端权威事件）', propertySchema: [
    { key: 'memberId', type: 'number', required: true, description: '会员 ID' },
    { key: 'source', type: 'string', description: '注册来源' },
    { key: 'hasPhone', type: 'boolean', description: '是否绑定手机号' },
    { key: 'hasEmail', type: 'boolean', description: '是否绑定邮箱' },
  ], strictMode: false },
  { id: 1031, eventName: 'member.profile.updated', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['member.profile.updated'], category: 'member', description: '会员资料更新（服务端权威事件，不含具体字段值）', propertySchema: [
    { key: 'memberId', type: 'number', required: true, description: '会员 ID' },
    { key: 'changedFields', type: 'array', description: '本次变更的字段名列表（不含值）' },
  ], strictMode: false },
  { id: 1032, eventName: 'member.points.earned', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['member.points.earned'], category: 'member', description: '会员积分获得（服务端权威事件，来自 changePoints）', propertySchema: MEMBER_POINTS_SCHEMA, strictMode: false },
  { id: 1033, eventName: 'member.points.redeemed', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['member.points.redeemed'], category: 'member', description: '会员积分消费（服务端权威事件，来自 changePoints）', propertySchema: MEMBER_POINTS_SCHEMA, strictMode: false },
  { id: 1034, eventName: 'member.points.adjusted', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['member.points.adjusted'], category: 'member', description: '会员积分人工调整（服务端权威事件，来自 changePoints）', propertySchema: MEMBER_POINTS_SCHEMA, strictMode: false },
  { id: 1035, eventName: 'member.points.expired', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['member.points.expired'], category: 'member', description: '会员积分过期清零（服务端权威事件，来自 changePoints）', propertySchema: MEMBER_POINTS_SCHEMA, strictMode: false },
  { id: 1036, eventName: 'member.points.refunded', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['member.points.refunded'], category: 'member', description: '会员积分退回（服务端权威事件，来自 changePoints）', propertySchema: MEMBER_POINTS_SCHEMA, strictMode: false },
  { id: 1037, eventName: 'member.coupon.received', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['member.coupon.received'], category: 'member', description: '会员领取优惠券（服务端权威事件）', propertySchema: MEMBER_COUPON_SCHEMA, strictMode: false },
  { id: 1038, eventName: 'member.coupon.redeemed', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['member.coupon.redeemed'], category: 'member', description: '会员核销优惠券（服务端权威事件）', propertySchema: MEMBER_COUPON_SCHEMA, strictMode: false },
  { id: 1039, eventName: 'member.checkin.completed', displayName: ANALYTICS_SEMANTIC_EVENT_LABELS['member.checkin.completed'], category: 'member', description: '会员签到完成（服务端权威事件）', propertySchema: [
    { key: 'memberId', type: 'number', required: true, description: '会员 ID' },
    { key: 'consecutiveDays', type: 'number', description: '连续签到天数' },
    { key: 'pointsAwarded', type: 'number', description: '本次奖励积分' },
    { key: 'experienceAwarded', type: 'number', description: '本次奖励经验值' },
    { key: 'checkinDate', type: 'string', description: '签到日期（YYYY-MM-DD）' },
  ], strictMode: false },
];

// ─── CMS：站点 / 模型 / 栏目 / 内容 / 标签 / 碎片 / 友链 ─────────────────────────
export const SEED_CMS_SITES: CmsSite[] = [
  {
    id: 1, name: 'Zenith 官方网站', code: 'main', domain: null, aliasDomains: [], isDefault: true,
    title: 'Zenith Admin — 企业级全栈管理系统', keywords: 'Zenith,CMS,后台管理,内容管理',
    description: 'Zenith Admin 是基于 Hono + React + PostgreSQL 的企业级全栈管理系统，内置 CMS 内容管理、多站点与全文检索。',
    logo: null, favicon: null, icp: null, copyright: '© 2024 Zenith Admin', theme: 'default',
    themeRevision: 0, templateRefsRevision: 0, staticMode: 'hybrid', robots: null, settings: {}, status: 'enabled', sort: 0, remark: '默认演示站点',
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

export const SEED_CMS_PUBLISH_CHANNELS: CmsPublishChannel[] = [
  { id: 1, siteId: 1, name: 'PC 桌面', code: 'pc', domain: null, uaRegex: null, isDefault: true, status: 'enabled', sort: 1, remark: '默认通道', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, siteId: 1, name: 'H5 移动', code: 'h5', domain: null, uaRegex: 'Mobile|Android|iPhone', isDefault: false, status: 'enabled', sort: 2, remark: '移动端通道（绑定域名后按 UA 自动跳转）', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_CMS_MODELS: (CmsModel & { fields: NonNullable<CmsModel['fields']> })[] = [
  {
    id: 1, name: '文章', code: 'article', description: '通用图文文章模型', isSystem: true,
    status: 'enabled', sort: 1, createdAt: SEED_DATE, updatedAt: SEED_DATE,
    fields: [],
  },
  {
    id: 2, name: '产品', code: 'product', description: '产品展示模型（含价格/规格自定义字段）', isSystem: true,
    status: 'enabled', sort: 2, createdAt: SEED_DATE, updatedAt: SEED_DATE,
    fields: [
      { id: 1, modelId: 2, name: 'price', label: '价格', fieldType: 'text', required: false, searchable: false, showInList: true, placeholder: '如：￥9999', defaultValue: null, options: null, sort: 1, createdAt: SEED_DATE, updatedAt: SEED_DATE },
      { id: 2, modelId: 2, name: 'spec', label: '规格参数', fieldType: 'textarea', required: false, searchable: true, showInList: false, placeholder: null, defaultValue: null, options: null, sort: 2, createdAt: SEED_DATE, updatedAt: SEED_DATE },
    ],
  },
];

export const SEED_CMS_CHANNELS: CmsChannel[] = [
  { id: 1, siteId: 1, parentId: 0, modelId: 1, name: '新闻中心', slug: 'news',     path: 'news',     type: 'list', linkUrl: null, listTemplate: null, detailTemplate: null, pageSize: 20, pageContent: null, seoTitle: null, seoKeywords: null, seoDescription: '最新公司动态与行业资讯', image: null, visible: true, status: 'enabled', sort: 1, settings: {}, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, siteId: 1, parentId: 0, modelId: 2, name: '产品中心', slug: 'products', path: 'products', type: 'list', linkUrl: null, listTemplate: null, detailTemplate: null, pageSize: 20, pageContent: null, seoTitle: null, seoKeywords: null, seoDescription: '产品与解决方案', image: null, visible: true, status: 'enabled', sort: 2, settings: {}, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, siteId: 1, parentId: 0, modelId: null, name: '关于我们', slug: 'about', path: 'about',    type: 'page', linkUrl: null, listTemplate: null, detailTemplate: null, pageSize: 20, pageContent: '<h2>关于 Zenith</h2><p>Zenith Admin 是一套企业级全栈管理系统，本页面由 CMS 单页栏目渲染。</p>', seoTitle: null, seoKeywords: null, seoDescription: '关于 Zenith Admin', image: null, visible: true, status: 'enabled', sort: 3, settings: {}, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_CMS_TAGS: CmsTag[] = [
  { id: 1, siteId: 1, name: '产品发布', slug: 'release',  groupName: '产品', contentCount: 1, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, siteId: 1, name: '行业动态', slug: 'industry', groupName: '资讯', contentCount: 1, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_CMS_CONTENTS: (CmsContent & { tagIds: number[] })[] = [
  {
    id: 1, siteId: 1, channelId: 1, channelName: '新闻中心', modelId: 1,
    contentType: 'article', mediaData: {},
    title: 'Zenith Admin 发布 CMS 内容管理模块', subTitle: null, shortTitle: 'CMS 模块发布', slug: null,
    summary: '全新 CMS 模块支持多站点、SEO 优化、SSR 静态化发布与基于 PostgreSQL 的中文全文检索。',
    coverImage: null, coverThumb: null, author: '管理员', editor: '管理员', source: '官方', sourceUrl: null, isOriginal: true, body: '<p>Zenith Admin 全新 CMS 模块正式发布：支持站群管理、内容模型自定义字段、React SSR 静态化与 PostgreSQL 全文检索，功能全面对标国内主流 CMS。</p>',
    extend: {}, externalLink: null, detailTemplate: null, isTop: true, topWeight: 10, topExpireAt: null, isRecommend: true, isHot: false,
    status: 'published', rejectReason: null, publishedAt: SEED_DATE, scheduledAt: null, expireAt: null,
    viewCount: 128, likeCount: 0, favoriteCount: 0, version: 1, sort: 0, seoTitle: null, seoKeywords: 'CMS,发布', seoDescription: null, socialImageAlt: null, twitterCreator: null,
    archivedAt: null, mappingSourceId: null, lockedAt: null, lockedBy: null, lockReason: null,
    tagIds: [1], extraChannelIds: [2], relatedIds: [2], createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 2, siteId: 1, channelId: 1, channelName: '新闻中心', modelId: 1,
    contentType: 'article', mediaData: {},
    title: '内容管理系统选型指南：静态化与全文检索实践', subTitle: null, shortTitle: null, slug: null,
    summary: '解析传统 CMS 的静态化方案与现代 SSR 渲染的结合方式，以及不依赖 Elasticsearch 的 PostgreSQL 全文检索实现。',
    coverImage: null, coverThumb: null, author: '管理员', editor: null, source: '原创', sourceUrl: null, isOriginal: true, body: '<p>本文介绍混合静态化模式（发布时增量生成 + 访问时回写）与应用层中文分词方案在 PostgreSQL tsvector 上的落地实践。</p>',
    extend: {}, externalLink: null, detailTemplate: null, isTop: false, topWeight: 0, topExpireAt: null, isRecommend: true, isHot: true,
    status: 'published', rejectReason: null, publishedAt: SEED_DATE, scheduledAt: null, expireAt: null,
    viewCount: 86, likeCount: 0, favoriteCount: 0, version: 1, sort: 0, seoTitle: null, seoKeywords: '静态化,全文检索', seoDescription: null, socialImageAlt: null, twitterCreator: null,
    archivedAt: null, mappingSourceId: null, lockedAt: null, lockedBy: null, lockReason: null,
    tagIds: [2], extraChannelIds: [], relatedIds: [1], createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 3, siteId: 1, channelId: 2, channelName: '产品中心', modelId: 2,
    contentType: 'article', mediaData: {},
    title: 'Zenith 企业版', subTitle: '一体化数字化底座', shortTitle: null, slug: 'enterprise',
    summary: '面向中大型企业的一体化数字化底座。',
    coverImage: null, coverThumb: null, author: null, editor: null, source: null, sourceUrl: null, isOriginal: false, body: '<p>Zenith 企业版提供完整的权限体系、工作流引擎、支付中心与 CMS 内容管理能力。</p>',
    extend: { price: '联系销售', spec: '支持私有化部署，PostgreSQL 16 + Redis 7' }, externalLink: null, detailTemplate: null,
    isTop: false, topWeight: 0, topExpireAt: null, isRecommend: false, isHot: false,
    status: 'published', rejectReason: null, publishedAt: SEED_DATE, scheduledAt: null, expireAt: null,
    viewCount: 45, likeCount: 0, favoriteCount: 0, version: 1, sort: 0, seoTitle: null, seoKeywords: null, seoDescription: null, socialImageAlt: null, twitterCreator: null,
    archivedAt: null, mappingSourceId: null, lockedAt: null, lockedBy: null, lockReason: null,
    tagIds: [], createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 4, siteId: 1, channelId: 1, channelName: '新闻中心', modelId: 1,
    contentType: 'album', mediaData: {
      images: [
        { url: 'https://picsum.photos/seed/zenith-album-1/1200/800', thumb: 'https://picsum.photos/seed/zenith-album-1/400/267', caption: '发布会现场' },
        { url: 'https://picsum.photos/seed/zenith-album-2/1200/800', thumb: 'https://picsum.photos/seed/zenith-album-2/400/267', caption: '圆桌讨论' },
        { url: 'https://picsum.photos/seed/zenith-album-3/1200/800', thumb: 'https://picsum.photos/seed/zenith-album-3/400/267', caption: null },
      ],
    },
    title: '产品发布会精彩瞬间（图集）', subTitle: null, shortTitle: '发布会图集', slug: null,
    summary: 'Zenith Admin 年度产品发布会现场图集。',
    coverImage: 'https://picsum.photos/seed/zenith-album-1/1200/800', coverThumb: 'https://picsum.photos/seed/zenith-album-1/400/267',
    author: '管理员', editor: null, source: '官方', sourceUrl: null, isOriginal: true, body: '<p>发布会现场图集，点击图片查看大图。</p>',
    extend: {}, externalLink: null, detailTemplate: null, isTop: false, topWeight: 0, topExpireAt: null, isRecommend: true, isHot: false,
    hasImage: true,
    status: 'published', rejectReason: null, publishedAt: SEED_DATE, scheduledAt: null, expireAt: null,
    viewCount: 66, likeCount: 0, favoriteCount: 0, version: 1, sort: 0, seoTitle: null, seoKeywords: '发布会,图集', seoDescription: null, socialImageAlt: 'Zenith 产品发布会现场', twitterCreator: '@zenith_admin',
    archivedAt: null, mappingSourceId: null, lockedAt: null, lockedBy: null, lockReason: null,
    tagIds: [1], createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 5, siteId: 1, channelId: 1, channelName: '新闻中心', modelId: 1,
    contentType: 'media', mediaData: {
      mediaType: 'video',
      mediaUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
      poster: 'https://picsum.photos/seed/zenith-video/1200/675',
      duration: '00:06',
    },
    title: '三分钟了解 Zenith CMS（视频）', subTitle: null, shortTitle: null, slug: null,
    summary: '视频快速导览：站群、静态化、全文检索与多形态内容。',
    coverImage: 'https://picsum.photos/seed/zenith-video/1200/675', coverThumb: null,
    author: '管理员', editor: null, source: '官方', sourceUrl: null, isOriginal: true, body: '<p>视频简介：本片演示 CMS 模块核心能力。</p>',
    extend: {}, externalLink: null, detailTemplate: null, isTop: false, topWeight: 0, topExpireAt: null, isRecommend: false, isHot: true,
    hasImage: true, hasVideo: true,
    status: 'published', rejectReason: null, publishedAt: SEED_DATE, scheduledAt: null, expireAt: null,
    viewCount: 88, likeCount: 0, favoriteCount: 0, version: 1, sort: 0, seoTitle: null, seoKeywords: '视频,导览', seoDescription: null, socialImageAlt: 'Zenith CMS 视频导览', twitterCreator: '@zenith_admin',
    archivedAt: null, mappingSourceId: null, lockedAt: null, lockedBy: null, lockReason: null,
    tagIds: [], createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

export const SEED_CMS_CONTENT_CHANNELS = [
  { contentId: 1, channelId: 2 },
];

export const SEED_CMS_CONTENT_RELATIONS = [
  { contentId: 1, relatedId: 2, sort: 1 },
  { contentId: 2, relatedId: 1, sort: 1 },
];

export const SEED_CMS_CONTENT_VERSIONS: CmsContentVersion[] = [
  {
    id: 1,
    contentId: 1,
    version: 1,
    title: 'Zenith Admin 发布 CMS 内容管理模块',
    snapshot: { title: 'Zenith Admin 发布 CMS 内容管理模块', summary: '首个已发布版本' },
    remark: 'Demo 初始发布快照',
    createdByName: '管理员',
    createdAt: SEED_DATE,
  },
];

export const SEED_CMS_FRAGMENTS: CmsFragment[] = [
  { id: 1, siteId: 1, code: 'home-banner', name: '首页横幅', type: 'html', content: '<div style="padding:28px 24px;background:linear-gradient(120deg,#1f6feb,#0969da);border-radius:10px;color:#fff"><h2 style="margin:0 0 6px;font-size:22px">Zenith CMS</h2><p style="margin:0;opacity:.85">多站点 · SEO · SSR 静态化 · PostgreSQL 全文检索</p></div>', status: 'enabled', remark: '首页顶部横幅区块', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, siteId: 1, code: 'home-side',   name: '首页侧栏', type: 'html', content: '<p style="font-size:13px;color:#59636e">碎片内容可在后台「碎片管理」中随时修改，无需改代码。</p>', status: 'enabled', remark: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_CMS_FRIEND_LINKS: CmsFriendLink[] = [
  { id: 1, siteId: 1, name: 'Hono',       url: 'https://hono.dev',           logo: null, status: 'enabled', sort: 1, remark: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, siteId: 1, name: 'PostgreSQL', url: 'https://www.postgresql.org', logo: null, status: 'enabled', sort: 2, remark: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── CMS 素材中心（P2 示例素材）──────────────────────────────────────────────────
export const SEED_CMS_RESOURCES: CmsResource[] = [
  { id: 1, siteId: 1, folderId: 1, type: 'image', name: 'demo-avatar-01.svg', url: '/avatars/avatar-01.svg', thumbUrl: null, fileId: null, size: 4096, width: 128, height: 128, mimeType: 'image/svg+xml', remark: '演示素材（外链登记）', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, siteId: 1, folderId: 1, type: 'image', name: 'demo-avatar-02.svg', url: '/avatars/avatar-02.svg', thumbUrl: null, fileId: null, size: 4096, width: 128, height: 128, mimeType: 'image/svg+xml', remark: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, siteId: 1, folderId: 2, type: 'document', name: '产品白皮书.pdf', url: '/files/demo-whitepaper.pdf', thumbUrl: null, fileId: null, size: 1048576, width: null, height: null, mimeType: 'application/pdf', remark: '示例文档素材', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_CMS_RESOURCE_FOLDERS: CmsResourceFolder[] = [
  { id: 1, siteId: 1, parentId: null, name: '图片素材', sort: 1, resourceCount: 2, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, siteId: 1, parentId: null, name: '文档资料', sort: 2, resourceCount: 1, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_CMS_SEARCH_WORDS: CmsSearchWord[] = [
  { id: 1, siteId: 1, word: 'ZenithAdmin', type: 'extension', groupName: '品牌词', weight: 3000, status: 'enabled', remark: '品牌完整词（词典 token 不含空白）', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, siteId: 1, word: '的', type: 'stop', groupName: '通用停用词', weight: 1, status: 'enabled', remark: '过滤低价值助词', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_CMS_HOTWORD_GROUPS: CmsHotwordGroup[] = [
  { id: 1, siteId: 1, name: '产品推荐', sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_CMS_HOTWORDS = [
  { id: 1, siteId: 1, groupId: 1, keyword: 'CMS', sort: 1, status: 'enabled' as const },
  { id: 2, siteId: 1, groupId: 1, keyword: '企业版', sort: 2, status: 'enabled' as const },
];

// ─── CMS 轻量投票（P3 示例投票）──────────────────────────────────────────────────
export const SEED_CMS_POLLS: CmsPoll[] = [
  {
    id: 1, siteId: 1, code: 'reader-vote', title: '您最期待哪些 CMS 能力？',
    options: [
      { id: 1, label: 'AI 辅助写作' },
      { id: 2, label: '可视化页面搭建' },
      { id: 3, label: '多语言站点' },
      { id: 4, label: '内容分发推送' },
    ],
    maxChoices: 2, allowAnonymous: true, startAt: null, endAt: null,
    status: 'published', totalVotes: 5, remark: '正文插入 [投票:reader-vote] 嵌入',
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

export const SEED_CMS_POLL_VOTES = [
  { id: 1, pollId: 1, memberId: 1, ip: null, optionIds: [1, 2], createdAt: SEED_DATE },
  { id: 2, pollId: 1, memberId: null, ip: '127.0.0.1', optionIds: [2], createdAt: SEED_DATE },
];

export const SEED_CMS_COLLECT_RULES: CmsCollectRule[] = [
  {
    id: 1, siteId: 1, channelId: 1, channelName: '新闻中心', name: '官方博客采集演示',
    listUrl: 'https://example.com/news?page={page}', pageStart: 1, pageEnd: 1,
    listSelector: '.news-list a', titleSelector: 'h1', bodySelector: 'article',
    summarySelector: '.summary', coverSelector: '.cover img', removeSelectors: ['.ad'],
    autoPublish: false, localizeImages: false, maxItems: 10, status: 'enabled',
    lastRunAt: SEED_DATE, remark: '仅用于展示任务中心与采集明细', createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

export const SEED_CMS_COLLECT_ITEMS: CmsCollectItem[] = [
  { id: 1, ruleId: 1, url: 'https://example.com/news/demo', title: '采集演示文章', status: 'success', contentId: 1, error: null, createdAt: SEED_DATE },
  { id: 2, ruleId: 1, url: 'https://example.com/news/failure', title: null, status: 'failed', contentId: null, error: '演示：页面结构不匹配', createdAt: SEED_DATE },
];

export const SEED_CMS_PAGES: CmsPage[] = [
  {
    id: 1, siteId: 1, name: '产品能力落地页', slug: 'capabilities', isHome: false,
    blocks: [
      { id: 'hero-1', type: 'hero', props: { title: 'Zenith CMS', subtitle: '内容、检索与素材治理一体化' } },
      { id: 'content-1', type: 'content-list', props: { title: '最新内容', channelId: 1, limit: 5 } },
    ],
    seoTitle: 'Zenith CMS 产品能力', seoKeywords: 'CMS,内容管理', seoDescription: '可视化页面搭建演示',
    status: 'enabled', remark: 'Stage 2 Demo 页面', createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

const CMS_SEED_LIST_DSL: CmsTemplateDslDocument = {
  version: 1,
  root: {
    kind: 'element', tag: 'html', attrs: { lang: 'zh-CN' }, children: [
      { kind: 'element', tag: 'head', children: [{ kind: 'component', name: 'seo_head' }] },
      {
        kind: 'element', tag: 'body', attrs: { className: 'cms-dsl-demo' }, children: [
          { kind: 'component', name: 'site_header' },
          {
            kind: 'element', tag: 'main', attrs: { className: 'cms-dsl-main' }, children: [
              { kind: 'element', tag: 'h1', children: [{ kind: 'binding', bind: 'channel.name' }] },
              { kind: 'component', name: 'breadcrumbs' },
              { kind: 'component', name: 'content_list', props: { source: 'items' } },
              { kind: 'component', name: 'pagination' },
            ],
          },
          { kind: 'component', name: 'site_footer' },
        ],
      },
    ],
  },
};

const CMS_SEED_DETAIL_DSL: CmsTemplateDslDocument = {
  version: 1,
  root: {
    kind: 'element', tag: 'html', attrs: { lang: 'zh-CN' }, children: [
      { kind: 'element', tag: 'head', children: [{ kind: 'component', name: 'seo_head' }] },
      {
        kind: 'element', tag: 'body', attrs: { className: 'cms-dsl-demo' }, children: [
          { kind: 'component', name: 'site_header' },
          {
            kind: 'element', tag: 'main', attrs: { className: 'cms-dsl-main' }, children: [
              { kind: 'component', name: 'breadcrumbs' },
              { kind: 'component', name: 'content_detail' },
            ],
          },
          { kind: 'component', name: 'site_footer' },
        ],
      },
    ],
  },
};

export const SEED_CMS_TEMPLATES: CmsTemplate[] = [
  {
    id: 1, siteId: 1, themeCode: 'default', type: 'list', code: 'list-editorial', name: '声明式资讯列表',
    source: 'manual', status: 'enabled', currentVersion: 1, activeVersion: 1, lifecycleRevision: 0,
    description: 'Stage 3 安全 DSL 演示模板（无 JS/TSX）',
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
  {
    id: 2, siteId: 1, themeCode: 'default', type: 'detail', code: 'detail-editorial', name: '声明式资讯详情',
    source: 'manual', status: 'enabled', currentVersion: 1, activeVersion: 1, lifecycleRevision: 0,
    description: '富文本由服务端 Stage 1 sanitizer 处理',
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

export const SEED_CMS_TEMPLATE_VERSIONS: CmsTemplateVersion[] = [
  {
    id: 1, templateId: 1, version: 1, dsl: CMS_SEED_LIST_DSL,
    checksum: '6f52dac3daf2a6ee6c9a915d4b13768bb7c30602ba6362a069fa23c870b2b1a5',
    changeNote: 'Stage 3 初始演示版本', themePackageId: null, createdAt: SEED_DATE,
  },
  {
    id: 2, templateId: 2, version: 1, dsl: CMS_SEED_DETAIL_DSL,
    checksum: 'ca3ca065758b9aaa3b11621e90540ec92c03d05c86b18d29e4798a7e3c5183b2',
    changeNote: 'Stage 3 初始演示版本', themePackageId: null, createdAt: SEED_DATE,
  },
];

export const SEED_CMS_THEME_PACKAGES: CmsThemePackage[] = [
  {
    id: 1,
    code: 'editorial-demo',
    name: 'Editorial 声明式主题',
    version: '1.0.0',
    engineMin: 1,
    engineMax: 1,
    signingKeyId: 'seed-demo',
    archiveChecksum: 'c1d9494cc549a00cc03978d599ae6314ffd43a9c8f06d39fcbc3ca86df7cbbb2',
    status: 'disabled',
    manifest: {
      schemaVersion: 1,
      code: 'editorial-demo',
      name: 'Editorial 声明式主题',
      version: '1.0.0',
      engine: { min: 1, max: 1 },
      templates: [
        { code: 'index-editorial', name: '主题首页', type: 'index', path: 'templates/index.json' },
        { code: 'list-editorial', name: '资讯列表', type: 'list', path: 'templates/list.json' },
        { code: 'detail-editorial', name: '资讯详情', type: 'detail', path: 'templates/detail.json' },
        { code: 'page-editorial', name: '单页', type: 'page', path: 'templates/page.json' },
        { code: 'search-editorial', name: '搜索结果', type: 'search', path: 'templates/search.json' },
        { code: 'tag-editorial', name: '标签聚合', type: 'tag', path: 'templates/tag.json' },
        { code: 'not-found-editorial', name: '未找到', type: 'not_found', path: 'templates/not-found.json' },
      ],
      assets: [],
      checksums: {
        'templates/index.json': '1111111111111111111111111111111111111111111111111111111111111111',
        'templates/list.json': '6f52dac3daf2a6ee6c9a915d4b13768bb7c30602ba6362a069fa23c870b2b1a5',
        'templates/detail.json': 'ca3ca065758b9aaa3b11621e90540ec92c03d05c86b18d29e4798a7e3c5183b2',
        'templates/page.json': '2222222222222222222222222222222222222222222222222222222222222222',
        'templates/search.json': '3333333333333333333333333333333333333333333333333333333333333333',
        'templates/tag.json': '4444444444444444444444444444444444444444444444444444444444444444',
        'templates/not-found.json': '5555555555555555555555555555555555555555555555555555555555555555',
      },
      signingKeyId: 'seed-demo',
      signature: 'seed-demo-package-is-disabled-and-must-be-reimported-with-a-trusted-signature',
    },
    validationReport: {
      valid: false,
      archiveChecksum: 'c1d9494cc549a00cc03978d599ae6314ffd43a9c8f06d39fcbc3ca86df7cbbb2',
      manifest: null,
      fileCount: 8,
      compressedBytes: 0,
      uncompressedBytes: 0,
      issues: [{ path: '$', code: 'seed_demo', message: '演示占位包已停用；请使用受信任 Ed25519 密钥重新签名并导入' }],
    },
    activeSiteIds: [],
    exportAvailable: false,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

export const SEED_CMS_PUBLISH_TASKS = [
  {
    id: 900001,
    taskType: 'cms-publish-build',
    title: 'CMS 整站发布（演示）',
    status: 'success' as const,
    payload: { siteId: 1, targetType: 'site', reason: 'Stage 3 演示发布' },
    totalCount: 3,
    processedCount: 3,
    failedCount: 0,
    progressNote: '演示发布完成',
    result: { artifacts: 3, failedArtifacts: 0, targetType: 'site' },
    attempts: 1,
    maxAttempts: 3,
    startedAt: SEED_DATE,
    completedAt: SEED_DATE,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];

export const SEED_CMS_PUBLISH_ARTIFACTS = [
  { id: 1, taskId: 900001, siteId: 1, publishChannelId: 1, targetType: 'site' as const, path: 'index.html', url: null, checksum: 'f3f39f3b8456f63a1a414a8c311260e0b73e978fdfc8e0161653c9b92fc9c4bc', size: 4280, status: 'generated' as const, generatedAt: SEED_DATE, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, taskId: 900001, siteId: 1, publishChannelId: 1, targetType: 'site' as const, path: 'sitemap.xml', url: null, checksum: 'e152f7eafc61e5aa9e0f8e83de6fdb203f415f8eaff86ab8f54cf0f9e850caef', size: 860, status: 'generated' as const, generatedAt: SEED_DATE, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, taskId: 900001, siteId: 1, publishChannelId: 1, targetType: 'site' as const, path: 'robots.txt', url: null, checksum: 'b884b75b9a9d5c1b28627a65105f0b62b7f24e633eeb3e4b3de414e8ee3dc1c4', size: 56, status: 'generated' as const, generatedAt: SEED_DATE, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_CMS_SURVEY_ANSWERS = [
  { id: 1, surveyId: 1, memberId: 1, ip: null, answers: { '1': 'opt-1-非常满意', '2': ['opt-1-站点管理', 'opt-3-全文检索'], '3': '继续完善素材治理' }, createdAt: SEED_DATE },
];

// ─── CMS P2：广告位 / 广告 / 表单 / 敏感词 / 内链词 / 评论（示例）────────────────
export const SEED_CMS_AD_SLOTS: CmsAdSlot[] = [
  { id: 1, siteId: 1, code: 'home-ad', name: '首页通栏广告位', remark: '首页横幅下方', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_CMS_ADS: CmsAd[] = [
  { id: 1, slotId: 1, name: 'Zenith 企业版上线', image: null, linkUrl: '/products/enterprise.html', startAt: null, endAt: null, clickCount: 0, viewCount: 0, sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_CMS_FORMS: CmsForm[] = [
  {
    id: 1, siteId: 1, code: 'contact', name: '联系我们',
    fields: [
      { name: 'name', label: '姓名', fieldType: 'text', required: true },
      { name: 'phone', label: '联系电话', fieldType: 'text', required: true },
      { name: 'message', label: '留言内容', fieldType: 'textarea', required: true },
    ],
    successMessage: '提交成功，我们会尽快与您联系！',
    notifyEmail: null,
    captchaProvider: 'math', turnstileSiteKey: null, turnstileSecret: null,
    status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE,
  },
];

export const SEED_CMS_SENSITIVE_WORDS: CmsSensitiveWord[] = [
  { id: 1, word: '赌博', replaceWith: null, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, word: '广告勿扰', replaceWith: '***', status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_CMS_ERROR_PRONE_WORDS: CmsErrorProneWord[] = [
  { id: 1, word: '登陆系统', correction: '登录系统', status: 'enabled', remark: '登陆=着陆义，账号进入应为登录', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, word: '按装', correction: '安装', status: 'enabled', remark: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, word: '部署完毕', correction: '部署完成', status: 'enabled', remark: '书面语统一用“完成”', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

export const SEED_CMS_LINK_WORDS: CmsLinkWord[] = [
  { id: 1, siteId: 1, keyword: '全文检索', url: '/news/2.html', maxReplaces: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── CMS P3：问卷调查（示例）────────────────────────────────────────────────────
export const SEED_CMS_SURVEYS: (CmsSurvey & { questions: CmsSurveyQuestion[] })[] = [
  {
    id: 1, siteId: 1, code: 'satisfaction', title: '产品满意度调查',
    description: '感谢使用 Zenith CMS，您的反馈将帮助我们持续改进。', status: 'published',
    allowAnonymous: true, startAt: null, endAt: null, answerCount: 1,
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
    questions: [
      {
        id: 1, surveyId: 1, label: '您对 Zenith CMS 的整体满意度？', type: 'single', required: true, sort: 0,
        options: [
          { label: '非常满意', value: 'opt-1-非常满意' },
          { label: '满意', value: 'opt-2-满意' },
          { label: '一般', value: 'opt-3-一般' },
          { label: '不满意', value: 'opt-4-不满意' },
        ],
      },
      {
        id: 2, surveyId: 1, label: '您使用过哪些功能？', type: 'multiple', required: false, sort: 1,
        options: [
          { label: '站群管理', value: 'opt-1-站群管理' },
          { label: '静态化发布', value: 'opt-2-静态化发布' },
          { label: '全文检索', value: 'opt-3-全文检索' },
          { label: '问卷调查', value: 'opt-4-问卷调查' },
        ],
      },
      { id: 3, surveyId: 1, label: '其他意见或建议', type: 'text', required: false, sort: 2, options: [] },
    ],
  },
];

export const SEED_CMS_COMMENTS: CmsComment[] = [
  { id: 1, siteId: 1, contentId: 1, parentId: 0, memberId: null, nickname: '热心网友', content: '期待 CMS 模块的采集功能！', likeCount: 3, status: 'approved', ip: null, userAgent: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, siteId: 1, contentId: 1, parentId: 0, memberId: null, nickname: '路人甲', content: '静态化方案讲得很清楚', likeCount: 0, status: 'pending', ip: null, userAgent: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, siteId: 1, contentId: 1, parentId: 0, memberId: 1, nickname: '演示会员', content: '登录会员的评论会带会员标识，支持在会员中心统一管理。', likeCount: 1, status: 'approved', ip: null, userAgent: null, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];
