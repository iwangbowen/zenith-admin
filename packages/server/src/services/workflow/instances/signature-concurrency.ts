import { isDeepStrictEqual } from 'node:util';
import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { workflowInstances } from '../../../db/schema';
import type { DbExecutor } from '../../../db/types';

type DraftVersion = Pick<typeof workflowInstances.$inferSelect, 'id' | 'status' | 'formData' | 'formSnapshot' | 'definitionSnapshot'> & { draftRevision?: number };

/** 签名解析后再锁住原草稿，防并发保存覆盖签名或重复提交物化任务。 */
export async function lockUnchangedWorkflowDraft(tx: DbExecutor, expected: DraftVersion): Promise<void> {
  const [current] = await tx.select({ draftRevision: workflowInstances.draftRevision, status: workflowInstances.status, formData: workflowInstances.formData, formSnapshot: workflowInstances.formSnapshot, definitionSnapshot: workflowInstances.definitionSnapshot })
    .from(workflowInstances).where(eq(workflowInstances.id, expected.id)).for('update').limit(1);
  if (!current || current.status !== expected.status || !['draft', 'returned'].includes(current.status)
    || (expected.draftRevision !== undefined && current.draftRevision !== expected.draftRevision)
    || !isDeepStrictEqual(current.formData, expected.formData)
    || !isDeepStrictEqual(current.formSnapshot, expected.formSnapshot)
    || !isDeepStrictEqual(current.definitionSnapshot, expected.definitionSnapshot)) {
    throw new HTTPException(409, { message: '草稿或签署资料已变化，请刷新后重新确认' });
  }
}

/** 会签允许更新不同字段；不能覆盖签署时读取后已被他人改变的同一字段。 */
export function assertWorkflowFormUpdatesCurrent(previous: Record<string, unknown>, current: Record<string, unknown>, updates: Record<string, unknown>): void {
  if (Object.keys(updates).some((key) => !isDeepStrictEqual(previous[key], current[key]))) {
    throw new HTTPException(409, { message: '审批表单已变化，请刷新后重新确认签署' });
  }
}
