import { departmentContract, type Department } from '@zenith/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { requireItem, updateItem, removeByIds } from '@/mocks/utils/crud';

import { mockDepartments, getNextDeptId } from '@/mocks/data/departments';
import { mockUsers } from '@/mocks/data/users';
import { mockDateTime } from '@/mocks/utils/date';
import { includesKeyword } from '@/mocks/utils/filter';

function withLeaderName(dept: Department): Department {
  const leader = dept.leaderId ? mockUsers.find((u) => u.id === dept.leaderId) : undefined;
  return { ...dept, leaderName: leader?.nickname ?? null };
}

function withUserStats(dept: Department): Department {
  const deptUsers = mockUsers.filter((u) => u.departmentId === dept.id);
  return {
    ...dept,
    userCount: deptUsers.length,
    userPreview: deptUsers.slice(0, 5).map((u) => ({ id: u.id, nickname: u.nickname, avatar: u.avatar ?? null })),
  };
}

function buildDeptTree(list: Department[], parentId: number = 0): Department[] {
  return list
    .filter((d) => d.parentId === parentId)
    .map((d) => {
      const children = buildDeptTree(list, d.id);
      const enriched = withUserStats(withLeaderName(d));
      return children.length > 0 ? { ...enriched, children } : { ...enriched };
    });
}

/** 按关键字 / 状态过滤，命中节点保留其祖先链（与服务端语义一致） */
function filterDepartments(list: Department[], keyword?: string, status?: string): Department[] {
  if (!keyword && !status) return list;
  const byId = new Map(list.map((d) => [d.id, d]));
  const keep = new Set<number>();
  for (const dept of list) {
    if (keyword && !includesKeyword(keyword, dept.name, dept.code)) continue;
    if (status && dept.status !== status) continue;
    let current: Department | undefined = dept;
    while (current && !keep.has(current.id)) {
      keep.add(current.id);
      current = byId.get(current.parentId);
    }
  }
  return list.filter((d) => keep.has(d.id));
}

export const departmentsHandlers = [
  // 部门平铺列表（供下拉框使用）
  mock(departmentContract.flat, ({ ok }) => {
    return ok(mockDepartments.map(withLeaderName));
  }),

  // 部门树
  mock(departmentContract.tree, ({ query, ok }) => {
    return ok(buildDeptTree(filterDepartments(mockDepartments, query.keyword, query.status)));
  }),

  // 获取单个部门
  mock(departmentContract.detail, ({ params, ok }) => {
    const dept = requireItem(mockDepartments, params.id, '部门不存在', { status: 404 });
    return ok(dept);
  }),

  // 新增部门
  mock(departmentContract.create, ({ body, ok }) => {
    const newDept: Department = {
      id: getNextDeptId(),
      ...body,
      leaderId: body.leaderId ?? null,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockDepartments.push(newDept);
    return ok(newDept, '新增成功');
  }),

  // 更新部门
  mock(departmentContract.update, ({ params, body, ok }) => {
    const dept = updateItem(mockDepartments, params.id, body, { notFoundMessage: '部门不存在', now: mockDateTime, init: { status: 404 } });
    return ok(dept, '更新成功');
  }),

  // 删除部门
  mock(departmentContract.remove, ({ params, ok }) => {
    requireItem(mockDepartments, params.id, '部门不存在', { status: 404 });
    removeByIds(mockDepartments, [params.id]);
    return ok(null, '删除成功');
  }),
];
