import type { LicenseEdition, LicenseFeatureKey } from './constants';

// ─── License 文档（签名对象）──────────────────────────────────────────────────

/**
 * 被签名的载荷。验签流程：先对 payload 原始字节验签，通过后再 Zod 解析——
 * 绝不重新序列化后验签（JSON 键序不稳定会导致签名失配）。
 */
export interface LicensePayload {
  licenseId: string;
  /** 固定 'zenith-admin'，防止其他产品签发的文件被误用 */
  audience: string;
  /** 绑定的部署实例 ID（system_installations.installationId） */
  installationId: string;
  customerId: string;
  customerName: string;
  edition: LicenseEdition;
  features: LicenseFeatureKey[];
  limits: {
    maxUsers: number | null;
    maxTenants: number | null;
    /** 展示型元数据，无运行时强制 */
    maxNodes: number | null;
  };
  issuedAt: string;
  notBefore: string;
  expiresAt: string;
  /** 过期后的宽限截止；此前功能保持可用但持续告警 */
  graceUntil: string;
  /** 展示型元数据：可升级新版本的截止日，无运行时强制 */
  maintenanceUntil: string | null;
}

/** .zenlic 文件结构 */
export interface LicenseEnvelope {
  version: number;
  algorithm: string;
  /** 发行方公钥版本，支持轮换 */
  keyId: string;
  /** base64url 编码的 payload 原始字节 */
  payload: string;
  /** base64url 编码的 Ed25519 签名 */
  signature: string;
}

// ─── 套餐配额 ─────────────────────────────────────────────────────────────────

export interface TenantPackageQuotas {
  /** 套餐级席位上限；与 License.maxUsers、tenant.maxUsers 取最小值生效 */
  maxUsers?: number | null;
}
