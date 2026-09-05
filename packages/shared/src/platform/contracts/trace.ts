import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { TRACE_NODE_KINDS, TRACE_NODE_STATUSES } from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 链路时间线节点：五类锚点归一后的统一结构 */
export const traceTimelineNodeSchema = z.object({
  kind: z.enum(TRACE_NODE_KINDS),
  ts: z.string().meta({ description: '节点时间', example: '2026-08-28 12:00:00' }),
  title: z.string(),
  status: z.enum(TRACE_NODE_STATUSES),
  durationMs: z.int().nullable(),
  refId: z.int().meta({ description: '源单据 ID（对应锚点表主键）' }),
  parentRef: z.string().nullable().optional().meta({ description: '因果父引用（`kind:refId` 或 `request`）；null 表示无法定位触发源' }),
  detail: z.record(z.string(), z.unknown()).meta({ description: 'kind 专属明细（渠道投递结果 / 作业错误 / 审计摘要等）' }),
}).meta({ id: 'TraceTimelineNode' });

export type TraceTimelineNode = z.infer<typeof traceTimelineNodeSchema>;

export const traceTimelineSchema = z.object({
  traceId: z.string(),
  nodes: z.array(traceTimelineNodeSchema),
}).meta({ id: 'TraceTimeline' });

export type TraceTimeline = z.infer<typeof traceTimelineSchema>;

/** 最近失败链路条目（排障入口列表） */
export const traceFailureEntrySchema = z.object({
  kind: z.enum(TRACE_NODE_KINDS),
  refId: z.int(),
  traceId: z.string(),
  title: z.string(),
  error: z.string(),
  ts: z.string().meta({ example: '2026-08-28 12:00:00' }),
}).meta({ id: 'TraceFailureEntry' });

export type TraceFailureEntry = z.infer<typeof traceFailureEntrySchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const traceIdParam = z.object({
  traceId: z.string().min(8).max(64).meta({ description: '链路 ID（= 请求的 X-Request-Id）' }),
});

export const traceFailureListQuery = z.object({
  days: z.coerce.number().int().min(1).max(30).optional().meta({ description: '时间窗天数，默认 7' }),
  kind: z.enum(TRACE_NODE_KINDS).optional().meta({ description: '按节点类型过滤' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const traceContract = defineContract('/api/trace', {
  recentFailures: op.get('/recent-failures', { query: traceFailureListQuery, response: z.array(traceFailureEntrySchema), summary: '最近失败链路（请求 5xx / 作业失败 / 任务失败 / 通知派发失败）' }),
  timeline: op.get('/{traceId}', { params: traceIdParam, response: traceTimelineSchema, summary: '按 traceId 聚合一次操作的时间线（请求/作业/事件/通知/任务）' }),
}, { tags: ['链路追踪'] });
