import * as z from 'zod';
import { paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { LICENSE_EDITIONS, LICENSE_EVENT_TYPES, LICENSE_FEATURES, LICENSE_STATUSES } from '../constants';
import { activateLicenseSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const licenseLimitsSchema = z.object({
  maxUsers: z.int().nullable(),
  maxTenants: z.int().nullable(),
  maxNodes: z.int().nullable().meta({ description: '展示型元数据，无运行时强制' }),
}).meta({ id: 'LicenseLimits' });

export type LicenseLimits = z.infer<typeof licenseLimitsSchema>;

/** License 状态页概览（已验签数据的投影 + 运行时状态） */
export const licenseInfoSchema = z.object({
  id: z.int(),
  licenseId: z.string(),
  status: z.enum(LICENSE_STATUSES),
  edition: z.enum(LICENSE_EDITIONS),
  editionLabel: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  features: z.array(z.enum(LICENSE_FEATURES)),
  limits: licenseLimitsSchema,
  issuedAt: z.string(),
  notBefore: z.string(),
  expiresAt: z.string(),
  graceUntil: z.string().meta({ description: '过期后的宽限截止；此前功能保持可用但持续告警' }),
  maintenanceUntil: z.string().nullable().meta({ description: '可升级新版本的截止日，无运行时强制' }),
  keyId: z.string(),
  activatedAt: z.string(),
  lastVerifiedAt: z.string().nullable(),
  invalidReason: z.string().nullable(),
  replacedById: z.int().nullable(),
}).meta({ id: 'LicenseInfo' });

export type LicenseInfo = z.infer<typeof licenseInfoSchema>;

/** 安装身份与运行摘要 */
export const licenseInstallationInfoSchema = z.object({
  installationId: z.string(),
  licenseEpoch: z.int(),
  createdAt: z.string(),
  mode: z.string().meta({ description: '当前 LICENSE_MODE' }),
  activeNodes: z.int().meta({ description: '近期活跃后端节点数（心跳统计，展示用）' }),
}).meta({ id: 'LicenseInstallationInfo' });

export type LicenseInstallationInfo = z.infer<typeof licenseInstallationInfoSchema>;

/** 有效授权快照（当前部署最终生效的功能与限额） */
export const licenseEffectiveStateSchema = z.object({
  mode: z.string(),
  status: z.enum([...LICENSE_STATUSES, 'unlicensed']),
  features: z.array(z.enum(LICENSE_FEATURES)),
  limits: licenseLimitsSchema.nullable(),
  expiresAt: z.string().nullable(),
  graceUntil: z.string().nullable(),
  restricted: z.boolean().meta({ description: '当前是否处于受限模式（required 下 License 失效）' }),
}).meta({ id: 'LicenseEffectiveState' });

export type LicenseEffectiveState = z.infer<typeof licenseEffectiveStateSchema>;

export const licensingStatusSchema = z.object({
  installation: licenseInstallationInfoSchema,
  license: licenseInfoSchema.nullable(),
  effective: licenseEffectiveStateSchema,
  usingTestKey: z.boolean().meta({ description: '是否使用内置测试签发公钥' }),
}).meta({ id: 'LicensingStatus' });

export type LicensingStatus = z.infer<typeof licensingStatusSchema>;

export const licenseEventItemSchema = z.object({
  id: z.int(),
  licenseId: z.int().nullable(),
  type: z.enum(LICENSE_EVENT_TYPES),
  typeLabel: z.string(),
  detail: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'LicenseEvent' });

export type LicenseEventItem = z.infer<typeof licenseEventItemSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const licensingContract = defineContract('/api/licensing', {
  status: op.get('/status', { response: licensingStatusSchema, summary: 'License 状态总览' }),
  activate: op.post('/activate', { body: activateLicenseSchema, response: licenseInfoSchema, summary: '激活 / 替换 License' }),
  deactivate: op.post('/deactivate', { summary: '停用当前 License' }),
  events: op.get('/events', { query: paginationQuery, response: paginated(licenseEventItemSchema), summary: 'License 事件日志' }),
}, { tags: ['Licensing'] });
