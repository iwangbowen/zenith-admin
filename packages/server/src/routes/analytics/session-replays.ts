import { OpenAPIHono, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { ANALYTICS_SITE_KEY_HEADER, replaySegmentUploadMetaSchema, sessionReplayContract } from '@zenith/shared/analytics';
import { authMiddleware } from '../../middleware/auth';
import { optionalAuthMiddleware } from '../../middleware/optional-auth';
import { guard } from '../../middleware/guard';
import { namedRateLimit } from '../../middleware/rate-limit';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  ingestReplaySegment, listReplaySessions, getReplaySessionDetail, getReplaySegmentData, deleteReplaySessions,
  getReplayStorageStats, listHeatmapPages, getClickHeatmap, listReplayAccessLogs, REPLAY_SEGMENT_MAX_BYTES,
} from '../../services/analytics/session-replays.service';
import { getClientIp } from '../../lib/request-helpers';

const r = new OpenAPIHono({ defaultHook: validationHook });

const replayList = [authMiddleware, guard({ permission: 'monitor:replay:list' })] as const;
const replayManage = [authMiddleware, guard({ permission: 'monitor:replay:manage' })] as const;

// 回放分片为持续流式上报热点，meta 解析走 AOT 预编译换事件循环余量
// （在 server 使用点编译而非 shared 定义点，避免把 zod 编译器带进 web 包；strict 防未来改动静默退化）
const compiledReplaySegmentMeta = z.compile(replaySegmentUploadMetaSchema, { strict: true });

// ─── 上报（匿名/登录均可）─────────────────────────────────────────────────────
const ingestRoute = defineContractRoute(sessionReplayContract.ingestSegment, {
  middleware: [optionalAuthMiddleware, namedRateLimit('replay-ingest')],
  responses: { 400: { content: jsonContent(ErrorResponse), description: '参数或分片非法' } },
  handler: async (c) => {
    const body = await c.req.parseBody();
    let meta: unknown;
    try {
      meta = JSON.parse(String(body.meta ?? ''));
    } catch {
      throw new HTTPException(400, { message: 'meta 不是合法 JSON' });
    }
    const parsed = compiledReplaySegmentMeta.safeParse(meta);
    if (!parsed.success) throw new HTTPException(400, { message: `meta 校验失败：${parsed.error.issues[0]?.message ?? '未知错误'}` });
    const file = body.data;
    if (typeof (file as File)?.arrayBuffer !== 'function') throw new HTTPException(400, { message: '缺少分片数据' });
    if ((file as File).size > REPLAY_SEGMENT_MAX_BYTES) throw new HTTPException(400, { message: '分片超出大小上限' });
    const data = Buffer.from(await (file as File).arrayBuffer());
    await ingestReplaySegment(parsed.data, data, {
      ua: c.req.header('user-agent') ?? '',
      siteKey: c.req.header(ANALYTICS_SITE_KEY_HEADER) ?? null,
      origin: c.req.header('origin') ?? null,
    });
    return c.json(okBody(null, '上报成功'), 200);
  },
});

// ─── 查询 ─────────────────────────────────────────────────────────────────────
const listRoute = defineContractRoute(sessionReplayContract.list, {
  middleware: replayList,
  handler: async (c) => c.json(okBody(await listReplaySessions(c.req.valid('query'))), 200),
});

const statsRoute = defineContractRoute(sessionReplayContract.stats, {
  middleware: replayList,
  handler: async (c) => c.json(okBody(await getReplayStorageStats()), 200),
});

const heatmapPagesRoute = defineContractRoute(sessionReplayContract.heatmapPages, {
  middleware: replayList,
  handler: async (c) => c.json(okBody(await listHeatmapPages(c.req.valid('query').days)), 200),
});

const heatmapRoute = defineContractRoute(sessionReplayContract.heatmap, {
  middleware: replayList,
  handler: async (c) => {
    const q = c.req.valid('query');
    return c.json(okBody(await getClickHeatmap(q.pagePath, q.days)), 200);
  },
});

const detailRoute = defineContractRoute(sessionReplayContract.detail, {
  middleware: replayList,
  handler: async (c) => c.json(okBody(await getReplaySessionDetail(c.req.valid('param').id, getClientIp(c))), 200),
});

const accessLogsRoute = defineContractRoute(sessionReplayContract.accessLogs, {
  middleware: replayManage,
  handler: async (c) => c.json(okBody(await listReplayAccessLogs(c.req.valid('query'))), 200),
});

const segmentDataRoute = defineContractRoute(sessionReplayContract.segmentData, {
  middleware: replayList,
  handler: async (c) => {
    const { id, seq } = c.req.valid('param');
    const data = await getReplaySegmentData(id, seq);
    // gzip 原样透传：浏览器按 Content-Encoding 自动解压，服务端零解压开销
    return c.body(new Uint8Array(data).buffer as ArrayBuffer, 200, {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      'Cache-Control': 'private, max-age=3600',
    });
  },
});

const batchDeleteRoute = defineContractRoute(sessionReplayContract.removeBatch, {
  middleware: replayManage,
  handler: async (c) => {
    const n = await deleteReplaySessions(c.req.valid('json').ids);
    return c.json(okBody(null, `已删除 ${n} 条回放`), 200);
  },
});

r.openapiRoutes([ingestRoute, listRoute, statsRoute, heatmapPagesRoute, heatmapRoute, accessLogsRoute, batchDeleteRoute, detailRoute, segmentDataRoute] as const);

export default r;
