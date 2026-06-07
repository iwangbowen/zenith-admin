import { z } from '@hono/zod-openapi';

export const MaintenanceStatusDTO = z
  .object({
    enabled: z.boolean().openapi({ example: false }),
    message: z.string().openapi({ example: '系统维护中，请稍后重试' }),
    estimatedEndAt: z.string().nullable().openapi({ example: '2026-06-07 18:00:00' }),
    startedAt: z.string().nullable().openapi({ example: '2026-06-07 16:00:00' }),
    startedByName: z.string().nullable().openapi({ example: 'admin' }),
    updatedAt: z.string().openapi({ example: '2026-06-07 16:00:00' }),
  })
  .openapi('MaintenanceStatus');
