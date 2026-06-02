/**
 * 业务文件关联 DTO
 */
import { z } from '@hono/zod-openapi';

export const BusinessFileDTO = z
  .object({
    id: z.number().int(),
    businessType: z.string(),
    businessId: z.number().int(),
    fileId: z.number().int(),
    name: z.string().nullable(),
    category: z.string().nullable(),
    sortOrder: z.number().int(),
    // 关联的文件信息
    file: z.object({
      id: z.number().int(),
      originalName: z.string(),
      size: z.number().int(),
      mimeType: z.string().nullable(),
      extension: z.string().nullable(),
      url: z.string(),
    }),
    createdAt: z.string(),
  })
  .openapi('BusinessFile');
