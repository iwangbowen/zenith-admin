import * as z from 'zod';
import { entityKeySchema, type EntityType } from '../core/entity-ref';

/**
 * 跨对象能力使用的 canonical EntityType。
 *
 * Global Search 的 `SearchType` 是面向检索适配器的兼容词表，不能替代这里的
 * 实体类型：一个可关联实体不一定可搜索，且一个搜索结果有时只是某个实体的
 * 展示别名。两者通过 `SEARCH_TYPE_ENTITY_TYPES` 显式映射，避免在关系服务里
 * 把 `order` 等搜索词误当成完整实体类型。
 */
export const ENTITY_TYPES = [
  'identity.user',
  'member.member',
  'payment.order',
  'payment.refund',
  'payment.dispute',
  'payment.risk-hit',
  'payment.risk-review',
  'workflow.definition',
  'workflow.instance',
  'workflow.task',
  'drive.file',
  'iot.device',
  'iot.alarm',
  'cms.content',
  'wiki.document',
  'messaging.announcement',
  'chat.message',
  'biz.leave',
  'report.dashboard',
  'report.dataset',
  'ai.knowledge-base',
  'tasks.async',
  'notification.outbox',
  'platform.operation-log',
  'platform.exception-log',
] as const satisfies readonly EntityType[];

export type CanonicalEntityType = (typeof ENTITY_TYPES)[number];

export const canonicalEntityTypeSchema = z.enum(ENTITY_TYPES).meta({
  id: 'CanonicalEntityType',
  description: '已注册的跨对象实体类型',
});

/** Types with a server resolver and a shipped relation view. Searchability is independent. */
export const ENTITY_RELATION_TYPES = [
  'identity.user', 'member.member', 'payment.order', 'payment.refund', 'payment.dispute',
  'payment.risk-hit', 'payment.risk-review', 'workflow.instance', 'workflow.task',
  'drive.file', 'iot.device', 'iot.alarm', 'cms.content', 'wiki.document', 'tasks.async',
  'notification.outbox', 'platform.operation-log',
] as const satisfies readonly CanonicalEntityType[];
export function supportsEntityRelations(type: string): type is (typeof ENTITY_RELATION_TYPES)[number] {
  return (ENTITY_RELATION_TYPES as readonly string[]).includes(type);
}
export interface EntityDefinition {
  readonly type: CanonicalEntityType;
  /** 前端本地化键；服务端不把中文 label 固化在关系响应里。 */
  readonly labelKey: string;
  readonly searchable: boolean;
  readonly capabilities: readonly ('detail' | 'relations' | 'timeline')[];
}

/** 实体注册表是跨域对象发现、详情能力和关系能力的唯一清单。 */
export const ENTITY_REGISTRY: Readonly<Record<CanonicalEntityType, EntityDefinition>> = {
  'identity.user': { type: 'identity.user', labelKey: 'entity.identity.user', searchable: true, capabilities: ['detail', 'relations', 'timeline'] },
  'member.member': { type: 'member.member', labelKey: 'entity.member.member', searchable: true, capabilities: ['detail', 'relations', 'timeline'] },
  'payment.order': { type: 'payment.order', labelKey: 'entity.payment.order', searchable: true, capabilities: ['detail', 'relations', 'timeline'] },
  'payment.refund': { type: 'payment.refund', labelKey: 'entity.payment.refund', searchable: false, capabilities: ['detail', 'relations', 'timeline'] },
  'payment.dispute': { type: 'payment.dispute', labelKey: 'entity.payment.dispute', searchable: false, capabilities: ['detail', 'relations', 'timeline'] },
  'payment.risk-hit': { type: 'payment.risk-hit', labelKey: 'entity.payment.risk-hit', searchable: false, capabilities: ['detail', 'relations', 'timeline'] },
  'payment.risk-review': { type: 'payment.risk-review', labelKey: 'entity.payment.risk-review', searchable: false, capabilities: ['detail', 'relations', 'timeline'] },
  'workflow.definition': { type: 'workflow.definition', labelKey: 'entity.workflow.definition', searchable: false, capabilities: ['detail'] },
  'workflow.instance': { type: 'workflow.instance', labelKey: 'entity.workflow.instance', searchable: true, capabilities: ['detail', 'relations', 'timeline'] },
  'workflow.task': { type: 'workflow.task', labelKey: 'entity.workflow.task', searchable: false, capabilities: ['detail', 'relations', 'timeline'] },
  'drive.file': { type: 'drive.file', labelKey: 'entity.drive.file', searchable: true, capabilities: ['detail', 'relations', 'timeline'] },
  'iot.device': { type: 'iot.device', labelKey: 'entity.iot.device', searchable: true, capabilities: ['detail', 'relations', 'timeline'] },
  'iot.alarm': { type: 'iot.alarm', labelKey: 'entity.iot.alarm', searchable: true, capabilities: ['detail', 'relations', 'timeline'] },
  'cms.content': { type: 'cms.content', labelKey: 'entity.cms.content', searchable: true, capabilities: ['detail', 'relations', 'timeline'] },
  'wiki.document': { type: 'wiki.document', labelKey: 'entity.wiki.document', searchable: true, capabilities: ['detail', 'relations', 'timeline'] },
  'messaging.announcement': { type: 'messaging.announcement', labelKey: 'entity.messaging.announcement', searchable: true, capabilities: ['detail'] },
  'chat.message': { type: 'chat.message', labelKey: 'entity.chat.message', searchable: true, capabilities: ['detail'] },
  'biz.leave': { type: 'biz.leave', labelKey: 'entity.biz.leave', searchable: true, capabilities: ['detail'] },
  'report.dashboard': { type: 'report.dashboard', labelKey: 'entity.report.dashboard', searchable: true, capabilities: ['detail'] },
  'report.dataset': { type: 'report.dataset', labelKey: 'entity.report.dataset', searchable: true, capabilities: ['detail'] },
  'ai.knowledge-base': { type: 'ai.knowledge-base', labelKey: 'entity.ai.knowledge-base', searchable: true, capabilities: ['detail'] },
  'tasks.async': { type: 'tasks.async', labelKey: 'entity.tasks.async', searchable: true, capabilities: ['detail', 'relations', 'timeline'] },
  'notification.outbox': { type: 'notification.outbox', labelKey: 'entity.notification.outbox', searchable: false, capabilities: ['detail', 'relations', 'timeline'] },
  'platform.operation-log': { type: 'platform.operation-log', labelKey: 'entity.platform.operation-log', searchable: true, capabilities: ['detail', 'relations', 'timeline'] },
  'platform.exception-log': { type: 'platform.exception-log', labelKey: 'entity.platform.exception-log', searchable: true, capabilities: ['detail'] },
};

/** 统一搜索返回的旧词表到 canonical EntityType 的明确映射。 */
export const SEARCH_TYPE_ENTITY_TYPES = {
  user: 'identity.user',
  member: 'member.member',
  order: 'payment.order',
  workflow: 'workflow.instance',
  file: 'drive.file',
  'iot-device': 'iot.device',
  'iot-alarm': 'iot.alarm',
  'cms-content': 'cms.content',
  'wiki-document': 'wiki.document',
  announcement: 'messaging.announcement',
  'chat-message': 'chat.message',
  'biz-leave': 'biz.leave',
  'report-dashboard': 'report.dashboard',
  'report-dataset': 'report.dataset',
  'ai-knowledge-base': 'ai.knowledge-base',
  'async-task': 'tasks.async',
  'operation-log': 'platform.operation-log',
  'exception-log': 'platform.exception-log',
} as const satisfies Record<string, CanonicalEntityType>;

export type SearchType = keyof typeof SEARCH_TYPE_ENTITY_TYPES;
export type SearchEntityType = (typeof SEARCH_TYPE_ENTITY_TYPES)[SearchType];

/** 用于平台契约的 canonical 引用，限制 type 必须先在实体注册表登记。 */
export const canonicalEntityRefSchema = z.object({
  type: canonicalEntityTypeSchema,
  key: entityKeySchema,
}).meta({ id: 'CanonicalEntityRef' });

export type CanonicalEntityRef = z.infer<typeof canonicalEntityRefSchema>;

/** 运行时注册表校验，供 server 启动时检查模块贡献者。 */
export function isCanonicalEntityType(value: string): value is CanonicalEntityType {
  return Object.prototype.hasOwnProperty.call(ENTITY_REGISTRY, value);
}

export function isCanonicalEntityRef(value: unknown): value is CanonicalEntityRef {
  return canonicalEntityRefSchema.safeParse(value).success;
}
