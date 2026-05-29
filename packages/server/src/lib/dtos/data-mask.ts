/**
 * 数据脱敏配置 DTO
 */
import { z } from '@hono/zod-openapi';

export const DataMaskConfigDTO = z
  .object({
    id:              z.number().int().openapi({ example: 1 }),
    entity:          z.string().openapi({ example: 'user' }),
    field:           z.string().openapi({ example: 'phone' }),
    label:           z.string().openapi({ example: '手机号' }),
    maskType:        z.enum(['phone', 'email', 'id_card', 'name', 'bank_card', 'custom']),
    customRule:      z.object({
      prefixKeep: z.number(),
      suffixKeep: z.number(),
      maskChar:   z.string().optional(),
    }).nullable().optional(),
    exemptRoleCodes: z.array(z.string()).openapi({ example: ['super_admin'] }),
    enabled:         z.boolean(),
    remark:          z.string().nullable().optional(),
    createdAt:       z.string(),
    updatedAt:       z.string(),
  })
  .openapi('DataMaskConfig');
