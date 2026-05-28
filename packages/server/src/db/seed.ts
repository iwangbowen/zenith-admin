import { db } from './index';
import { users, menus, roles, roleMenus, userRoles, dicts, dictItems, fileStorageConfigs, departments, positions, userPositions, systemConfigs, cronJobs, regions, tenants, emailTemplates, smsConfigs, smsTemplates, inAppTemplates, tags } from './schema';
import bcrypt from 'bcryptjs';
import { and, eq, isNull, inArray, sql } from 'drizzle-orm';
import { createRequire } from 'node:module';
import logger from '../lib/logger';
import { runAsUser } from '../lib/audit-context';
import { SEED_MENUS, SEED_ROLES, SEED_DEPARTMENTS, SEED_POSITIONS, SEED_DICTS, SEED_DICT_ITEMS, SEED_SYSTEM_CONFIGS, SEED_CRON_JOBS } from '@zenith/shared';

const require = createRequire(import.meta.url);

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
  // 首位管理员是审计链路的起点，本身允许 created_by/updated_by 为 NULL。
  const existingAdmin = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.username, 'admin'), isNull(users.tenantId)))
    .limit(1);
  if (existingAdmin.length === 0) {
    const hashedPassword = await bcrypt.hash('123456', 10);
    await db.insert(users).values({
      username: 'admin',
      nickname: '管理员',
      email: 'admin@zenith.dev',
      password: hashedPassword,
      status: 'enabled',
    });
  }
  logger.info('  ✔ Admin user seeded (skip if exists)');

  const [adminRow] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.username, 'admin'), isNull(users.tenantId)))
    .limit(1);
  if (!adminRow) throw new Error('Admin user not found after seeding');
  const adminId = adminRow.id;

  // 后续所有 seed 写入均以管理员身份执行，由 db Proxy 自动注入
  // created_by / updated_by = adminId
  await runAsUser(adminId, () => seedRest());

  logger.info('🎉 Seed complete.');
  process.exit(0);
}

async function seedRest() {
  // ─── 2. 菜单数据（数据来源：@zenith/shared SEED_MENUS）─────────────────────
  // onConflictDoNothing：只插入不存在的菜单，绝不覆盖用户通过 UI 修改的数据
  const menuRows = SEED_MENUS.map((row) => ({
    id: row.id,
    parentId: row.parentId,
    title: row.title,
    name: row.name ?? null,
    path: row.path ?? null,
    component: row.component ?? null,
    icon: row.icon ?? null,
    type: row.type,
    permission: row.permission ?? null,
    sort: row.sort,
    status: row.status,
    visible: row.visible,
  }));
  await db.insert(menus).values(menuRows).onConflictDoNothing({ target: menus.id });
  await db.execute(sql`SELECT setval('menus_id_seq', GREATEST((SELECT MAX(id) FROM menus), 1))`);
  logger.info('  ✔ Menus seeded (onConflictDoNothing)');

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

  // 其他角色按 SEED_ROLES.menuIds 绑定菜单
  for (const role of SEED_ROLES) {
    if (role.id === 1) continue; // 超管已全量绑定
    if (role.menuIds && role.menuIds.length > 0) {
      await db.insert(roleMenus)
        .values(role.menuIds.map((menuId) => ({ roleId: role.id, menuId })))
        .onConflictDoNothing();
    }
  }
  logger.info('  ✔ Role-menu bindings seeded');

  // ─── 4. 部门数据（数据来源：@zenith/shared SEED_DEPARTMENTS）──────────────
  // 只插入不存在的部门，不覆盖用户修改的数据
  const existingDeptIds = new Set(
    (await db.select({ id: departments.id }).from(departments)).map((r) => r.id),
  );
  const newDeptRows = SEED_DEPARTMENTS.filter((row) => !existingDeptIds.has(row.id)).map((row) => ({
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    code: row.code,
    phone: row.phone ?? null,
    email: row.email ?? null,
    sort: row.sort,
    status: row.status,
  }));
  if (newDeptRows.length > 0) {
    await db.insert(departments).values(newDeptRows).onConflictDoNothing({ target: departments.id });
    logger.info(`  ✔ Departments seeded — ${newDeptRows.length} new entries`);
  } else {
    logger.info('  ✔ Departments up-to-date');
  }

  // ─── 5. 岗位数据（数据来源：@zenith/shared SEED_POSITIONS）────────────────
  // 只插入不存在的岗位，不覆盖用户修改的数据
  const existingPositionIds = new Set(
    (await db.select({ id: positions.id }).from(positions)).map((r) => r.id),
  );
  const newPositionRows = SEED_POSITIONS.filter((row) => !existingPositionIds.has(row.id)).map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    sort: row.sort,
    status: row.status,
    remark: row.remark ?? null,
  }));
  if (newPositionRows.length > 0) {
    await db.insert(positions).values(newPositionRows).onConflictDoNothing({ target: positions.id });
    logger.info(`  ✔ Positions seeded — ${newPositionRows.length} new entries`);
  } else {
    logger.info('  ✔ Positions up-to-date');
  }

  // 管理员账号绑定超级管理员角色
  const [adminUser] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.username, 'admin'), isNull(users.tenantId)))
    .limit(1);
  if (adminUser) {
    // 只在管理员尚未设置部门时才设置默认部门（1）
    const [adminDetail] = await db.select({ departmentId: users.departmentId }).from(users).where(eq(users.id, adminUser.id)).limit(1);
    if (adminDetail && adminDetail.departmentId === null) {
      await db.update(users).set({ departmentId: 1, updatedAt: new Date() }).where(eq(users.id, adminUser.id));
    }
    await db.insert(userRoles).values({ userId: adminUser.id, roleId: 1 }).onConflictDoNothing();
    await db.insert(userPositions).values({ userId: adminUser.id, positionId: 1 }).onConflictDoNothing();
    // 只在种子部门尚未设置负责人时才设置为超管
    const seedDeptIds = SEED_DEPARTMENTS.map((d) => d.id);
    const deptsNeedLeader = await db.select({ id: departments.id }).from(departments)
      .where(and(inArray(departments.id, seedDeptIds), isNull(departments.leaderId)));
    if (deptsNeedLeader.length > 0) {
      await db.update(departments).set({ leaderId: adminUser.id, updatedAt: new Date() })
        .where(inArray(departments.id, deptsNeedLeader.map((d) => d.id)));
    }
    logger.info('  ✔ Admin user-role binding seeded');
  }

  // ─── 6. 字典数据（数据来源：@zenith/shared SEED_DICTS）────────────────────
  const dictRows = SEED_DICTS.map(({ id, name, code, description, status }) => ({ id, name, code, description, status }));
  await db.insert(dicts).values(dictRows).onConflictDoUpdate({
    target: dicts.id,
    set: { name: sql`excluded.name`, code: sql`excluded.code`, description: sql`excluded.description`, status: sql`excluded.status` },
  });
  await db.execute(sql`SELECT setval('dicts_id_seq', GREATEST((SELECT MAX(id) FROM dicts), 1))`);
  logger.info('  ✔ Dicts seeded (onConflictDoUpdate)');

  // ─── 6. 文件服务配置 ──────────────────────────────────────────────────────
  await db.insert(fileStorageConfigs).values({
    id: 1,
    name: '本地磁盘',
    provider: 'local',
    status: 'enabled',
    isDefault: true,
    localRootPath: 'storage/local',
    basePath: 'uploads',
    remark: '系统默认本地文件服务',
  }).onConflictDoNothing({ target: fileStorageConfigs.id });
  await db.execute(sql`SELECT setval('file_storage_configs_id_seq', GREATEST((SELECT MAX(id) FROM file_storage_configs), 1))`);
  logger.info('  ✔ File storage configs seeded (onConflictDoNothing)');

  // ─── 7. 字典项数据（数据来源：@zenith/shared SEED_DICT_ITEMS）─────────────
  // 只插入不存在的字典项，不覆盖用户修改的数据
  const existingDictItems = await db.select({ dictId: dictItems.dictId, value: dictItems.value }).from(dictItems);
  const existingDictItemKeys = new Set(existingDictItems.map((r) => `${r.dictId}:${r.value}`));
  const newDictItemRows = SEED_DICT_ITEMS
    .filter(({ dictId, value }) => !existingDictItemKeys.has(`${dictId}:${value}`))
    .map(({ dictId, label, value, color, sort, status }) => ({ dictId, label, value, color, sort, status }));
  if (newDictItemRows.length > 0) {
    await db.insert(dictItems).values(newDictItemRows).onConflictDoNothing({
      target: [dictItems.dictId, dictItems.value],
    });
    logger.info(`  ✔ Dict items seeded — ${newDictItemRows.length} new entries`);
  } else {
    logger.info('  ✔ Dict items up-to-date');
  }

  // ─── 8. 系统配置种子数据（数据来源：@zenith/shared SEED_SYSTEM_CONFIGS）────
  // 注意：PostgreSQL 唯一约束中 NULL != NULL，因此 (NULL, key) 无法触发冲突。
  // 改用先查询再按需插入的方式确保幂等性。
  const existingCfgKeys = await db
    .select({ configKey: systemConfigs.configKey })
    .from(systemConfigs)
    .where(isNull(systemConfigs.tenantId));
  const existingCfgKeySet = new Set(existingCfgKeys.map((r) => r.configKey));
  const cfgsToInsert = SEED_SYSTEM_CONFIGS.filter((c) => !existingCfgKeySet.has(c.configKey));
  if (cfgsToInsert.length > 0) {
    await db.insert(systemConfigs).values(cfgsToInsert.map((cfg) => ({
      configKey:   cfg.configKey,
      configValue: cfg.configValue,
      configType:  cfg.configType,
      description: cfg.description ?? '',
    })));
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
      status: 'enabled' as const,
    })),
    ...cities.map((c, i) => ({
      code: c.code,
      name: c.name,
      level: 'city' as const,
      parentCode: c.provinceCode,
      sort: i,
      status: 'enabled' as const,
    })),
    ...areas.map((a, i) => ({
      code: a.code,
      name: a.name,
      level: 'county' as const,
      parentCode: a.cityCode,
      sort: i,
      status: 'enabled' as const,
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
      status: 'enabled',
      maxUsers: 50,
      remark: '演示用租户A',
    },
    {
      name: '示例租户B',
      code: 'tenant_b',
      contactName: '李四',
      contactPhone: '13800002222',
      status: 'enabled',
      remark: '演示用租户B',
    },
  ]).onConflictDoNothing({ target: tenants.code });
  logger.info('  ✔ Tenants seeded (onConflictDoNothing)');

  // ─── 邮件模板示例数据 ───────────────────────────────────────────────────────
  await db.insert(emailTemplates).values([
    {
      name: '欢迎注册邮件',
      code: 'user_welcome_email',
      subject: '欢迎加入 {{app_name}}',
      content: '亲爱的 {{username}}，\n\n欢迎注册 {{app_name}}！\n您的账户已成功创建，请单击以下链接完成验证：\n{{verify_link}}\n\n此链接 24 小时内有效。',
      variables: JSON.stringify({ username: '用户名', app_name: '应用名称', verify_link: '验证链接' }),
      status: 'enabled',
      remark: '新用户注册后发送的激活邮件',
    },
    {
      name: '密码重置邮件',
      code: 'user_reset_password_email',
      subject: '重置您的密码',
      content: '亲爱的 {{username}}，\n\n我们收到了您的密码重置申请。请单击以下链接重置密码：\n{{reset_link}}\n\n此链接 2 小时内有效。如果您未发起此请求，请忽略此邮件。',
      variables: JSON.stringify({ username: '用户名', reset_link: '重置密码链接' }),
      status: 'enabled',
      remark: '用户密码重置流程所用模板',
    },
  ]).onConflictDoNothing({ target: emailTemplates.code });
  logger.info('  ✔ Email templates seeded (onConflictDoNothing)');

  // ─── 短信模板示例数据 ───────────────────────────────────────────────────────
  await db.insert(smsTemplates).values([
    {
      name: '验证码短信',
      code: 'user_verification_sms',
      templateCode: 'SMS_DEMO_VERIFICATION',
      signName: 'Zenith',
      content: '【{{app_name}}】您的验证码为 {{code}}，{{expire_minutes}} 分钟内有效，请勿泄露。',
      variables: JSON.stringify({ app_name: '应用名称', code: '验证码', expire_minutes: '有效分钟数' }),
      provider: 'aliyun',
      status: 'enabled',
      remark: '短信验证码模板（需绑定实际厂商模板 ID）',
    },
  ]).onConflictDoNothing({ target: smsTemplates.code });
  logger.info('  ✔ SMS templates seeded (onConflictDoNothing)');

  // ─── 短信服务商配置示例 ─────────────────────────────────────────────────────
  const existingSmsConfig = await db.select({ id: smsConfigs.id }).from(smsConfigs).limit(1);
  if (existingSmsConfig.length === 0) {
    await db.insert(smsConfigs).values([
      {
        name: '阿里云短信（示例）',
        provider: 'aliyun',
        accessKeyId: 'LTAI5tDemoAccessKeyId',
        accessKeySecret: 'DemoAccessKeySecretReplaceMe',
        region: 'cn-hangzhou',
        signName: 'Zenith',
        isDefault: true,
        status: 'disabled',
        remark: '初始环境占位配置，需填实际凭证后启用',
      },
    ]);
  }
  logger.info('  ✔ SMS configs seeded (skip if exists)');

  // ─── 站内信模板示例数据 ─────────────────────────────────────────────────────
  await db.insert(inAppTemplates).values([
    {
      name: '系统公告',
      code: 'system_notice_in_app',
      title: '系统公告：{{title}}',
      content: '{{content}}',
      type: 'info',
      variables: JSON.stringify({ title: '公告标题', content: '公告内容' }),
      status: 'enabled',
      remark: '系统公告通知模板',
    },
  ]).onConflictDoNothing({ target: inAppTemplates.code });
  logger.info('  ✔ In-app templates seeded (onConflictDoNothing)');

  // ── 标签 ────────────────────────────────────────────────────────────────────
  await db.insert(tags).values([
    { name: '重要',   color: '#ef4444', groupName: '优先级', description: '高优先级事项',   status: 'enabled', sortOrder: 1 },
    { name: '紧急',   color: '#f97316', groupName: '优先级', description: '需要立即处理',   status: 'enabled', sortOrder: 2 },
    { name: '普通',   color: '#6b7280', groupName: '优先级', description: '常规事项',       status: 'enabled', sortOrder: 3 },
    { name: '新用户', color: '#2563eb', groupName: '用户标签', description: '新注册用户',   status: 'enabled', sortOrder: 1 },
    { name: 'VIP',    color: '#a855f7', groupName: '用户标签', description: 'VIP 会员用户', status: 'enabled', sortOrder: 2 },
    { name: '待处理', color: '#f59e0b', groupName: '状态标签', description: '等待处理的事项', status: 'enabled', sortOrder: 1 },
    { name: '已完成', color: '#10b981', groupName: '状态标签', description: '已完成的事项', status: 'enabled', sortOrder: 2 },
  ]).onConflictDoNothing({ target: tags.name });
  logger.info('  ✔ Tags seeded (onConflictDoNothing)');
}

try {
  await seed();
} catch (err) {
  logger.error('Seed failed:', err);
  process.exit(1);
}
