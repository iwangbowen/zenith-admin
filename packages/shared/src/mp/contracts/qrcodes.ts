import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { MP_QRCODE_TYPES } from '../constants';
import { createMpQrcodeSchema } from '../validation';
import { mpAccountIdQuery } from './common';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const mpQrcodeSchema = z.object({
  id: z.int(),
  accountId: z.int(),
  type: z.enum(MP_QRCODE_TYPES),
  sceneStr: z.string(),
  name: z.string(),
  ticket: z.string().nullable(),
  url: z.string().nullable().meta({ description: '二维码图片地址' }),
  expireSeconds: z.int().nullable().meta({ description: '临时二维码有效期（秒）' }),
  scanCount: z.int(),
  rewardPoints: z.int().meta({ description: '扫码关注奖励积分，0 为不奖励' }),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'MpQrcode' });

export type MpQrcode = z.infer<typeof mpQrcodeSchema>;

// ─── 查询参数 ────────────────────────────────────────────────────────────────

export const mpQrcodeListQuery = paginationQuery.extend({
  ...mpAccountIdQuery.shape,
  type: z.enum(MP_QRCODE_TYPES).optional(),
  keyword: z.string().optional().meta({ description: '按名称 / 场景值模糊匹配' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const mpQrcodeContract = defineContract('/api/mp/qrcodes', {
  list: op.get('/', { query: mpQrcodeListQuery, response: paginated(mpQrcodeSchema), summary: '二维码列表' }),
  create: op.post('/', { body: createMpQrcodeSchema, response: mpQrcodeSchema, summary: '创建带参二维码' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除二维码' }),
}, { tags: ['公众号二维码'] });
