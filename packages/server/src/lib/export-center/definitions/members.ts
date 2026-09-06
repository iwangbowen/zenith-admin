import { desc } from 'drizzle-orm';
import { db } from '../../../db';
import { members } from '../../../db/schema';
import { buildMemberWhere } from '../../../services/member/admin-members.service';
import { MEMBER_STATUS_LABELS } from '@zenith/shared/member';
import type { MemberStatus } from '@zenith/shared/member';
import { defineExport } from '../registry';
import type { ExportColumn } from '../types';

type MembersExportQuery = { keyword?: string; status?: MemberStatus; levelId?: number };

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'username', header: '用户名', width: 16 },
  { key: 'phone', header: '手机号', width: 16, sensitive: true, maskKey: 'Member.phone' },
  { key: 'email', header: '邮箱', width: 22, sensitive: true, maskKey: 'Member.email' },
  { key: 'nickname', header: '昵称', width: 16 },
  { key: 'levelName', header: '等级', width: 12 },
  { key: 'status', header: '状态', width: 10, enumMap: MEMBER_STATUS_LABELS },
  { key: 'growthValue', header: '成长值', width: 10, type: 'number' },
  { key: 'pointBalance', header: '积分', width: 10, type: 'number' },
  { key: 'walletBalance', header: '余额(元)', width: 12, type: 'money' },
  { key: 'registerSource', header: '注册来源', width: 10 },
  { key: 'lastLoginAt', header: '最后登录', width: 20, type: 'datetime' },
  { key: 'createdAt', header: '注册时间', width: 20, type: 'datetime' },
];

export const membersExportDefinition = defineExport<MembersExportQuery & Record<string, unknown>, Record<string, unknown>>({
  entity: 'member.members',
  moduleName: '会员管理',
  filenamePrefix: '会员列表',
  sourcePath: '/member/members',
  sheetName: '会员列表',
  permissions: { export: 'member:member:list' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
  columns,
  countRows: async (query) => db.$count(members, buildMemberWhere(query)),
  streamRows: async (query) => {
    const rows = await db.query.members.findMany({
      where: buildMemberWhere(query),
      with: {
        level: { columns: { name: true } },
        pointAccount: { columns: { balance: true } },
        wallet: { columns: { balance: true } },
      },
      orderBy: desc(members.id),
    });
    return rows.map((r) => ({
      id: r.id,
      username: r.username ?? '',
      phone: r.phone ?? '',
      email: r.email ?? '',
      nickname: r.nickname,
      levelName: r.level?.name ?? '',
      status: r.status,
      growthValue: r.growthValue,
      pointBalance: r.pointAccount?.balance ?? 0,
      walletBalance: r.wallet?.balance ?? 0,
      registerSource: r.registerSource,
      lastLoginAt: r.lastLoginAt,
      createdAt: r.createdAt,
    }));
  },
});
