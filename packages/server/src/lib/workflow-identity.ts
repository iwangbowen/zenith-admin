import type { SignatureInput, SignaturePolicy, SignatureSnapshot } from '@zenith/shared/core';
import type { DbExecutor } from '../db/types';

export interface WorkflowIdentityPort {
  resolveSignature(input: SignatureInput, policy: SignaturePolicy, actor?: { userId: number; tenantId: number | null }): Promise<SignatureSnapshot>;
  loadUserDisplays(ids: readonly number[], executor?: DbExecutor): Promise<Map<number, { name: string; avatar: string | null }>>;
  listSelectableUsers(): Promise<Array<{ id: number; username: string; nickname: string; avatar: string | null; departmentName: string | null }>>;
}
let identity: Readonly<WorkflowIdentityPort> | undefined;
export function registerWorkflowIdentity(port: WorkflowIdentityPort): void {
  if (identity) throw new Error('工作流身份能力已经冻结');
  identity = Object.freeze({ ...port });
}
export function workflowIdentity(): Readonly<WorkflowIdentityPort> {
  if (!identity) throw new Error('工作流身份能力尚未装配');
  return identity;
}
