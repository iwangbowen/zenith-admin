/** 按节点实际激活顺序编号；同轮会签、转办、加签任务共享轮次。 */
export function workflowTaskActivationRounds(rows: ReadonlyArray<{ instanceId: number; nodeKey: string; activationId: string }>): Map<string, number> {
  const rounds = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = workflowTaskActivationKey(row);
    if (rounds.has(key)) continue;
    const node = JSON.stringify([row.instanceId, row.nodeKey]);
    const next = (counts.get(node) ?? 0) + 1;
    counts.set(node, next);
    rounds.set(key, next);
  }
  return rounds;
}

export function workflowTaskActivationKey(row: { instanceId: number; nodeKey: string; activationId: string }): string {
  return JSON.stringify([row.instanceId, row.nodeKey, row.activationId]);
}
