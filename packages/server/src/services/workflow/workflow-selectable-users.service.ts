// ─── 工作流选人通讯录：面向发起人/审批人的跨部门候选人查询 ───
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { users } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { tenantCondition } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';

export interface WorkflowSelectableUser {
  id: number;
  username: string;
  nickname: string;
  avatar: string | null;
  departmentName: string | null;
}

/**
 * 工作流协作选人清单（转办/委派/加签/协办/转发/抄送）。
 *
 * 与用户管理 `userContract.all` 的边界：
 * - 权限：仅要求工作流参与权限（发起或审批），不要求 system:user:list——普通审批人可用；
 * - 可见范围：租户内全部启用用户，不叠加数据范围（跨部门转办/抄送是审批协作的常态）；
 * - 字段：仅暴露协作必需的最小集（无手机号/邮箱/角色等管理字段）。
 */
export async function listWorkflowSelectableUsers(): Promise<WorkflowSelectableUser[]> {
  const rows = await db.query.users.findMany({
    columns: { id: true, username: true, nickname: true, avatar: true },
    with: { department: { columns: { name: true } } },
    where: buildWhere(eq(users.status, 'enabled'), tenantCondition(users, currentUser())),
    orderBy: users.id,
  });
  return rows.map((u) => ({
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    avatar: u.avatar ?? null,
    departmentName: u.department?.name ?? null,
  }));
}
