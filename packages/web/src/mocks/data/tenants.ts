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
    expireAt: '2027-12-31 23:59:59',
    maxUsers: 50,
    remark: '演示用租户A',
    createdAt: '2025-01-01 00:00:00',
    updatedAt: '2025-01-01 00:00:00',
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
    createdAt: '2025-01-15 00:00:00',
    updatedAt: '2025-01-15 00:00:00',
  },
];
