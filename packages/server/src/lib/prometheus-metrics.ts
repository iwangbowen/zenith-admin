/**
 * Zenith 业务/系统指标 → Prometheus 导出。
 * 将采样器（metricsSampler）、WebSocket 管理器的即时指标以 Gauge/Counter 形式
 * 注册到 @hono/prometheus 使用的同一个 Registry，由已有的 `GET /metrics`
 * 端点统一输出（text exposition 格式），可直接接入 Prometheus / Grafana。
 * 所有指标通过 prom-client 的 collect() 钩子在抓取时惰性求值，零常驻开销。
 */
import { Gauge, type Registry } from 'prom-client';
import { config } from '../config';
import { metricsSampler } from './metrics-sampler';
import { countActiveWorkerNodes, getQueueDepths } from './pg-boss-scheduler';
import { getWsFanoutCounters } from './ws-fanout';
import { getWsSnapshot } from './ws-manager';

export function registerZenithMetrics(registry: Registry): void {
  // 进程角色作为全局标签：api / worker 拆分部署后同一指标名来自不同角色，抓取端按 process_role 区分
  registry.setDefaultLabels({ process_role: config.roles.label });
  const gauge = (name: string, help: string, fn: () => number) => {
    new Gauge({
      name,
      help,
      registers: [registry],
      collect() {
        this.set(fn());
      },
    });
  };

  const latest = () => metricsSampler.getLatest();

  // ── 系统资源 ──
  gauge('zenith_cpu_usage_percent', 'System CPU usage percent (0-100)', () => latest()?.cpu ?? 0);
  gauge('zenith_memory_usage_percent', 'System memory usage percent (0-100)', () => latest()?.mem ?? 0);
  gauge('zenith_process_cpu_percent', 'Node process CPU percent (100 = one core)', () => latest()?.procCpu ?? 0);
  gauge('zenith_heap_usage_percent', 'Node heap usage percent (0-100)', () => latest()?.heap ?? 0);
  gauge('zenith_event_loop_lag_mean_ms', 'Event loop delay mean (ms)', () => latest()?.loopLagMean ?? 0);
  gauge('zenith_event_loop_lag_p99_ms', 'Event loop delay p99 (ms)', () => latest()?.loopLagP99 ?? 0);
  gauge('zenith_event_loop_lag_max_ms', 'Event loop delay window max (ms)', () => latest()?.loopLagMax ?? 0);

  // ── 网络 / 磁盘吞吐 ──
  gauge('zenith_net_rx_bytes_per_second', 'Aggregate network receive throughput (B/s)', () => latest()?.netRxBps ?? 0);
  gauge('zenith_net_tx_bytes_per_second', 'Aggregate network transmit throughput (B/s)', () => latest()?.netTxBps ?? 0);
  gauge('zenith_disk_read_bytes_per_second', 'Aggregate disk read throughput (B/s)', () => latest()?.diskReadBps ?? 0);
  gauge('zenith_disk_write_bytes_per_second', 'Aggregate disk write throughput (B/s)', () => latest()?.diskWriteBps ?? 0);

  // ── HTTP ──
  gauge('zenith_http_qps', 'Average QPS over the last 60s window', () => latest()?.qps ?? 0);
  gauge('zenith_http_error_rate_percent', 'HTTP error rate percent over the last 60s window', () => latest()?.errorRate ?? 0);
  gauge('zenith_http_requests_total', 'Total HTTP requests since process start', () => metricsSampler.http.totals().total);
  gauge('zenith_http_errors_4xx_total', 'Total HTTP 4xx responses since process start', () => metricsSampler.http.totals().total4xx);
  gauge('zenith_http_errors_5xx_total', 'Total HTTP 5xx responses since process start', () => metricsSampler.http.totals().total5xx);

  // ── WebSocket ──
  gauge('zenith_ws_connections', 'Current WebSocket connections', () => getWsSnapshot().currentConnections);
  gauge('zenith_ws_users', 'Current distinct WebSocket users', () => getWsSnapshot().currentUsers);
  // 跨进程 fan-out：published 为本进程发出的信封数，delivered / dropped 为本进程作为订阅方的处理结果
  gauge('zenith_ws_fanout_published_total', 'WS fan-out envelopes published by this process', () => getWsFanoutCounters().published);
  gauge('zenith_ws_fanout_publish_failed_total', 'WS fan-out envelopes that failed to publish', () => getWsFanoutCounters().publishFailed);
  gauge('zenith_ws_fanout_delivered_total', 'WS fan-out envelopes handled by this process', () => getWsFanoutCounters().delivered);
  gauge('zenith_ws_fanout_dropped_total', 'WS fan-out envelopes dropped (malformed / no handler / handler error)', () => getWsFanoutCounters().dropped);

  // ── DB / Redis（外部采集器提供，缺省 0） ──
  gauge('zenith_db_connections', 'PostgreSQL connections to current database', () => latest()?.dbConnections ?? 0);
  gauge('zenith_redis_memory_bytes', 'Redis used memory in bytes', () => latest()?.redisMemBytes ?? 0);
  gauge('zenith_redis_hit_rate_percent', 'Redis keyspace hit rate percent (sampling window delta)', () => latest()?.redisHitRate ?? 0);

  // ── 后台调度（api / worker 拆分部署的执行面）──
  // 抓取时异步取数：队列读数来自 pg-boss 在 pgboss.queue 上的缓存统计（进程内再缓存 10s），worker 数来自节点心跳表。
  // 取数失败保留上一次值而不是归零，避免抓取抖动被 HPA / 告警当成「积压清空 / worker 全没了」。
  new Gauge({
    name: 'zenith_pgboss_queue_jobs',
    help: 'pg-boss jobs per queue and state (ready = runnable now, the worker scaling signal; deferred = start_after in the future; failed = retained recent failures)',
    labelNames: ['queue', 'state'],
    registers: [registry],
    async collect() {
      let depths;
      try {
        depths = await getQueueDepths();
      } catch {
        return;
      }
      this.reset();
      for (const d of depths) {
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
      try {
        this.set(await countActiveWorkerNodes());
      } catch {
        /* keep last value */
      }
    },
  });
}
