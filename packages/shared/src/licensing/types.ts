import type * as z from 'zod';
import type { licenseEnvelopeSchema, licensePayloadSchema, tenantPackageQuotasSchema } from './validation';

// ─── License 文档（签名对象）──────────────────────────────────────────────────

/**
 * 被签名的载荷。验签流程：先对 payload 原始字节验签，通过后再 Zod 解析——
 * 绝不重新序列化后验签（JSON 键序不稳定会导致签名失配）。
 */
export type LicensePayload = z.infer<typeof licensePayloadSchema>;

/** .zenlic 文件结构 */
export type LicenseEnvelope = z.infer<typeof licenseEnvelopeSchema>;

// ─── 套餐配额 ─────────────────────────────────────────────────────────────────

/** 套餐级配额；`maxUsers` 与 License.maxUsers、tenant.maxUsers 取最小值生效 */
export type TenantPackageQuotas = z.infer<typeof tenantPackageQuotasSchema>;
