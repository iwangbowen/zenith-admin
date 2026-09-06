import { SEED_DATA_MASK_POLICIES } from '@zenith/shared/seed';
import type { DataMaskPolicy } from '@zenith/shared/platform';
import { contractOperations, collectSensitiveFields, sensitiveKeyOf, type AnyContract, type SensitiveFieldRef } from '@zenith/shared/core';
import * as identity from '@zenith/shared/identity';
import * as member from '@zenith/shared/member';
import * as messaging from '@zenith/shared/messaging';
import * as payment from '@zenith/shared/payment';
import * as platform from '@zenith/shared/platform';

/** 策略覆盖记录（可变，供 handler 增删改） */
export const mockDataMaskPolicies: DataMaskPolicy[] = [...SEED_DATA_MASK_POLICIES];

export interface MockSensitiveFieldEntry {
  readonly key: string;
  readonly entity: string;
  readonly field: string;
  readonly kind: SensitiveFieldRef['kind'];
  readonly label: string;
}

function isContract(value: unknown): value is AnyContract {
  return typeof value === 'object' && value !== null && typeof (value as { basePath?: unknown }).basePath === 'string';
}

/**
 * Demo 模式下的敏感字段注册表：与服务端一样从契约响应 schema 静态推导（`unmasked` 自视图不计入），
 * 覆盖含敏感字段声明的各业务域契约。
 */
export const mockSensitiveFieldEntries: MockSensitiveFieldEntry[] = (() => {
  const merged = new Map<string, MockSensitiveFieldEntry>();
  for (const domain of [identity, member, messaging, payment, platform]) {
    for (const contract of Object.values(domain as Record<string, unknown>).filter(isContract)) {
      for (const op of contractOperations(contract)) {
        if (op.kind !== 'json' || op.unmasked) continue;
        for (const ref of collectSensitiveFields(op.response)) {
          const key = sensitiveKeyOf(ref);
          if (!merged.has(key)) merged.set(key, { key, entity: ref.entity, field: ref.field, kind: ref.kind, label: ref.label });
        }
      }
    }
  }
  return [...merged.values()].sort((a, b) => a.entity.localeCompare(b.entity) || a.field.localeCompare(b.field));
})();