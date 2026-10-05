import type { WorkflowJobType } from '@zenith/shared/workflow';
import type { WorkflowJobHandler } from './types';
import type { WorkflowJobRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';

/**
 * jobType → handler 注册表。
 * handler 模块在被 import 时调用 registerJobHandler 自注册；
 * lib/workflow-jobs/handlers/index.ts 汇总 import 触发注册。
 */
const registry = new Map<WorkflowJobType, WorkflowJobHandler>();
type WorkflowJobSettlementHandler = (tx: DbTransaction, job: WorkflowJobRow) => Promise<void>;
const settlementHandlers = new Map<WorkflowJobType, WorkflowJobSettlementHandler>();

/** Domain continuations commit with attempt settlement, including expired leases. */
export function registerJobSettlementHandler(jobType: WorkflowJobType, handler: WorkflowJobSettlementHandler): void {
  if (settlementHandlers.has(jobType)) throw new Error(`workflow job settlement already registered for "${jobType}"`);
  settlementHandlers.set(jobType, handler);
}

export async function runJobSettlement(tx: DbTransaction, job: WorkflowJobRow): Promise<void> {
  // An explicit cancellation stops work; it never releases a domain continuation.
  if (job.status === 'canceled') return;
  await settlementHandlers.get(job.jobType)?.(tx, job);
}

export function registerJobHandler(jobType: WorkflowJobType, handler: WorkflowJobHandler): void {
  if (registry.has(jobType)) {
    throw new Error(`workflow job handler already registered for "${jobType}"`);
  }
  registry.set(jobType, handler);
}

export function getJobHandler(jobType: WorkflowJobType): WorkflowJobHandler | undefined {
  return registry.get(jobType);
}

export function getRegisteredJobTypes(): WorkflowJobType[] {
  return [...registry.keys()];
}
