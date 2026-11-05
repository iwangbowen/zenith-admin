/**
 * 应用日志的业务关联归属由 pino 顶层 correlationId 决定（= X-Request-Id）。
 * 不搜索正文：链路查询 URL / 日志搜索参数也会包含目标 ID，但属于另一次请求。
 */
export function matchesLogCorrelationId(line: string, correlationId: string): boolean {
  try {
    const entry: unknown = JSON.parse(line);
    return typeof entry === 'object' && entry !== null && 'correlationId' in entry && entry.correlationId === correlationId;
  } catch {
    return false;
  }
}
