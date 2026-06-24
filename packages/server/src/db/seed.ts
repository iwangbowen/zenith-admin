import { db } from './index';
import { users, menus, roles, roleMenus, userRoles, dicts, dictItems, fileStorageConfigs, departments, positions, userPositions, systemConfigs, cronJobs, regions, tenants, tenantPackages, tenantPackageMenus, emailTemplates, smsConfigs, smsTemplates, inAppTemplates, tags, dataMaskConfigs, memberLevels, members, memberPointAccounts, memberPointTransactions, memberWallets, coupons, memberCoupons, checkinRules, checkinSettings, checkinMilestones, workflowForms, workflowDataSources, workflowTemplates, workflowDefinitions, aiPromptTemplates, paymentMethodConfigs, mpAccounts, mpTags, mpFans, mpMessages, mpAutoReplies, mpMenus, mpMaterials, mpDrafts, mpMessageTemplates, mpBroadcasts, mpQrcodes, mpKfAccounts, mpKfSessions, mpKfSessionEvents, mpKfRoutingConfigs, channels, channelQuickReplies } from './schema';
import bcrypt from 'bcryptjs';
import { and, eq, isNull, inArray, sql } from 'drizzle-orm';
import { createRequire } from 'node:module';
import logger from '../lib/logger';
import { runAsUser } from '../lib/audit-context';
import { SEED_MENUS, SEED_ROLES, SEED_DEPARTMENTS, SEED_POSITIONS, SEED_DICTS, SEED_DICT_ITEMS, SEED_SYSTEM_CONFIGS, SEED_CRON_JOBS, SEED_TAGS, SEED_DATA_MASK_CONFIGS, SEED_MEMBER_LEVELS, SEED_COUPONS, SEED_EMAIL_TEMPLATES, SEED_SMS_TEMPLATES, SEED_INAPP_TEMPLATES, SEED_TENANTS, SEED_TENANT_PACKAGES, SEED_WORKFLOW_FORMS, SEED_WORKFLOW_DATA_SOURCES, SEED_WORKFLOW_TEMPLATES, SEED_WORKFLOW_DEFINITIONS, SEED_AI_PROMPT_TEMPLATES, SEED_PAYMENT_METHOD_CONFIGS, SEED_CHECKIN_MILESTONES, SEED_MP_ACCOUNTS, SEED_MP_TAGS, SEED_MP_FANS, SEED_MP_MESSAGES, SEED_MP_AUTO_REPLIES, SEED_MP_MENUS, SEED_MP_MATERIALS, SEED_MP_DRAFTS, SEED_MP_MESSAGE_TEMPLATES, SEED_MP_BROADCASTS, SEED_MP_QRCODES, SEED_MP_KF_ACCOUNTS, SEED_MP_KF_ROUTING_CONFIGS, SEED_MP_KF_SESSIONS, SEED_MP_KF_SESSION_EVENTS, SEED_CHANNELS, SEED_CHANNEL_QUICK_REPLIES } from '@zenith/shared';
import type { PaymentChannel, PaymentMethod } from '@zenith/shared';

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

  // 内置系统号「Zenith 助手」（工作流/告警/卡片消息的发送者，取代旧的机器人假用户）
  for (const ch of SEED_CHANNELS) {
    const existing = await db.select({ id: channels.id }).from(channels)
      .where(eq(channels.code, ch.code)).limit(1);
    if (existing.length === 0) {
      await db.insert(channels).values({
        code: ch.code,
        name: ch.name,
        avatar: ch.avatar,
        description: ch.description,
        type: ch.type,
        builtin: ch.builtin,
        status: 'enabled',
      });
    }
  }
  logger.info('  ✔ System channel seeded (skip if exists)');

  // 客服快捷回复示例（全局，仅在表为空时种入）
  const quickReplyCount = await db.$count(channelQuickReplies);
  if (quickReplyCount === 0) {
    await db.insert(channelQuickReplies).values(SEED_CHANNEL_QUICK_REPLIES.map((q) => ({
      channelId: q.channelId,
      title: q.title,
      content: q.content,
      sort: q.sort,
    })));
    logger.info('  ✔ Channel quick replies seeded');
  }

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
    category: row.category ?? 'department',
    leaderId: row.leaderId ?? null,
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
  await db.insert(dicts).values(dictRows).onConflictDoNothing({ target: dicts.id });
  await db.execute(sql`SELECT setval('dicts_id_seq', GREATEST((SELECT MAX(id) FROM dicts), 1))`);
  logger.info('  ✔ Dicts seeded (onConflictDoNothing)');

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

  // ─── 租户套餐示例数据（数据来源：@zenith/shared SEED_TENANT_PACKAGES）─────────────────────────
  await db.insert(tenantPackages).values(
    SEED_TENANT_PACKAGES.map(({ id, name, status, remark }) => ({ id, name, status, remark })),
  ).onConflictDoNothing({ target: tenantPackages.id });
  await db.execute(sql`SELECT setval('tenant_packages_id_seq', GREATEST((SELECT MAX(id) FROM tenant_packages), 1))`);
  const pkgMenuRows = SEED_TENANT_PACKAGES.flatMap((p) => (p.menuIds ?? []).map((menuId) => ({ packageId: p.id, menuId })));
  if (pkgMenuRows.length > 0) {
    await db.insert(tenantPackageMenus).values(pkgMenuRows).onConflictDoNothing();
  }
  logger.info('  ✔ Tenant packages seeded (onConflictDoNothing)');

  // ─── 租户示例数据（数据来源：@zenith/shared SEED_TENANTS）───────────────────────────────────
  await db.insert(tenants).values(
    SEED_TENANTS.map(({ name, code, contactName, contactPhone, status, maxUsers, packageId, remark }) => ({ name, code, contactName, contactPhone, status, maxUsers, packageId, remark })),
  ).onConflictDoNothing({ target: tenants.code });
  logger.info('  ✔ Tenants seeded (onConflictDoNothing)');

  // ─── 邮件模板示例数据（数据来源：@zenith/shared SEED_EMAIL_TEMPLATES）─────────────────────────
  await db.insert(emailTemplates).values(
    SEED_EMAIL_TEMPLATES.map(({ name, code, subject, content, variables, status, remark }) => ({ name, code, subject, content, variables, status, remark })),
  ).onConflictDoNothing({ target: emailTemplates.code });
  logger.info('  ✔ Email templates seeded (onConflictDoNothing)');

  // ─── 短信模板示例数据（数据来源：@zenith/shared SEED_SMS_TEMPLATES）──────────────────────
  await db.insert(smsTemplates).values(
    SEED_SMS_TEMPLATES.map(({ name, code, templateCode, signName, content, variables, provider, status, remark }) => ({ name, code, templateCode, signName, content, variables, provider, status, remark })),
  ).onConflictDoNothing({ target: smsTemplates.code });
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

  // ─── 公众号账号示例数据（数据来源：@zenith/shared SEED_MP_ACCOUNTS）──────────────
  await db.insert(mpAccounts).values(
    SEED_MP_ACCOUNTS.map(({ id, name, account, appId, appSecret, token, encodingAesKey, encryptMode, type, qrCodeUrl, isDefault, autoCreateMember, status, remark }) =>
      ({ id, name, account, appId, appSecret, token, encodingAesKey, encryptMode, type, qrCodeUrl, isDefault, autoCreateMember, status, remark })),
  ).onConflictDoNothing({ target: mpAccounts.appId });
  await db.execute(sql`SELECT setval('mp_accounts_id_seq', GREATEST((SELECT MAX(id) FROM mp_accounts), 1))`);
  logger.info('  ✔ MP accounts seeded (onConflictDoNothing)');

  // ─── 公众号标签示例数据（数据来源：@zenith/shared SEED_MP_TAGS）──────────────────
  await db.insert(mpTags).values(
    SEED_MP_TAGS.map(({ id, accountId, wechatTagId, name, fansCount }) => ({ id, accountId, wechatTagId, name, fansCount })),
  ).onConflictDoNothing({ target: mpTags.id });
  await db.execute(sql`SELECT setval('mp_tags_id_seq', GREATEST((SELECT MAX(id) FROM mp_tags), 1))`);
  logger.info('  ✔ MP tags seeded (onConflictDoNothing)');

  // ─── 公众号粉丝示例数据（数据来源：@zenith/shared SEED_MP_FANS）──────────────────
  await db.insert(mpFans).values(
    SEED_MP_FANS.map(({ id, accountId, openid, nickname, avatar, sex, country, province, city, language, subscribe, remark, tagIds }) =>
      ({ id, accountId, openid, nickname, avatar, sex, country, province, city, language, subscribe, remark, tagIds })),
  ).onConflictDoNothing({ target: mpFans.id });
  await db.execute(sql`SELECT setval('mp_fans_id_seq', GREATEST((SELECT MAX(id) FROM mp_fans), 1))`);
  logger.info('  ✔ MP fans seeded (onConflictDoNothing)');

  // ─── 公众号消息示例数据（数据来源：@zenith/shared SEED_MP_MESSAGES）──────────────
  await db.insert(mpMessages).values(
    SEED_MP_MESSAGES.map(({ id, accountId, openid, direction, msgType, content, mediaId, mediaUrl, event, msgId, status, createdAt }) =>
      ({ id, accountId, openid, direction, msgType, content, mediaId, mediaUrl, event, msgId, status, createdAt: new Date(createdAt) })),
  ).onConflictDoNothing({ target: mpMessages.id });
  await db.execute(sql`SELECT setval('mp_messages_id_seq', GREATEST((SELECT MAX(id) FROM mp_messages), 1))`);
  logger.info('  ✔ MP messages seeded (onConflictDoNothing)');

  // ─── 公众号自动回复 / 自定义菜单示例数据 ────────────────────────────────────────
  await db.insert(mpAutoReplies).values(
    SEED_MP_AUTO_REPLIES.map(({ id, accountId, replyType, keyword, matchType, contentType, content, mediaId, newsArticles, status, sort }) =>
      ({ id, accountId, replyType, keyword, matchType, contentType, content, mediaId, newsArticles, status, sort })),
  ).onConflictDoNothing({ target: mpAutoReplies.id });
  await db.execute(sql`SELECT setval('mp_auto_replies_id_seq', GREATEST((SELECT MAX(id) FROM mp_auto_replies), 1))`);
  logger.info('  ✔ MP auto-replies seeded (onConflictDoNothing)');

  await db.insert(mpMenus).values(
    SEED_MP_MENUS.map(({ id, accountId, buttons, status }) => ({ id, accountId, buttons, status })),
  ).onConflictDoNothing({ target: mpMenus.id });
  await db.execute(sql`SELECT setval('mp_menus_id_seq', GREATEST((SELECT MAX(id) FROM mp_menus), 1))`);
  logger.info('  ✔ MP menus seeded (onConflictDoNothing)');

  // ─── 公众号素材 / 图文草稿 / 模板消息示例数据 ────────────────────────────────────
  await db.insert(mpMaterials).values(
    SEED_MP_MATERIALS.map(({ id, accountId, type, name, wechatMediaId, url, fileSize }) => ({ id, accountId, type, name, wechatMediaId, url, fileSize })),
  ).onConflictDoNothing({ target: mpMaterials.id });
  await db.execute(sql`SELECT setval('mp_materials_id_seq', GREATEST((SELECT MAX(id) FROM mp_materials), 1))`);
  logger.info('  ✔ MP materials seeded (onConflictDoNothing)');

  await db.insert(mpDrafts).values(
    SEED_MP_DRAFTS.map(({ id, accountId, title, articles, status }) => ({ id, accountId, title, articles, status })),
  ).onConflictDoNothing({ target: mpDrafts.id });
  await db.execute(sql`SELECT setval('mp_drafts_id_seq', GREATEST((SELECT MAX(id) FROM mp_drafts), 1))`);
  logger.info('  ✔ MP drafts seeded (onConflictDoNothing)');

  await db.insert(mpMessageTemplates).values(
    SEED_MP_MESSAGE_TEMPLATES.map(({ id, accountId, templateId, title, content, example }) => ({ id, accountId, templateId, title, content, example })),
  ).onConflictDoNothing({ target: mpMessageTemplates.id });
  await db.execute(sql`SELECT setval('mp_message_templates_id_seq', GREATEST((SELECT MAX(id) FROM mp_message_templates), 1))`);
  logger.info('  ✔ MP message templates seeded (onConflictDoNothing)');

  // ─── 公众号群发 / 带参二维码示例数据（数据来源：@zenith/shared）─────────────────────
  await db.insert(mpBroadcasts).values(
    SEED_MP_BROADCASTS.map(({ id, accountId, msgType, target, tagId, content, mediaId, status }) => ({ id, accountId, msgType, target, tagId, content, mediaId, status })),
  ).onConflictDoNothing({ target: mpBroadcasts.id });
  await db.execute(sql`SELECT setval('mp_broadcasts_id_seq', GREATEST((SELECT MAX(id) FROM mp_broadcasts), 1))`);
  logger.info('  ✔ MP broadcasts seeded (onConflictDoNothing)');

  await db.insert(mpQrcodes).values(
    SEED_MP_QRCODES.map(({ id, accountId, type, sceneStr, name, ticket, url, expireSeconds, scanCount }) => ({ id, accountId, type, sceneStr, name, ticket, url, expireSeconds, scanCount })),
  ).onConflictDoNothing({ target: mpQrcodes.id });
  await db.execute(sql`SELECT setval('mp_qrcodes_id_seq', GREATEST((SELECT MAX(id) FROM mp_qrcodes), 1))`);
  logger.info('  ✔ MP qrcodes seeded (onConflictDoNothing)');

  await db.insert(mpKfAccounts).values(
    SEED_MP_KF_ACCOUNTS.map(({ id, accountId, kfAccount, nickname, avatar, kfId, inviteStatus, inviteWx, status }) => ({ id, accountId, kfAccount, nickname, avatar, kfId, inviteStatus, inviteWx, status })),
  ).onConflictDoNothing({ target: mpKfAccounts.id });
  await db.execute(sql`SELECT setval('mp_kf_accounts_id_seq', GREATEST((SELECT MAX(id) FROM mp_kf_accounts), 1))`);
  logger.info('  ✔ MP kf accounts seeded (onConflictDoNothing)');

  // 多客服路由配置 + 会话状态机 + 事件流水（时间取 now，避免被超时任务立即清理）
  await db.insert(mpKfRoutingConfigs).values(
    SEED_MP_KF_ROUTING_CONFIGS.map((c) => ({ ...c })),
  ).onConflictDoNothing({ target: mpKfRoutingConfigs.accountId });
  const mpKfNow = new Date();
  await db.insert(mpKfSessions).values(
    SEED_MP_KF_SESSIONS.map((s) => ({
      id: s.id, accountId: s.accountId, openid: s.openid, kfId: s.kfId, status: s.status,
      unreadCount: s.unreadCount, source: s.source, closeReason: s.closeReason,
      lastMsgAt: mpKfNow,
      lastFanMsgAt: mpKfNow,
      lastKfMsgAt: s.kfId ? mpKfNow : null,
      waitingSince: s.status === 'waiting' ? mpKfNow : null,
      acceptedAt: s.status === 'waiting' ? null : mpKfNow,
      closedAt: s.status === 'closed' ? mpKfNow : null,
    })),
  ).onConflictDoNothing({ target: mpKfSessions.id });
  await db.execute(sql`SELECT setval('mp_kf_sessions_id_seq', GREATEST((SELECT MAX(id) FROM mp_kf_sessions), 1))`);
  await db.insert(mpKfSessionEvents).values(
    SEED_MP_KF_SESSION_EVENTS.map((e) => ({ id: e.id, sessionId: e.sessionId, accountId: e.accountId, type: e.type, fromKfId: e.fromKfId, toKfId: e.toKfId, detail: e.detail })),
  ).onConflictDoNothing({ target: mpKfSessionEvents.id });
  await db.execute(sql`SELECT setval('mp_kf_session_events_id_seq', GREATEST((SELECT MAX(id) FROM mp_kf_session_events), 1))`);
  logger.info('  ✔ MP kf sessions seeded (onConflictDoNothing)');

  // ─── 站内信模板示例数据（数据来源：@zenith/shared SEED_INAPP_TEMPLATES）─────────────────────
  await db.insert(inAppTemplates).values(
    SEED_INAPP_TEMPLATES.map(({ name, code, title, content, type, variables, status, remark }) => ({ name, code, title, content, type, variables, status, remark })),
  ).onConflictDoNothing({ target: inAppTemplates.code });
  logger.info('  ✔ In-app templates seeded (onConflictDoNothing)');

  // ─── AI 提示词模板内置预设（数据来源：@zenith/shared SEED_AI_PROMPT_TEMPLATES）─────
  await db.insert(aiPromptTemplates).values(
    SEED_AI_PROMPT_TEMPLATES.map(({ id, name, content, description, category, scope, userId, isBuiltin, sort, isEnabled }) => ({ id, name, content, description, category, scope, userId, isBuiltin, sort, isEnabled })),
  ).onConflictDoNothing({ target: aiPromptTemplates.id });
  await db.execute(sql`SELECT setval('ai_prompt_templates_id_seq', GREATEST((SELECT MAX(id) FROM ai_prompt_templates), 1))`);
  logger.info('  ✔ AI prompt templates seeded (onConflictDoNothing)');

  // ─── 支付方式配置（数据来源：@zenith/shared SEED_PAYMENT_METHOD_CONFIGS）─────────
  await db.insert(paymentMethodConfigs).values(
    SEED_PAYMENT_METHOD_CONFIGS.map(({ id, method, channel, label, icon, enabled, sort }) => ({
      id,
      method: method as PaymentMethod,
      channel: channel as PaymentChannel,
      label,
      icon,
      enabled,
      sort,
    })),
  ).onConflictDoNothing({ target: paymentMethodConfigs.id });
  await db.execute(sql`SELECT setval('payment_method_configs_id_seq', GREATEST((SELECT MAX(id) FROM payment_method_configs), 1))`);
  logger.info('  ✔ Payment method configs seeded (onConflictDoNothing)');

  // ── 标签 ────────────────────────────────────────────────────────────────────
  await db.insert(tags).values(
    SEED_TAGS.map(({ name, color, groupName, description, status, sortOrder }) => ({ name, color, groupName, description, status, sortOrder })),
  ).onConflictDoNothing({ target: tags.name });
  logger.info('  ✔ Tags seeded (onConflictDoNothing)');

  // ── 数据脱敏规则 ──────────────────────────────────────────────────────────────
  await db.insert(dataMaskConfigs).values(
    SEED_DATA_MASK_CONFIGS.map(({ entity, field, label, maskType, exemptRoleCodes, enabled, remark }) => ({ entity, field, label, maskType, exemptRoleCodes, enabled, remark })),
  ).onConflictDoNothing();
  logger.info('  ✔ Data mask configs seeded (onConflictDoNothing)');

  // ── 会员等级 ──────────────────────────────────────────────────
  await db.insert(memberLevels).values(
    SEED_MEMBER_LEVELS.map(({ id, name, level, growthThreshold, discount, benefits, sort, status }) => ({ id, name, level, growthThreshold, discount, benefits, sort, status })),
  ).onConflictDoNothing({ target: memberLevels.id });
  await db.execute(sql`SELECT setval('member_levels_id_seq', GREATEST((SELECT MAX(id) FROM member_levels), 1))`);
  logger.info('  ✔ Member levels seeded (onConflictDoNothing)');

  // ── 优惠券模板 ────────────────────────────────────────────────
  await db.insert(coupons).values(
    SEED_COUPONS.map(({ id, name, type, faceValue, threshold, maxDiscount, totalQuantity, perLimit, validType, validDays, status, description }) => ({ id, name, type, faceValue, threshold, maxDiscount, totalQuantity, perLimit, validType, validDays, status, description })),
  ).onConflictDoNothing({ target: coupons.id });
  await db.execute(sql`SELECT setval('coupons_id_seq', GREATEST((SELECT MAX(id) FROM coupons), 1))`);
  logger.info('  ✔ Coupons seeded (onConflictDoNothing)');

  // ── 签到规则 ──────────────────────────────────────────────────
  await db.insert(checkinRules).values([
    { dayNumber: 1, points: 10, experience: 5, remark: '第1天签到' },
    { dayNumber: 2, points: 10, experience: 5, remark: '第2天签到' },
    { dayNumber: 3, points: 15, experience: 8, remark: '第3天签到' },
    { dayNumber: 4, points: 15, experience: 8, remark: '第4天签到' },
    { dayNumber: 5, points: 20, experience: 10, remark: '第5天签到' },
    { dayNumber: 6, points: 20, experience: 10, remark: '第6天签到' },
    { dayNumber: 7, points: 50, experience: 30, remark: '连续7天签到（周奖励）' },
  ]).onConflictDoNothing();
  logger.info('  ✔ Checkin rules seeded (onConflictDoNothing)');

  // ── 签到设置（单行，id 固定为 1）────────────────────────────────
  await db.insert(checkinSettings).values({ id: 1, makeupEnabled: true, makeupCostPoints: 20, makeupMaxDays: 7 }).onConflictDoNothing();
  logger.info('  ✔ Checkin settings seeded (onConflictDoNothing)');

  // ── 签到里程碑（数据来源：@zenith/shared SEED_CHECKIN_MILESTONES）──
  await db.insert(checkinMilestones).values(
    SEED_CHECKIN_MILESTONES.map(({ id, title, cumulativeDays, rewardType, rewardPoints, couponId, enabled, remark }) => ({
      id, title, cumulativeDays, rewardType, rewardPoints, couponId, enabled, remark,
    })),
  ).onConflictDoNothing();
  logger.info('  ✔ Checkin milestones seeded (onConflictDoNothing)');

  // ── 流程表单库（数据来源：@zenith/shared SEED_WORKFLOW_FORMS）────────────────
  // tenantId 留空（平台级），由超管可见；created_by/updated_by 由 db Proxy 注入。
  await db.insert(workflowForms).values(
    SEED_WORKFLOW_FORMS.map(({ id, name, code, description, categoryId, schema, status }) =>
      ({ id, name, code, description, categoryId, schema, status })),
  ).onConflictDoNothing({ target: workflowForms.id });
  await db.execute(sql`SELECT setval('workflow_forms_id_seq', GREATEST((SELECT MAX(id) FROM workflow_forms), 1))`);
  logger.info('  ✔ Workflow forms seeded (onConflictDoNothing)');

  // ── 流程远程数据源（数据来源：@zenith/shared SEED_WORKFLOW_DATA_SOURCES）──────
  await db.insert(workflowDataSources).values(
    SEED_WORKFLOW_DATA_SOURCES.map(({ id, name, method, url, headers, itemsPath, valueField, labelField, keywordParam, status, remark }) =>
      ({ id, name, method, url, headers: headers ?? undefined, itemsPath: itemsPath ?? undefined, valueField, labelField, keywordParam: keywordParam ?? undefined, status, remark: remark ?? undefined })),
  ).onConflictDoNothing({ target: workflowDataSources.id });
  await db.execute(sql`SELECT setval('workflow_data_sources_id_seq', GREATEST((SELECT MAX(id) FROM workflow_data_sources), 1))`);
  logger.info('  ✔ Workflow data sources seeded (onConflictDoNothing)');

  // ── 流程内置模板（数据来源：@zenith/shared SEED_WORKFLOW_TEMPLATES）──────────
  // builtin=true 系统模板，tenantId 留空（平台级），供「从模板新建」直接克隆为草稿。
  await db.insert(workflowTemplates).values(
    SEED_WORKFLOW_TEMPLATES.map(({ id, name, code, description, categoryName, icon, color, flowData, formSchema, sort, builtin, tenantId }) =>
      ({ id, name, code, description, categoryName, icon, color, flowData, formSchema, sort, builtin, tenantId })),
  ).onConflictDoNothing({ target: workflowTemplates.id });
  await db.execute(sql`SELECT setval('workflow_templates_id_seq', GREATEST((SELECT MAX(id) FROM workflow_templates), 1))`);
  logger.info('  ✔ Workflow templates seeded (onConflictDoNothing)');

  // ── 流程定义（业务接入示例：请假审批，external）────────────────────────────────
  await db.insert(workflowDefinitions).values(
    SEED_WORKFLOW_DEFINITIONS.map(({ id, name, description, initiatorScopeType, flowData, formType, customForm, status, version, tenantId }) =>
      ({ id, name, description, initiatorScopeType, flowData, formType, customForm, status, version, tenantId })),
  ).onConflictDoNothing({ target: workflowDefinitions.id });
  await db.execute(sql`SELECT setval('workflow_definitions_id_seq', GREATEST((SELECT MAX(id) FROM workflow_definitions), 1))`);
  logger.info('  ✔ Workflow definitions seeded (onConflictDoNothing)');

  // ── 演示会员（手机号 13800138000 / 密码 123456）────────────────────────
  const existingDemoMember = await db.select({ id: members.id }).from(members).where(eq(members.phone, '13800138000')).limit(1);
  if (existingDemoMember.length === 0) {
    const memberPwd = await bcrypt.hash('123456', 10);
    const [normalLevel] = await db.select({ id: memberLevels.id }).from(memberLevels).where(eq(memberLevels.level, 1)).limit(1);
    const [demoMember] = await db.insert(members).values({
      phone: '13800138000',
      nickname: '演示会员',
      password: memberPwd,
      status: 'active',
      levelId: normalLevel?.id ?? null,
      growthValue: 0,
      registerSource: 'seed',
    }).returning({ id: members.id });
    // 初始化积分账户（赠送 100 积分）+ 流水
    await db.insert(memberPointAccounts).values({ memberId: demoMember.id, balance: 100, totalEarned: 100 });
    await db.insert(memberPointTransactions).values({ memberId: demoMember.id, type: 'earn', amount: 100, balanceAfter: 100, bizType: 'register', remark: '注册赠送积分' });
    // 初始化钱包
    await db.insert(memberWallets).values({ memberId: demoMember.id, balance: 0 });
    // 发放一张优惠券
    const [firstCoupon] = await db.select({ id: coupons.id, validDays: coupons.validDays }).from(coupons).limit(1);
    if (firstCoupon) {
      const expireAt = firstCoupon.validDays ? new Date(Date.now() + firstCoupon.validDays * 86_400_000) : null;
      await db.insert(memberCoupons).values({ couponId: firstCoupon.id, memberId: demoMember.id, code: 'SEEDCOUPON0001', status: 'unused', expireAt });
      await db.update(coupons).set({ issuedQuantity: sql`${coupons.issuedQuantity} + 1` }).where(eq(coupons.id, firstCoupon.id));
    }
    logger.info('  ✔ Demo member seeded (13800138000 / 123456)');
  }
}

try {
  await seed();
} catch (err) {
  logger.error('Seed failed:', err);
  process.exit(1);
}
