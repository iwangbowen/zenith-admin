import { dataMaskContract, type DataMaskField, type DataMaskPolicy } from '@zenith/shared/platform';
import { previewMask, valuesAtPath, type MaskType } from '@zenith/shared/core';
import { mock } from '@/mocks/utils/contract';
import { badRequest, nextIdFrom, notFound } from '@/mocks/utils/handlers';
import { mockDateTime } from '@/mocks/utils/date';
import { mockDataMaskPolicies, mockSensitiveFieldEntries, type MockSensitiveFieldEntry } from '@/mocks/data/data-mask';
import { mockUsers } from '@/mocks/data/users';
import { mockMembers } from '@/mocks/data/members';
import { mockTenants } from '@/mocks/data/tenants';

/**
 * 数据脱敏 Demo：注册表来自契约推导，策略覆盖记录可增删改。
 * Demo 登录身份是平台超管，因此 `effective` 不打码、可按需查看明文；按需查看明文从对应 mock 数据取值。
 */

function findPolicy(entity: string, field: string): DataMaskPolicy | undefined {
  return mockDataMaskPolicies.find((p) => p.entity === entity && p.field === field);
}

function toField(entry: MockSensitiveFieldEntry): DataMaskField {
  const policy = findPolicy(entry.entity, entry.field);
  const maskType: MaskType = policy?.maskType ?? entry.kind;
  const customRule = maskType === 'custom' ? (policy?.customRule ?? null) : null;
  return {
    key: entry.key,
    entity: entry.entity,
    field: entry.field,
    label: entry.label,
    kind: entry.kind,
    maskType,
    customRule,
    exemptPermissions: policy?.exemptPermissions ?? [],
    enabled: policy?.enabled ?? true,
    remark: policy?.remark ?? null,
    overridden: policy !== undefined,
    policyId: policy?.id ?? null,
    preview: previewMask(maskType, customRule),
    updatedAt: policy?.updatedAt ?? null,
  };
}

const REVEAL_SOURCES: Record<string, (id: number) => Record<string, unknown> | undefined> = {
  User: (id) => mockUsers.find((u) => u.id === id) as Record<string, unknown> | undefined,
  Member: (id) => mockMembers.find((m) => m.id === id) as Record<string, unknown> | undefined,
  Tenant: (id) => mockTenants.find((t) => t.id === id) as Record<string, unknown> | undefined,
};

export const dataMaskHandlers = [
  mock(dataMaskContract.fields, ({ query, ok }) => {
    const keyword = query.keyword?.trim().toLowerCase();
    const list = mockSensitiveFieldEntries.map(toField).filter((item) => {
      if (keyword && ![item.entity, item.field, item.label, item.key].some((v) => v.toLowerCase().includes(keyword))) return false;
      if (query.entity && item.entity !== query.entity) return false;
      if (query.maskType && item.maskType !== query.maskType) return false;
      if (query.enabled !== undefined && item.enabled !== query.enabled) return false;
      if (query.overridden !== undefined && item.overridden !== query.overridden) return false;
      return true;
    });
    return ok(list);
  }),

  mock(dataMaskContract.effective, ({ ok }) => ok({ masked: [], canReveal: true })),

  mock(dataMaskContract.savePolicy, ({ params, body, ok }) => {
    const entry = mockSensitiveFieldEntries.find((e) => e.entity === params.entity && e.field === params.field);
    if (!entry) return notFound(`契约中不存在敏感字段 ${params.entity}.${params.field}`, { status: 404 });
    const maskType = body.maskType ?? entry.kind;
    const values = {
      maskType,
      customRule: maskType === 'custom' ? (body.customRule ?? null) : null,
      exemptPermissions: Array.from(new Set(body.exemptPermissions)),
      enabled: body.enabled,
      remark: body.remark?.trim() || null,
      updatedAt: mockDateTime(),
    };
    const existing = findPolicy(params.entity, params.field);
    if (existing) {
      Object.assign(existing, values);
    } else {
      mockDataMaskPolicies.push({ id: nextIdFrom(mockDataMaskPolicies), entity: params.entity, field: params.field, ...values, createdAt: values.updatedAt });
    }
    return ok(toField(entry), '策略已保存');
  }),

  mock(dataMaskContract.resetPolicy, ({ params, ok }) => {
    const entry = mockSensitiveFieldEntries.find((e) => e.entity === params.entity && e.field === params.field);
    if (!entry) return notFound(`契约中不存在敏感字段 ${params.entity}.${params.field}`, { status: 404 });
    const idx = mockDataMaskPolicies.findIndex((p) => p.entity === params.entity && p.field === params.field);
    if (idx >= 0) mockDataMaskPolicies.splice(idx, 1);
    return ok(toField(entry), '已恢复契约默认策略');
  }),

  mock(dataMaskContract.reveal, ({ body, ok }) => {
    if (!mockSensitiveFieldEntries.some((e) => e.entity === body.entity && e.field === body.field)) {
      return notFound(`契约中不存在敏感字段 ${body.entity}.${body.field}`, { status: 404 });
    }
    const source = REVEAL_SOURCES[body.entity];
    if (!source) return badRequest(`实体 ${body.entity} 不支持按需查看明文`, { status: 400 });
    const record = source(body.id);
    if (!record) return notFound('记录不存在或无权查看', { status: 404 });
    const [value] = valuesAtPath(record, body.field.split('.'));
    return ok({ value: typeof value === 'string' ? value : null });
  }),
];