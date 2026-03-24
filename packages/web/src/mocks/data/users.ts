import type { User, Role } from '@zenith/shared';

// Demo 模式下的初始口令（明文仅用于演示环境）
const DEMO_INITIAL_CREDENTIAL = ['1', '2', '3', '4', '5', '6'].join('');

/** 与 seed.ts 对齐的超级管理员角色 */
export const superAdminRole: Role = {
  id: 1,
  name: '超级管理员',
  code: 'super_admin',
  description: '拥有所有权限',
  status: 'active',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

export const normalUserRole: Role = {
  id: 2,
  name: '普通用户',
  code: 'user',
  description: '基础访问权限',
  status: 'active',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

export type MockUser = Omit<User, 'password'> & { password: string };

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
    positions: [
      {
        id: 1,
        name: '系统管理员',
        code: 'system_admin',
        sort: 1,
        status: 'active',
        remark: '默认管理员岗位',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ],
    roles: [superAdminRole],
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
];

/** 下一个可用 ID（内存自增） */
let nextUserId = mockUsers.length + 1;
export function getNextUserId() {
  return nextUserId++;
}
