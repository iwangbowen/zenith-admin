// ─── 工作流协作通讯录：面向发起人 / 审批人的跨部门候选查询 ───
import { desc } from 'drizzle-orm';
import { db } from '../../db';
import { departments } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { tenantCondition } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';
import { workflowIdentity } from '../../lib/workflow-identity';

export interface WorkflowSelectableUser {
  id: number;
  username: string;
  nickname: string;
  avatar: string | null;
  departmentName: string | null;
}

export interface WorkflowSelectableDepartment {
  id: number;
  name: string;
  parentId: number;
  status: 'enabled' | 'disabled';
}

/**
 * 工作流协作选人清单（转办 / 委派 / 加签 / 抄送 / 转交 / 抄送人）。
 *
 * 不复用 `userContract.all` 的边界：
 * - 权限：只要求工作流三权限，不额外要求 system:user:list；
 * - 可见范围：租户内全部启用用户，不叠加管理部门数据范围；
 * - 字段：只暴露协作所需字段，不返回手机号 / 邮箱 / 角色等管理字段。
 */
export async function listWorkflowSelectableUsers(): Promise<WorkflowSelectableUser[]> {
  return workflowIdentity().listSelectableUsers();
}

/**
 * 工作流协作选部门清单。
 *
 * 仅暴露 id / name / parentId / status：可编辑字段用于构建选择树，只读字段用于把
 * 实例中的部门 ID 解析成名称；不要求 system:department:list，也不暴露部门管理字段。
 */
export async function listWorkflowSelectableDepartments(): Promise<WorkflowSelectableDepartment[]> {
  const rows = await db.select({
    id: departments.id,
    name: departments.name,
    parentId: departments.parentId,
    status: departments.status,
  }).from(departments)
    .where(buildWhere(tenantCondition(departments, currentUser())))
    .orderBy(departments.sort, desc(departments.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    status: row.status as WorkflowSelectableDepartment['status'],
  }));
}
