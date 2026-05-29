import type { DataMaskConfig, MaskType } from '@zenith/shared';
import { mockDateTime } from '@/mocks/utils/date';

let nextId = 3;
export function getNextDataMaskId() { return nextId++; }

export const mockDataMaskConfigs: DataMaskConfig[] = [
  {
    id: 1,
    entity: 'user',
    field: 'phone',
    label: '手机号',
    maskType: 'phone' as MaskType,
    customRule: null,
    exemptRoleCodes: ['super_admin'],
    enabled: true,
    remark: '手机号脱敏，超管豁免',
    createdAt: '2024-01-01 00:00:00',
    updatedAt: '2024-01-01 00:00:00',
  },
  {
    id: 2,
    entity: 'user',
    field: 'email',
    label: '邮箱',
    maskType: 'email' as MaskType,
    customRule: null,
    exemptRoleCodes: ['super_admin'],
    enabled: true,
    remark: '邮箱脱敏，超管豁免',
    createdAt: '2024-01-01 00:00:00',
    updatedAt: '2024-01-01 00:00:00',
  },
];

export function createMockDataMaskConfig(body: Partial<DataMaskConfig>): DataMaskConfig {
  const now = mockDateTime();
  return {
    id: getNextDataMaskId(),
    entity: body.entity ?? '',
    field: body.field ?? '',
    label: body.label ?? '',
    maskType: (body.maskType ?? 'phone') as MaskType,
    customRule: body.customRule ?? null,
    exemptRoleCodes: body.exemptRoleCodes ?? [],
    enabled: body.enabled ?? true,
    remark: body.remark ?? null,
    createdAt: now,
    updatedAt: now,
  };
}
