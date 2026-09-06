/**
 * 数值阈值比较算子：报表预警、IoT 告警 / 联动、监控告警等「值 vs 阈值」判定的单一实现。
 * 各域的算子常量（`REPORT_ALERT_OPS` / `IOT_COMPARE_OPS`）都是本集合或其子集，标签与选项仍由各域自行定义。
 */
export const NUMERIC_COMPARE_OPS = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq'] as const;

export type NumericCompareOp = (typeof NUMERIC_COMPARE_OPS)[number];

/** 未知算子恒为 false（fail-closed），与各域历史实现一致 */
export function compareNumber(value: number, op: NumericCompareOp, threshold: number): boolean {
  switch (op) {
    case 'gt': return value > threshold;
    case 'gte': return value >= threshold;
    case 'lt': return value < threshold;
    case 'lte': return value <= threshold;
    case 'eq': return value === threshold;
    case 'neq': return value !== threshold;
    default: return false;
  }
}
