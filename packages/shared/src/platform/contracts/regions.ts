import * as z from 'zod';
import { entityStatusSchema, idParam } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { lazyRecursive } from '../../core/validation';
import type { EntityStatus } from '../../core/types';
import { REGION_LEVELS } from '../constants';
import type { RegionLevel } from '../constants';
import { createRegionSchema, updateRegionSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 行政区划；树形接口按 parentCode 递归挂 children，平铺 / 详情接口不含 children */
export interface Region {
  id: number;
  code: string;
  name: string;
  level: RegionLevel;
  parentCode: string | null;
  sort: number;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
  children?: Region[];
}

export const regionSchema: z.ZodType<Region> = lazyRecursive(() => z.object({
  id: z.int(),
  code: z.string().meta({ example: '110000' }),
  name: z.string().meta({ example: '北京市' }),
  level: z.enum(REGION_LEVELS),
  parentCode: z.string().nullable(),
  sort: z.int(),
  status: entityStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  children: z.array(regionSchema).optional(),
})).meta({ id: 'Region' });

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const regionTreeQuery = z.object({
  keyword: z.string().optional().meta({ description: '按名称 / 区划代码模糊匹配' }),
  status: entityStatusSchema.optional(),
  level: z.enum(REGION_LEVELS).optional(),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const regionContract = defineContract('/api/regions', {
  tree: op.get('/', { query: regionTreeQuery, response: z.array(regionSchema), summary: '地区树形结构' }),
  flat: op.get('/flat', { response: z.array(regionSchema), summary: '平铺地区列表' }),
  detail: op.get('/{id}', { params: idParam, response: regionSchema, summary: '地区详情' }),
  create: op.post('/', { body: createRegionSchema, response: regionSchema, summary: '新增地区' }),
  update: op.put('/{id}', { params: idParam, body: updateRegionSchema, response: regionSchema, summary: '更新地区' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除地区' }),
}, { tags: ['Regions'] });
