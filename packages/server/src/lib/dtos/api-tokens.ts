/**
 * API Token 相关 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

export const ApiTokenListItemDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    tokenPrefix: z.string(),
    lastUsedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string().optional(),
  })
  .openapi('ApiTokenListItem');

export const ApiTokenCreatedDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    token: z.string(),
    createdAt: z.string(),
  })
  .openapi('ApiTokenCreated');
