import * as z from 'zod';
import { auditFieldsSchema, idParam } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { lazyRecursive } from '../../core/validation';
import { REPORT_RESOURCE_TYPES } from '../types';
import { createReportFolderSchema, moveReportFolderSchema, reportResourceTypeSchema, updateReportFolderSchema } from '../validation';
import { reportStatusSchema } from './_common';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const reportFolderSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  parentId: z.int().nullable(),
  name: z.string(),
  resourceType: z.enum(REPORT_RESOURCE_TYPES),
  ownerId: z.int().nullable(),
  ownerName: z.string().nullable().optional(),
  sort: z.int(),
  status: reportStatusSchema,
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportFolder' });

export type ReportFolder = z.infer<typeof reportFolderSchema>;

/** 资源目录树节点；自引用结构，类型需手写供递归 schema 标注 */
export type ReportFolderTreeNode = ReportFolder & {
  children?: ReportFolderTreeNode[];
  resourceCount?: number;
};

export const reportFolderTreeNodeSchema: z.ZodType<ReportFolderTreeNode> = lazyRecursive(() => reportFolderSchema.extend({
  children: z.array(reportFolderTreeNodeSchema).optional(),
  resourceCount: z.int().optional(),
})).meta({ id: 'ReportFolderTreeNode' });

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const reportFolderTreeQuery = z.object({
  resourceType: reportResourceTypeSchema.optional(),
});

export const reportFolderContract = defineContract('/api/report/folders', {
  tree: op.get('/tree', { query: reportFolderTreeQuery, response: z.array(reportFolderTreeNodeSchema), summary: '资源目录树' }),
  detail: op.get('/{id}', { params: idParam, response: reportFolderSchema, summary: '资源目录详情' }),
  create: op.post('/', { body: createReportFolderSchema, response: reportFolderSchema, summary: '创建资源目录' }),
  update: op.put('/{id}', { params: idParam, body: updateReportFolderSchema, response: reportFolderSchema, summary: '更新资源目录' }),
  move: op.post('/{id}/move', { params: idParam, body: moveReportFolderSchema, response: reportFolderSchema, summary: '移动资源目录' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除资源目录' }),
}, { tags: ['报表资源目录'] });
