import * as z from 'zod';
import { idParam, idQuery, paginated, paginationQuery, queryBool } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { createIotWhitelistSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 一型一密预注册白名单条目（SN 命中即可换取设备密钥，一次性凭证语义） */
export const iotWhitelistEntrySchema = z.object({
  id: z.int(),
  productId: z.int(),
  productName: z.string().nullable(),
  sn: z.string(),
  used: z.boolean().meta({ description: '已核销：注册成功后置位' }),
  usedAt: z.string().nullable(),
  deviceId: z.int().nullable().meta({ description: '注册产生的设备 id（追溯）' }),
  deviceName: z.string().nullable(),
  remark: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'IotWhitelistEntry' });

export type IotWhitelistEntry = z.infer<typeof iotWhitelistEntrySchema>;

export const iotWhitelistStatsSchema = z.object({
  total: z.int(),
  used: z.int(),
}).meta({ id: 'IotWhitelistStats' });

export type IotWhitelistStats = z.infer<typeof iotWhitelistStatsSchema>;

export const iotWhitelistImportResultSchema = z.object({
  total: z.int(),
  inserted: z.int(),
  skipped: z.int().meta({ description: '重复 SN 跳过数' }),
}).meta({ id: 'IotWhitelistImportResult' });

export type IotWhitelistImportResult = z.infer<typeof iotWhitelistImportResultSchema>;

export const iotRegistrationSecretSchema = z.object({
  registrationSecret: z.string().meta({ description: '产品注册密钥明文（仅本次返回）' }),
}).meta({ id: 'IotRegistrationSecret' });

export type IotRegistrationSecret = z.infer<typeof iotRegistrationSecretSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const iotWhitelistStatsQuery = z.object({
  productId: idQuery(),
});

export const iotWhitelistListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按 SN 模糊匹配' }),
  productId: idQuery(),
  used: queryBool('是否已核销'),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const iotWhitelistContract = defineContract('/api/iot/whitelist', {
  stats: op.get('/stats', { query: iotWhitelistStatsQuery, response: iotWhitelistStatsSchema, summary: '白名单统计（总数/已核销）' }),
  list: op.get('/', { query: iotWhitelistListQuery, response: paginated(iotWhitelistEntrySchema), summary: '注册白名单列表' }),
  import: op.post('/', { body: createIotWhitelistSchema, response: iotWhitelistImportResultSchema, summary: '批量导入白名单 SN（重复跳过）' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除白名单条目（已核销的不可删除）' }),
  resetRegistrationSecret: op.post('/products/{id}/registration-secret', {
    params: idParam,
    response: iotRegistrationSecretSchema,
    summary: '开启/重置产品注册密钥（明文仅本次返回）',
  }),
  disableRegistration: op.delete('/products/{id}/registration-secret', { params: idParam, summary: '关闭产品动态注册（已注册设备不受影响）' }),
}, { tags: ['IoT 动态注册'] });
