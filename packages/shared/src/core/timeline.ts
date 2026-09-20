import * as z from 'zod';
import { entityRefSchema, subjectRefSchema } from './entity-ref';

/** 时间线事件的可见性策略；更细的权限由服务端按当前主体判定。 */
export const TIMELINE_EVENT_VISIBILITIES = ['tenant', 'restricted'] as const;
export const timelineEventVisibilitySchema = z.enum(TIMELINE_EVENT_VISIBILITIES).meta({ id: 'TimelineEventVisibility' });
export type TimelineEventVisibility = z.infer<typeof timelineEventVisibilitySchema>;

/**
 * 跨域时间线的稳定事件协议。
 *
 * `subjectRefs` 是事件与业务对象的唯一结构化关联依据；traceId / parentRef
 * 只描述因果链，不能单独推断对象关系。payload 由具体 eventType 解释，展示层
 * 只能消费经过领域权限过滤后的摘要。
 */
export const timelineEventSchema = z.object({
  id: z.string().min(1).max(128).meta({ description: '事件稳定标识' }),
  eventType: z.string().min(1).max(128).meta({ description: '领域事件类型', example: 'payment.order.refunded' }),
  occurredAt: z.iso.datetime().meta({ description: '事件发生时间', example: '2026-09-20T08:30:00.000Z' }),
  actorRef: entityRefSchema.nullable().optional(),
  sourceRef: entityRefSchema.nullable().optional(),
  subjectRefs: z.array(subjectRefSchema).min(1),
  traceId: z.string().min(1).max(128).nullable().optional(),
  parentRef: z.string().min(1).max(256).nullable().optional(),
  visibility: timelineEventVisibilitySchema,
  payload: z.record(z.string(), z.unknown()).default({}),
}).meta({ id: 'TimelineEvent' });

export type TimelineEvent = z.infer<typeof timelineEventSchema>;
