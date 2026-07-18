/**
 * Zenith 业务/系统指标 → Prometheus 导出。
 * 将采样器（metricsSampler）、WebSocket 管理器的即时指标以 Gauge/Counter 形式
 * 注册到 @hono/prometheus 使用的同一个 Registry，由已有的 `GET /metrics`
 * 端点统一输出（text exposition 格式），可直接接入 Prometheus / Grafana。
 * 所有指标通过 prom-client 的 collect() 钩子在抓取时惰性求值，零常驻开销。
 */
import { Gauge, type Registry } from 'prom-client';
import { metricsSampler } from './metrics-sampler';
import { getWsSnapshot } from './ws-manager';

export function registerZenithMetrics(registry: Registry): void {
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

  // ── DB / Redis（外部采集器提供，缺省 0） ──
  gauge('zenith_db_connections', 'PostgreSQL connections to current database', () => latest()?.dbConnections ?? 0);
  gauge('zenith_redis_memory_bytes', 'Redis used memory in bytes', () => latest()?.redisMemBytes ?? 0);
  gauge('zenith_redis_hit_rate_percent', 'Redis keyspace hit rate percent (sampling window delta)', () => latest()?.redisHitRate ?? 0);
}
