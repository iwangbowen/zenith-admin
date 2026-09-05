import * as z from 'zod';
import { paginated, paginationQuery, queryBool, queryEnum } from '../../core/api-schemas';
import { defineContract, fileField, multipart, op } from '../../core/contract';
import {
  ANALYTICS_DEVICE_TYPES,
  ANALYTICS_ENVIRONMENTS,
  ANALYTICS_EVENT_SOURCES,
  ERROR_LEVELS,
  FRONTEND_ERROR_TYPES,
  REPLAY_MODES,
  REPLAY_STATUSES,
  REPLAY_TRIGGER_TYPES,
} from '../constants';
import { replayTriggerSchema } from '../validation';
import { daysQuery } from './_query';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const replaySessionSchema = z.object({
  id: z.string().meta({ description: '回放会话 ID（客户端生成 UUID）' }),
  sessionId: z.string().meta({ description: 'tracker 会话 ID' }),
  mode: z.enum(REPLAY_MODES),
  status: z.enum(REPLAY_STATUSES),
  triggers: z.array(replayTriggerSchema),
  startedAt: z.string(),
  lastActivityAt: z.string(),
  endedAt: z.string().nullable(),
  durationMs: z.int(),
  segmentCount: z.int(),
  totalBytes: z.int(),
  errorCount: z.int(),
  pageCount: z.int(),
  clickCount: z.int(),
  pagePaths: z.array(z.string()).meta({ description: '访问过的页面路径（去重索引，内容检索用）' }),
  clickLabels: z.array(z.string()).meta({ description: '点击过的元素文案（去重索引，内容检索用）' }),
  entryPageUrl: z.string().nullable(),
  source: z.enum(ANALYTICS_EVENT_SOURCES),
  appId: z.string(),
  environment: z.enum(ANALYTICS_ENVIRONMENTS),
  userId: z.int().nullable(),
  username: z.string().nullable(),
  memberId: z.int().nullable(),
  browser: z.string().nullable(),
  os: z.string().nullable(),
  deviceType: z.enum(ANALYTICS_DEVICE_TYPES).nullable(),
  sdkVersion: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'ReplaySession' });

export type ReplaySession = z.infer<typeof replaySessionSchema>;

export const replaySegmentMetaSchema = z.object({
  id: z.int(),
  replayId: z.string(),
  seq: z.int(),
  fromTs: z.string(),
  toTs: z.string(),
  byteSize: z.int(),
  eventCount: z.int(),
  hasFullSnapshot: z.boolean().meta({ description: '含 rrweb 全量快照的分片可作为播放起点' }),
}).meta({ id: 'ReplaySegmentMeta' });

export type ReplaySegmentMeta = z.infer<typeof replaySegmentMetaSchema>;

/** 回放详情：会话 + 分片清单 + 关联错误（时间轴标注与跳转用） */
export const replaySessionDetailSchema = replaySessionSchema.extend({
  segments: z.array(replaySegmentMetaSchema),
  errors: z.array(z.object({
    id: z.int(),
    groupId: z.int(),
    errorType: z.enum(FRONTEND_ERROR_TYPES),
    level: z.enum(ERROR_LEVELS),
    message: z.string(),
    createdAt: z.string(),
  })),
  perfEvents: z.array(z.object({
    metricName: z.string(),
    metricValue: z.number(),
    createdAt: z.string(),
  })).meta({ description: '回放期间的 Web Vitals 性能事件（时间轴标注）' }),
  siblings: z.array(z.object({
    id: z.string(),
    status: z.enum(REPLAY_STATUSES),
    startedAt: z.string(),
    durationMs: z.int(),
    errorCount: z.int(),
    entryPageUrl: z.string().nullable(),
  })).meta({ description: '同一浏览器会话的其它回放片段（旅程拼接）' }),
}).meta({ id: 'ReplaySessionDetail' });

export type ReplaySessionDetail = z.infer<typeof replaySessionDetailSchema>;

/** 回放存储统计（容量看板与配额治理） */
export const replayStorageStatsSchema = z.object({
  totalBytes: z.number(),
  totalCount: z.int(),
  todayBytes: z.number(),
  todayCount: z.int(),
  quotaMb: z.int().meta({ description: '配额（MB，0=不限制）' }),
  usagePercent: z.number().meta({ description: '配额使用率（%，无配额时为 0）' }),
}).meta({ id: 'ReplayStorageStats' });

export type ReplayStorageStats = z.infer<typeof replayStorageStatsSchema>;

/** 页面点击热力聚合（2% 网格） */
export const replayClickHeatmapSchema = z.object({
  points: z.array(z.object({ x: z.int(), y: z.int(), count: z.int() })),
  total: z.int(),
}).meta({ id: 'ReplayClickHeatmap' });

export type ReplayClickHeatmap = z.infer<typeof replayClickHeatmapSchema>;

/** 回放访问审计（谁查看了谁的录像） */
export const replayAccessLogSchema = z.object({
  id: z.int(),
  replayId: z.string(),
  replayOwner: z.string().nullable(),
  userId: z.int(),
  username: z.string().nullable(),
  action: z.string(),
  ip: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'ReplayAccessLog' });

export type ReplayAccessLog = z.infer<typeof replayAccessLogSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

const REPLAY_ID_EXAMPLE = '11111111-1111-4111-8111-111111111111';

/** `{id}` 路径参数：回放会话 ID（UUID） */
export const replayIdParam = z.object({
  id: z.uuid().meta({ description: '回放会话 ID', example: REPLAY_ID_EXAMPLE }),
});

export const replaySegmentParam = replayIdParam.extend({
  seq: z.coerce.number().int().min(0).meta({ description: '分片序号（从 0 计）', example: 0 }),
});

export const replayListQuery = paginationQuery.extend({
  status: queryEnum(REPLAY_STATUSES),
  mode: queryEnum(REPLAY_MODES),
  triggerType: queryEnum(REPLAY_TRIGGER_TYPES),
  keyword: z.string().optional().meta({ description: '匹配用户名 / 入口页 / 回放 ID / 会话 ID' }),
  hasError: queryBool('仅含错误的回放'),
  source: queryEnum(['web_admin', 'web_member']),
  pagePath: z.string().max(256).optional().meta({ description: '内容检索：访问过的页面路径（模糊）' }),
  clickLabel: z.string().max(64).optional().meta({ description: '内容检索：点击过的元素文案（模糊）' }),
});

export const replayHeatmapPagesQuery = z.object({ days: daysQuery(90, 30) });

export const replayHeatmapQuery = z.object({
  pagePath: z.string().min(1).max(256),
  days: daysQuery(90, 30),
});

export const replayAccessLogListQuery = paginationQuery.extend({
  replayId: z.uuid().optional(),
  keyword: z.string().optional(),
});

/** 批量删除的回放会话 ID 列表 */
export const replayIdsBody = z.object({
  ids: z.array(z.uuid()).min(1).max(100),
});

const replaySegmentUploadBody = multipart(z.object({
  meta: z.string().meta({ description: '分片元信息 JSON（形态见 replaySegmentUploadMetaSchema）' }),
  data: fileField('gzip 压缩的 rrweb 事件数组'),
}));

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const sessionReplayContract = defineContract('/api/session-replays', {
  ingestSegment: op.post('/segments', { body: replaySegmentUploadBody, public: true, summary: '上报回放分片（multipart：meta JSON + gzip 二进制）' }),
  list: op.get('/', { query: replayListQuery, response: paginated(replaySessionSchema), summary: '回放会话列表' }),
  stats: op.get('/stats', { response: replayStorageStatsSchema, summary: '回放存储统计（容量看板）' }),
  heatmapPages: op.get('/heatmap/pages', { query: replayHeatmapPagesQuery, response: z.array(z.string()), summary: '有点击热力数据的页面清单' }),
  heatmap: op.get('/heatmap', { query: replayHeatmapQuery, response: replayClickHeatmapSchema, summary: '页面点击热力聚合（2% 网格）' }),
  accessLogs: op.get('/access-logs', { query: replayAccessLogListQuery, response: paginated(replayAccessLogSchema), summary: '回放访问审计（谁查看了谁的录像）' }),
  removeBatch: op.delete('/batch', { body: replayIdsBody, summary: '批量删除回放会话' }),
  detail: op.get('/{id}', { params: replayIdParam, response: replaySessionDetailSchema, summary: '回放会话详情（含分片清单与关联错误）' }),
  segmentData: op.get('/{id}/segments/{seq}/data', {
    params: replaySegmentParam,
    kind: 'file',
    summary: '拉取回放分片数据（gzip JSON 透传）',
    description: '响应体为 Content-Encoding: gzip 的 JSON 事件数组，浏览器按编码自动解压。',
  }),
}, { tags: ['SessionReplays'] });
