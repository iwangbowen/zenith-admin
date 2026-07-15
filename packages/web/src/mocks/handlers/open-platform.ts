import { http, HttpResponse } from 'msw';
import {
  OPEN_SIGNATURE_ALGORITHM,
  OPEN_SIGNATURE_TIMESTAMP_WINDOW,
  OPEN_SIGNATURE_HEADERS,
} from '@zenith/shared';
import type { OpenApiCallLog } from '@zenith/shared';
import { mockOpenApiLogs } from '@/mocks/data/open-api-logs';
import dayjs from 'dayjs';

const ok = (data: unknown, message = 'success') => HttpResponse.json({ code: 0, message, data });

function inRange(log: OpenApiCallLog, start: string | null, end: string | null): boolean {
  if (start && log.createdAt < start) return false;
  if (end && log.createdAt > end) return false;
  return true;
}

function filtered(url: URL): OpenApiCallLog[] {
  const start = url.searchParams.get('startTime');
  const end = url.searchParams.get('endTime');
  const clientId = url.searchParams.get('clientId');
  const keyword = url.searchParams.get('keyword')?.toLowerCase();
  const method = url.searchParams.get('method');
  const success = url.searchParams.get('success');
  const statusCode = url.searchParams.get('statusCode');
  const environment = url.searchParams.get('environment');
  return mockOpenApiLogs.filter((log) =>
    inRange(log, start, end)
    && (!clientId || log.clientId === clientId)
    && (!keyword || log.path.toLowerCase().includes(keyword) || (log.appName ?? '').toLowerCase().includes(keyword))
    && (!method || log.method === method)
    && (success === null || log.success === (success === 'true'))
    && (!statusCode || log.statusCode === Number(statusCode))
    && (!environment || log.environment === environment),
  );
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

/** 简单确定性伪签名（仅用于 Demo，无后端时计算签名） */
function pseudoSign(input: string): string {
  let h = 0x811c9dc5;
  let out = '';
  for (let round = 0; round < 8; round++) {
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, '0');
    h = (h ^ round) >>> 0;
  }
  return out;
}

export const openPlatformHandlers = [
  // ─── 调用统计 ──────────────────────────────────────────────────────────────
  http.get('/api/open-api-stats/overview', ({ request }) => {
    const logs = filtered(new URL(request.url));
    const total = logs.length;
    const success = logs.filter((l) => l.success).length;
    const today = dayjs().format('YYYY-MM-DD');
    const avg = total ? Math.round(logs.reduce((s, l) => s + l.durationMs, 0) / total) : 0;
    return ok({
      totalCalls: total,
      successCalls: success,
      failedCalls: total - success,
      successRate: total ? Math.round((success / total) * 10000) / 100 : 0,
      avgDurationMs: avg,
      p95DurationMs: percentile(logs.map((log) => log.durationMs), 0.95),
      p99DurationMs: percentile(logs.map((log) => log.durationMs), 0.99),
      activeApps: new Set(logs.map((l) => l.clientId)).size,
      todayCalls: logs.filter((l) => l.createdAt.startsWith(today)).length,
    });
  }),

  http.get('/api/open-api-stats/trend', ({ request }) => {
    const url = new URL(request.url);
    const granularity = url.searchParams.get('granularity') ?? 'day';
    const logs = filtered(url);
    const map = new Map<string, { total: number; success: number }>();
    for (const l of logs) {
      const key = granularity === 'hour' ? `${l.createdAt.slice(0, 13)}:00:00` : l.createdAt.slice(0, 10);
      const e = map.get(key) ?? { total: 0, success: 0 };
      e.total += 1;
      if (l.success) e.success += 1;
      map.set(key, e);
    }
    const data = [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([time, v]) => ({ time, total: v.total, success: v.success, failed: v.total - v.success }));
    return ok(data);
  }),

  http.get('/api/open-api-stats/by-app', ({ request }) => {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') ?? 10);
    return ok(groupBy(filtered(url), (l) => l.clientId, (l) => l.appName ?? l.clientId, limit));
  }),

  http.get('/api/open-api-stats/by-endpoint', ({ request }) => {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') ?? 10);
    return ok(groupBy(filtered(url), (l) => l.path, (l) => l.path, limit));
  }),

  http.get('/api/open-api-stats/logs', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 10);
    const logs = filtered(url);
    const start = (page - 1) * pageSize;
    return ok({ list: logs.slice(start, start + pageSize), total: logs.length, page, pageSize });
  }),

  // ─── 签名验签工具 ──────────────────────────────────────────────────────────
  http.get('/api/open-signature/algorithm', () => ok({
    algorithm: OPEN_SIGNATURE_ALGORITHM,
    timestampWindow: OPEN_SIGNATURE_TIMESTAMP_WINDOW,
    headers: {
      appKey: OPEN_SIGNATURE_HEADERS.appKey,
      timestamp: OPEN_SIGNATURE_HEADERS.timestamp,
      nonce: OPEN_SIGNATURE_HEADERS.nonce,
      signature: OPEN_SIGNATURE_HEADERS.signature,
    },
    stringToSignFormat: 'METHOD\\nPATH\\nCANONICAL_QUERY\\nTIMESTAMP\\nNONCE\\nSHA256_HEX(BODY)',
    steps: [
      '1. 规整 query：按参数名排序后以 k=v&k=v 拼接（无 query 则为空字符串）',
      '2. 计算请求体的 SHA-256 十六进制摘要（无 body 则对空字符串求摘要）',
      '3. 以换行符顺序拼接 METHOD、PATH、CANONICAL_QUERY、TIMESTAMP、NONCE、BODY_HASH 得到待签名串',
      '4. 用 AppSecret 作为密钥对待签名串做 HMAC-SHA256，输出十六进制即 X-Signature',
      '5. 请求时携带 X-App-Key、X-Timestamp（秒级）、X-Nonce（随机串）、X-Signature 四个请求头',
    ],
  })),

  http.post('/api/open-signature/verify', async ({ request }) => {
    const body = (await request.json()) as Record<string, string>;
    const canonicalQuery = (body.query ?? '')
      .split('&')
      .filter(Boolean)
      .sort()
      .join('&');
    const stringToSign = [
      (body.method ?? 'GET').toUpperCase(),
      body.path ?? '',
      canonicalQuery,
      body.timestamp ?? '',
      body.nonce ?? '',
      pseudoSign(body.body ?? ''),
    ].join('\n');
    const signature = pseudoSign(`${body.appKey}:${stringToSign}`);
    const matched = body.signature ? body.signature === signature : undefined;
    return ok({ signature, stringToSign, matched });
  }),
];

function groupBy(
  logs: OpenApiCallLog[],
  keyFn: (l: OpenApiCallLog) => string,
  labelFn: (l: OpenApiCallLog) => string,
  limit: number,
) {
  const map = new Map<string, { label: string; total: number; success: number; dur: number }>();
  for (const l of logs) {
    const key = keyFn(l);
    const e = map.get(key) ?? { label: labelFn(l), total: 0, success: 0, dur: 0 };
    e.total += 1;
    e.dur += l.durationMs;
    if (l.success) e.success += 1;
    map.set(key, e);
  }
  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      label: v.label,
      total: v.total,
      success: v.success,
      failed: v.total - v.success,
      avgDurationMs: Math.round(v.dur / v.total),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}
