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

export const SensitiveFieldDTO = z
  .object({
    tableName:         z.string().openapi({ example: 'users' }),
    columnName:        z.string().openapi({ example: 'phone' }),
    dataType:          z.string().openapi({ example: 'character varying' }),
    suggestedMaskType: z.enum(['phone', 'email', 'id_card', 'name', 'bank_card', 'custom']),
    suggestedLabel:    z.string().openapi({ example: '手机号' }),
    hasRule:           z.boolean().openapi({ description: '是否已有脱敏规则' }),
  })
  .openapi('SensitiveField');
