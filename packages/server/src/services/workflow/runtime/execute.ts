import type { WorkflowFlowData, WorkflowStarterContext, WorkflowNodeConfig } from '@zenith/shared/workflow';
import { advanceTokens, type AdvanceTrigger, type TokenSnapshot, type PendingDecision, type NewTokenSpec } from '../../../lib/workflow-token-engine';
import type { TaskAction } from '../../../lib/workflow-engine';
import type { ExpandedTaskRows, ExpandedTaskRow } from './expand-tasks';

export type RuntimeTrigger = { kind: 'seed' } | { kind: 'advanceNode'; nodeKey: string }
  | { kind: 'enterNode'; nodeKey: string; consumeNodeKey?: string };

export interface ExecutionPorts<T> {
  loadTokens(): Promise<TokenSnapshot[]>;
  completedKeys(): Promise<Set<string>>;
  completeToken(tokenId: number): Promise<void>;
  consumeTokens(ids: number[]): Promise<void>;
  createToken(spec: NewTokenSpec): Promise<number>;
  expand(tasks: TaskAction[]): Promise<ExpandedTaskRows>;
  materialize(rows: ExpandedTaskRow[], tokens: Map<string, number>): Promise<T[]>;
  resolveDecisions(pending: PendingDecision[]): Promise<AdvanceTrigger[]>;
  reject(created: T[]): Promise<T[]>;
  genBranchId?: () => string;
  checkpoint?(): void;
}

/** PostgreSQL and memory execution use this identical execution loop. */
export async function executeWorkflow<T>(trigger: RuntimeTrigger, ctx: {
  flowData: WorkflowFlowData; formData: Record<string, unknown>; starter?: WorkflowStarterContext; instanceId: number; now?: number;
}, ports: ExecutionPorts<T>): Promise<{ createdTasks: T[]; finished: boolean; rejected: boolean; currentNodeKeys: string[] }> {
  const queue: AdvanceTrigger[] = [];
  const createdTasks: T[] = [];
  let finished = false;
  let rejected = false;
  let currentNodeKeys: string[] = [];
  if (trigger.kind === 'seed') queue.push({ type: 'seed' });
  else if (trigger.kind === 'advanceNode') {
    const token = (await ports.loadTokens()).find(item => item.nodeKey === trigger.nodeKey);
    if (!token) throw new Error('节点「' + trigger.nodeKey + '」缺少执行 Token');
    await ports.completeToken(token.id);
    queue.push({ type: 'advance', tokenId: token.id, nodeKey: token.nodeKey, branchPath: token.branchPath });
  } else {
    if (trigger.consumeNodeKey) {
      const token = (await ports.loadTokens()).find(item => item.nodeKey === trigger.consumeNodeKey);
      if (token) { await ports.completeToken(token.id); await ports.consumeTokens([token.id]); }
    }
    queue.push({ type: 'enter', nodeKey: trigger.nodeKey, branchPath: [] });
  }
  while (queue.length > 0 && !rejected) {
    ports.checkpoint?.();
    const next = queue.shift()!;
    const result = advanceTokens({ ...ctx, liveTokens: await ports.loadTokens(), trigger: next,
      completedNodeKeys: await ports.completedKeys(), genBranchId: ports.genBranchId });
    if (result.ops.consume.length) await ports.consumeTokens(result.ops.consume);
    const expanded = result.tasksToCreate.length ? await ports.expand(result.tasksToCreate)
      : { rows: [], autoApprovedNodeKeys: [], autoRejectedNodeKey: null };
    const automatic = new Set(expanded.autoApprovedNodeKeys);
    const tokens = new Map<string, number>();
    for (const spec of result.ops.create) {
      if (automatic.has(spec.nodeKey)) queue.push({ type: 'continue', nodeKey: spec.nodeKey, branchPath: spec.branchPath, parentTokenId: spec.parentTokenId });
      else tokens.set(spec.nodeKey, await ports.createToken(spec));
    }
    createdTasks.push(...await ports.materialize(expanded.rows, tokens));
    if (!result.rejected && result.pendingDecisions.length) queue.push(...await ports.resolveDecisions(result.pendingDecisions));
    finished ||= result.finished;
    rejected ||= result.rejected || !!expanded.autoRejectedNodeKey;
    if (result.activeNodeKeys.length) currentNodeKeys = result.activeNodeKeys;
  }
  if (rejected) return { createdTasks: await ports.reject(createdTasks), finished: false, rejected: true, currentNodeKeys: [] };
  return { createdTasks, finished, rejected: false, currentNodeKeys };
}

/** Frozen approval denominator and task identity are storage independent. */
export function planRuntimeActivation(rows: ExpandedTaskRow[], config: WorkflowNodeConfig | undefined) {
  const basis = rows.filter(row => (row.nodeType === 'approve' || row.nodeType === 'handler') && row.taskKind !== 'excluded');
  const method = basis.find(row => row.approveMethod)?.approveMethod ?? (basis.length ? 'and' : null);
  const ratio = method === 'ratio' ? basis.find(row => row.approveRatio != null)?.approveRatio ?? 51 : null;
  const required = method === 'or' ? Math.min(1, basis.length) : method === 'ratio' ? Math.ceil(basis.length * ratio! / 100) : basis.length;
  return { method, ratio, required, baseTotal: basis.length,
    kind: basis.length ? 'approval' as const : rows[0].nodeType === 'ccNode' ? 'cc' as const : 'system' as const,
    includeInEfficiencyStats: config?.includeInEfficiencyStats ?? true };
}

export function runtimeTaskIdentity(row: ExpandedTaskRow, method: ReturnType<typeof planRuntimeActivation>['method']) {
  const kind = row.taskKind ?? (row.nodeType === 'ccNode' ? 'cc' : row.nodeType === 'approve' || row.nodeType === 'handler' ? 'approval' : 'system');
  const taskKind = kind === 'approval' && row.delegationMode === 'suggest' ? 'suggestion' : kind;
  const waitReason = row.status !== 'waiting' ? null : row.externalCallbackId ? 'external'
    : method === 'sequential' && kind === 'approval' ? 'sequence' : row.nodeType === 'subProcess' ? 'subprocess'
      : row.nodeType === 'delay' ? 'delay' : row.nodeType === 'trigger' ? 'trigger' : null;
  return { kind, taskKind, waitReason } as const;
}
