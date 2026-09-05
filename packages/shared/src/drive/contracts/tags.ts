import * as z from 'zod';
import { idParam } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { createDriveTagSchema, updateDriveTagSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const driveTagSchema = z.object({
  id: z.int(),
  spaceId: z.int(),
  name: z.string().meta({ example: '重要' }),
  color: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'DriveTag' });

export type DriveTag = z.infer<typeof driveTagSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const driveTagListQuery = z.object({
  spaceId: z.coerce.number().int().positive().meta({ description: '空间 ID', example: 1 }),
});

export const driveTagContract = defineContract('/api/drive/tags', {
  list: op.get('/', { query: driveTagListQuery, response: z.array(driveTagSchema), summary: '空间标签' }),
  create: op.post('/', { body: createDriveTagSchema, response: driveTagSchema, summary: '新建标签' }),
  update: op.put('/{id}', { params: idParam, body: updateDriveTagSchema, response: driveTagSchema, summary: '更新标签' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除标签' }),
}, { tags: ['企业网盘-标签'] });
