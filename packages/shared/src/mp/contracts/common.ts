import * as z from 'zod';

// ─── 本域按公众号隔离的通用积木 ──────────────────────────────────────────────

/** `?accountId=` 所属公众号（本域所有按账号隔离的查询共用） */
export const mpAccountIdQuery = z.object({
  accountId: z.coerce.number().int().positive().meta({ description: '公众号 ID', example: 1 }),
});

/** 从微信同步（标签 / 素材 / 模板 / 客服账号）的 upsert 结果 */
export const mpSyncResultSchema = z.object({
  success: z.boolean(),
  created: z.int(),
  updated: z.int(),
  total: z.int(),
}).meta({ id: 'MpSyncResult' });

export type MpSyncResult = z.infer<typeof mpSyncResultSchema>;
