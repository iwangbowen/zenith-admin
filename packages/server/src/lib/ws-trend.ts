/**
 * WebSocket 连接趋势采样（进程内环形缓冲，不落库）。
 *
 * 与系统指标采样器同一个 tick（10 秒）：每帧记录一次集群聚合的连接态与周期增量，
 * 保留 1 小时（360 点），供「WebSocket 连接」页画趋势。进程重启后从头累积——
 * 连接态趋势只服务当下排障，不需要跨重启的历史，也不占用数据库。
 *
 * 增量口径见 shared 契约 `MonitorWsTrendPoint`：连接、断开、收发是相邻两帧计数器之差，
 * 计数器回退（本进程或任一远端节点重启）时**丢弃该帧**，宁缺不断线，不写入负值。
 */
import { isWsConnectionActive } from '@zenith/shared/platform';
import { metricsSampler } from './metrics-sampler';
import logger from './logger';
import { getWsClusterSnapshot } from './ws-manager';

/** 采样间隔：与 metricsSampler 的 tick 一致 */
export const WS_TREND_INTERVAL_SEC = 10;
/** 环形缓冲容量：360 × 10 秒 = 1 小时 */
export const WS_TREND_CAPACITY = 360;

export interface WsTrendPoint {
  t: number;
  connections: number;
  users: number;
  idle: number;
  connects: number;
  disconnects: number;
  sent: number;
  recv: number;
  failed: number;
}

interface CounterBaseline {
  connects: number;
  disconnects: number;
  sent: number;
  recv: number;
}

const points: WsTrendPoint[] = [];
let baseline: CounterBaseline | null = null;

/**
 * 采集一帧趋势点。首帧只建立计数器基线（返回 null）；
 * 计数器回退时丢弃本帧并重建基线，避免把重启造成的差值画成尖峰或负数。
 */
export function recordWsTrendSample(now: number = Date.now()): WsTrendPoint | null {
  const snap = getWsClusterSnapshot();
  const counters: CounterBaseline = {
    connects: snap.totalConnects,
    disconnects: snap.totalDisconnects,
    sent: snap.totalSent,
    recv: snap.totalRecv,
  };
  const prev = baseline;
  baseline = counters;
  if (!prev) return null;
  if (
    counters.connects < prev.connects
    || counters.disconnects < prev.disconnects
    || counters.sent < prev.sent
    || counters.recv < prev.recv
  ) {
    return null;
  }

  const point: WsTrendPoint = {
    t: now,
    connections: snap.currentConnections,
    users: snap.currentUsers,
    idle: snap.connections.filter((c) => !isWsConnectionActive(c.lastActivityAt, now)).length,
    connects: counters.connects - prev.connects,
    disconnects: counters.disconnects - prev.disconnects,
    sent: counters.sent - prev.sent,
    recv: counters.recv - prev.recv,
    // 失败明细没有累计计数器可差分，取采样窗口内的失败条数（口径见契约）
    failed: snap.messages.filter((m) => !m.success).length,
  };
  points.push(point);
  if (points.length > WS_TREND_CAPACITY) points.shift();
  return point;
}

/** 趋势点（按时间升序）；服务启动初期不足容量 */
export function getWsTrend(): { intervalSec: number; capacity: number; points: WsTrendPoint[] } {
  return { intervalSec: WS_TREND_INTERVAL_SEC, capacity: WS_TREND_CAPACITY, points: points.slice() };
}

/** 仅供测试与热重载：清空缓冲与基线 */
export function resetWsTrend(): void {
  points.length = 0;
  baseline = null;
}

let subscribed = false;

/**
 * 挂到系统指标采样器的 tick 上（api 进程启动时调用一次）。
 * 只有 api 持有连接、也才有节点镜像可合并，worker 采样没有意义。
 */
export function startWsTrendSampling(): void {
  if (subscribed) return;
  subscribed = true;
  metricsSampler.subscribe(() => {
    try {
      recordWsTrendSample();
    } catch (err) {
      logger.warn('[ws-trend] sample failed', { err: String(err) });
    }
  });
}
