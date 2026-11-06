/**
 * Zenith 业务/系统指标 → Prometheus 导出。
 * 将采样器（metricsSampler）、WebSocket 管理器的即时指标以 Gauge/Counter 形式
 * 注册到 @hono/prometheus 使用的同一个 Registry，由已有的 `GET /metrics`
 * 端点统一输出（text exposition 格式），可直接接入 Prometheus / Grafana。
 * 所有指标通过 prom-client 的 collect() 钩子在抓取时惰性求值，零常驻开销。
 */
import { Counter, Gauge, type Registry } from 'prom-client';
import { config } from '../config';
import { metricsSampler } from './metrics-sampler';
import { countActiveWorkerNodes, getQueueDepthSnapshot } from './pg-boss-scheduler';
import { getWsFanoutCounters } from './ws-fanout';
import { getWsSnapshot } from './ws-manager';
import { apiAccessLogStats } from './api-access-log';
import type { WorkflowJobRuntimeStatus } from '@zenith/shared/workflow';

let workflowMetricsCache: { until: number; value: Promise<WorkflowJobRuntimeStatus> } | null = null;
function workflowMetrics(): Promise<WorkflowJobRuntimeStatus> {
  if (!workflowMetricsCache || workflowMetricsCache.until < Date.now()) {
    workflowMetricsCache = { until: Date.now() + 5000,
      value: import('../services/workflow/workflow-jobs.service').then(({ getWorkflowJobRuntimeStatus }) => getWorkflowJobRuntimeStatus()) };
  }
  return workflowMetricsCache.value;
}

export function registerZenithMetrics(registry: Registry): void {
  // 进程角色作为全局标签：api / worker 拆分部署后同一指标名来自不同角色，抓取端按 process_role 区分
  registry.setDefaultLabels({ process_role: config.roles.label });
  const gauge = (name: string, help: string, fn: () => number | null | undefined) => {
    new Gauge({
      name,
      help,
      registers: [registry],
      collect() {
        const value = fn();
        this.reset();
        if (value !== null && value !== undefined && Number.isFinite(value)) this.set(value);
      },
    });
  };
  const counter = (name: string, help: string, fn: () => number) => {
    let previous = 0;
    new Counter({
      name,
      help,
      registers: [registry],
      collect() {
        const current = Math.max(0, fn());
        // Source counters are process-local and can reset after a restart. Treat
        // a reset as a new baseline instead of exporting a negative delta.
        if (current >= previous) this.inc(current - previous);
        previous = current;
      },
    });
  };

  const latest = () => metricsSampler.getLatest();

  // ── 系统资源 ──
  gauge('zenith_cpu_usage_percent', 'System CPU usage percent (0-100)', () => latest()?.cpu);
  gauge('zenith_memory_usage_percent', 'System memory usage percent (0-100)', () => latest()?.mem);
  gauge('zenith_process_cpu_percent', 'Node process CPU percent (100 = one core)', () => latest()?.procCpu);
  gauge('zenith_heap_usage_percent', 'Node heap usage percent (0-100)', () => latest()?.heap);
  gauge('zenith_event_loop_lag_mean_ms', 'Event loop delay mean (ms)', () => latest()?.loopLagMean);
  gauge('zenith_event_loop_lag_p99_ms', 'Event loop delay p99 (ms)', () => latest()?.loopLagP99);
  gauge('zenith_event_loop_lag_max_ms', 'Event loop delay window max (ms)', () => latest()?.loopLagMax);

  // ── 网络 / 磁盘吞吐 ──
  gauge('zenith_net_rx_bytes_per_second', 'Aggregate network receive throughput (B/s)', () => latest()?.netRxBps);
  gauge('zenith_net_tx_bytes_per_second', 'Aggregate network transmit throughput (B/s)', () => latest()?.netTxBps);
  gauge('zenith_disk_read_bytes_per_second', 'Aggregate disk read throughput (B/s)', () => latest()?.diskReadBps);
  gauge('zenith_disk_write_bytes_per_second', 'Aggregate disk write throughput (B/s)', () => latest()?.diskWriteBps);

  // ── HTTP ──
  gauge('zenith_http_qps', 'Average QPS over the last 60s window', () => {
    const stats = metricsSampler.http.windowStats(60);
    return stats.total > 0 ? stats.qps : null;
  });
  gauge('zenith_http_error_rate_percent', 'HTTP error rate percent over the last 60s window', () => {
    const stats = metricsSampler.http.windowStats(60);
    return stats.total > 0 ? stats.errorRate : null;
  });
  counter('zenith_http_requests_total', 'Total HTTP requests since process start', () => metricsSampler.http.totals().total);
  counter('zenith_http_errors_4xx_total', 'Total HTTP 4xx responses since process start', () => metricsSampler.http.totals().total4xx);
  counter('zenith_http_errors_5xx_total', 'Total HTTP 5xx responses since process start', () => metricsSampler.http.totals().total5xx);
  gauge('zenith_api_access_log_pending', 'Buffered API access records awaiting persistence', () => apiAccessLogStats().pending);
  counter('zenith_api_access_log_dropped_total', 'API access records dropped since process start', () => apiAccessLogStats().dropped);
  counter('zenith_api_access_log_flush_failures_total', 'Failed API access log batches since process start', () => apiAccessLogStats().flushFailures);

  // ── WebSocket ──
  gauge('zenith_ws_connections', 'Current WebSocket connections', () => getWsSnapshot().currentConnections);
  gauge('zenith_ws_users', 'Current distinct WebSocket users', () => getWsSnapshot().currentUsers);
  // 跨进程 fan-out：published 为本进程发出的信封数，delivered / dropped 为本进程作为订阅方的处理结果
  counter('zenith_ws_fanout_published_total', 'WS fan-out envelopes published by this process', () => getWsFanoutCounters().published);
  counter('zenith_ws_fanout_publish_failed_total', 'WS fan-out envelopes that failed to publish', () => getWsFanoutCounters().publishFailed);
  counter('zenith_ws_fanout_delivered_total', 'WS fan-out envelopes handled by this process', () => getWsFanoutCounters().delivered);
  counter('zenith_ws_fanout_dropped_total', 'WS fan-out envelopes dropped (malformed / no handler / handler error)', () => getWsFanoutCounters().dropped);
  counter('zenith_ws_sent_frames_total', 'WebSocket frames written by this process', () => getWsSnapshot().totalSent);
  counter('zenith_ws_received_frames_total', 'WebSocket frames received by this process', () => getWsSnapshot().totalRecv);
  counter('zenith_ws_sent_bytes_total', 'WebSocket bytes written by this process', () => getWsSnapshot().totalSentBytes);
  counter('zenith_ws_received_bytes_total', 'WebSocket bytes received by this process', () => getWsSnapshot().totalRecvBytes);
  counter('zenith_ws_write_failures_total', 'WebSocket frame write failures in this process', () => getWsSnapshot().totalWriteFailures);
  counter('zenith_ws_parse_failures_total', 'WebSocket inbound parse or protocol validation failures in this process', () => getWsSnapshot().totalParseFailures);
  counter('zenith_ws_heartbeat_failures_total', 'WebSocket heartbeat failures in this process', () => getWsSnapshot().totalHeartbeatFailures);

  // ── DB / Redis（外部采集器提供；未采样/失败时不导出伪造 0） ──
  gauge('zenith_db_connections', 'PostgreSQL connections to current database', () => latest()?.dbConnections);
  gauge('zenith_redis_memory_bytes', 'Redis used memory in bytes', () => latest()?.redisMemBytes);
  gauge('zenith_redis_hit_rate_percent', 'Redis keyspace hit rate percent (sampling window delta)', () => latest()?.redisHitRate);

  // ── 后台调度（api / worker 拆分部署的执行面）──
  // 抓取时异步取数：队列读数来自 pg-boss 在 pgboss.queue 上的缓存统计（进程内再缓存 10s），worker 数来自节点心跳表。
  // 取数失败清空本次 gauge，避免过期值被 HPA / 告警误当成实时积压或在线 worker。
  new Gauge({
    name: 'zenith_pgboss_queue_jobs',
    help: 'pg-boss jobs per queue and state (ready = runnable now, the worker scaling signal; deferred = start_after in the future; failed = retained recent failures)',
    labelNames: ['queue', 'state'],
    registers: [registry],
    async collect() {
      const snapshot = await getQueueDepthSnapshot().catch(() => null);
      this.reset();
      if (!snapshot || snapshot.status !== 'ok' || !snapshot.queues) return;
      for (const d of snapshot.queues) {
        this.set({ queue: d.queue, state: 'ready' }, d.ready);
        this.set({ queue: d.queue, state: 'deferred' }, d.deferred);
        this.set({ queue: d.queue, state: 'active' }, d.active);
        this.set({ queue: d.queue, state: 'failed' }, d.failed);
        this.set({ queue: d.queue, state: 'total' }, d.total);
      }
    },
  });
  new Gauge({
    name: 'zenith_scheduler_worker_nodes',
    help: 'Worker-role processes with a recent scheduler heartbeat (0 = queued jobs have no executor)',
    registers: [registry],
    async collect() {
      this.reset();
      try {
        this.set(await countActiveWorkerNodes());
      } catch {
        /* unavailable: do not retain a stale worker count */
      }
    },
  });
  new Gauge({
    name: 'zenith_workflow_ledger_jobs',
    help: 'Business workflow ledger jobs, excluding coalesced hints and human approvals',
    labelNames: ['state'], registers: [registry],
    async collect() {
      this.reset();
      try {
        const metrics = await workflowMetrics();
        this.set({ state: 'due' }, metrics.backlog);
        this.set({ state: 'running' }, metrics.runningJobs);
        this.set({ state: 'expired' }, metrics.stuckRunningJobs);
        this.set({ state: 'dead' }, metrics.deadLetter);
        this.set({ state: 'slots' }, metrics.totalSlots);
        this.set({ state: 'active_slots' }, metrics.activeSlots);
      } catch { /* unavailable: do not retain stale samples */ }
    },
  });
  new Gauge({
    name: 'zenith_workflow_ledger_oldest_due_seconds',
    help: 'Age of the oldest due business job; excludes future timers and human approvals',
    registers: [registry],
    async collect() {
      this.reset();
      try {
        const value = (await workflowMetrics()).oldestDueSeconds;
        if (value !== null && value !== undefined) this.set(value);
      } catch { /* unavailable: do not retain stale samples */ }
    },
  });
  new Gauge({
    name: 'zenith_workflow_ledger_queue_wait_ms',
    help: 'Business ledger due-to-claim latency quantiles over the last hour',
    labelNames: ['quantile'], registers: [registry],
    async collect() {
      this.reset();
      try {
        const metrics = await workflowMetrics();
        if (metrics.queueP95Ms != null) this.set({ quantile: '0.95' }, metrics.queueP95Ms);
        if (metrics.queueP99Ms != null) this.set({ quantile: '0.99' }, metrics.queueP99Ms);
      } catch { /* unavailable: do not retain stale samples */ }
    },
  });
}
