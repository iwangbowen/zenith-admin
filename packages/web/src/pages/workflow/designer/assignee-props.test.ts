import { describe, expect, it } from 'vitest';
import { clearInactiveAssigneeProps, resetAssigneePropsForType, sanitizeAssigneePropsForWrite } from './assignee-props';

describe('workflow designer assignee props', () => {
  it('clears role fields when switching from role to user', () => {
    expect(resetAssigneePropsForType({
      assigneeType: 'role',
      roleIds: [2],
      roleNames: ['普通用户'],
      assigneeIds: [9],
      assigneeNames: ['旧成员'],
    }, 'user')).toEqual({ assigneeType: 'user' });
  });

  it('keeps the active source fields while dropping inactive sources', () => {
    expect(clearInactiveAssigneeProps({
      assigneeType: 'deptMember',
      deptMemberDeptIds: [3],
      deptMemberDeptNames: ['财务部'],
      deptMemberIncludeChildren: true,
      roleIds: [2],
      roleNames: ['普通用户'],
    }, 'deptMember')).toEqual({
      assigneeType: 'deptMember',
      deptMemberDeptIds: [3],
      deptMemberDeptNames: ['财务部'],
      deptMemberIncludeChildren: true,
    });
  });

  it('strips UI-only names before flowData is persisted', () => {
    expect(sanitizeAssigneePropsForWrite({
      assigneeType: 'role',
      roleIds: [2],
      roleNames: ['普通用户'],
      userGroupIds: [7],
      userGroupNames: ['采购组'],
    })).toEqual({ assigneeType: 'role', roleIds: [2] });
  });
});
