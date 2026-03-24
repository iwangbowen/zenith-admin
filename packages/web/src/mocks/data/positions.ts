import type { Position } from '@zenith/shared';

export const mockPositions: Position[] = [
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
  {
    id: 2,
    name: '开发工程师',
    code: 'developer',
    sort: 2,
    status: 'active',
    remark: '默认技术岗位',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
];

let nextPositionId = 3;
export function getNextPositionId() {
  return nextPositionId++;
}
