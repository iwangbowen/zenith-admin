import type { User, Role } from '@zenith/shared/identity';
import { SEED_ROLES, SEED_POSITIONS } from '@zenith/shared/seed';
import { nextIdFrom } from '@/mocks/utils/handlers';

// Demo 模式下的初始口令（明文仅用于演示环境）
const DEMO_INITIAL_CREDENTIAL = ['1', '2', '3', '4', '5', '6'].join('');

/** 与 seed.ts 对齐的超级管理员角色 */
export const superAdminRole = SEED_ROLES.find((r) => r.code === 'super_admin') as Role;
export const normalUserRole = SEED_ROLES.find((r) => r.code === 'user') as Role;

/** 契约实体不含口令；Demo 登录校验需要明文口令，仅在内存数据中携带 */
export type MockUser = User & { password: string; tenantId?: number | null };

export const mockUsers: MockUser[] = [
  {
    id: 1,
    username: 'admin',
    nickname: '管理员',
    email: 'admin@zenith.dev',
    password: DEMO_INITIAL_CREDENTIAL,
    avatar: undefined,
    departmentId: 1,
    departmentName: '总部',
    positionIds: [1],
    positions: [SEED_POSITIONS.find((p) => p.code === 'system_admin')!],
    gender: null,
    roles: [superAdminRole],
    passwordUpdatedAt: '2024-01-01 00:00:00',
    status: 'enabled',
    createdAt: '2024-01-01 00:00:00',
    updatedAt: '2024-01-01 00:00:00',
  },
  // 与工作流 mock 数据（李四/王五/赵六）对齐的演示用户，供转办/自选审批人选人
  ...[
    { id: 2, username: 'lisi', nickname: '李四' },
    { id: 3, username: 'wangwu', nickname: '王五' },
    { id: 4, username: 'zhaoliu', nickname: '赵六' },
  ].map(({ id, username, nickname }): MockUser => ({
    id,
    username,
    nickname,
    email: `${username}@zenith.dev`,
    password: DEMO_INITIAL_CREDENTIAL,
    avatar: undefined,
    departmentId: 1,
    departmentName: '总部',
    positionIds: [],
    positions: [],
    gender: null,
    roles: [normalUserRole],
    passwordUpdatedAt: '2024-01-01 00:00:00',
    status: 'enabled',
    createdAt: '2024-01-01 00:00:00',
    updatedAt: '2024-01-01 00:00:00',
  })),
];

/** 下一个可用 ID（内存自增） */
let nextUserId = nextIdFrom(mockUsers);
export function getNextUserId() {
  return nextUserId++;
}
