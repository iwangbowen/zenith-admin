import * as z from 'zod';
import { auditFieldsSchema, entityStatusQuery, entityStatusSchema, idParam, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { WIKI_SPACE_MEMBER_ROLES, WIKI_SPACE_VISIBILITIES } from '../constants';
import { createWikiSpaceSchema, saveWikiSpaceMembersSchema, updateWikiSpaceSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const wikiSpaceSchema = z.object({
  id: z.int(),
  name: z.string().meta({ example: '公司制度' }),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  visibility: z.enum(WIKI_SPACE_VISIBILITIES),
  status: entityStatusSchema,
  sort: z.int(),
  aiSyncEnabled: z.boolean(),
  tenantId: z.int().nullable(),
  memberCount: z.int().optional().meta({ description: '成员数（列表返回）' }),
  docCount: z.int().optional().meta({ description: '未删除文档数（列表返回）' }),
  myRole: z.enum(WIKI_SPACE_MEMBER_ROLES).nullable().optional()
    .meta({ description: '当前用户在该空间的有效角色（详情 / 我可访问的空间返回）；null = 非成员' }),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'WikiSpace' });

export type WikiSpace = z.infer<typeof wikiSpaceSchema>;

export const wikiSpaceMemberSchema = z.object({
  spaceId: z.int(),
  userId: z.int(),
  role: z.enum(WIKI_SPACE_MEMBER_ROLES),
  username: z.string().optional(),
  nickname: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'WikiSpaceMember' });

export type WikiSpaceMember = z.infer<typeof wikiSpaceMemberSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const wikiSpaceListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按名称 / 描述模糊匹配' }),
  visibility: queryEnum(WIKI_SPACE_VISIBILITIES),
  status: entityStatusQuery,
});

export const wikiSpaceContract = defineContract('/api/wiki/spaces', {
  list: op.get('/', { query: wikiSpaceListQuery, response: paginated(wikiSpaceSchema), summary: '知识空间列表' }),
  my: op.get('/my', { response: z.array(wikiSpaceSchema), summary: '我可访问的空间（文档中心侧栏）' }),
  detail: op.get('/{id}', { params: idParam, response: wikiSpaceSchema, summary: '空间详情' }),
  create: op.post('/', { body: createWikiSpaceSchema, response: wikiSpaceSchema, summary: '创建空间' }),
  update: op.put('/{id}', { params: idParam, body: updateWikiSpaceSchema, response: wikiSpaceSchema, summary: '更新空间' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除空间' }),
  listMembers: op.get('/{id}/members', { params: idParam, response: z.array(wikiSpaceMemberSchema), summary: '空间成员列表' }),
  saveMembers: op.put('/{id}/members', { params: idParam, body: saveWikiSpaceMembersSchema, summary: '保存空间成员（全量替换）' }),
}, { tags: ['知识中心-空间'] });
