import * as z from 'zod';
import {
  LICENSE_AUDIENCE,
  LICENSE_EDITIONS,
  LICENSE_FEATURES,
} from './constants';
import { dateTimeStringSchema } from '../core/validation';

// ─── 签名载荷与信封 ───────────────────────────────────────────────────────────

/** ISO 8601 时间戳（License 文档跨系统交换，用 ISO 而非本地格式） */
const isoDateTime = z.iso.datetime({ offset: true });

export const licensePayloadSchema = z.strictObject({
  licenseId: z.string().min(1).max(64),
  audience: z.literal(LICENSE_AUDIENCE),
  installationId: z.uuid(),
  customerId: z.string().min(1).max(64),
  customerName: z.string().min(1).max(128),
  edition: z.enum(LICENSE_EDITIONS),
  features: z.array(z.enum(LICENSE_FEATURES)).max(LICENSE_FEATURES.length)
    .refine((features) => new Set(features).size === features.length, '授权功能不能重复'),
  limits: z.object({
    maxUsers: z.number().int().positive().nullable(),
    maxTenants: z.number().int().positive().nullable(),
    maxNodes: z.number().int().positive().nullable(),
  }),
  issuedAt: isoDateTime,
  notBefore: isoDateTime,
  expiresAt: isoDateTime,
  graceUntil: isoDateTime,
  maintenanceUntil: isoDateTime.nullable(),
}).superRefine((payload, ctx) => {
  if (Date.parse(payload.notBefore) > Date.parse(payload.expiresAt)) {
    ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: '到期时间不能早于生效时间' });
  }
  if (Date.parse(payload.expiresAt) > Date.parse(payload.graceUntil)) {
    ctx.addIssue({ code: 'custom', path: ['graceUntil'], message: '宽限截止时间不能早于到期时间' });
  }
});

/** 浏览器与 CLI 共用的签发参数；密钥始终留在各自签名边界。 */
export const licenseIssuanceSchema = z.strictObject({
  installationId: licensePayloadSchema.shape.installationId.trim(),
  customerName: licensePayloadSchema.shape.customerName.trim().min(1, '客户名称不能为空'),
  edition: licensePayloadSchema.shape.edition,
  features: licensePayloadSchema.shape.features,
  licenseId: licensePayloadSchema.shape.licenseId.trim().optional(),
  customerId: licensePayloadSchema.shape.customerId.trim().optional(),
  limits: z.strictObject({
    maxUsers: licensePayloadSchema.shape.limits.shape.maxUsers.default(null),
    maxTenants: licensePayloadSchema.shape.limits.shape.maxTenants.default(null),
    maxNodes: licensePayloadSchema.shape.limits.shape.maxNodes.default(null),
  }).default({ maxUsers: null, maxTenants: null, maxNodes: null }),
  validDays: z.number().int().min(1, '有效天数至少为 1').max(36500, '有效天数不能超过 36500').default(365),
  graceDays: z.number().int().min(0, '宽限天数不能为负数').max(36500, '宽限天数不能超过 36500').default(30),
  notBefore: licensePayloadSchema.shape.notBefore.optional(),
  maintenanceUntil: licensePayloadSchema.shape.maintenanceUntil.default(null),
});

export const licenseEnvelopeSchema = z.strictObject({
  // version/algorithm 不用 literal：具体值在验签流程中显式检查，给出可读错误而非「结构无效」
  version: z.number().int().positive(),
  algorithm: z.string().min(1).max(32),
  keyId: z.string().min(1).max(64),
  payload: z.string().min(1),
  signature: z.string().min(1),
});

/** 激活请求：粘贴 .zenlic 文件内容（JSON 字符串） */
export const activateLicenseSchema = z.object({
  envelope: z.string().min(1, 'License 文件内容不能为空').max(64 * 1024),
});

// ─── 套餐功能与配额 ───────────────────────────────────────────────────────────

export const tenantPackageQuotasSchema = z.strictObject({
  maxUsers: z.number().int().positive().optional().nullable(),
});

export const assignTenantPackageFeaturesSchema = z.object({
  features: z.array(z.enum(LICENSE_FEATURES)),
});

// ─── 事件查询 ─────────────────────────────────────────────────────────────────

export const listLicenseEventsQuerySchema = z.object({
  startTime: dateTimeStringSchema.optional(),
  endTime: dateTimeStringSchema.optional(),
});

export type LicensePayloadInput = z.infer<typeof licensePayloadSchema>;
export type LicenseIssuanceInput = z.input<typeof licenseIssuanceSchema>;
export type LicenseEnvelopeInput = z.infer<typeof licenseEnvelopeSchema>;
export type ActivateLicenseInput = z.infer<typeof activateLicenseSchema>;
export type TenantPackageQuotasInput = z.infer<typeof tenantPackageQuotasSchema>;
export type AssignTenantPackageFeaturesInput = z.infer<typeof assignTenantPackageFeaturesSchema>;
