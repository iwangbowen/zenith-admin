import type { Department } from '@zenith/shared';

export const mockDepartments: Department[] = [
  {
    id: 1,
    parentId: 0,
    name: '总部',
    code: 'headquarters',
    leader: '管理员',
    phone: '13800000000',
    email: 'admin@zenith.dev',
    sort: 1,
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 2,
    parentId: 1,
    name: '技术部',
    code: 'technology',
    leader: '管理员',
    phone: '13800000001',
    email: 'tech@zenith.dev',
    sort: 1,
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 3,
    parentId: 1,
    name: '产品部',
    code: 'product',
    leader: '管理员',
    phone: '13800000002',
    email: 'product@zenith.dev',
    sort: 2,
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
];

let nextDeptId = 4;
export function getNextDeptId() {
  return nextDeptId++;
}
