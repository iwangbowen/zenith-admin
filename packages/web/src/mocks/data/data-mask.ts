import { SEED_DATA_MASK_CONFIGS } from '@zenith/shared';
import type { DataMaskConfig, MaskType } from '@zenith/shared';
import { mockDateTime } from '@/mocks/utils/date';

export const mockDataMaskConfigs: DataMaskConfig[] = [...SEED_DATA_MASK_CONFIGS];

let nextId = SEED_DATA_MASK_CONFIGS.length + 1;
export function getNextDataMaskId() { return nextId++; }

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
