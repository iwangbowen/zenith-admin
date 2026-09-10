/**
 * 业务定时任务的 Cron 表达式在 pg-boss 侧的归一化。
 *
 * pg-boss 每 30 秒评估一次 schedule，官方文档明确不建议带秒位的 6 段表达式：秒级精度既无法保证，
 * 还会让「下次执行」与实际触发时刻对不上。前端构建器与历史数据仍是 6 段（含秒），
 * 因此注册到 pg-boss 以及所有「下次执行 / 未按计划执行」的计算都先经这里去掉秒位，保证口径一致。
 */
export function toMinuteCron(expression: string): string {
  const fields = expression.trim().split(/\s+/);
  return fields.length === 6 ? fields.slice(1).join(' ') : fields.join(' ');
}

/** 6 段表达式的秒位不是 0 时，实际触发时刻会落到整分钟；用于在界面上提示 */
export function cronSecondsIgnored(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  return fields.length === 6 && fields[0] !== '0';
}
