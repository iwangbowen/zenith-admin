import type { EntityType } from '../core/entity-ref';
import type * as z from 'zod';
import type { canonicalEntityRefSchema } from './entity-registry';

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
  'member.wallet-transaction',
  'member.vip-renewal',
  'payment.order',
  'payment.refund',
  'payment.dispute',
  'payment.risk-hit',
  'payment.risk-review',
  'payment.journal',
  'payment.recon-case',
  'payment.recon-adjustment',
  'payment.sharing-order',
  'payment.sharing-receiver',
  'payment.sharing-reversal',
  'payment.settlement-batch',
  'payment.notify-log',
  'workflow.definition',
  'workflow.instance',
  'workflow.task',
  'workflow.attachment',
  'workflow.archive',
  'drive.file',
  'iot.device',
  'iot.ota-task',
  'iot.ota-device',
  'iot.firmware',
  'platform.managed-file',
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

/** Types with a server resolver and a shipped relation view. Searchability is independent. */
export const ENTITY_RELATION_TYPES = [
  'identity.user', 'member.member', 'payment.order', 'payment.refund', 'payment.dispute',
  'payment.risk-hit', 'payment.risk-review', 'workflow.instance', 'workflow.task',
  'payment.journal', 'payment.recon-case', 'payment.recon-adjustment',
  'payment.sharing-order', 'payment.sharing-receiver', 'payment.sharing-reversal',
  'payment.settlement-batch', 'payment.notify-log',
  'biz.leave', 'workflow.attachment', 'workflow.archive',
  'drive.file', 'iot.device', 'iot.alarm', 'cms.content', 'wiki.document', 'tasks.async',
  'notification.outbox', 'platform.operation-log',
  'member.wallet-transaction', 'member.vip-renewal', 'iot.ota-task', 'iot.ota-device', 'iot.firmware', 'platform.managed-file', 'messaging.announcement',
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
  'member.wallet-transaction': { type: 'member.wallet-transaction', labelKey: 'entity.member.wallet-transaction', searchable: false, capabilities: ['detail', 'relations'] },
  'member.vip-renewal': { type: 'member.vip-renewal', labelKey: 'entity.member.vip-renewal', searchable: false, capabilities: ['detail', 'relations'] },
  'iot.ota-task': { type: 'iot.ota-task', labelKey: 'entity.iot.ota-task', searchable: false, capabilities: ['detail', 'relations'] },
  'iot.ota-device': { type: 'iot.ota-device', labelKey: 'entity.iot.ota-device', searchable: false, capabilities: ['detail', 'relations'] },
  'iot.firmware': { type: 'iot.firmware', labelKey: 'entity.iot.firmware', searchable: false, capabilities: ['detail', 'relations'] },
  'platform.managed-file': { type: 'platform.managed-file', labelKey: 'entity.platform.managed-file', searchable: false, capabilities: ['detail', 'relations'] },
  'workflow.attachment': { type: 'workflow.attachment', labelKey: 'entity.workflow.attachment', searchable: false, capabilities: ['detail', 'relations'] },
  'workflow.archive': { type: 'workflow.archive', labelKey: 'entity.workflow.archive', searchable: false, capabilities: ['detail', 'relations'] },
  'identity.user': { type: 'identity.user', labelKey: 'entity.identity.user', searchable: true, capabilities: ['detail', 'relations', 'timeline'] },
  'member.member': { type: 'member.member', labelKey: 'entity.member.member', searchable: true, capabilities: ['detail', 'relations', 'timeline'] },
  'payment.order': { type: 'payment.order', labelKey: 'entity.payment.order', searchable: true, capabilities: ['detail', 'relations', 'timeline'] },
  'payment.refund': { type: 'payment.refund', labelKey: 'entity.payment.refund', searchable: false, capabilities: ['detail', 'relations', 'timeline'] },
  'payment.dispute': { type: 'payment.dispute', labelKey: 'entity.payment.dispute', searchable: false, capabilities: ['detail', 'relations', 'timeline'] },
  'payment.risk-hit': { type: 'payment.risk-hit', labelKey: 'entity.payment.risk-hit', searchable: false, capabilities: ['detail', 'relations', 'timeline'] },
  'payment.risk-review': { type: 'payment.risk-review', labelKey: 'entity.payment.risk-review', searchable: false, capabilities: ['detail', 'relations', 'timeline'] },
  'payment.journal': { type: 'payment.journal', labelKey: 'entity.payment.journal', searchable: false, capabilities: ['detail', 'relations', 'timeline'] },
  'payment.recon-case': { type: 'payment.recon-case', labelKey: 'entity.payment.recon-case', searchable: false, capabilities: ['detail', 'relations', 'timeline'] },
  'payment.recon-adjustment': { type: 'payment.recon-adjustment', labelKey: 'entity.payment.recon-adjustment', searchable: false, capabilities: ['detail', 'relations', 'timeline'] },
  'payment.sharing-order': { type: 'payment.sharing-order', labelKey: 'entity.payment.sharing-order', searchable: false, capabilities: ['detail', 'relations', 'timeline'] },
  'payment.sharing-receiver': { type: 'payment.sharing-receiver', labelKey: 'entity.payment.sharing-receiver', searchable: false, capabilities: ['detail', 'relations', 'timeline'] },
  'payment.sharing-reversal': { type: 'payment.sharing-reversal', labelKey: 'entity.payment.sharing-reversal', searchable: false, capabilities: ['detail', 'relations', 'timeline'] },
  'payment.settlement-batch': { type: 'payment.settlement-batch', labelKey: 'entity.payment.settlement-batch', searchable: false, capabilities: ['detail', 'relations', 'timeline'] },
  'payment.notify-log': { type: 'payment.notify-log', labelKey: 'entity.payment.notify-log', searchable: false, capabilities: ['detail', 'relations', 'timeline'] },
  'workflow.definition': { type: 'workflow.definition', labelKey: 'entity.workflow.definition', searchable: false, capabilities: ['detail'] },
  'workflow.instance': { type: 'workflow.instance', labelKey: 'entity.workflow.instance', searchable: true, capabilities: ['detail', 'relations', 'timeline'] },
  'workflow.task': { type: 'workflow.task', labelKey: 'entity.workflow.task', searchable: false, capabilities: ['detail', 'relations', 'timeline'] },
  'drive.file': { type: 'drive.file', labelKey: 'entity.drive.file', searchable: true, capabilities: ['detail', 'relations', 'timeline'] },
  'iot.device': { type: 'iot.device', labelKey: 'entity.iot.device', searchable: true, capabilities: ['detail', 'relations', 'timeline'] },
  'iot.alarm': { type: 'iot.alarm', labelKey: 'entity.iot.alarm', searchable: true, capabilities: ['detail', 'relations', 'timeline'] },
  'cms.content': { type: 'cms.content', labelKey: 'entity.cms.content', searchable: true, capabilities: ['detail', 'relations', 'timeline'] },
  'wiki.document': { type: 'wiki.document', labelKey: 'entity.wiki.document', searchable: true, capabilities: ['detail', 'relations', 'timeline'] },
  'messaging.announcement': { type: 'messaging.announcement', labelKey: 'entity.messaging.announcement', searchable: true, capabilities: ['detail', 'relations'] },
  'chat.message': { type: 'chat.message', labelKey: 'entity.chat.message', searchable: true, capabilities: ['detail'] },
  'biz.leave': { type: 'biz.leave', labelKey: 'entity.biz.leave', searchable: true, capabilities: ['detail', 'relations'] },
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

/** Canonical references are value-only; validation lives in entity-registry.ts. */
export type CanonicalEntityRef = z.infer<typeof canonicalEntityRefSchema>;

export function isCanonicalEntityType(value: string): value is CanonicalEntityType {
  return Object.prototype.hasOwnProperty.call(ENTITY_REGISTRY, value);
}
