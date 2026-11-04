import { currentUser, hasPermission } from '../../../lib/context';

/** 校验当前用户可访问/操作该任务（创建者本人，或持有指定权限的管理员） */
export interface AsyncTaskAccessScope {
  userId: number;
  global: boolean;
}

export async function resolveAsyncTaskAccessScope(
  permission: 'system:async-task:list' | 'system:async-task:manage' = 'system:async-task:list',
): Promise<AsyncTaskAccessScope> {
  const user = currentUser();
  return { userId: user.userId, global: await hasPermission(permission) };
}

export function canAccessAsyncTaskForScope(
  task: { createdBy: number | null },
  scope: AsyncTaskAccessScope,
): boolean {
  return task.createdBy === scope.userId || scope.global;
}
