import { createHash } from 'node:crypto';
import { stableStringify } from '@zenith/shared/core';

/** 文件可以用于不同站点/栏目；同一目标的重复提交才应复用原导入任务。 */
export function importJobIdempotencyKey(entity: string, fileId: string, context: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify({ entity, fileId, context })).digest('hex');
}
