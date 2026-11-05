/**
 * 作业平台增强纯逻辑单测（无 DB 依赖）。
 *
 * 覆盖：
 * - 重放限流参数钳制 clampRate / clampLimit
 * - 错峰入队时间 staggeredRunAt
 * - 失败原因关键字提取 reasonKeywordOf
 * - 多维失败聚类 clusterFailureRows
 */
import { describe, it, expect } from 'vitest';
import {
  REPLAY_DEFAULTS,
  CLUSTER_MEMBER_LIMIT,
  clampRate,
  clampLimit,
  staggeredRunAt,
  reasonKeywordOf,
  clusterFailureRows,
  type ClusterInputRow,
} from './workflow-jobs.service';
import { formatDateTime } from '../../lib/datetime';

describe('clampRate', () => {
  it('未传 / 非法 / 非正数回退默认速率', () => {
    expect(clampRate(undefined)).toBe(REPLAY_DEFAULTS.ratePerSecond);
    expect(clampRate(0)).toBe(REPLAY_DEFAULTS.ratePerSecond);
    expect(clampRate(-5)).toBe(REPLAY_DEFAULTS.ratePerSecond);
    expect(clampRate(Number.NaN)).toBe(REPLAY_DEFAULTS.ratePerSecond);
  });

  it('取整并封顶到最大速率', () => {
    expect(clampRate(35.9)).toBe(35);
    expect(clampRate(9999)).toBe(REPLAY_DEFAULTS.maxRatePerSecond);
  });
});

describe('clampLimit', () => {
  it('未传 / 非正数回退默认上限', () => {
    expect(clampLimit(undefined)).toBe(REPLAY_DEFAULTS.maxBatch);
    expect(clampLimit(0)).toBe(REPLAY_DEFAULTS.maxBatch);
  });

  it('封顶到单次最大批量', () => {
    expect(clampLimit(10)).toBe(10);
    expect(clampLimit(9999)).toBe(REPLAY_DEFAULTS.maxBatch);
  });
});

describe('staggeredRunAt', () => {
  const base = 1_000_000_000_000;

  it('同一秒窗口内的作业共享 runAt，跨窗口顺延 1 秒', () => {
    // rate=20：前 20 个在第 0 秒，第 21 个进入第 1 秒
    expect(staggeredRunAt(0, 20, base).getTime()).toBe(base);
    expect(staggeredRunAt(19, 20, base).getTime()).toBe(base);
    expect(staggeredRunAt(20, 20, base).getTime()).toBe(base + 1000);
    expect(staggeredRunAt(41, 20, base).getTime()).toBe(base + 2000);
  });

  it('速率为 0 时按 1 兜底，避免除零', () => {
    expect(staggeredRunAt(3, 0, base).getTime()).toBe(base + 3000);
  });
});

describe('reasonKeywordOf', () => {
  it('空 / null 返回 null', () => {
    expect(reasonKeywordOf(null)).toBeNull();
    expect(reasonKeywordOf('   ')).toBeNull();
  });

  it('取首个数字前的字面前缀', () => {
    expect(reasonKeywordOf('Connection timeout after 5000ms')).toBe('Connection timeout after');
    expect(reasonKeywordOf('timeout after 3000ms')).toBe('timeout after');
  });

  it('前缀过短时回退取原文前 40 字符', () => {
    expect(reasonKeywordOf('AB123456 error')).toBe('AB123456 error');
    expect(reasonKeywordOf('5xx upstream error')).toBe('5xx upstream error');
  });
});

describe('clusterFailureRows', () => {
  const at = (iso: string) => new Date(iso);
  const base = {
    status: 'dead',
    definitionName: '测试流程',
    nodeKey: null as string | null,
    attempts: 3,
    maxAttempts: 3,
    lockedBy: 'host-a:100',
  };
  // 按 failedAt 倒序排列（与 getJobFailureClusters 的 orderBy 一致）
  const rows: ClusterInputRow[] = [
    { ...base, id: 4, jobType: 'webhook_delivery', lastError: 'timeout after 5000ms', instanceId: 1, instanceTitle: '请假单', correlationId: 't-a', failedAt: at('2026-08-21T12:00:00'), createdAt: at('2026-08-21T11:00:00') },
    { ...base, id: 3, jobType: 'webhook_delivery', lastError: 'timeout after 3000ms', instanceId: 1, instanceTitle: '请假单', correlationId: 't-a', failedAt: at('2026-08-21T10:00:00'), createdAt: at('2026-08-21T09:00:00') },
    { ...base, id: 2, jobType: 'trigger_dispatch', lastError: 'connection refused', instanceId: 2, instanceTitle: null, correlationId: 't-b', failedAt: at('2026-08-21T09:00:00'), createdAt: at('2026-08-21T08:00:00') },
    { ...base, id: 1, jobType: 'trigger_dispatch', lastError: null, instanceId: null, instanceTitle: null, correlationId: null, failedAt: at('2026-08-21T08:00:00'), createdAt: at('2026-08-21T07:00:00') },
  ];

  it('reason 维度：数字归一后合并相似错误并按数量倒序', () => {
    const clusters = clusterFailureRows(rows, 'reason');
    const top = clusters[0];
    expect(top.dimension).toBe('reason');
    expect(top.key).toBe('timeout after Nms');
    expect(top.count).toBe(2);
    expect(top.jobTypes).toEqual(['webhook_delivery']);
    expect(top.reasonKeyword).toBe('timeout after');
    // 未知错误也成簇
    expect(clusters.some((c) => c.key === '未知错误')).toBe(true);
  });

  it('簇附带时间窗 / 涉及实例数 / 成员明细（按最近失败倒序）', () => {
    const clusters = clusterFailureRows(rows, 'reason');
    const top = clusters[0];
    // 期望值经同一 formatDateTime 计算：格式化按固定业务时区，硬编码字符串会随 runner 时区漂移
    expect(top.firstAt).toBe(formatDateTime(at('2026-08-21T10:00:00')));
    expect(top.lastAt).toBe(formatDateTime(at('2026-08-21T12:00:00')));
    expect(top.instanceCount).toBe(1);
    expect(top.jobs.map((j) => j.id)).toEqual([4, 3]);
    expect(top.jobs[0]).toMatchObject({
      id: 4,
      status: 'dead',
      lockedBy: 'host-a:100',
      lastError: 'timeout after 5000ms',
      failedAt: formatDateTime(at('2026-08-21T12:00:00')),
      createdAt: formatDateTime(at('2026-08-21T11:00:00')),
      definitionName: '测试流程',
    });
  });

  it('成员明细按 CLUSTER_MEMBER_LIMIT 截断，计数不受影响', () => {
    const many: ClusterInputRow[] = Array.from({ length: CLUSTER_MEMBER_LIMIT + 5 }, (_, i) => ({
      ...base,
      id: 100 + i,
      jobType: 'webhook_delivery',
      lastError: 'fetch failed',
      instanceId: i,
      instanceTitle: null,
      correlationId: null,
      failedAt: at('2026-08-21T12:00:00'),
      createdAt: at('2026-08-21T11:00:00'),
    }));
    const [cluster] = clusterFailureRows(many, 'reason');
    expect(cluster.count).toBe(CLUSTER_MEMBER_LIMIT + 5);
    expect(cluster.jobs).toHaveLength(CLUSTER_MEMBER_LIMIT);
    expect(cluster.instanceCount).toBe(CLUSTER_MEMBER_LIMIT + 5);
  });

  it('jobType 维度：按类型聚合计数', () => {
    const clusters = clusterFailureRows(rows, 'jobType');
    const webhook = clusters.find((c) => c.key === 'webhook_delivery');
    const trigger = clusters.find((c) => c.key === 'trigger_dispatch');
    expect(webhook?.count).toBe(2);
    expect(trigger?.count).toBe(2);
  });

  it('instance 维度：跳过空实例，标题带入 label', () => {
    const clusters = clusterFailureRows(rows, 'instance');
    expect(clusters.every((c) => c.instanceId != null)).toBe(true);
    const inst1 = clusters.find((c) => c.instanceId === 1);
    expect(inst1?.count).toBe(2);
    expect(inst1?.label).toBe('请假单 (#1)');
    const inst2 = clusters.find((c) => c.instanceId === 2);
    expect(inst2?.label).toBe('实例 #2');
  });

  it('trace 维度：跳过空 correlationId', () => {
    const clusters = clusterFailureRows(rows, 'trace');
    expect(clusters.every((c) => c.correlationId != null)).toBe(true);
    expect(clusters.find((c) => c.correlationId === 't-a')?.count).toBe(2);
  });
});
