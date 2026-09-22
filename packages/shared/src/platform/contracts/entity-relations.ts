import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { entityKeySchema, relationKeySchema } from '../../core/entity-ref';
import { canonicalEntityRefSchema, canonicalEntityTypeSchema } from '../entity-registry';

export const ENTITY_RELATION_KINDS = ['direct', 'derived', 'causal', 'activity'] as const;
export const entityRelationKindSchema = z.enum(ENTITY_RELATION_KINDS).meta({ id: 'EntityRelationKind' });
export type EntityRelationKind = z.infer<typeof entityRelationKindSchema>;

export const ENTITY_RELATION_CARDINALITIES = ['one', 'many'] as const;
export const entityRelationCardinalitySchema = z.enum(ENTITY_RELATION_CARDINALITIES).meta({ id: 'EntityRelationCardinality' });
export type EntityRelationCardinality = z.infer<typeof entityRelationCardinalitySchema>;

/**
 * 定性关联摘要。刻意不暴露数量，避免折叠状态泄漏数据规模，同时让列表
 * 在展开前就能表达是否存在记录或需要关注的记录。
 */
export const ENTITY_RELATION_SUMMARY_STATES = ['has-data', 'empty', 'attention', 'unavailable'] as const;
export const entityRelationSummaryStateSchema = z.enum(ENTITY_RELATION_SUMMARY_STATES).meta({ id: 'EntityRelationSummaryState' });
export type EntityRelationSummaryState = z.infer<typeof entityRelationSummaryStateSchema>;

/** 关系摘要上的能力由服务端按目标对象权限计算，前端不自行猜测路由。 */
export const entityRelationCapabilitiesSchema = z.object({
  view: z.boolean().default(true),
  open: z.boolean().default(true),
}).meta({ id: 'EntityRelationCapabilities' });

/**
 * 关系项的来源语义。kind 说明为什么能建立这条关系；eventType 仅允许
 * 服务端提供安全的事件标识，不承载领域事件 payload 或其他敏感详情。
 */
export const entityRelationOriginSchema = z.object({
  kind: entityRelationKindSchema,
  eventType: z.string().max(128).nullable().optional().meta({ description: '建立或触发关系的事件标识，可空' }),
}).meta({ id: 'EntityRelationOrigin' });
export type EntityRelationOrigin = z.infer<typeof entityRelationOriginSchema>;

export const entityRelationSectionSchema = z.object({
  key: relationKeySchema,
  labelKey: z.string().min(1).max(128),
  targetTypes: z.array(canonicalEntityTypeSchema).min(1),
  kind: entityRelationKindSchema,
  cardinality: entityRelationCardinalitySchema,
  capabilities: entityRelationCapabilitiesSchema,
  summaryState: entityRelationSummaryStateSchema.default('unavailable'),
}).meta({ id: 'EntityRelationSection' });
export type EntityRelationSection = z.infer<typeof entityRelationSectionSchema>;
/** Provider manifests may omit the server-computed state; describe fills it. */
export type EntityRelationSectionDescriptor = Omit<EntityRelationSection, 'summaryState'> & {
  summaryState?: EntityRelationSummaryState;
};

/** 关联分组中的最小摘要 DTO；完整目标对象必须通过自身详情接口再次鉴权。 */
export const entityRelationItemSchema = z.object({
  ref: canonicalEntityRefSchema,
  relationKey: relationKeySchema,
  title: z.string().min(1).max(160),
  subtitle: z.string().max(240).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  status: z.string().max(64).nullable().optional(),
  occurredAt: z.string().nullable().optional(),
  origin: entityRelationOriginSchema.optional().meta({ description: '关系来源语义；不包含事件载荷' }),
  capabilities: entityRelationCapabilitiesSchema,
}).meta({ id: 'EntityRelationItem' });
export type EntityRelationItem = z.infer<typeof entityRelationItemSchema>;

export const entityRelationPageSchema = z.object({
  items: z.array(entityRelationItemSchema),
  nextCursor: z.string().max(4096).nullable(),
  hasMore: z.boolean(),
  /** 只有在与 items 使用同一可见性谓词时才填写。 */
  total: z.int().nonnegative().optional(),
  degraded: z.enum(['timeout', 'error']).optional(),
}).meta({ id: 'EntityRelationPage' });
export type EntityRelationPage = z.infer<typeof entityRelationPageSchema>;

export const entityRelationAnchorSchema = z.object({
  ref: canonicalEntityRefSchema,
  title: z.string().min(1).max(160),
}).meta({ id: 'EntityRelationAnchor' });

export const entityRelationsResponseSchema = z.object({
  anchor: entityRelationAnchorSchema,
  sections: z.array(entityRelationSectionSchema),
  canManageLinks: z.boolean().default(false),
}).meta({ id: 'EntityRelationsResponse' });
export type EntityRelationsResponse = z.infer<typeof entityRelationsResponseSchema>;

export const entityRelationParamsSchema = z.object({
  type: canonicalEntityTypeSchema,
  key: entityKeySchema,
});

export const entityRelationSectionParamsSchema = entityRelationParamsSchema.extend({
  sectionKey: relationKeySchema,
});

export const entityRelationsQuerySchema = z.object({
  cursor: z.string().min(1).max(4096).optional().meta({ description: '下一页游标' }),
  limit: z.coerce.number().int().min(1).max(50).default(5).meta({ description: '单组预览 / 分页条数', example: 5 }),
});

export const entityRelationsContract = defineContract('/api/platform/entities', {
  link: op.post('/{type}/{key}/links', {
    access: { permission: 'system:relation:manage' }, audit: '关联业务对象',
    params: entityRelationParamsSchema,
    body: z.object({ target: canonicalEntityRefSchema }),
    summary: '建立人工对象关联',
  }),
  unlink: op.delete('/{type}/{key}/links', {
    access: { permission: 'system:relation:manage' }, audit: '解除业务对象关联',
    params: entityRelationParamsSchema,
    body: z.object({ target: canonicalEntityRefSchema }),
    summary: '解除人工对象关联',
  }),
  describe: op.get('/{type}/{key}/relations', {
    access: 'authenticated',
    params: entityRelationParamsSchema,
    response: entityRelationsResponseSchema,
    summary: '获取对象可见的关联分组',
  }),
  section: op.get('/{type}/{key}/relations/{sectionKey}', {
    access: 'authenticated',
    params: entityRelationSectionParamsSchema,
    query: entityRelationsQuerySchema,
    response: entityRelationPageSchema,
    summary: '分页获取对象关联分组',
  }),
}, { tags: ['EntityRelations'] });
