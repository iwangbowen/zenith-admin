import type { Tenant } from '@zenith/shared';

let nextTenantId = 3;
export function getNextTenantId() { return nextTenantId++; }

export const mockTenants: Tenant[] = [
  {
    id: 1,
    name: '示例租户A',
    code: 'tenant_a',
    logo: null,
    contactName: '张三',
    contactPhone: '13800001111',
    status: 'active',
    expireAt: '2027-12-31T23:59:59.000Z',
    maxUsers: 50,
    remark: '演示用租户A',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 2,
    name: '示例租户B',
    code: 'tenant_b',
    logo: null,
    contactName: '李四',
    contactPhone: '13800002222',
    status: 'active',
    expireAt: null,
    maxUsers: null,
    remark: '演示用租户B',
    createdAt: '2025-01-15T00:00:00.000Z',
    updatedAt: '2025-01-15T00:00:00.000Z',
  },
];
