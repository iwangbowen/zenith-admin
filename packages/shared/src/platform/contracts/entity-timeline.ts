import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { entityKeySchema } from '../../core/entity-ref';
import { timelineEventSchema } from '../../core/timeline';
import { canonicalEntityTypeSchema } from '../entity-registry';

export const entityTimelineQuerySchema = z.object({
  cursor: z.string().max(512).optional().meta({ description: '下一页游标' }),
  limit: z.coerce.number().int().min(1).max(100).default(20).meta({ description: '时间线条数', example: 20 }),
});

export const entityTimelineResponseSchema = z.object({
  items: z.array(timelineEventSchema),
  nextCursor: z.string().max(512).nullable(),
  hasMore: z.boolean(),
}).meta({ id: 'EntityTimelineResponse' });
export type EntityTimelineResponse = z.infer<typeof entityTimelineResponseSchema>;

export const entityTimelineParamsSchema = z.object({
  type: canonicalEntityTypeSchema,
  key: entityKeySchema,
});

export const entityTimelineContract = defineContract('/api/platform/entities', {
  list: op.get('/{type}/{key}/timeline', {
    access: 'authenticated',
    params: entityTimelineParamsSchema,
    query: entityTimelineQuerySchema,
    response: entityTimelineResponseSchema,
    summary: '分页获取对象时间线',
  }),
}, { tags: ['EntityTimeline'] });
