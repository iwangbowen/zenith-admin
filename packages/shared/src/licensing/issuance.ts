import { LICENSE_AUDIENCE } from './constants';
import type { LicensePayload } from './types';
import { licenseIssuanceSchema, licensePayloadSchema, type LicenseIssuanceInput } from './validation';

export interface LicenseIssuanceContext {
  now: Date;
  licenseId: string;
  customerId: string;
}

/** 构造待签名载荷；当前时间与随机 ID 由调用端提供，不读取环境或产生 I/O。 */
export function createLicensePayload(input: LicenseIssuanceInput, context: LicenseIssuanceContext): LicensePayload {
  const params = licenseIssuanceSchema.parse(input);
  if (!Number.isFinite(context.now.getTime())) throw new Error('签发时间无效');
  const issuedAt = context.now.toISOString();
  const notBefore = params.notBefore ?? issuedAt;
  const expiresAt = new Date(Date.parse(notBefore) + params.validDays * 86_400_000).toISOString();
  const graceUntil = new Date(Date.parse(expiresAt) + params.graceDays * 86_400_000).toISOString();
  return licensePayloadSchema.parse({
    licenseId: params.licenseId ?? context.licenseId,
    audience: LICENSE_AUDIENCE,
    installationId: params.installationId,
    customerId: params.customerId ?? context.customerId,
    customerName: params.customerName,
    edition: params.edition,
    features: params.features,
    limits: params.limits,
    issuedAt,
    notBefore,
    expiresAt,
    graceUntil,
    maintenanceUntil: params.maintenanceUntil,
  });
}
