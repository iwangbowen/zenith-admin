import { db } from './index';
import { users, menus, roles, roleMenus, userRoles, dicts, dictItems, fileStorageConfigs, departments, positions, userPositions, systemConfigs, cronJobs, regions, tenants } from './schema';
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { createRequire } from 'node:module';
import logger from '../lib/logger';
import { SEED_MENUS, SEED_ROLES, SEED_DEPARTMENTS, SEED_POSITIONS, SEED_DICTS, SEED_DICT_ITEMS, SEED_SYSTEM_CONFIGS, SEED_CRON_JOBS } from '@zenith/shared';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { provinces, cities, areas } = require('china-division') as {
  provinces: Array<{ code: string; name: string }>;
  cities: Array<{ code: string; name: string; provinceCode: string }>;
  areas: Array<{ code: string; name: string; cityCode: string; provinceCode: string }>;
};

/**
 * 种子数据初始化脚本
 * - 使用 ON CONFLICT DO NOTHING 策略，可安全重复执行
 * - 不会覆盖已有数据，只补充缺失的种子记录
 */
async function seed() {
  logger.info('🌱 Seeding database...');

  // ─── 1. 管理员账号 ─────────────────────────────────────────────────────────
  // 注意：tenant_id 为 NULL 时复合唯一约束 (tenant_id, username) 不生效（NULL != NULL），
  // 必须先查询是否已存在，再决定是否插入，避免重复创建。
  const existingAdmin = await db.select({ id: users.id }).from(users)
    .where(sql`${users.username} = 'admin' AND ${users.tenantId} IS NULL`)
    .limit(1);
  if (existingAdmin.length === 0) {
    const hashedPassword = await bcrypt.hash('123456', 10);
    await db.insert(users).values({
      username: 'admin',
      nickname: '管理员',
      email: 'admin@zenith.dev',
      password: hashedPassword,
      status: 'active',
    });
  }
  logger.info('  ✔ Admin user seeded (skip if exists)');

  // ─── 2. 菜单数据（数据来源：@zenith/shared SEED_MENUS）─────────────────────
  for (const row of SEED_MENUS) {
    const dbRow = { id: row.id, parentId: row.parentId, title: row.title, name: row.name ?? null, path: row.path ?? null, component: row.component ?? null, icon: row.icon ?? null, type: row.type, permission: row.permission ?? null, sort: row.sort, status: row.status, visible: row.visible };
    await db
      .insert(menus)
      .values(dbRow)
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

  // ─── 3. 角色数据（数据来源：@zenith/shared SEED_ROLES）────────────────────
  const roleRows = SEED_ROLES.map(({ id, name, code, description, status, dataScope }) => ({ id, name, code, description, status, dataScope }));
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

  // ─── 4. 部门数据（数据来源：@zenith/shared SEED_DEPARTMENTS）──────────────
  for (const row of SEED_DEPARTMENTS) {
    const dbRow = { id: row.id, parentId: row.parentId, name: row.name, code: row.code, leader: row.leader ?? null, phone: row.phone ?? null, email: row.email ?? null, sort: row.sort, status: row.status };
    await db.insert(departments).values(dbRow).onConflictDoUpdate({
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

  // ─── 5. 岗位数据（数据来源：@zenith/shared SEED_POSITIONS）────────────────
  for (const row of SEED_POSITIONS) {
    const dbRow = { id: row.id, name: row.name, code: row.code, sort: row.sort, status: row.status, remark: row.remark ?? null };
    await db.insert(positions).values(dbRow).onConflictDoUpdate({
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
  const [adminUser] = await db.select({ id: users.id }).from(users)
    .where(sql`${users.username} = 'admin' AND ${users.tenantId} IS NULL`)
    .limit(1);
  if (adminUser) {
    await db.update(users).set({ departmentId: 1, updatedAt: new Date() }).where(eq(users.id, adminUser.id));
    await db.insert(userRoles).values({ userId: adminUser.id, roleId: 1 }).onConflictDoNothing();
    await db.insert(userPositions).values({ userId: adminUser.id, positionId: 1 }).onConflictDoNothing();
    logger.info('  ✔ Admin user-role binding seeded');
  }

  // ─── 6. 字典数据（数据来源：@zenith/shared SEED_DICTS）────────────────────
  const dictRows = SEED_DICTS.map(({ id, name, code, description, status }) => ({ id, name, code, description, status }));
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

  // ─── 7. 字典项数据（数据来源：@zenith/shared SEED_DICT_ITEMS）─────────────
  // 使用 (dict_id, value) 唯一索引，通过 onConflictDoUpdate 保持幂等
  const dictItemRows = SEED_DICT_ITEMS.map(({ dictId, label, value, color, sort, status }) => ({ dictId, label, value, color, sort, status }));
  await db.insert(dictItems)
    .values(dictItemRows)
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

  // ─── 8. 系统配置种子数据（数据来源：@zenith/shared SEED_SYSTEM_CONFIGS）────
  for (const cfg of SEED_SYSTEM_CONFIGS) {
    await db.insert(systemConfigs).values({
      configKey:   cfg.configKey,
      configValue: cfg.configValue,
      configType:  cfg.configType as 'boolean' | 'string' | 'number' | 'json',
      description: cfg.description ?? '',
    }).onConflictDoNothing();
  }
  logger.info('  ✔ System configs seeded');

  // ─── 9. 定时任务种子数据（数据来源：@zenith/shared SEED_CRON_JOBS）─────────
  const cronJobRows = SEED_CRON_JOBS.map(({ name, cronExpression, handler, status, description }) => ({ name, cronExpression, handler, status, description }));
  await db.insert(cronJobs)
    .values(cronJobRows)
    .onConflictDoNothing({ target: cronJobs.name });
  logger.info('  ✔ Cron jobs seeded (onConflictDoNothing)');

  // ─── 10. 地区数据（来源：china-division 包）────────────────────────────────
  const regionRows = [
    ...provinces.map((p, i) => ({
      code: p.code,
      name: p.name,
      level: 'province' as const,
      parentCode: null,
      sort: i,
      status: 'active' as const,
    })),
    ...cities.map((c, i) => ({
      code: c.code,
      name: c.name,
      level: 'city' as const,
      parentCode: c.provinceCode,
      sort: i,
      status: 'active' as const,
    })),
    ...areas.map((a, i) => ({
      code: a.code,
      name: a.name,
      level: 'county' as const,
      parentCode: a.cityCode,
      sort: i,
      status: 'active' as const,
    })),
  ];
  // 批量插入，每批 500 条，避免单次参数过多
  const BATCH_SIZE = 500;
  let inserted = 0;
  for (let i = 0; i < regionRows.length; i += BATCH_SIZE) {
    const batch = regionRows.slice(i, i + BATCH_SIZE);
    await db.insert(regions).values(batch).onConflictDoNothing({ target: regions.code });
    inserted += batch.length;
  }
  logger.info(`  ✔ Regions seeded (onConflictDoNothing) — ${inserted} records`);

  // ─── 租户示例数据 ──────────────────────────────────────────────────────────
  await db.insert(tenants).values([
    {
      name: '示例租户A',
      code: 'tenant_a',
      contactName: '张三',
      contactPhone: '13800001111',
      status: 'active',
      maxUsers: 50,
      remark: '演示用租户A',
    },
    {
      name: '示例租户B',
      code: 'tenant_b',
      contactName: '李四',
      contactPhone: '13800002222',
      status: 'active',
      remark: '演示用租户B',
    },
  ]).onConflictDoNothing({ target: tenants.code });
  logger.info('  ✔ Tenants seeded (onConflictDoNothing)');

  logger.info('🎉 Seed complete.');
  process.exit(0);
}

try {
  await seed();
} catch (err) {
  logger.error('Seed failed:', err);
  process.exit(1);
}
