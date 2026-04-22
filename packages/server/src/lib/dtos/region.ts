/**
 * 地区相关 DTO
 */
import { z } from '@hono/zod-openapi';

export const RegionDTO: z.ZodType = z
  .object({
    id: z.number().int(),
    code: z.string().openapi({ example: '110000' }),
    name: z.string().openapi({ example: '北京市' }),
    level: z.enum(['province', 'city', 'county']),
    parentCode: z.string().nullable(),
    sort: z.number().int(),
    status: z.enum(['active', 'disabled']),
    createdAt: z.string(),
    updatedAt: z.string(),
    get children() {
      return z.array(RegionDTO).optional();
    },
  })
  .openapi('Region');
