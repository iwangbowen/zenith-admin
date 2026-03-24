import { db } from './index';
import { users, menus, roles, roleMenus, userRoles, dicts, dictItems, fileStorageConfigs, departments, positions, userPositions, systemConfigs, cronJobs } from './schema';
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import logger from '../lib/logger';

/**
 * 种子数据初始化脚本
 * - 使用 ON CONFLICT DO NOTHING 策略，可安全重复执行
 * - 不会覆盖已有数据，只补充缺失的种子记录
 */
async function seed() {
  logger.info('🌱 Seeding database...');

  // ─── 1. 管理员账号 ─────────────────────────────────────────────────────────
  const hashedPassword = await bcrypt.hash('123456', 10);
  await db.insert(users).values({
    username: 'admin',
    nickname: '管理员',
    email: 'admin@zenith.dev',
    password: hashedPassword,
    status: 'active',
  }).onConflictDoNothing({ target: users.username });
  logger.info('  ✔ Admin user seeded (onConflictDoNothing)');

  // ─── 2. 菜单数据 ──────────────────────────────────────────────────────────
  const menuRows = [
    { id: 1,  parentId: 0, title: '首页',    name: 'Dashboard',     path: '/', component: 'dashboard/DashboardPage',              icon: 'Home',           type: 'menu' as const,      sort: 1,  status: 'active' as const, visible: true },
    { id: 2,  parentId: 0, title: '系统管理',   name: 'System',        path: undefined, component: undefined,        icon: 'Settings',       type: 'directory' as const, sort: 2,  status: 'active' as const, visible: true },
    { id: 3,  parentId: 2, title: '用户管理',   name: 'SystemUsers',   path: '/system/users', component: 'users/UsersPage',  icon: 'UsersRound',     type: 'menu' as const,      sort: 1,  status: 'active' as const, visible: true, permission: 'system:user:list' },
    { id: 10, parentId: 3, title: '新增用户',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 1,  status: 'active' as const, visible: true, permission: 'system:user:create' },
    { id: 11, parentId: 3, title: '编辑用户',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 2,  status: 'active' as const, visible: true, permission: 'system:user:update' },
    { id: 12, parentId: 3, title: '删除用户',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 3,  status: 'active' as const, visible: true, permission: 'system:user:delete' },
    { id: 36, parentId: 2, title: '部门管理',   name: 'SystemDepartments', path: '/system/departments', component: 'system/departments/DepartmentsPage', icon: 'Building2', type: 'menu' as const, sort: 2, status: 'active' as const, visible: true, permission: 'system:department:list' },
    { id: 37, parentId: 36, title: '新增部门',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 1,  status: 'active' as const, visible: true, permission: 'system:department:create' },
    { id: 38, parentId: 36, title: '编辑部门',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 2,  status: 'active' as const, visible: true, permission: 'system:department:update' },
    { id: 39, parentId: 36, title: '删除部门',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 3,  status: 'active' as const, visible: true, permission: 'system:department:delete' },
    { id: 40, parentId: 2, title: '岗位管理',   name: 'SystemPositions', path: '/system/positions', component: 'system/positions/PositionsPage', icon: 'BriefcaseBusiness', type: 'menu' as const, sort: 3, status: 'active' as const, visible: true, permission: 'system:position:list' },
    { id: 41, parentId: 40, title: '新增岗位',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 1,  status: 'active' as const, visible: true, permission: 'system:position:create' },
    { id: 42, parentId: 40, title: '编辑岗位',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 2,  status: 'active' as const, visible: true, permission: 'system:position:update' },
    { id: 43, parentId: 40, title: '删除岗位',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 3,  status: 'active' as const, visible: true, permission: 'system:position:delete' },
    { id: 4,  parentId: 2, title: '菜单管理',   name: 'SystemMenus',   path: '/system/menus', component: 'system/menus/MenusPage',  icon: 'LayoutList',     type: 'menu' as const,      sort: 4,  status: 'active' as const, visible: true, permission: 'system:menu:list' },
    { id: 13, parentId: 4, title: '新增菜单',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 1,  status: 'active' as const, visible: true, permission: 'system:menu:create' },
    { id: 14, parentId: 4, title: '编辑菜单',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 2,  status: 'active' as const, visible: true, permission: 'system:menu:update' },
    { id: 15, parentId: 4, title: '删除菜单',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 3,  status: 'active' as const, visible: true, permission: 'system:menu:delete' },
    { id: 5,  parentId: 2, title: '角色管理',   name: 'SystemRoles',   path: '/system/roles', component: 'system/roles/RolesPage',  icon: 'ShieldCheck',    type: 'menu' as const,      sort: 5,  status: 'active' as const, visible: true, permission: 'system:role:list' },
    { id: 16, parentId: 5, title: '新增角色',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 1,  status: 'active' as const, visible: true, permission: 'system:role:create' },
    { id: 17, parentId: 5, title: '编辑角色',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 2,  status: 'active' as const, visible: true, permission: 'system:role:update' },
    { id: 18, parentId: 5, title: '删除角色',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 3,  status: 'active' as const, visible: true, permission: 'system:role:delete' },
    { id: 19, parentId: 5, title: '分配菜单',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 4,  status: 'active' as const, visible: true, permission: 'system:role:assign' },
    { id: 6,  parentId: 2, title: '字典管理',   name: 'SystemDicts',   path: '/system/dicts', component: 'system/dicts/DictsPage',  icon: 'NotepadText',    type: 'menu' as const, sort: 6,  status: 'active' as const, visible: true, permission: 'system:dict:list' },
    { id: 8,  parentId: 2, title: '文件管理',   name: 'SystemFiles',   path: undefined, component: undefined,        icon: 'FolderOpen',     type: 'directory' as const, sort: 7,  status: 'active' as const, visible: true, permission: 'system:file:list' },
    { id: 34, parentId: 2, title: '审计日志',   name: 'SystemAuditLogs', path: undefined, component: undefined, icon: 'ClipboardMinus',  type: 'directory' as const, sort: 9,  status: 'active' as const, visible: true },
    { id: 32, parentId: 34, title: '登录日志',   name: 'SystemLoginLogs', path: '/system/login-logs', component: 'system/login-logs/LoginLogsPage', icon: 'List',       type: 'menu' as const,      sort: 1,  status: 'active' as const, visible: true, permission: 'system:log:login' },
    { id: 33, parentId: 34, title: '操作日志',   name: 'SystemOperationLogs', path: '/system/operation-logs', component: 'system/operation-logs/OperationLogsPage', icon: 'ClipboardList', type: 'menu' as const, sort: 2, status: 'active' as const, visible: true, permission: 'system:log:operation' },
    { id: 9,  parentId: 2, title: '服务监控',   name: 'SystemMonitor', path: '/system/monitor', component: 'system/monitor/MonitorPage', icon: 'Activity',       type: 'menu' as const,      sort: 8,  status: 'active' as const, visible: true, permission: 'system:monitor:view' },
    { id: 24, parentId: 8, title: '文件配置',   name: 'SystemFileConfigs', path: '/system/file-configs', component: 'system/file-configs/FileStorageConfigsPage', icon: 'HardDriveUpload', type: 'menu' as const, sort: 1, status: 'active' as const, visible: true, permission: 'system:file:config' },
    { id: 25, parentId: 8, title: '文件列表',   name: 'SystemFileList', path: '/system/files', component: 'system/files/FilesPage',  icon: 'Files',          type: 'menu' as const, sort: 2, status: 'active' as const, visible: true, permission: 'system:file:list' },
    { id: 26, parentId: 24, title: '新增配置',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 1,  status: 'active' as const, visible: true, permission: 'system:file:config:create' },
    { id: 27, parentId: 24, title: '编辑配置',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 2,  status: 'active' as const, visible: true, permission: 'system:file:config:update' },
    { id: 28, parentId: 24, title: '删除配置',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 3,  status: 'active' as const, visible: true, permission: 'system:file:config:delete' },
    { id: 29, parentId: 24, title: '设为默认',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 4,  status: 'active' as const, visible: true, permission: 'system:file:config:default' },
    { id: 30, parentId: 25, title: '上传文件',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 1,  status: 'active' as const, visible: true, permission: 'system:file:upload' },
    { id: 31, parentId: 25, title: '删除文件',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 2,  status: 'active' as const, visible: true, permission: 'system:file:delete' },
    { id: 20, parentId: 6, title: '新增字典',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 1,  status: 'active' as const, visible: true, permission: 'system:dict:create' },
    { id: 21, parentId: 6, title: '编辑字典',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 2,  status: 'active' as const, visible: true, permission: 'system:dict:update' },
    { id: 22, parentId: 6, title: '删除字典',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 3,  status: 'active' as const, visible: true, permission: 'system:dict:delete' },
    { id: 23, parentId: 6, title: '管理字典项',  name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 4,  status: 'active' as const, visible: true, permission: 'system:dict:item' },
    { id: 35, parentId: 2, title: '通知公告',   name: 'SystemNotices', path: '/system/notices', component: 'system/notices/NoticesPage', icon: 'BellRing',   type: 'menu' as const,      sort: 10,  status: 'active' as const, visible: true, permission: 'system:notice:list' },
    { id: 36, parentId: 35, title: '新增通知',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 1,  status: 'active' as const, visible: true, permission: 'system:notice:create' },
    { id: 37, parentId: 35, title: '编辑通知',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 2,  status: 'active' as const, visible: true, permission: 'system:notice:update' },
    { id: 38, parentId: 35, title: '删除通知',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 3,  status: 'active' as const, visible: true, permission: 'system:notice:delete' },
    { id: 7,  parentId: 0, title: '组件示例',   name: 'Components',    path: '/components', component: 'components/ComponentsPage',    icon: 'Component',      type: 'menu' as const,      sort: 99, status: 'active' as const, visible: false },
    // 系统参数配置
    { id: 50, parentId: 2, title: '系统配置',   name: 'SystemConfigs', path: '/system/configs', component: 'system/configs/SystemConfigsPage', icon: 'SlidersHorizontal', type: 'menu' as const, sort: 11, status: 'active' as const, visible: true, permission: 'system:config:list' },
    { id: 51, parentId: 50, title: '新增配置',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 1,  status: 'active' as const, visible: true, permission: 'system:config:create' },
    { id: 52, parentId: 50, title: '编辑配置',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 2,  status: 'active' as const, visible: true, permission: 'system:config:update' },
    { id: 53, parentId: 50, title: '删除配置',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 3,  status: 'active' as const, visible: true, permission: 'system:config:delete' },
    // 在线用户
    { id: 54, parentId: 2, title: '在线用户',   name: 'SystemSessions', path: '/system/sessions', component: 'system/sessions/OnlineSessionsPage', icon: 'MonitorSmartphone', type: 'menu' as const, sort: 12, status: 'active' as const, visible: true, permission: 'system:session:list' },
    { id: 55, parentId: 54, title: '强制下线',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 1,  status: 'active' as const, visible: true, permission: 'system:session:forceLogout' },
    // 定时任务
    { id: 56, parentId: 2, title: '定时任务',   name: 'SystemCronJobs', path: '/system/cron-jobs', component: 'system/cron-jobs/CronJobsPage', icon: 'Clock', type: 'menu' as const, sort: 13, status: 'active' as const, visible: true, permission: 'system:cronjob:list' },
    { id: 57, parentId: 56, title: '新增任务',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 1,  status: 'active' as const, visible: true, permission: 'system:cronjob:create' },
    { id: 58, parentId: 56, title: '编辑任务',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 2,  status: 'active' as const, visible: true, permission: 'system:cronjob:update' },
    { id: 59, parentId: 56, title: '删除任务',   name: undefined,       path: undefined, component: undefined,        icon: undefined,        type: 'button' as const,    sort: 3,  status: 'active' as const, visible: true, permission: 'system:cronjob:delete' },
  ];
  for (const row of menuRows) {
    await db
      .insert(menus)
      .values(row)
      .onConflictDoUpdate({
        target: menus.id,
        set: {
          parentId:   row.parentId,
          title:      row.title,
          name:       row.name ?? null,
          path:       row.path ?? null,
          component:  row.component ?? null,
          icon:       row.icon ?? null,
          type:       row.type,
          permission: row.permission ?? null,
          sort:       row.sort,
          status:     row.status,
          visible:    row.visible,
          updatedAt:  new Date(),
        },
      });
  }
  await db.execute(sql`SELECT setval('menus_id_seq', GREATEST((SELECT MAX(id) FROM menus), 1))`);
  logger.info('  ✔ Menus upserted');

  // ─── 3. 角色数据 ──────────────────────────────────────────────────────────
  const roleRows = [
    { id: 1, name: '超级管理员', code: 'super_admin', description: '拥有所有权限', status: 'active' as const },
    { id: 2, name: '普通用户',   code: 'user',        description: '基础访问权限', status: 'active' as const },
  ];
  await db.insert(roles).values(roleRows).onConflictDoNothing({ target: roles.id });
  await db.execute(sql`SELECT setval('roles_id_seq', GREATEST((SELECT MAX(id) FROM roles), 1))`);
  logger.info('  ✔ Roles seeded (onConflictDoNothing)');

  // 超级管理员绑定全部菜单（联合主键去重）
  const allMenuIds = await db.select({ id: menus.id }).from(menus);
  if (allMenuIds.length > 0) {
    await db.insert(roleMenus)
      .values(allMenuIds.map((m) => ({ roleId: 1, menuId: m.id })))
      .onConflictDoNothing();
  }
  logger.info('  ✔ Role-menu bindings seeded');

  // ─── 4. 部门数据 ──────────────────────────────────────────────────────────
  const departmentRows = [
    { id: 1, parentId: 0, name: '总部', code: 'headquarters', leader: '管理员', phone: '13800000000', email: 'admin@zenith.dev', sort: 1, status: 'active' as const },
    { id: 2, parentId: 1, name: '技术部', code: 'technology', leader: '管理员', phone: '13800000001', email: 'tech@zenith.dev', sort: 1, status: 'active' as const },
  ];
  for (const row of departmentRows) {
    await db.insert(departments).values(row).onConflictDoUpdate({
      target: departments.id,
      set: {
        parentId: row.parentId,
        name: row.name,
        code: row.code,
        leader: row.leader,
        phone: row.phone,
        email: row.email,
        sort: row.sort,
        status: row.status,
        updatedAt: new Date(),
      },
    });
  }
  await db.execute(sql`SELECT setval('departments_id_seq', GREATEST((SELECT MAX(id) FROM departments), 1))`);
  logger.info('  ✔ Departments upserted');

  // ─── 5. 岗位数据 ──────────────────────────────────────────────────────────
  const positionRows = [
    { id: 1, name: '系统管理员', code: 'system_admin', sort: 1, status: 'active' as const, remark: '默认管理员岗位' },
    { id: 2, name: '开发工程师', code: 'developer', sort: 2, status: 'active' as const, remark: '默认技术岗位' },
  ];
  for (const row of positionRows) {
    await db.insert(positions).values(row).onConflictDoUpdate({
      target: positions.id,
      set: {
        name: row.name,
        code: row.code,
        sort: row.sort,
        status: row.status,
        remark: row.remark,
        updatedAt: new Date(),
      },
    });
  }
  await db.execute(sql`SELECT setval('positions_id_seq', GREATEST((SELECT MAX(id) FROM positions), 1))`);
  logger.info('  ✔ Positions upserted');

  // 管理员账号绑定超级管理员角色
  const [adminUser] = await db.select({ id: users.id }).from(users).where(eq(users.username, 'admin')).limit(1);
  if (adminUser) {
    await db.update(users).set({ departmentId: 1, updatedAt: new Date() }).where(eq(users.id, adminUser.id));
    await db.insert(userRoles).values({ userId: adminUser.id, roleId: 1 }).onConflictDoNothing();
    await db.insert(userPositions).values({ userId: adminUser.id, positionId: 1 }).onConflictDoNothing();
    logger.info('  ✔ Admin user-role binding seeded');
  }

  // ─── 6. 字典数据 ──────────────────────────────────────────────────────────
  const dictRows = [
    { id: 1, name: '通用状态',     code: 'common_status',        description: '通用启用/禁用状态' },
    { id: 3, name: '菜单类型',     code: 'menu_type',            description: '菜单节点类型' },
    { id: 4, name: '用户性别',     code: 'user_gender',          description: '用户性别' },
    { id: 5, name: '显示状态',     code: 'menu_visible',         description: '菜单显示/隐藏状态' },
    { id: 6, name: '通知类型',     code: 'notice_type',          description: '通知公告类型' },
    { id: 7, name: '通知发布状态', code: 'notice_publish_status', description: '通知公告的发布状态' },
    { id: 8, name: '通知优先级',   code: 'notice_priority',      description: '通知公告优先级' },
  ];
  await db.insert(dicts).values(dictRows).onConflictDoNothing({ target: dicts.id });
  await db.execute(sql`SELECT setval('dicts_id_seq', GREATEST((SELECT MAX(id) FROM dicts), 1))`);
  logger.info('  ✔ Dicts seeded (onConflictDoNothing)');

  // ─── 6. 文件服务配置 ──────────────────────────────────────────────────────
  await db.insert(fileStorageConfigs).values({
    id: 1,
    name: '本地磁盘',
    provider: 'local',
    status: 'active',
    isDefault: true,
    localRootPath: 'storage/local',
    basePath: 'uploads',
    remark: '系统默认本地文件服务',
  }).onConflictDoNothing({ target: fileStorageConfigs.id });
  await db.execute(sql`SELECT setval('file_storage_configs_id_seq', GREATEST((SELECT MAX(id) FROM file_storage_configs), 1))`);
  logger.info('  ✔ File storage configs seeded (onConflictDoNothing)');

  // ─── 7. 字典项数据 ────────────────────────────────────────────────────────
  // 使用 (dict_id, value) 唯一索引，通过 onConflictDoUpdate 保持幂等
  const dictItemRows = [
    { dictId: 1, label: '启用',     value: 'active',    color: 'green',  sort: 1 },
    { dictId: 1, label: '禁用',     value: 'disabled',  color: 'grey',   sort: 2 },
    { dictId: 3, label: '目录',     value: 'directory', color: 'blue',   sort: 1 },
    { dictId: 3, label: '菜单',     value: 'menu',      color: 'green',  sort: 2 },
    { dictId: 3, label: '按钮',     value: 'button',    color: 'orange', sort: 3 },
    { dictId: 4, label: '男',       value: 'male',      color: 'blue',   sort: 1 },
    { dictId: 4, label: '女',       value: 'female',    color: 'pink',   sort: 2 },
    { dictId: 4, label: '保密',     value: 'secret',    color: 'grey',   sort: 3 },
    { dictId: 5, label: '显示',     value: 'show',        color: 'green',  sort: 1 },
    { dictId: 5, label: '隐藏',     value: 'hidden',      color: 'grey',   sort: 2 },
    // 通知类型
    { dictId: 6, label: '通知',     value: 'notice',      color: 'blue',   sort: 1 },
    { dictId: 6, label: '公告',     value: 'announcement', color: 'cyan',  sort: 2 },
    { dictId: 6, label: '警告',     value: 'warning',     color: 'orange', sort: 3 },
    // 通知发布状态
    { dictId: 7, label: '草稿',     value: 'draft',       color: 'grey',   sort: 1 },
    { dictId: 7, label: '已发布',   value: 'published',   color: 'green',  sort: 2 },
    { dictId: 7, label: '已撤回',   value: 'recalled',    color: 'orange', sort: 3 },
    // 通知优先级
    { dictId: 8, label: '低',       value: 'low',         color: 'grey',   sort: 1 },
    { dictId: 8, label: '中',       value: 'medium',      color: 'blue',   sort: 2 },
    { dictId: 8, label: '高',       value: 'high',        color: 'red',    sort: 3 },
  ];
  // dict_items 使用 (dict_id, value) 唯一索引，通过 onConflictDoUpdate 保持幂等
  await db.insert(dictItems)
    .values(dictItemRows.map(r => ({ ...r, status: 'active' as const })))
    .onConflictDoUpdate({
      target: [dictItems.dictId, dictItems.value],
      set: {
        label: sql`excluded.label`,
        color: sql`excluded.color`,
        sort: sql`excluded.sort`,
        updatedAt: new Date(),
      },
    });
  logger.info('  ✔ Dict items seeded (onConflictDoUpdate)');

  // ─── 8. 系统配置种子数据 ──────────────────────────────────────────────────
  const systemConfigRows = [
    { configKey: 'captcha_enabled', configValue: 'false', configType: 'boolean' as const, label: '登录验证码', description: '是否开启登录验证码', sort: 1, status: 'active' as const, builtIn: true },
    { configKey: 'site_name', configValue: 'Zenith Admin', configType: 'string' as const, label: '站点名称', description: '站点名称，显示在浏览器标签页', sort: 2, status: 'active' as const, builtIn: true },
    { configKey: 'user_default_password', configValue: '123456', configType: 'string' as const, label: '用户默认密码', description: '新增用户时的默认密码', sort: 3, status: 'active' as const, builtIn: true },
  ];
  for (const row of systemConfigRows) {
    await db.insert(systemConfigs).values(row).onConflictDoNothing();
  }
  logger.info('  ✔ System configs seeded');

  // ─── 9. 定时任务种子数据 ──────────────────────────────────────────────────
  const cronJobRows = [
    { name: '清理过期验证码', cronExpression: '0 */30 * * * *', handler: 'cleanExpiredCaptchas', status: 'active' as const, description: '每30分钟清理过期的验证码' },
    { name: '清理过期会话', cronExpression: '0 0 * * * *', handler: 'cleanExpiredSessions', status: 'active' as const, description: '每小时清理超过8小时无活动的会话' },
  ];
  await db.insert(cronJobs)
    .values(cronJobRows)
    .onConflictDoNothing({ target: cronJobs.name });
  logger.info('  ✔ Cron jobs seeded (onConflictDoNothing)');

  logger.info('🎉 Seed complete.');
  process.exit(0);
}

try {
  await seed();
} catch (err) {
  logger.error('Seed failed:', err);
  process.exit(1);
}
