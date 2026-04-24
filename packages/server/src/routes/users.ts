import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import bcrypt from 'bcryptjs';
import { eq, like, and, or, inArray, gte, lte } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { db } from '../db';
import type { DbExecutor } from '../db/types';
import { pageOffset } from '../lib/pagination';
import { users, userRoles, roles, departments, positions, userPositions } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import type { JwtPayload } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import { clearUserPermissionCache } from '../lib/permissions';
import { exportToExcel } from '../lib/excel-export';
import { getDataScopeCondition } from '../lib/data-scope';
import { unlockUser } from '../lib/session-manager';
import { getPasswordPolicy, validatePassword } from '../lib/password-policy';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import type { User } from '@zenith/shared';
import { ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody, errBody, okExcel, excelBody } from '../lib/openapi-schemas';
import { UserDTO, ImportResultDTO } from '../lib/openapi-dtos';

const usersRouter = new OpenAPIHono({ defaultHook: validationHook });

// Schemas (zod v4 local)
const createUserSchema = z.object({
  username: z.string().min(3).max(32),
  nickname: z.string().min(1).max(32),
  email: z.email(),
  password: z.string().min(6).max(64),
  phone: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().regex(/^1[3-9]\d{9}$/).optional(),
  ),
  departmentId: z.number().int().positive().nullable().optional(),
  positionIds: z.array(z.number().int().positive()).default([]),
  roleIds: z.array(z.number().int()).default([]),
  status: z.enum(['active', 'disabled']).default('active'),
});
const updateUserSchema = z.object({
  username: z.string().min(3).max(32).optional(),
  nickname: z.string().min(1).max(32).optional(),
  email: z.email().optional(),
  phone: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().regex(/^1[3-9]\d{9}$/).optional(),
  ),
  departmentId: z.number().int().positive().nullable().optional(),
  positionIds: z.array(z.number().int().positive()).optional(),
  roleIds: z.array(z.number().int()).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});
const resetUserPasswordSchema = z.object({ password: z.string().min(6).max(64) });
const batchIdsSchema = z.object({ ids: z.array(z.number().int()) });
const batchStatusSchema = z.object({ ids: z.array(z.number().int()), status: z.enum(['active', 'disabled']) });

// Helpers
const userRelationConfig = {
  department: { columns: { name: true } },
  userRoles: { columns: {}, with: { role: true } },
  userPositions: { columns: {}, with: { position: true } },
} as const;

type FindManyUsersArgs = NonNullable<Parameters<typeof db.query.users.findMany>[0]>;
type FindFirstUserArgs = NonNullable<Parameters<typeof db.query.users.findFirst>[0]>;

async function findUsersWithRelations(config: Omit<FindManyUsersArgs, 'with'> = {}) {
  return db.query.users.findMany({
    ...config,
    with: userRelationConfig,
  });
}

async function findUserWithRelations(config: Omit<FindFirstUserArgs, 'with'>) {
  return db.query.users.findFirst({
    ...config,
    with: userRelationConfig,
  });
}

type UserWithRelations = Awaited<ReturnType<typeof findUsersWithRelations>>[number];

function toPublicUser(row: UserWithRelations): User {
  const roles = row.userRoles.map(({ role: r }) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    description: r.description ?? undefined,
    dataScope: r.dataScope,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
  const positionList = row.userPositions.map(({ position: p }) => ({
    id: p.id,
    name: p.name,
    code: p.code,
    sort: p.sort,
    status: p.status,
    remark: p.remark ?? undefined,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));

  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    email: row.email,
    phone: row.phone ?? undefined,
    avatar: row.avatar ?? undefined,
    departmentId: row.departmentId,
    departmentName: row.department?.name ?? null,
    positionIds: positionList.map((position) => position.id),
    positions: positionList,
    roles,
    status: row.status,
    passwordUpdatedAt: row.passwordUpdatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  } satisfies User;
}

function toPublicUsers(rows: UserWithRelations[]): User[] {
  return rows.map(toPublicUser);
}

async function setUserRoles(executor: DbExecutor, userId: number, roleIds: number[]) {
  await executor.delete(userRoles).where(eq(userRoles.userId, userId));
  if (roleIds.length > 0) {
    await executor.insert(userRoles).values(roleIds.map((roleId) => ({ userId, roleId })));
  }
}
async function setUserPositions(executor: DbExecutor, userId: number, positionIds: number[]) {
  await executor.delete(userPositions).where(eq(userPositions.userId, userId));
  if (positionIds.length > 0) {
    await executor.insert(userPositions).values(positionIds.map((positionId) => ({ userId, positionId })));
  }
}

async function ensureDepartmentExists(departmentId?: number | null, user?: JwtPayload) {
  if (departmentId === undefined || departmentId === null) return null;
  const conditions = [eq(departments.id, departmentId)];
  if (user) {
    const tc = tenantCondition(departments, user);
    if (tc) conditions.push(tc);
  }
  const [d] = await db.select({ id: departments.id }).from(departments).where(and(...conditions)).limit(1);
  return d ? null : '所属部门不存在';
}
async function ensureRoleIdsExist(roleIds: number[], user?: JwtPayload) {
  const uniq = Array.from(new Set(roleIds));
  if (uniq.length === 0) return null;
  const conditions = [inArray(roles.id, uniq)];
  if (user) { const tc = tenantCondition(roles, user); if (tc) conditions.push(tc); }
  const rows = await db.select({ id: roles.id }).from(roles).where(and(...conditions));
  return rows.length === uniq.length ? null : '存在无效角色';
}
async function ensurePositionIdsExist(positionIds: number[], user?: JwtPayload) {
  const uniq = Array.from(new Set(positionIds));
  if (uniq.length === 0) return null;
  const conditions = [inArray(positions.id, uniq)];
  if (user) { const tc = tenantCondition(positions, user); if (tc) conditions.push(tc); }
  const rows = await db.select({ id: positions.id }).from(positions).where(and(...conditions));
  return rows.length === uniq.length ? null : '存在无效岗位';
}

// GET /all  全量用户（供下拉框）
const getAllUsersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/all',
    tags: ['Users'], summary: '全量用户（供下拉框）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:list' })] as const,
    request: {},
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(UserDTO), '全量用户'),
    },
  }),
  handler: async (c) => {
    const payload = c.get('user');
    const tc = tenantCondition(users, payload);
    const rawList = await findUsersWithRelations({
      where: tc,
      orderBy: users.id,
    });
    const publicUsers = toPublicUsers(rawList);
    return c.json(okBody(publicUsers), 200);
  },
});

// GET /
const listUsersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['Users'], summary: '用户列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:list' })] as const,
    request: { query: PaginationQuery.extend({
      keyword: z.string().optional(), phone: z.string().optional(),
      departmentId: z.coerce.number().optional(), status: z.enum(['active', 'disabled']).optional(),
      startTime: z.string().optional(), endTime: z.string().optional(),
    }) },
    responses: {
      ...commonErrorResponses,
      ...okPaginated(UserDTO, 'ok'),
    },
  }),
  handler: async (c) => {
    const { page = 1, pageSize = 10, keyword, phone, departmentId, status, startTime, endTime } = c.req.valid('query');
    const conditions = [];
    if (keyword) conditions.push(or(like(users.username, `%${keyword}%`), like(users.nickname, `%${keyword}%`), like(users.email, `%${keyword}%`)));
    if (phone) conditions.push(like(users.phone, `%${phone}%`));
    if (departmentId) conditions.push(eq(users.departmentId, departmentId));
    if (status) conditions.push(eq(users.status, status));
    if (startTime) conditions.push(gte(users.createdAt, new Date(startTime)));
    if (endTime) conditions.push(lte(users.createdAt, new Date(endTime)));

    const payload = c.get('user');
    const scopeCondition = await getDataScopeCondition({
      currentUserId: payload.userId, deptColumn: users.departmentId, ownerColumn: users.id,
    });
    if (scopeCondition) conditions.push(scopeCondition);
    const tc = tenantCondition(users, payload);
    if (tc) conditions.push(tc);

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [count, rawList] = await Promise.all([
      db.$count(users, where),
      findUsersWithRelations({
        where,
        limit: pageSize,
        offset: pageOffset(page, pageSize),
        orderBy: users.id,
      }),
    ]);
    const publicUsers = toPublicUsers(rawList);
    return c.json(okBody({ list: publicUsers, total: Number(count), page, pageSize }), 200);
  },
});

// POST /
const createUserRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['Users'], summary: '创建用户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:create', audit: { description: '创建用户', module: '用户管理' } })] as const,
    request: { body: { content: jsonContent(createUserSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(UserDTO, '创建成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    },
  }),
  handler: async (c) => {
    const data = c.req.valid('json');
    const policy = await getPasswordPolicy();
    const policyError = validatePassword(data.password, policy);
    if (policyError) return c.json(errBody(policyError), 400);

    const { password, roleIds, positionIds, departmentId, ...rest } = data;
    const nextRoleIds = Array.from(new Set(roleIds));
    const nextPositionIds = Array.from(new Set(positionIds));

    const [departmentError, roleError, positionError] = await Promise.all([
      ensureDepartmentExists(departmentId, c.get('user')),
      ensureRoleIdsExist(nextRoleIds, c.get('user')),
      ensurePositionIdsExist(nextPositionIds, c.get('user')),
    ]);
    const referenceError = departmentError ?? roleError ?? positionError;
    if (referenceError) return c.json(errBody(referenceError), 400);

    const hashedPassword = await bcrypt.hash(password, 10);
    try {
      const user = await db.transaction(async (tx) => {
        const [createdUser] = await tx.insert(users).values({
          ...rest,
          password: hashedPassword,
          departmentId: departmentId ?? null,
          tenantId: getCreateTenantId(c.get('user')),
        }).returning();
        await setUserRoles(tx, createdUser.id, nextRoleIds);
        await setUserPositions(tx, createdUser.id, nextPositionIds);
        return createdUser;
      });
      const createdUser = await findUserWithRelations({ where: eq(users.id, user.id) });
      if (!createdUser) throw new Error('创建用户后回读失败');
      const publicUser = toPublicUser(createdUser);
      return c.json(okBody(publicUser, '创建成功'), 200);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23505') {
        return c.json(errBody('用户名或邮箱已存在'), 400);
      }
      throw err;
    }
  },
});

// DELETE /batch
const batchDeleteUsersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/batch',
    tags: ['Users'], summary: '批量删除用户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:delete', audit: { description: '批量删除用户', module: '用户管理' } })] as const,
    request: { body: { content: jsonContent(batchIdsSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    if (!Array.isArray(ids) || ids.length === 0) return c.json(errBody('请选择要删除的用户'), 400);
    const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
    if (validIds.length === 0) return c.json(errBody('用户ID格式无效'), 400);
    const tc = tenantCondition(users, c.get('user'));
    await db.delete(users).where(tc ? and(inArray(users.id, validIds), tc) : inArray(users.id, validIds));
    return c.json(okBody(null, `已删除 ${validIds.length} 个用户`), 200);
  },
});

// PUT /batch-status
const batchStatusUsersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/batch-status',
    tags: ['Users'], summary: '批量修改用户状态',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:update', audit: { description: '批量修改用户状态', module: '用户管理' } })] as const,
    request: { body: { content: jsonContent(batchStatusSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('ok'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    },
  }),
  handler: async (c) => {
    const { ids, status } = c.req.valid('json');
    if (!Array.isArray(ids) || ids.length === 0) return c.json(errBody('请选择要操作的用户'), 400);
    const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
    const tc = tenantCondition(users, c.get('user'));
    await db.update(users).set({ status }).where(tc ? and(inArray(users.id, validIds), tc) : inArray(users.id, validIds));
    return c.json(okBody(null, '状态已更新'), 200);
  },
});

// GET /import-template
const importTemplateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/import-template',
    tags: ['Users'], summary: '下载导入模板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:import' })] as const,
    responses: {
      ...commonErrorResponses,
      ...okExcel(),
    },
  }),
  handler: async (c) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('用户导入模板');
    sheet.columns = [
      { header: '用户名*', key: 'username', width: 16 },
      { header: '昵称*', key: 'nickname', width: 16 },
      { header: '邮箱*', key: 'email', width: 24 },
      { header: '密码*', key: 'password', width: 16 },
      { header: '部门编码', key: 'departmentCode', width: 18 },
      { header: '岗位编码(逗号分隔)', key: 'positionCodes', width: 22 },
      { header: '角色编码(逗号分隔)', key: 'roleCodes', width: 22 },
      { header: '状态(active/disabled)', key: 'status', width: 22 },
    ];
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };
    sheet.addRow({
      username: 'zhangsan', nickname: '张三', email: 'zhangsan@example.com',
      // NOSONAR - sample value for import template only
      password: '请修改为强密码', departmentCode: 'technology', positionCodes: 'engineer',
      roleCodes: 'normal_user', status: 'active',
    });
    const buffer = await workbook.xlsx.writeBuffer();
    return excelBody(c, buffer, 'user_import_template.xlsx');
  },
});

// POST /import
const importUsersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/import',
    tags: ['Users'], summary: '导入用户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:import', audit: { description: '导入用户', module: '用户管理' } })] as const,
    request: {
      body: { content: { 'multipart/form-data': { schema: z.object({ file: z.any() }) } }, required: true },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(ImportResultDTO, 'ok'),
      400: { content: jsonContent(ErrorResponse), description: '文件无效' },
    },
  }),
  handler: async (c) => {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return c.json(errBody('请上传文件'), 400);
    const arrayBuffer = await file.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return c.json(errBody('文件格式无效或工作表为空'), 400);

    const policy = await getPasswordPolicy();
    const errors: Array<{ row: number; message: string }> = [];
    let success = 0;
    const getCellText = (row: ExcelJS.Row, col: number) => {
      const cell = row.getCell(col);
      return cell.text?.toString().trim() ?? '';
    };
    const dataRows: ExcelJS.Row[] = [];
    sheet.eachRow((row, rowNum) => { if (rowNum > 1) dataRows.push(row); });

    const [allDepts, allRoles, allPositions, existingUsersList] = await Promise.all([
      db.select({ id: departments.id, code: departments.code }).from(departments),
      db.select({ id: roles.id, code: roles.code }).from(roles),
      db.select({ id: positions.id, code: positions.code }).from(positions),
      db.select({ username: users.username, email: users.email }).from(users),
    ]);
    const deptCodeMap = new Map(allDepts.map((d) => [d.code, d.id]));
    const roleCodeMap = new Map(allRoles.map((r) => [r.code, r.id]));
    const positionCodeMap = new Map(allPositions.map((p) => [p.code, p.id]));
    const existingUsernames = new Set(existingUsersList.map((u) => u.username));
    const existingEmails = new Set(existingUsersList.map((u) => u.email));

    for (const row of dataRows) {
      const rowNum = row.number;
      const username = getCellText(row, 1);
      const nickname = getCellText(row, 2);
      const email = getCellText(row, 3);
      const password = getCellText(row, 4);
      const departmentCode = getCellText(row, 5);
      const positionCodesRaw = getCellText(row, 6);
      const roleCodesRaw = getCellText(row, 7);
      const statusRaw = getCellText(row, 8);

      if (!username || !nickname || !email || !password) { errors.push({ row: rowNum, message: '用户名、昵称、邮箱、密码为必填项' }); continue; }
      const policyError = validatePassword(password, policy);
      if (policyError) { errors.push({ row: rowNum, message: policyError }); continue; }
      if (existingUsernames.has(username) || existingEmails.has(email)) {
        errors.push({ row: rowNum, message: `用户名或邮箱已存在: ${username} / ${email}` }); continue;
      }

      let departmentId: number | null = null;
      if (departmentCode) {
        const deptId = deptCodeMap.get(departmentCode);
        if (!deptId) { errors.push({ row: rowNum, message: `部门编码不存在: ${departmentCode}` }); continue; }
        departmentId = deptId;
      }

      const roleCodes = roleCodesRaw ? roleCodesRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
      let roleIds: number[] = [];
      if (roleCodes.length > 0) {
        const missing = roleCodes.filter((code) => !roleCodeMap.has(code));
        if (missing.length > 0) { errors.push({ row: rowNum, message: `角色编码不存在: ${missing.join(', ')}` }); continue; }
        roleIds = roleCodes
          .map((code) => roleCodeMap.get(code))
          .filter((roleId): roleId is number => roleId !== undefined);
      }
      const positionCodes = positionCodesRaw ? positionCodesRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
      let positionIds: number[] = [];
      if (positionCodes.length > 0) {
        const missing = positionCodes.filter((code) => !positionCodeMap.has(code));
        if (missing.length > 0) { errors.push({ row: rowNum, message: `岗位编码不存在: ${missing.join(', ')}` }); continue; }
        positionIds = positionCodes
          .map((code) => positionCodeMap.get(code))
          .filter((positionId): positionId is number => positionId !== undefined);
      }

      let status: 'active' | 'disabled' = 'active';
      if (statusRaw) {
        const normalized = statusRaw.trim().toLowerCase();
        if (normalized === 'active' || normalized === 'disabled') status = normalized;
        else { errors.push({ row: rowNum, message: `状态值无效: ${statusRaw}（仅支持 active/disabled 或留空）` }); continue; }
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      try {
        await db.transaction(async (tx) => {
          const [newUser] = await tx.insert(users).values({
            username,
            nickname,
            email,
            password: hashedPassword,
            departmentId,
            status,
            tenantId: getCreateTenantId(c.get('user')),
          }).returning();
          if (roleIds.length > 0) await setUserRoles(tx, newUser.id, roleIds);
          if (positionIds.length > 0) await setUserPositions(tx, newUser.id, positionIds);
        });
        existingUsernames.add(username);
        existingEmails.add(email);
        success++;
      } catch (e: unknown) {
        errors.push({ row: rowNum, message: `插入失败: ${e instanceof Error ? e.message : '未知错误'}` });
      }
    }
    return c.json(okBody({ total: dataRows.length, success, failed: errors.length, errors }, '导入完成'), 200);
  },
});

// GET /export
const exportUsersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export',
    tags: ['Users'], summary: '导出用户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:list' })] as const,
    responses: {
      ...commonErrorResponses,
      ...okExcel(),
    },
  }),
  handler: async (c) => {
    const tc = tenantCondition(users, c.get('user'));
    const rawList = await db.query.users.findMany({
      where: tc,
      with: { department: { columns: { name: true } } },
      orderBy: users.id,
    });
    const list = rawList.map((u) => ({
      id: u.id, username: u.username, nickname: u.nickname, email: u.email,
      departmentName: u.department?.name ?? null, status: u.status, createdAt: u.createdAt,
    }));
    const buffer = await exportToExcel(
      [
        { header: 'ID', key: 'id', width: 8 },
        { header: '用户名', key: 'username', width: 16 },
        { header: '昵称', key: 'nickname', width: 16 },
        { header: '邮箱', key: 'email', width: 24 },
        { header: '部门', key: 'departmentName', width: 16 },
        { header: '状态', key: 'status', width: 10, transform: (v) => v === 'active' ? '启用' : '禁用' },
        { header: '创建时间', key: 'createdAt', width: 22 },
      ],
      list.map((r) => ({ ...r, departmentName: r.departmentName ?? '', createdAt: r.createdAt.toISOString() })),
      '用户列表',
    );
    return excelBody(c, buffer, 'users.xlsx');
  },
});

// PUT /{id}/password
const updateUserPasswordRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}/password',
    tags: ['Users'], summary: '修改用户密码',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:update', audit: { description: '修改用户密码', module: '用户管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(resetUserPasswordSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('ok'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '用户不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const policy = await getPasswordPolicy();
    const policyError = validatePassword(data.password, policy);
    if (policyError) return c.json(errBody(policyError), 400);
    const tc = tenantCondition(users, c.get('user'));
    const [user] = await db.select({ id: users.id }).from(users).where(tc ? and(eq(users.id, id), tc) : eq(users.id, id)).limit(1);
    if (!user) return c.json(errBody('用户不存在', 404), 404);
    const hashedPassword = await bcrypt.hash(data.password, 10);
    await db.update(users).set({ password: hashedPassword }).where(eq(users.id, id));
    return c.json(okBody(null, '密码修改成功'), 200);
  },
});

// POST /{id}/unlock
const unlockUserRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/unlock',
    tags: ['Users'], summary: '解锁账号',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:update', audit: { description: '解除账号锁定', module: '用户管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('ok'),
      404: { content: jsonContent(ErrorResponse), description: '用户不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const tc = tenantCondition(users, c.get('user'));
    const [user] = await db.select({ username: users.username }).from(users).where(tc ? and(eq(users.id, id), tc) : eq(users.id, id)).limit(1);
    if (!user) return c.json(errBody('用户不存在', 404), 404);
    await unlockUser(user.username);
    return c.json(okBody(null, '解锁成功'), 200);
  },
});

// PUT /{id}
const updateUserRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['Users'], summary: '更新用户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:update', audit: { description: '更新用户', module: '用户管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateUserSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(UserDTO, '更新成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '用户不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const [beforeUser] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (beforeUser) {
      const { password: _pw, ...safeBeforeUser } = beforeUser;
      setAuditBeforeData(c, safeBeforeUser);
    }
    const { roleIds, positionIds, departmentId, ...rest } = data;
    const nextRoleIds = roleIds ? Array.from(new Set(roleIds)) : undefined;
    const nextPositionIds = positionIds ? Array.from(new Set(positionIds)) : undefined;

    const [departmentError, roleError, positionError] = await Promise.all([
      ensureDepartmentExists(departmentId, c.get('user')),
      ensureRoleIdsExist(nextRoleIds ?? [], c.get('user')),
      ensurePositionIdsExist(nextPositionIds ?? [], c.get('user')),
    ]);
    const referenceError = departmentError ?? roleError ?? positionError;
    if (referenceError) return c.json(errBody(referenceError), 400);

    const nextValues = {
      ...rest,
      ...(departmentId === undefined ? {} : { departmentId: departmentId ?? null }),
    };
    const tc = tenantCondition(users, c.get('user'));
    const user = await db.transaction(async (tx) => {
      const [updatedUser] = await tx.update(users)
        .set(nextValues)
        .where(tc ? and(eq(users.id, id), tc) : eq(users.id, id))
        .returning();
      if (!updatedUser) return null;

      if (nextRoleIds !== undefined) {
        await setUserRoles(tx, id, nextRoleIds);
      }
      if (nextPositionIds !== undefined) {
        await setUserPositions(tx, id, nextPositionIds);
      }

      return updatedUser;
    });
    if (!user) return c.json(errBody('用户不存在', 404), 404);

    if (nextRoleIds !== undefined) clearUserPermissionCache(id);

    const updatedUser = await findUserWithRelations({ where: eq(users.id, user.id) });
    if (!updatedUser) return c.json(errBody('用户不存在', 404), 404);
    const publicUser = toPublicUser(updatedUser);
    return c.json(okBody(publicUser, '更新成功'), 200);
  },
});

// DELETE /{id}
const deleteUserRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['Users'], summary: '删除用户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:user:delete', audit: { description: '删除用户', module: '用户管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '用户不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const [beforeUser] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (beforeUser) {
      const { password: _pw, ...safeBeforeUser } = beforeUser;
      setAuditBeforeData(c, safeBeforeUser);
    }
    const tc = tenantCondition(users, c.get('user'));
    const [deleted] = await db.delete(users).where(tc ? and(eq(users.id, id), tc) : eq(users.id, id)).returning();
    if (!deleted) return c.json(errBody('用户不存在', 404), 404);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

usersRouter.openapiRoutes([getAllUsersRoute, listUsersRoute, createUserRoute, batchDeleteUsersRoute, batchStatusUsersRoute, importTemplateRoute, importUsersRoute, exportUsersRoute, updateUserPasswordRoute, unlockUserRoute, updateUserRoute, deleteUserRoute] as const);

export default usersRouter;
