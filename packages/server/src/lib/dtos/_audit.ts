import { z } from '@hono/zod-openapi';

/**
 * 通用审计字段：`createdBy` / `updatedBy` 指向用户 ID。
 * 由 `db/index.ts` 的 Proxy 在 insert / update 时自动写入（基于 `audit-context`），
 * 业务 service 与路由无需手动赋值。
 *
 * 用法：
 *   const UserDTO = z.object({ ... , ...auditFields }).openapi('User');
 */
export const auditFields = {
  createdBy: z.number().int().nullable().optional(),
  updatedBy: z.number().int().nullable().optional(),
};
