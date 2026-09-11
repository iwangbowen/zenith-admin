import { db } from '../../../db';
import { users } from '../../../db/schema';
import type { JwtPayload } from '../../../middleware/auth';
import { buildUsersListWhere, findUsersWithRelations, mapUsers, type UsersListFilter } from '../../../services/identity/users.service';
import { asPositiveInt, asString } from '../query-normalize';
import { defineExport } from '../registry';

interface UserExportRow extends Record<string, unknown> {
  id: number;
  username: string;
  nickname: string;
  email: string;
  phone: string;
  departmentName: string;
  rolesText: string;
  positionsText: string;
  status: 'enabled' | 'disabled';
  lastLoginAt: string;
  createdAt: string;
  updatedAt: string;
}

function normalizeQuery(query: Record<string, unknown>): UsersListFilter {
  const status = query.status === 'enabled' || query.status === 'disabled' ? query.status : undefined;
  return {
    keyword: asString(query.keyword),
    phone: asString(query.phone),
    departmentId: asPositiveInt(query.departmentId),
    status,
    startTime: asString(query.startTime),
    endTime: asString(query.endTime),
  };
}

async function loadUserRows(query: Record<string, unknown>, user: JwtPayload): Promise<UserExportRow[]> {
  const where = await buildUsersListWhere(normalizeQuery(query), user);
  const rawList = await findUsersWithRelations({ where, orderBy: users.id });
  const list = mapUsers(rawList);
  return list.map((item) => ({
    id: item.id,
    username: item.username,
    nickname: item.nickname,
    email: item.email ?? '',
    phone: item.phone ?? '',
    departmentName: item.departmentName ?? '',
    rolesText: item.roles.map((role) => role.name).join(', '),
    positionsText: (item.positions ?? []).map((position) => position.name).join(', '),
    status: item.status,
    lastLoginAt: item.lastLoginAt ?? '',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
}

export const usersExportDefinition = defineExport<Record<string, unknown>, UserExportRow>({
  entity: 'system.users',
  moduleName: '用户管理',
  filenamePrefix: '用户列表',
  sourcePath: '/system/users',
  sheetName: '用户列表',
  formats: ['xlsx', 'csv'],
  permissions: {
    export: 'system:user:export',
    exportRaw: 'system:user:export-raw',
    requireExportRawPermission: true,
  },
  execution: {
    mode: 'sync',
    syncMaxRows: 3000,
    forceAsyncWhenRaw: false,
    forceAsyncWhenSensitive: false,
    syncModeOverridesAsyncPolicies: true,
  },
  retention: {
    normalDays: 7,
    sensitiveDays: 3,
    rawDays: 1,
  },
  columns: [
    {
      header: '基础信息',
      children: [
        { key: 'id', header: 'ID', width: 8, type: 'number' },
        { key: 'username', header: '用户名', width: 18 },
        { key: 'nickname', header: '昵称', width: 18 },
        { key: 'departmentName', header: '部门', width: 18 },
        { key: 'status', header: '状态', width: 10, enumMap: { enabled: '启用', disabled: '禁用' } },
      ],
    },
    {
      header: '联系方式',
      children: [
        // 脱敏导出按数据脱敏中心对 User.email / User.phone 的生效策略打码，与用户列表页同一口径
        { key: 'email', header: '邮箱', width: 28, sensitive: true, maskKey: 'User.email' },
        { key: 'phone', header: '手机号', width: 18, sensitive: true, maskKey: 'User.phone' },
      ],
    },
    {
      header: '组织角色',
      children: [
        { key: 'rolesText', header: '角色', width: 28 },
        { key: 'positionsText', header: '岗位', width: 24 },
      ],
    },
    {
      header: '时间信息',
      children: [
        { key: 'lastLoginAt', header: '最后登录时间', width: 22, type: 'datetime' },
        { key: 'createdAt', header: '创建时间', width: 22, type: 'datetime' },
        { key: 'updatedAt', header: '更新时间', width: 22, type: 'datetime' },
      ],
    },
  ],
  countRows: async (query, user) => {
    const where = await buildUsersListWhere(normalizeQuery(query), user);
    return db.$count(users, where);
  },
  streamRows: loadUserRows,
});
