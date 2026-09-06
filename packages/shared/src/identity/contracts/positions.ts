import * as z from 'zod';
import { auditFieldsSchema, batchIdsBody, dateRangeBound, entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { sensitive } from '../../core/sensitive';
import { createPositionSchema, scopeUserIdsSchema, updatePositionSchema } from '../validation';
import { memberPreviewOp } from './scope-members';
import { userPreviewSchema } from './user-preview';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const positionSchema = z.object({
  id: z.int(),
  name: z.string().meta({ example: '前端工程师' }),
  code: z.string().meta({ example: 'frontend_dev' }),
  sort: z.int().meta({ example: 1 }),
  status: entityStatusSchema,
  remark: z.string().nullable().optional(),
  userCount: z.int().optional().meta({ example: 5, description: '成员数（列表返回）' }),
  userPreview: z.array(userPreviewSchema).optional().meta({ description: '成员摘要（列表返回）' }),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'Position' });

export type Position = z.infer<typeof positionSchema>;

/** 岗位成员（分配成员抽屉的预选来源） */
export const positionMemberSchema = z.object({
  id: z.int(),
  username: z.string(),
  nickname: z.string(),
  email: sensitive(z.string().nullable(), 'email'),
  avatar: z.string().nullable(),
  departmentName: z.string().nullable(),
  joinedAt: z.string(),
}).meta({ id: 'PositionMember' });

export type PositionMember = z.infer<typeof positionMemberSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const positionListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按名称 / 编码模糊匹配' }),
  status: entityStatusSchema.optional(),
  startTime: dateRangeBound('创建时间起'),
  endTime: dateRangeBound('创建时间止'),
});

export const positionContract = defineContract('/api/positions', {
  all: op.get('/all', { response: z.array(positionSchema), summary: '全量岗位（供下拉框）' }),
  list: op.get('/', { query: positionListQuery, response: paginated(positionSchema), summary: '岗位列表' }),
  detail: op.get('/{id}', { params: idParam, response: positionSchema, summary: '岗位详情' }),
  create: op.post('/', { body: createPositionSchema, response: positionSchema, summary: '创建岗位' }),
  update: op.put('/{id}', { params: idParam, body: updatePositionSchema, response: positionSchema, summary: '更新岗位' }),
  removeBatch: op.delete('/batch', { body: batchIdsBody, summary: '批量删除岗位' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除岗位' }),
  members: op.get('/{id}/members', { params: idParam, response: z.array(positionMemberSchema), summary: '获取岗位成员' }),
  memberPreview: memberPreviewOp('岗位成员分页预览'),
  setMembers: op.put('/{id}/members', { params: idParam, body: scopeUserIdsSchema, summary: '设置岗位成员（全量覆盖）' }),
}, { tags: ['Positions'] });
