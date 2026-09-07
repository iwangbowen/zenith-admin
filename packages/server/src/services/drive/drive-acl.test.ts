import { describe, expect, it } from 'vitest';
import { DRIVE_ROLES } from '@zenith/shared/drive';
import {
  childAclOf, computeNodeRole, computeSpaceRole, effectiveGrantNodeIds, EMPTY_SUBJECTS,
  matchedGrantRoles, ownAclOf, rolesAtLeast, type DriveSubjectSet, type ParentAclLike, type SpaceLike,
} from './drive-acl';

const subjects: DriveSubjectSet = {
  userId: 10, user: new Set([10]), department: new Set([20, 21]), role: new Set([30]),
  user_group: new Set([40]), departmentId: 21, isAdmin: false,
};
const space: SpaceLike = { id: 1, type: 'team', ownerId: 99, departmentId: null, defaultMemberRole: 'editor', status: 'enabled' };
const context = { members: [], leaderDeptIds: new Set<number>() };

describe('materialized drive ACL', () => {
  it.each([0, 1, 2])('blocks space inheritance at depth %i', (depth) => {
    let parent: ParentAclLike | null = null;
    for (let id = 1; id <= depth; id++) parent = { id, ...childAclOf(parent) };
    const node = { id: depth + 1, ...ownAclOf(false, parent) };
    expect(node.aclChainIds).toEqual([]);
    expect(node.aclOpen).toBe(false);
    expect(computeNodeRole(node, 'editor', [])).toBeNull();
    const child = { id: depth + 2, ...childAclOf(node) };
    expect(child.aclChainIds).toEqual([node.id]);
    expect(computeNodeRole(child, 'editor', [])).toBeNull();
    expect(computeNodeRole(child, 'editor', ['viewer'])).toBe('viewer');
    expect(computeNodeRole(child, 'manager', [])).toBe('manager');
  });

  it('reopens inheritance according to the destination parent', () => {
    const parent = { id: 2, aclChainIds: [1], aclOpen: false };
    expect(ownAclOf(true, parent)).toEqual({ aclChainIds: [1, 2], aclOpen: false });
    expect(ownAclOf(true, null)).toEqual({ aclChainIds: [], aclOpen: true });
    expect(effectiveGrantNodeIds({ id: 3, ...childAclOf(parent) })).toEqual([1, 2, 3]);
  });

  it.each(DRIVE_ROLES)('takes the strongest grant for %s space members', (role) => {
    const node = { id: 1, aclChainIds: [], aclOpen: true };
    expect(computeNodeRole(node, role, ['manager'])).toBe('manager');
    expect(computeNodeRole(node, role, [])).toBe(role);
  });

  it('matches all four subject categories but not unrelated subjects', () => {
    expect(matchedGrantRoles([
      { subjectType: 'user', subjectId: 10, role: 'viewer' },
      { subjectType: 'department', subjectId: 20, role: 'downloader' },
      { subjectType: 'role', subjectId: 30, role: 'editor' },
      { subjectType: 'user_group', subjectId: 40, role: 'manager' },
      { subjectType: 'user', subjectId: 99, role: 'manager' },
    ], subjects)).toEqual(['viewer', 'downloader', 'editor', 'manager']);
  });

  it('does not give anonymous or missing creators a public team role', () => {
    expect(computeSpaceRole(space, EMPTY_SUBJECTS, context)).toBeNull();
  });

  it('handles default managers, owners, department leaders and disabled spaces', () => {
    expect(computeSpaceRole({ ...space, defaultMemberRole: 'manager' }, subjects, context)).toBe('manager');
    expect(computeSpaceRole({ ...space, ownerId: 10 }, subjects, context)).toBe('manager');
    expect(computeSpaceRole({ ...space, type: 'department', departmentId: 20 }, subjects, { ...context, leaderDeptIds: new Set([20]) })).toBe('manager');
    expect(computeSpaceRole({ ...space, status: 'disabled' }, subjects, context)).toBeNull();
    expect(computeSpaceRole(space, { ...subjects, isAdmin: true }, context)).toBe('manager');
    expect(rolesAtLeast('downloader')).toEqual(['downloader', 'editor', 'manager']);
  });
});
