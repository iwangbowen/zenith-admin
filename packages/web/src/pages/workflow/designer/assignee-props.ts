import type { AssigneeType } from './types';

/**
 * 只允许当前审批人来源拥有自己的配置字段。
 * 这些字段在设计器内暂存，写入 flowData 前再由 sanitizeAssigneePropsForWrite 收口。
 */
const SOURCE_FIELDS = [
  'assigneeIds', 'assigneeNames',
  'roleIds', 'roleNames',
  'postIds', 'postNames',
  'deptMemberDeptIds', 'deptMemberDeptNames', 'deptMemberIncludeChildren',
  'userGroupIds', 'userGroupNames',
  'selectScopeType', 'selectScopeIds',
  'formUserField', 'formDeptField', 'formDeptHeadLevel',
  'managerLevel',
  'multiLevelEndType', 'multiLevelEndLevel', 'multiLevelEndRoleId',
  'nodeApproverNodeId',
  'assigneeExpression',
  'decisionRuleKey',
] as const;

type SourceField = typeof SOURCE_FIELDS[number];

const ACTIVE_FIELDS: Partial<Record<AssigneeType, readonly SourceField[]>> = {
  user: ['assigneeIds', 'assigneeNames'],
  role: ['roleIds', 'roleNames'],
  post: ['postIds', 'postNames'],
  deptMember: ['deptMemberDeptIds', 'deptMemberDeptNames', 'deptMemberIncludeChildren'],
  userGroup: ['userGroupIds', 'userGroupNames'],
  initiatorSelectScope: ['selectScopeType', 'selectScopeIds'],
  formUser: ['formUserField'],
  formDepartment: ['formDeptField', 'formDeptHeadLevel'],
  manager: ['managerLevel'],
  multiLevelManager: ['multiLevelEndType', 'multiLevelEndLevel', 'multiLevelEndRoleId'],
  multiLevelDeptHead: ['multiLevelEndType', 'multiLevelEndLevel'],
  nodeApprover: ['nodeApproverNodeId'],
  expression: ['assigneeExpression'],
  decision: ['decisionRuleKey'],
};

function sourceFieldsFor(type: AssigneeType): readonly SourceField[] {
  return ACTIVE_FIELDS[type] ?? [];
}

/** 清掉切换来源后不再属于当前来源的配置，避免 UI 临时状态互相污染。 */
export function clearInactiveAssigneeProps(
  props: Record<string, unknown>,
  assigneeType: AssigneeType,
): Record<string, unknown> {
  const active = new Set(sourceFieldsFor(assigneeType));
  const next: Record<string, unknown> = { ...props, assigneeType };
  for (const field of SOURCE_FIELDS) {
    if (!active.has(field)) delete next[field];
  }
  return next;
}

/** 切换来源时丢弃旧来源的选择，避免把上一次来源的值带到新来源。 */
export function resetAssigneePropsForType(
  props: Record<string, unknown>,
  assigneeType: AssigneeType,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...props, assigneeType };
  for (const field of SOURCE_FIELDS) delete next[field];
  return next;
}

/**
 * 设计器写入 flowData 前的最终边界。
 * roleNames / userGroupNames 只服务于画布摘要，shared graph schema 不持久化它们。
 */
export function sanitizeAssigneePropsForWrite(props: Record<string, unknown>): Record<string, unknown> {
  const assigneeType = props.assigneeType as AssigneeType | undefined;
  if (!assigneeType) return { ...props };
  const next = clearInactiveAssigneeProps(props, assigneeType);
  delete next.roleNames;
  delete next.userGroupNames;
  return next;
}
