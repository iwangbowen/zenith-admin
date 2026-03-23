import { db } from './index';
import { users, menus, roles, roleMenus, dicts, fileStorageConfigs } from './schema';
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';

/**
 * 种子数据初始化脚本
 * - 使用 ON CONFLICT DO NOTHING 策略，可安全重复执行
 * - 不会覆盖已有数据，只补充缺失的种子记录
 */
async function seed() {
  console.log('🌱 Seeding database...');

  // ─── 1. 管理员账号 ─────────────────────────────────────────────────────────
  const existing = await db.select().from(users).where(eq(users.username, 'admin'));
  const hashedPassword = await bcrypt.hash('123456', 10);
  if (existing.length === 0) {
    await db.insert(users).values({
      username: 'admin',
      nickname: '管理员',
      email: 'admin@zenith.dev',
      password: hashedPassword,
      role: 'admin',
      status: 'active',
    });
    console.log('  ✔ Admin user created: admin / 123456');
  } else {
    console.log('  ⏭ Admin user already exists, skipped');
  }

  // ─── 2. 菜单数据 ──────────────────────────────────────────────────────────
  const menuRows = [
    { id: 1,  parentId: 0, title: '首页',    name: 'Dashboard',     path: '/',              icon: 'Home',           type: 'menu' as const,      sort: 1,  status: 'active' as const, visible: true },
    { id: 2,  parentId: 0, title: '系统管理',   name: 'System',        path: undefined,        icon: 'Settings',       type: 'directory' as const, sort: 2,  status: 'active' as const, visible: true },
    { id: 3,  parentId: 2, title: '用户管理',   name: 'SystemUsers',   path: '/system/users',  icon: 'UsersRound',     type: 'menu' as const,      sort: 1,  status: 'active' as const, visible: true, permission: 'system:user:list' },
    { id: 10, parentId: 3, title: '新增用户',   name: undefined,       path: undefined,        icon: undefined,        type: 'button' as const,    sort: 1,  status: 'active' as const, visible: true, permission: 'system:user:create' },
    { id: 11, parentId: 3, title: '编辑用户',   name: undefined,       path: undefined,        icon: undefined,        type: 'button' as const,    sort: 2,  status: 'active' as const, visible: true, permission: 'system:user:update' },
    { id: 12, parentId: 3, title: '删除用户',   name: undefined,       path: undefined,        icon: undefined,        type: 'button' as const,    sort: 3,  status: 'active' as const, visible: true, permission: 'system:user:delete' },
    { id: 4,  parentId: 2, title: '菜单管理',   name: 'SystemMenus',   path: '/system/menus',  icon: 'LayoutList',     type: 'menu' as const,      sort: 2,  status: 'active' as const, visible: true, permission: 'system:menu:list' },
    { id: 13, parentId: 4, title: '新增菜单',   name: undefined,       path: undefined,        icon: undefined,        type: 'button' as const,    sort: 1,  status: 'active' as const, visible: true, permission: 'system:menu:create' },
    { id: 14, parentId: 4, title: '编辑菜单',   name: undefined,       path: undefined,        icon: undefined,        type: 'button' as const,    sort: 2,  status: 'active' as const, visible: true, permission: 'system:menu:update' },
    { id: 15, parentId: 4, title: '删除菜单',   name: undefined,       path: undefined,        icon: undefined,        type: 'button' as const,    sort: 3,  status: 'active' as const, visible: true, permission: 'system:menu:delete' },
    { id: 5,  parentId: 2, title: '角色管理',   name: 'SystemRoles',   path: '/system/roles',  icon: 'ShieldCheck',    type: 'menu' as const,      sort: 3,  status: 'active' as const, visible: true, permission: 'system:role:list' },
    { id: 16, parentId: 5, title: '新增角色',   name: undefined,       path: undefined,        icon: undefined,        type: 'button' as const,    sort: 1,  status: 'active' as const, visible: true, permission: 'system:role:create' },
    { id: 17, parentId: 5, title: '编辑角色',   name: undefined,       path: undefined,        icon: undefined,        type: 'button' as const,    sort: 2,  status: 'active' as const, visible: true, permission: 'system:role:update' },
    { id: 18, parentId: 5, title: '删除角色',   name: undefined,       path: undefined,        icon: undefined,        type: 'button' as const,    sort: 3,  status: 'active' as const, visible: true, permission: 'system:role:delete' },
    { id: 19, parentId: 5, title: '分配菜单',   name: undefined,       path: undefined,        icon: undefined,        type: 'button' as const,    sort: 4,  status: 'active' as const, visible: true, permission: 'system:role:assign' },
    { id: 6,  parentId: 2, title: '字典管理',   name: 'SystemDicts',   path: '/system/dicts',  icon: 'NotepadText',    type: 'menu' as const, sort: 4,  status: 'active' as const, visible: true, permission: 'system:dict:list' },
    { id: 8,  parentId: 2, title: '文件管理',   name: 'SystemFiles',   path: undefined,        icon: 'FolderOpen',     type: 'directory' as const, sort: 5,  status: 'active' as const, visible: true, permission: 'system:file:list' },
    { id: 24, parentId: 8, title: '文件配置',   name: 'SystemFileConfigs', path: '/system/file-configs', icon: 'HardDriveUpload', type: 'menu' as const, sort: 1, status: 'active' as const, visible: true, permission: 'system:file:config' },
    { id: 25, parentId: 8, title: '文件列表',   name: 'SystemFileList', path: '/system/files',  icon: 'Files',          type: 'menu' as const, sort: 2, status: 'active' as const, visible: true, permission: 'system:file:list' },
    { id: 26, parentId: 24, title: '新增配置',   name: undefined,       path: undefined,        icon: undefined,        type: 'button' as const,    sort: 1,  status: 'active' as const, visible: true, permission: 'system:file:config:create' },
    { id: 27, parentId: 24, title: '编辑配置',   name: undefined,       path: undefined,        icon: undefined,        type: 'button' as const,    sort: 2,  status: 'active' as const, visible: true, permission: 'system:file:config:update' },
    { id: 28, parentId: 24, title: '删除配置',   name: undefined,       path: undefined,        icon: undefined,        type: 'button' as const,    sort: 3,  status: 'active' as const, visible: true, permission: 'system:file:config:delete' },
    { id: 29, parentId: 24, title: '设为默认',   name: undefined,       path: undefined,        icon: undefined,        type: 'button' as const,    sort: 4,  status: 'active' as const, visible: true, permission: 'system:file:config:default' },
    { id: 30, parentId: 25, title: '上传文件',   name: undefined,       path: undefined,        icon: undefined,        type: 'button' as const,    sort: 1,  status: 'active' as const, visible: true, permission: 'system:file:upload' },
    { id: 31, parentId: 25, title: '删除文件',   name: undefined,       path: undefined,        icon: undefined,        type: 'button' as const,    sort: 2,  status: 'active' as const, visible: true, permission: 'system:file:delete' },
    { id: 20, parentId: 6, title: '新增字典',   name: undefined,       path: undefined,        icon: undefined,        type: 'button' as const,    sort: 1,  status: 'active' as const, visible: true, permission: 'system:dict:create' },
    { id: 21, parentId: 6, title: '编辑字典',   name: undefined,       path: undefined,        icon: undefined,        type: 'button' as const,    sort: 2,  status: 'active' as const, visible: true, permission: 'system:dict:update' },
    { id: 22, parentId: 6, title: '删除字典',   name: undefined,       path: undefined,        icon: undefined,        type: 'button' as const,    sort: 3,  status: 'active' as const, visible: true, permission: 'system:dict:delete' },
    { id: 23, parentId: 6, title: '管理字典项',  name: undefined,       path: undefined,        icon: undefined,        type: 'button' as const,    sort: 4,  status: 'active' as const, visible: true, permission: 'system:dict:item' },
    { id: 7,  parentId: 0, title: '组件示例',   name: 'Components',    path: '/components',    icon: 'Component',      type: 'menu' as const,      sort: 99, status: 'active' as const, visible: true },
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
  console.log('  ✔ Menus upserted');

  // ─── 3. 角色数据 ──────────────────────────────────────────────────────────
  const roleRows = [
    { id: 1, name: '超级管理员', code: 'super_admin', description: '拥有所有权限', status: 'active' as const },
    { id: 2, name: '普通用户',   code: 'user',        description: '基础访问权限', status: 'active' as const },
  ];
  await db.insert(roles).values(roleRows).onConflictDoNothing({ target: roles.id });
  await db.execute(sql`SELECT setval('roles_id_seq', GREATEST((SELECT MAX(id) FROM roles), 1))`);
  console.log('  ✔ Roles seeded (onConflictDoNothing)');

  // 超级管理员绑定全部菜单（联合主键去重）
  const allMenuIds = await db.select({ id: menus.id }).from(menus);
  if (allMenuIds.length > 0) {
    await db.insert(roleMenus)
      .values(allMenuIds.map((m) => ({ roleId: 1, menuId: m.id })))
      .onConflictDoNothing();
  }
  console.log('  ✔ Role-menu bindings seeded');

  // ─── 4. 字典数据 ──────────────────────────────────────────────────────────
  const dictRows = [
    { id: 1, name: '通用状态', code: 'common_status', description: '通用启用/禁用状态' },
    { id: 2, name: '用户角色', code: 'user_role',     description: '系统用户角色类型' },
    { id: 3, name: '菜单类型', code: 'menu_type',     description: '菜单节点类型' },
    { id: 4, name: '用户性别', code: 'user_gender',   description: '用户性别' },
  ];
  await db.insert(dicts).values(dictRows).onConflictDoNothing({ target: dicts.id });
  await db.execute(sql`SELECT setval('dicts_id_seq', GREATEST((SELECT MAX(id) FROM dicts), 1))`);
  console.log('  ✔ Dicts seeded (onConflictDoNothing)');

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
  console.log('  ✔ File storage configs seeded (onConflictDoNothing)');

  // ─── 7. 字典项数据 ────────────────────────────────────────────────────────
  // 使用 (dict_id, value) 作为逻辑唯一键，通过先查再插的方式去重
  const dictItemRows = [
    { dictId: 1, label: '启用',     value: 'active',    color: 'green',  sort: 1 },
    { dictId: 1, label: '禁用',     value: 'disabled',  color: 'grey',   sort: 2 },
    { dictId: 2, label: '管理员',   value: 'admin',     color: 'blue',   sort: 1 },
    { dictId: 2, label: '普通用户', value: 'user',      color: 'grey',   sort: 2 },
    { dictId: 3, label: '目录',     value: 'directory', color: 'blue',   sort: 1 },
    { dictId: 3, label: '菜单',     value: 'menu',      color: 'green',  sort: 2 },
    { dictId: 3, label: '按钮',     value: 'button',    color: 'orange', sort: 3 },
    { dictId: 4, label: '男',       value: 'male',      color: 'blue',   sort: 1 },
    { dictId: 4, label: '女',       value: 'female',    color: 'pink',   sort: 2 },
    { dictId: 4, label: '保密',     value: 'secret',    color: 'grey',   sort: 3 },
  ];
  // dict_items 没有唯一约束，用 SQL 子查询避免重复插入
  for (const item of dictItemRows) {
    await db.execute(sql`
      INSERT INTO dict_items (dict_id, label, value, color, sort, status)
      SELECT ${item.dictId}, ${item.label}, ${item.value}, ${item.color}, ${item.sort}, 'active'
      WHERE NOT EXISTS (
        SELECT 1 FROM dict_items WHERE dict_id = ${item.dictId} AND value = ${item.value}
      )
    `);
    await db.execute(sql`
      UPDATE dict_items SET color = ${item.color}
      WHERE dict_id = ${item.dictId} AND value = ${item.value} AND (color IS NULL OR color != ${item.color})
    `);
  }
  console.log('  ✔ Dict items seeded (WHERE NOT EXISTS)');

  console.log('🎉 Seed complete.');
  process.exit(0);
}

try {
  await seed();
} catch (err) {
  console.error('Seed failed:', err);
  process.exit(1);
}
