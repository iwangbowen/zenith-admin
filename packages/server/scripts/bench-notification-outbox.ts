/**
 * 通知 outbox 补投基准：在本地库里写入 N 条待派发事件，用假 webhook 适配器（固定延迟、不出网）
 * 模拟渠道出站耗时，跑 `dispatchPendingNotifications()` 直到全部派发完成，记录：
 * 总耗时、吞吐（行 / 秒）、单次调用处理的行数、同时在飞的渠道投递峰值（进程内实际并发）。
 *
 * 用法（packages/server 目录，需 .env 指向可写的本地库、Redis 可用）：
 *   npx tsx scripts/bench-notification-outbox.ts                                  # 200 行 × 单收件人，渠道延迟 300ms
 *   npx tsx scripts/bench-notification-outbox.ts --rows 200 --fanout 1 --latency 300 --out ../../docs/backend/perf/notification-outbox.json
 *   npx tsx scripts/bench-notification-outbox.ts --rows 40 --fanout 25 --latency 300     # 大扇出：每行 25 个收件人
 *
 * 基准行带独立 traceId，结束后连同派发留痕一起清理，不影响真实通知。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../src/db';
import { notificationDispatches, notificationOutbox } from '../src/db/schema';
import { registerNotificationAdapter } from '../src/lib/notification/registry';
import { runWithTraceId } from '../src/lib/context';
import { dispatchPendingNotifications, notifyWithin } from '../src/services/messaging/notification-outbox.service';
import { arg } from './lib/cli-args';

const ROWS = Number(arg('rows', '200'));
const FANOUT = Number(arg('fanout', '1'));
const LATENCY_MS = Number(arg('latency', '300'));
const OUT = arg('out', '');
const TRACE_ID = `bench-outbox-${Date.now().toString(36)}`;

// ─── 假 webhook 适配器：固定延迟，统计在飞并发 ───────────────────────────────
let inFlight = 0;
let peakInFlight = 0;
let sends = 0;
registerNotificationAdapter({
  channel: 'webhook',
  async resolveAddress(recipient) {
    return recipient.type === 'external' && recipient.channel === 'webhook' ? recipient.address : null;
  },
  async send() {
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    sends += 1;
    await new Promise((r) => setTimeout(r, LATENCY_MS));
    inFlight -= 1;
    return {};
  },
});

async function seed(): Promise<number[]> {
  const ids: number[] = [];
  await runWithTraceId(TRACE_ID, async () => {
    for (let i = 0; i < ROWS; i++) {
      const recipients = Array.from({ length: FANOUT }, (_, k) => ({
        type: 'external' as const,
        channel: 'webhook' as const,
        address: `https://bench.invalid/hook/${i}/${k}`,
      }));
      const id = await notifyWithin(db, 'ops.monitor.alert_test', {
        recipients,
        vars: { ruleName: `bench-${i}`, message: 'benchmark' },
        channelPolicy: { only: ['webhook'] },
        channelOptions: { webhook: { url: `https://bench.invalid/hook/${i}`, body: null } },
        // 用 scheduledAt 略早于现在，避免 notify() 的立即派发路径；这里只测 cron 补投
        scheduledAt: new Date(Date.now() - 1000),
      });
      if (id !== null) ids.push(id);
    }
  });
  return ids;
}

async function cleanup(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(notificationDispatches).where(inArray(notificationDispatches.outboxId, ids));
  await db.delete(notificationOutbox).where(eq(notificationOutbox.traceId, TRACE_ID));
}

async function pendingCount(ids: number[]): Promise<number> {
  const rows = await db.select({ status: notificationOutbox.status }).from(notificationOutbox).where(inArray(notificationOutbox.id, ids));
  return rows.filter((r) => r.status === 'pending').length;
}

async function main(): Promise<void> {
  const ids = await seed();
  console.log(`已写入 ${ids.length} 条基准事件（每行 ${FANOUT} 个收件人，渠道延迟 ${LATENCY_MS}ms）`);
  const calls: { rows: number; ms: number }[] = [];
  const started = performance.now();
  try {
    // 模拟 cron 连续触发：每次调用即一轮补投，直到全部派发
    for (let i = 0; i < 100; i++) {
      const t = performance.now();
      const processed = await dispatchPendingNotifications();
      calls.push({ rows: processed, ms: Math.round(performance.now() - t) });
      if (await pendingCount(ids) === 0) break;
      if (processed === 0) break;
    }
  } finally {
    const totalMs = Math.round(performance.now() - started);
    const remaining = await pendingCount(ids);
    const result = {
      generatedAt: new Date().toISOString(),
      params: { rows: ROWS, fanout: FANOUT, latencyMs: LATENCY_MS },
      totalMs,
      rowsPerSecond: Number((ids.length / (totalMs / 1000)).toFixed(1)),
      deliveries: sends,
      peakConcurrentDeliveries: peakInFlight,
      cronCalls: calls.length,
      rowsPerCall: calls.map((c) => c.rows),
      msPerCall: calls.map((c) => c.ms),
      remainingPending: remaining,
    };
    console.log(JSON.stringify(result, null, 2));
    if (OUT) {
      const file = resolve(OUT);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
      console.log(`已写入 ${file}`);
    }
    await cleanup(ids);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
