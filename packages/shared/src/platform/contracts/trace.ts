import * as z from 'zod';
import { queryEnum } from '../../core/api-schemas';
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
  correlationId: z.string(),
  nodes: z.array(traceTimelineNodeSchema),
}).meta({ id: 'TraceTimeline' });

export type TraceTimeline = z.infer<typeof traceTimelineSchema>;

/** 最近链路条目（无 ID 时的浏览入口） */
export const traceListEntrySchema = z.object({
  correlationId: z.string(),
  ts: z.string().meta({ description: '最近活动时间', example: '2026-08-28 12:00:00' }),
  title: z.string().meta({ description: '入口摘要（首个请求的方法路径 / 触发作业 / 任务标题）' }),
  status: z.enum(TRACE_NODE_STATUSES).meta({ description: '汇总状态：任一节点失败为 failed，否则有在途节点为 running / pending，全成功为 success' }),
  nodeCount: z.int().meta({ description: '链路内节点总数' }),
  failedCount: z.int().meta({ description: '失败节点数' }),
}).meta({ id: 'TraceListEntry' });

export type TraceListEntry = z.infer<typeof traceListEntrySchema>;

/** 最近失败链路条目（排障入口列表） */
export const traceFailureEntrySchema = z.object({
  kind: z.enum(TRACE_NODE_KINDS),
  refId: z.int(),
  correlationId: z.string(),
  title: z.string(),
  error: z.string(),
  ts: z.string().meta({ example: '2026-08-28 12:00:00' }),
}).meta({ id: 'TraceFailureEntry' });

export type TraceFailureEntry = z.infer<typeof traceFailureEntrySchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const correlationIdParam = z.object({
  correlationId: z.string().min(8).max(64).meta({ description: '链路 ID（= 请求的 X-Request-Id）' }),
});

export const traceFailureListQuery = z.object({
  days: z.coerce.number().int().min(1).max(30).optional().meta({ description: '时间窗天数，默认 7' }),
  kind: queryEnum(TRACE_NODE_KINDS, '按节点类型过滤'),
});

export const traceListQuery = z.object({
  days: z.coerce.number().int().min(1).max(30).optional().meta({ description: '时间窗天数，默认 7' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const traceContract = defineContract('/api/trace', {
  recent: op.get('/recent', { access: { permission: 'system:trace:view' }, query: traceListQuery, response: z.array(traceListEntrySchema), summary: '最近链路（按最近活动时间倒序，含节点 / 失败计数与汇总状态）' }),
  recentFailures: op.get('/recent-failures', { access: { permission: 'system:trace:view' }, query: traceFailureListQuery, response: z.array(traceFailureEntrySchema), summary: '最近失败链路（请求 5xx / 作业失败 / 任务失败 / 通知派发失败）' }),
  timeline: op.get('/{correlationId}', { access: { permission: 'system:trace:view' }, params: correlationIdParam, response: traceTimelineSchema, summary: '按 correlationId 聚合一次操作的时间线（请求/作业/事件/通知/任务）' }),
}, { tags: ['链路追踪'] });
