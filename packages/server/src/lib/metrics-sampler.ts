/**
 * 系统/进程指标后台采样器（单例）。
 *
 * 设计动机：
 * - 旧实现 `getCpuUsage()` 在每次 HTTP 请求中阻塞 500ms 计算 CPU 使用率，多人打开
 *   监控页时会显著放大开销。
 * - 现改为后台周期采样（默认每 10s 一次），HTTP 接口直接读取最新快照，零阻塞。
 * - 同时维护时序环形缓冲（默认 360 点 / 1h），供前端绘制趋势折线图。
 * - Event Loop Lag、GC、HTTP QPS·P95、每核 CPU、网络吞吐 等深度指标统一在此采集。
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { performance, PerformanceObserver, monitorEventLoopDelay, constants as perfConstants } from 'node:perf_hooks';
import type { IntervalHistogram } from 'node:perf_hooks';
import logger from './logger';

// ─── 类型 ───────────────────────────────────────────────────────────────
export interface MetricsSample {
  /** 采样时间戳（毫秒） */
  t: number;
  /** 系统总 CPU 使用率（0-100，整数） */
  cpu: number;
  /** 内存使用率（0-100） */
  mem: number;
  /** Node 进程 CPU 占比（user+system，0-100，超过单核 100% 表示多核） */
  procCpu: number;
  /** Node 堆内存使用率（0-100） */
  heap: number;
  /** Event loop 延迟均值（毫秒） */
  loopLagMean: number;
  /** Event loop 延迟 P99（毫秒） */
  loopLagP99: number;
  /** 1 秒级 QPS（最近 1s 的请求数） */
  qps: number;
  /** 错误率（0-100，最近窗口内 status>=400 占比） */
  errorRate: number;
  /** 汇总网络读字节/秒 */
  netRxBps: number;
  /** 汇总网络写字节/秒 */
  netTxBps: number;
  /** 磁盘读字节/秒（汇总物理设备）*/
  diskReadBps: number;
  /** 磁盘写字节/秒（汇总物理设备）*/
  diskWriteBps: number;
  /** 数据库总连接数（外部采集器提供，滞后一个采样周期） */
  dbConnections?: number;
  /** Redis 已用内存字节（外部采集器提供） */
  redisMemBytes?: number;
  /** Redis 窗口命中率 0-100（外部采集器提供，基于两次采样间 delta） */
  redisHitRate?: number;
}

export interface PerCoreCpu {
  index: number;
  usage: number;
  user: number;
  system: number;
  idle: number;
}

export interface NetIfaceStats {
  name: string;
  rxBytes: number;
  txBytes: number;
  rxBps: number;
  txBps: number;
  rxPackets: number;
  txPackets: number;
  rxErrors: number;
  txErrors: number;
}

export interface GcStats {
  /** 自启动以来 GC 总次数 */
  totalCount: number;
  /** 自启动以来 GC 总耗时（毫秒） */
  totalDurationMs: number;
  /** 按类型统计 */
  byKind: Record<string, { count: number; durationMs: number }>;
}

export interface EventLoopStats {
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  stddevMs: number;
}

// ─── 配置 ───────────────────────────────────────────────────────────────
const SAMPLE_INTERVAL_MS = 10_000;

/** 外部采集的慢指标（DB / Redis），由 registerExtCollector 注入 */
export interface ExtMetrics {
  dbConnections: number;
  redisMemBytes: number;
  redisHitRate: number;
}
const TIMESERIES_CAPACITY = 360; // 360 * 10s = 1h

// ─── 内部工具：环形缓冲 ────────────────────────────────────────────────
class RingBuffer<T> {
  private readonly buf: T[] = [];
  constructor(private readonly capacity: number) {}
  push(item: T): void {
    this.buf.push(item);
    if (this.buf.length > this.capacity) this.buf.shift();
  }
  toArray(): T[] {
    return this.buf.slice();
  }
  get length(): number {
    return this.buf.length;
  }
}

// ─── GC 类型常量 → 名称 ────────────────────────────────────────────────
function gcKindName(kind: number): string {
  switch (kind) {
    case perfConstants.NODE_PERFORMANCE_GC_MAJOR: return 'major';
    case perfConstants.NODE_PERFORMANCE_GC_MINOR: return 'minor';
    case perfConstants.NODE_PERFORMANCE_GC_INCREMENTAL: return 'incremental';
    case perfConstants.NODE_PERFORMANCE_GC_WEAKCB: return 'weakCallback';
    default: return `kind_${kind}`;
  }
}

// ─── HTTP 指标收集 ─────────────────────────────────────────────────────
const HTTP_LATENCY_CAPACITY = 1000;
const HTTP_QPS_WINDOW_SEC = 60;

class HttpMetricsCollector {
  private totalRequests = 0;
  private totalErrors = 0;
  private total4xx = 0;
  private total5xx = 0;
  private readonly latencies = new RingBuffer<number>(HTTP_LATENCY_CAPACITY);
  /** 每秒桶：{ epochSec → count } */
  private readonly perSec = new Map<number, { total: number; errors: number }>();

  record(durationMs: number, status: number): void {
    this.totalRequests += 1;
    this.latencies.push(durationMs);
    const isErr = status >= 400;
    if (isErr) this.totalErrors += 1;
    if (status >= 400 && status < 500) this.total4xx += 1;
    if (status >= 500) this.total5xx += 1;
    const sec = Math.floor(Date.now() / 1000);
    const bucket = this.perSec.get(sec) ?? { total: 0, errors: 0 };
    bucket.total += 1;
    if (isErr) bucket.errors += 1;
    this.perSec.set(sec, bucket);
    this.gc(sec);
  }

  private gc(nowSec: number): void {
    const cutoff = nowSec - HTTP_QPS_WINDOW_SEC;
    for (const k of this.perSec.keys()) {
      if (k < cutoff) this.perSec.delete(k);
    }
  }

  /** 最近 N 秒的窗口统计 */
  windowStats(windowSec = HTTP_QPS_WINDOW_SEC): { qps: number; total: number; errors: number; errorRate: number } {
    const nowSec = Math.floor(Date.now() / 1000);
    this.gc(nowSec);
    const start = nowSec - windowSec;
    let total = 0;
    let errors = 0;
    for (const [k, v] of this.perSec) {
      if (k > start && k <= nowSec) {
        total += v.total;
        errors += v.errors;
      }
    }
    return {
      qps: Math.round((total / windowSec) * 100) / 100,
      total,
      errors,
      errorRate: total > 0 ? Math.round((errors / total) * 10000) / 100 : 0,
    };
  }

  /** 最近 1s 的瞬时 QPS */
  currentQps(): number {
    const nowSec = Math.floor(Date.now() / 1000);
    return this.perSec.get(nowSec - 1)?.total ?? 0;
  }

  /** 错误率（基于全窗口 60s） */
  currentErrorRate(): number {
    return this.windowStats().errorRate;
  }

  /** 计算延迟分位数（基于最近 1000 条） */
  percentiles(): { p50: number; p95: number; p99: number; max: number } {
    const arr = this.latencies.toArray().slice().sort((a, b) => a - b);
    if (arr.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0 };
    const pick = (q: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))];
    return {
      p50: Math.round(pick(0.5) * 100) / 100,
      p95: Math.round(pick(0.95) * 100) / 100,
      p99: Math.round(pick(0.99) * 100) / 100,
      max: Math.round((arr.at(-1) ?? 0) * 100) / 100,
    };
  }

  totals(): { total: number; errors: number; total4xx: number; total5xx: number } {
    return {
      total: this.totalRequests,
      errors: this.totalErrors,
      total4xx: this.total4xx,
      total5xx: this.total5xx,
    };
  }
}

// ─── 主采样器 ──────────────────────────────────────────────────────────
class MetricsSampler {
  private timer: NodeJS.Timeout | null = null;
  private lastCpuTimes: ReturnType<typeof readCpuTimes> | null = null;
  private lastPerCpuTimes: PerCoreRaw[] | null = null;
  private lastProcCpuUsage: NodeJS.CpuUsage | null = null;
  private lastProcCpuTime: number = 0;
  private latest: MetricsSample | null = null;
  private latestPerCore: PerCoreCpu[] = [];
  private latestNetwork: NetIfaceStats[] = [];
  private lastNet: { at: number; ifaces: Record<string, NetSnapshot> } | null = null;
  private latestDiskIo: { readBps: number; writeBps: number } = { readBps: 0, writeBps: 0 };
  private lastDisk: { at: number; readBytes: number; writeBytes: number } | null = null;
  private readonly series = new RingBuffer<MetricsSample>(TIMESERIES_CAPACITY);
  /** SSE 订阅者：每个连接一个回调 */
  private readonly subscribers = new Set<(s: MetricsSample) => void>();
  /** 外部慢指标采集器（DB/Redis 等）：每 tick fire-and-forget 刷新，结果并入下一帧 */
  private extCollector: (() => Promise<ExtMetrics | null>) | null = null;
  private extPending = false;
  private latestExt: ExtMetrics | null = null;

  private readonly elDelay: IntervalHistogram = monitorEventLoopDelay({ resolution: 20 });
  private gcObserver: PerformanceObserver | null = null;
  private readonly gcAcc: GcStats = { totalCount: 0, totalDurationMs: 0, byKind: {} };

  readonly http = new HttpMetricsCollector();

  start(): void {
    if (this.timer) return;
    this.elDelay.enable();
    try {
      this.gcObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // @ts-expect-error perf_hooks 中 GC entry 的 detail.kind / kind 字段
          const kind = (entry.detail?.kind ?? entry.kind ?? 0) as number;
          const name = gcKindName(kind);
          const stat = this.gcAcc.byKind[name] ?? { count: 0, durationMs: 0 };
          stat.count += 1;
          stat.durationMs += entry.duration;
          this.gcAcc.byKind[name] = stat;
          this.gcAcc.totalCount += 1;
          this.gcAcc.totalDurationMs += entry.duration;
        }
      });
      this.gcObserver.observe({ entryTypes: ['gc'], buffered: false });
    } catch (err) {
      logger.warn('[metrics] failed to subscribe GC events', { err: String(err) });
    }

    // 初始化 CPU 基线
    this.lastCpuTimes = readCpuTimes();
    this.lastPerCpuTimes = readPerCpuTimes();
    this.lastProcCpuUsage = process.cpuUsage();
    this.lastProcCpuTime = performance.now();
    this.lastNet = { at: Date.now(), ifaces: readNetSnapshot() };
    this.lastDisk = readDiskSnapshot();

    this.timer = setInterval(() => {
      try {
        this.collectOnce();
      } catch (err) {
        logger.error('[metrics] sampler tick error', err);
      }
    }, SAMPLE_INTERVAL_MS);
    this.timer.unref();
    logger.info('[metrics] sampler started');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.gcObserver?.disconnect();
    this.elDelay.disable();
  }

  private collectOnce(): void {
    // System CPU usage from os.cpus() delta
    const cur = readCpuTimes();
    let cpu = 0;
    if (this.lastCpuTimes) {
      const totalDiff = cur.total - this.lastCpuTimes.total;
      const idleDiff = cur.idle - this.lastCpuTimes.idle;
      if (totalDiff > 0) {
        cpu = Math.max(0, Math.min(100, Math.round(100 - (100 * idleDiff) / totalDiff)));
      }
    }
    this.lastCpuTimes = cur;

    // Process CPU usage delta -> percent of single core (can exceed 100% for multi-core)
    let procCpu = 0;
    if (this.lastProcCpuUsage) {
      const usage = process.cpuUsage(this.lastProcCpuUsage);
      const elapsedMs = performance.now() - this.lastProcCpuTime;
      const usedMs = (usage.user + usage.system) / 1000;
      if (elapsedMs > 0) procCpu = Math.round((usedMs / elapsedMs) * 1000) / 10;
    }
    this.lastProcCpuUsage = process.cpuUsage();
    this.lastProcCpuTime = performance.now();

    // Per-core CPU
    this.latestPerCore = computePerCore(this.lastPerCpuTimes, readPerCpuTimes());
    this.lastPerCpuTimes = readPerCpuTimes();

    // Network throughput
    const netNow = readNetSnapshot();
    const tNow = Date.now();
    let totalRxBps = 0;
    let totalTxBps = 0;
    const ifaces: NetIfaceStats[] = [];
    if (this.lastNet) {
      const elapsedSec = (tNow - this.lastNet.at) / 1000;
      for (const [name, cur] of Object.entries(netNow)) {
        const prev = this.lastNet.ifaces[name];
        if (!prev || elapsedSec <= 0) continue;
        const rxBps = Math.max(0, Math.round((cur.rxBytes - prev.rxBytes) / elapsedSec));
        const txBps = Math.max(0, Math.round((cur.txBytes - prev.txBytes) / elapsedSec));
        totalRxBps += rxBps;
        totalTxBps += txBps;
        ifaces.push({
          name,
          rxBytes: cur.rxBytes,
          txBytes: cur.txBytes,
          rxBps,
          txBps,
          rxPackets: cur.rxPackets,
          txPackets: cur.txPackets,
          rxErrors: cur.rxErrors,
          txErrors: cur.txErrors,
        });
      }
    }
    ifaces.sort((a, b) => (b.rxBps + b.txBps) - (a.rxBps + a.txBps));
    this.latestNetwork = ifaces;
    this.lastNet = { at: tNow, ifaces: netNow };

    // Disk IO throughput (Linux /proc/diskstats delta)
    const diskNow = readDiskSnapshot();
    let diskReadBps = 0;
    let diskWriteBps = 0;
    if (diskNow && this.lastDisk) {
      const elapsedSec = (diskNow.at - this.lastDisk.at) / 1000;
      if (elapsedSec > 0) {
        diskReadBps = Math.max(0, Math.round((diskNow.readBytes - this.lastDisk.readBytes) / elapsedSec));
        diskWriteBps = Math.max(0, Math.round((diskNow.writeBytes - this.lastDisk.writeBytes) / elapsedSec));
      }
    }
    this.latestDiskIo = { readBps: diskReadBps, writeBps: diskWriteBps };
    if (diskNow) this.lastDisk = diskNow;

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);

    const procMem = process.memoryUsage();
    const heapPercent = procMem.heapTotal > 0
      ? Math.round((procMem.heapUsed / procMem.heapTotal) * 100)
      : 0;

    const elStats = this.eventLoopStats();
    const httpWindow = this.http.windowStats();

    const sample: MetricsSample = {
      t: Date.now(),
      cpu,
      mem: memPercent,
      procCpu,
      heap: heapPercent,
      loopLagMean: elStats.meanMs,
      loopLagP99: elStats.p99Ms,
      qps: httpWindow.qps,
      errorRate: httpWindow.errorRate,
      netRxBps: totalRxBps,
      netTxBps: totalTxBps,
      diskReadBps,
      diskWriteBps,
      ...(this.latestExt ?? {}),
    };
    this.latest = sample;
    this.series.push(sample);
    for (const fn of this.subscribers) {
      try { fn(sample); } catch (err) { logger.warn('[metrics] subscriber error', { err: String(err) }); }
    }

    // 触发外部慢指标采集（异步，结果并入下一帧；上次未完成则跳过）
    if (this.extCollector && !this.extPending) {
      this.extPending = true;
      this.extCollector()
        .then((v) => { if (v) this.latestExt = v; })
        .catch(() => { /* best-effort */ })
        .finally(() => { this.extPending = false; });
    }
  }

  /** 注册外部慢指标采集器（DB / Redis 连接数等），由服务启动时调用一次 */
  registerExtCollector(fn: () => Promise<ExtMetrics | null>): void {
    this.extCollector = fn;
  }

  /** 订阅采样事件（SSE 推送），返回取消函数 */
  subscribe(fn: (s: MetricsSample) => void): () => void {
    this.subscribers.add(fn);
    return () => { this.subscribers.delete(fn); };
  }

  /** 最新的每核 CPU 使用率 */
  getPerCore(): PerCoreCpu[] {
    return this.latestPerCore;
  }

  /** 最新网络接口吞吐 */
  getNetwork(): NetIfaceStats[] {
    return this.latestNetwork;
  }

  /** 最新磁盘 IO 吞吐（字节/秒） */
  getDiskIo(): { readBps: number; writeBps: number } {
    return this.latestDiskIo;
  }

  /** 立刻读最新一帧；如尚未采样则返回 null */
  getLatest(): MetricsSample | null {
    return this.latest;
  }

  /** 时序数组（按时间升序） */
  getSeries(): MetricsSample[] {
    return this.series.toArray();
  }

  /** Event loop 延迟统计（基于持续直方图） */
  eventLoopStats(): EventLoopStats {
    const h = this.elDelay;
    const ns = 1e6;
    return {
      meanMs: Math.round((h.mean / ns) * 100) / 100,
      p50Ms: Math.round((h.percentile(50) / ns) * 100) / 100,
      p95Ms: Math.round((h.percentile(95) / ns) * 100) / 100,
      p99Ms: Math.round((h.percentile(99) / ns) * 100) / 100,
      maxMs: Math.round((h.max / ns) * 100) / 100,
      stddevMs: Math.round((h.stddev / ns) * 100) / 100,
    };
  }

  /** 重置 Event loop 直方图（可选，调用方决定是否周期性 reset） */
  resetEventLoop(): void {
    this.elDelay.reset();
  }

  gcStats(): GcStats {
    // 浅拷贝避免外部修改
    return {
      totalCount: this.gcAcc.totalCount,
      totalDurationMs: Math.round(this.gcAcc.totalDurationMs * 100) / 100,
      byKind: Object.fromEntries(
        Object.entries(this.gcAcc.byKind).map(([k, v]) => [k, {
          count: v.count,
          durationMs: Math.round(v.durationMs * 100) / 100,
        }]),
      ),
    };
  }

  /** V8 堆 space 使用情况摘要 */
  heapSpaces(): Array<{ name: string; size: number; used: number; available: number }> {
    return v8.getHeapSpaceStatistics().map((s) => ({
      name: s.space_name,
      size: s.space_size,
      used: s.space_used_size,
      available: s.space_available_size,
    }));
  }

  /** Node 进程的 resourceUsage（节选） */
  resourceUsage(): {
    userCPUMicros: number;
    systemCPUMicros: number;
    maxRssBytes: number;
    fsRead: number;
    fsWrite: number;
    voluntaryContextSwitches: number;
    involuntaryContextSwitches: number;
  } {
    const r = process.resourceUsage();
    return {
      userCPUMicros: r.userCPUTime,
      systemCPUMicros: r.systemCPUTime,
      maxRssBytes: r.maxRSS * 1024, // ru_maxrss 单位是 KB
      fsRead: r.fsRead,
      fsWrite: r.fsWrite,
      voluntaryContextSwitches: r.voluntaryContextSwitches,
      involuntaryContextSwitches: r.involuntaryContextSwitches,
    };
  }
}

function readCpuTimes(): { total: number; idle: number } {
  let total = 0;
  let idle = 0;
  for (const c of os.cpus()) {
    for (const t of Object.values(c.times)) total += t;
    idle += c.times.idle;
  }
  return { total, idle };
}

interface PerCoreRaw { user: number; system: number; idle: number; total: number }
function readPerCpuTimes(): PerCoreRaw[] {
  return os.cpus().map((c) => {
    const total = c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
    return { user: c.times.user, system: c.times.sys, idle: c.times.idle, total };
  });
}

function computePerCore(prev: PerCoreRaw[] | null, cur: PerCoreRaw[]): PerCoreCpu[] {
  if (prev?.length !== cur.length) return [];
  return cur.map((c, i) => {
    const p = prev[i];
    const totalDiff = c.total - p.total;
    const idleDiff = c.idle - p.idle;
    const userDiff = c.user - p.user;
    const sysDiff = c.system - p.system;
    if (totalDiff <= 0) return { index: i, usage: 0, user: 0, system: 0, idle: 100 };
    return {
      index: i,
      usage: Math.max(0, Math.min(100, Math.round(100 - (100 * idleDiff) / totalDiff))),
      user: Math.max(0, Math.round((userDiff / totalDiff) * 100)),
      system: Math.max(0, Math.round((sysDiff / totalDiff) * 100)),
      idle: Math.max(0, Math.round((idleDiff / totalDiff) * 100)),
    };
  });
}

interface NetSnapshot { rxBytes: number; txBytes: number; rxPackets: number; txPackets: number; rxErrors: number; txErrors: number }
/**
 * 读取各网口计数。Linux 优先从 /proc/net/dev 读取；其他平台下返回空对象。
 * /proc/net/dev 列顺序：face | rxBytes packets errs drop fifo frame compressed multicast | txBytes packets errs drop fifo colls carrier compressed
 */
function readNetSnapshot(): Record<string, NetSnapshot> {
  if (process.platform !== 'linux') return {};
  try {
    const text = fs.readFileSync(path.join('/proc', 'net', 'dev'), 'utf8');
    const result: Record<string, NetSnapshot> = {};
    for (const line of text.split('\n')) {
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      const name = line.slice(0, colon).trim();
      if (!name || name === 'lo') continue;
      const cols = line.slice(colon + 1).trim().split(/\s+/).map(Number);
      if (cols.length < 16) continue;
      result[name] = {
        rxBytes: cols[0] || 0,
        rxPackets: cols[1] || 0,
        rxErrors: cols[2] || 0,
        txBytes: cols[8] || 0,
        txPackets: cols[9] || 0,
        txErrors: cols[10] || 0,
      };
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * 读取磁盘 IO 累计字节。Linux 从 /proc/diskstats 读取（扇区 512B），汇总物理整盘设备
 * （排除分区/loop/ram/dm 等）；其他平台返回 null（不支持 IO 采集）。
 * /proc/diskstats 列：major minor name reads rd_merged sectors_read ms_read writes wr_merged sectors_written ...
 */
function readDiskSnapshot(): { at: number; readBytes: number; writeBytes: number } | null {
  if (process.platform !== 'linux') return null;
  try {
    const text = fs.readFileSync(path.join('/proc', 'diskstats'), 'utf8');
    let readSectors = 0;
    let writeSectors = 0;
    const wholeDisk = /^(sd[a-z]+|nvme\d+n\d+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|mmcblk\d+)$/;
    for (const line of text.split('\n')) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 10) continue;
      const name = cols[2];
      if (!wholeDisk.test(name)) continue;
      readSectors += Number(cols[5]) || 0;
      writeSectors += Number(cols[9]) || 0;
    }
    return { at: Date.now(), readBytes: readSectors * 512, writeBytes: writeSectors * 512 };
  } catch {
    return null;
  }
}

// 单例
export const metricsSampler = new MetricsSampler();