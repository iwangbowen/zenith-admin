/**
 * WebSocket 连接趋势采样。
 *
 * 与系统指标采样器同一个 tick（10 秒）：每帧记录一次集群聚合的连接态与周期增量，
 * 进程内环形缓冲保留 1 小时（360 点），供「WebSocket 连接」页的近实时曲线；
 * 同一份数据由每分钟的落库任务经 `takeWsTrendWindow` 聚合下沉到 `ws_metric_samples`，
 * 支撑 24 小时 / 7 天范围的历史回溯（进程重启只影响环形缓冲，不影响已落库的历史）。
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
/** 已经下沉到 ws_metric_samples 的最后一个点时间戳；0 = 尚未下沉过任何点 */
let persistedThrough = 0;

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

/** 落库用的分钟窗口聚合行（列与 `ws_metric_samples` 对齐） */
export interface WsTrendSample {
  sampledAt: Date;
  connections: number;
  users: number;
  idle: number;
  connects: number;
  disconnects: number;
  sent: number;
  recv: number;
  failed: number;
}

/**
 * 取走上一个持久化点之后积累的采样窗口，聚合成一条待落库的采样行并推进游标。
 *
 * 由每分钟的落库任务调用；没有新点、或窗口不足一个采样周期（进程刚启动）时返回 null ——
 * 此时**不推进游标**，下一分钟会把这几帧一起聚合，不会下载半截窗口把增量算少。
 * 瞬时列取窗口末值，增量为窗口内之和，失败取窗口内峰值（该列本身是采样窗口口径）。
 */
export function takeWsTrendWindow(): WsTrendSample | null {
  const fresh = points.filter((point) => point.t > persistedThrough);
  if (fresh.length < 2) return null;
  const last = fresh[fresh.length - 1];
  persistedThrough = last.t;
  const sum = (pick: (point: WsTrendPoint) => number) => fresh.reduce((total, point) => total + pick(point), 0);
  return {
    sampledAt: new Date(last.t),
    connections: last.connections,
    users: last.users,
    idle: last.idle,
    connects: sum((point) => point.connects),
    disconnects: sum((point) => point.disconnects),
    sent: sum((point) => point.sent),
    recv: sum((point) => point.recv),
    failed: Math.max(...fresh.map((point) => point.failed)),
  };
}

/** 仅供测试与热重载：清空缓冲、基线与落库游标 */
export function resetWsTrend(): void {
  points.length = 0;
  baseline = null;
  persistedThrough = 0;
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
