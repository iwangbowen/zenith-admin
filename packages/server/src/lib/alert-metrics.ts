/**
 * 业务告警指标的公共口径工具。
 *
 * 各域的「告警指标源」函数（getXxxAlertMetrics）都返回 `Record<指标名, number>`，
 * 由 monitor-history 的快照采集统一汇总后交给告警评估器比对阈值。
 */
import { percentOf } from '@zenith/shared/core';
import { eq, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * 比率型指标统一口径：百分比、保留 1 位小数。
 * 分母为 0 时返回 0——「窗口内没有样本」不是异常，返回 100 会让所有失败率规则在空闲时段误报。
 */
export function ratePercent(part: number, total: number): number {
  return percentOf(part, total) ?? 0;
}

/**
 * 业务指标的租户过滤条件。
 *
 * 规则 `tenantId` 为空表示平台级规则，统计全平台数据（不加过滤），
 * 与 `lib/tenant.ts` 中平台管理员未指定 viewingTenantId 时「看全部」的语义一致；
 * 单租户部署下所有数据的 tenantId 均为 null，该分支同样退化为全量统计。
 */
export function metricTenantFilter(column: AnyPgColumn, tenantId: number | null): SQL | undefined {
  return tenantId == null ? undefined : eq(column, tenantId);
}
