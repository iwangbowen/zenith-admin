import { describe, expect, it } from 'vitest';
import { createLicensePayload } from './issuance';
import { licenseIssuanceSchema, licensePayloadSchema, type LicenseIssuanceInput } from './validation';

const input: LicenseIssuanceInput = {
  installationId: '2b4a94c4-98b6-4b81-a611-6e4a4bbd4a2f',
  customerName: '测试客户',
  edition: 'pro',
  features: ['growth', 'iot'],
};
const context = {
  now: new Date('2028-02-29T00:00:00.000Z'),
  licenseId: 'lic_test',
  customerId: 'cus_test',
};

describe('License 签发载荷工厂', () => {
  it('显式 features 不按版本扩权，默认日期和配额组成可验证载荷', () => {
    const payload = createLicensePayload(input, context);
    expect(payload.features).toEqual(['growth', 'iot']);
    expect(payload.edition).toBe('pro');
    expect(payload.limits).toEqual({ maxUsers: null, maxTenants: null, maxNodes: null });
    expect(payload.issuedAt).toBe('2028-02-29T00:00:00.000Z');
    expect(payload.notBefore).toBe(payload.issuedAt);
    expect(payload.expiresAt).toBe('2029-02-28T00:00:00.000Z');
    expect(payload.graceUntil).toBe('2029-03-30T00:00:00.000Z');
    expect(payload.maintenanceUntil).toBeNull();
    expect(payload.licenseId).toBe(context.licenseId);
    expect(payload.customerId).toBe(context.customerId);
    expect(licensePayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('有效期从指定生效时刻开始，保留时区、零宽限与指定维护时间', () => {
    const payload = createLicensePayload({
      ...input,
      validDays: 1,
      graceDays: 0,
      notBefore: '2028-03-01T08:00:00+08:00',
      maintenanceUntil: '2028-04-01T00:00:00Z',
      limits: { maxUsers: 1, maxNodes: 3 },
    }, context);
    expect(payload.notBefore).toBe('2028-03-01T08:00:00+08:00');
    expect(payload.expiresAt).toBe('2028-03-02T00:00:00.000Z');
    expect(payload.graceUntil).toBe(payload.expiresAt);
    expect(payload.maintenanceUntil).toBe('2028-04-01T00:00:00Z');
    expect(payload.limits).toEqual({ maxUsers: 1, maxTenants: null, maxNodes: 3 });
  });

  it('可覆盖调用端 ID，去除输入边界空格且不修改传入对象', () => {
    const original = { ...input, customerName: ' 测试客户 ', licenseId: ' lic_custom ', customerId: ' cus_custom ' };
    const payload = createLicensePayload(original, context);
    expect(payload.customerName).toBe('测试客户');
    expect(payload.licenseId).toBe('lic_custom');
    expect(payload.customerId).toBe('cus_custom');
    expect(original.customerName).toBe(' 测试客户 ');
    expect(context.now.toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });

  it('允许空增值功能列表与各 36500 天的最大周期', () => {
    const payload = createLicensePayload({ ...input, features: [], validDays: 36500, graceDays: 36500 }, context);
    expect(payload.features).toEqual([]);
    expect(Date.parse(payload.expiresAt) - Date.parse(payload.notBefore)).toBe(36500 * 86_400_000);
    expect(Date.parse(payload.graceUntil) - Date.parse(payload.expiresAt)).toBe(36500 * 86_400_000);
  });

  it('拒绝无效调用端时间或缺失的调用端 ID', () => {
    expect(() => createLicensePayload(input, { ...context, now: new Date(NaN) })).toThrow('签发时间无效');
    expect(() => createLicensePayload(input, { ...context, licenseId: '' })).toThrow();
  });
});

describe('签发参数校验', () => {
  it.each([
    { installationId: 'not-a-uuid' },
    { customerName: '   ' },
    { licenseId: '' },
    { customerId: '' },
    { validDays: 0 },
    { validDays: 36501 },
    { validDays: 1.5 },
    { graceDays: -1 },
    { graceDays: 36501 },
    { graceDays: 0.5 },
    { features: ['growth', 'growth'] },
    { features: ['not-a-feature'] },
    { limits: { maxUsers: 0 } },
    { limits: { maxTenants: -1 } },
    { limits: { maxNodes: 1.5 } },
    { notBefore: '2028-03-01 08:00:00' },
    { maintenanceUntil: '2028-02-30T00:00:00Z' },
    { privateKey: 'secret' },
    { keyId: 'key1' },
  ])('无效输入不能进入签名载荷：%j', (invalid) => {
    expect(licenseIssuanceSchema.safeParse({ ...input, ...invalid }).success).toBe(false);
  });

  it('验签载荷也拒绝重复授权与日期倒序', () => {
    const payload = createLicensePayload(input, context);
    expect(licensePayloadSchema.safeParse({ ...payload, features: ['growth', 'growth'] }).success).toBe(false);
    expect(licensePayloadSchema.safeParse({ ...payload, expiresAt: '2028-01-01T00:00:00Z' }).success).toBe(false);
    expect(licensePayloadSchema.safeParse({ ...payload, graceUntil: payload.notBefore }).success).toBe(false);
  });
});
