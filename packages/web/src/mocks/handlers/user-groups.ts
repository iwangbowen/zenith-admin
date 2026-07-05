import { http, HttpResponse } from 'msw';
import { mockUserGroups, getNextUserGroupId } from '@/mocks/data/user-groups';
import { mockUsers } from '@/mocks/data/users';
import { mockDateTime } from '@/mocks/utils/date';
import type { UserGroup } from '@zenith/shared';

interface CreateBody {
  name: string;
  code: string;
  description?: string;
  ownerId?: number | null;
  departmentId?: number | null;
  status?: 'enabled' | 'disabled';
}

function publicView(g: typeof mockUserGroups[number]): UserGroup {
  const { memberIds: _memberIds, ...rest } = g;
  const memberPreview = g.memberIds.slice(0, 5).map((uid) => {
    const u = mockUsers.find((mu) => mu.id === uid);
    return u ? { id: u.id, nickname: u.nickname, avatar: u.avatar ?? null } : null;
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  return { ...rest, memberCount: g.memberIds.length, memberPreview };
}

export const userGroupsHandlers = [
  http.get('/api/user-groups/all', () =>
    HttpResponse.json({ code: 0, message: 'ok', data: mockUserGroups.map(publicView) })),

  http.get('/api/user-groups', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;

    const filtered = mockUserGroups.filter((g) => {
      if (keyword && !g.name.includes(keyword) && !g.code.includes(keyword)) return false;
      if (status && g.status !== status) return false;
      return true;
    });
    const total = filtered.length;
    const list = filtered.slice((page - 1) * pageSize, page * pageSize).map(publicView);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  http.get('/api/user-groups/:id/members', ({ params }) => {
    const grp = mockUserGroups.find((g) => g.id === Number(params.id));
    if (!grp) return HttpResponse.json({ code: 404, message: '用户组不存在', data: null });
    const members = grp.memberIds.map((uid) => {
      const u = mockUsers.find((mu) => mu.id === uid);
      return u
        ? { id: u.id, username: u.username, nickname: u.nickname, email: u.email, departmentName: null, joinedAt: grp.createdAt }
        : null;
    }).filter(Boolean);
    return HttpResponse.json({ code: 0, message: 'ok', data: members });
  }),

  http.put('/api/user-groups/:id/members', async ({ params, request }) => {
    const grp = mockUserGroups.find((g) => g.id === Number(params.id));
    if (!grp) return HttpResponse.json({ code: 404, message: '用户组不存在', data: null });
    const body = await request.json() as { userIds: number[] };
    grp.memberIds = Array.isArray(body?.userIds) ? body.userIds : [];
    grp.memberCount = grp.memberIds.length;
    grp.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '保存成功', data: null });
  }),

  http.post('/api/user-groups/:id/members', async ({ params, request }) => {
    const grp = mockUserGroups.find((g) => g.id === Number(params.id));
    if (!grp) return HttpResponse.json({ code: 404, message: '用户组不存在', data: null });
    const body = await request.json() as { userIds: number[] };
    const set = new Set(grp.memberIds);
    (body?.userIds ?? []).forEach((id) => set.add(id));
    grp.memberIds = [...set];
    grp.memberCount = grp.memberIds.length;
    return HttpResponse.json({ code: 0, message: '添加成功', data: null });
  }),

  http.delete('/api/user-groups/:id/members', async ({ params, request }) => {
    const grp = mockUserGroups.find((g) => g.id === Number(params.id));
    if (!grp) return HttpResponse.json({ code: 404, message: '用户组不存在', data: null });
    const body = await request.json() as { userIds: number[] };
    const remove = new Set(body?.userIds ?? []);
    grp.memberIds = grp.memberIds.filter((id) => !remove.has(id));
    grp.memberCount = grp.memberIds.length;
    return HttpResponse.json({ code: 0, message: '移除成功', data: null });
  }),

  http.get('/api/user-groups/:id', ({ params }) => {
    const grp = mockUserGroups.find((g) => g.id === Number(params.id));
    if (!grp) return HttpResponse.json({ code: 404, message: '用户组不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: publicView(grp) });
  }),

  http.post('/api/user-groups', async ({ request }) => {
    const body = await request.json() as CreateBody;
    if (mockUserGroups.some((g) => g.code === body.code)) {
      return HttpResponse.json({ code: 400, message: '用户组编码已存在', data: null });
    }
    const now = mockDateTime();
    const created = {
      id: getNextUserGroupId(),
      name: body.name,
      code: body.code,
      description: body.description ?? null,
      ownerId: body.ownerId ?? null,
      ownerName: null,
      departmentId: body.departmentId ?? null,
      departmentName: null,
      memberCount: 0,
      memberIds: [],
      status: body.status ?? 'enabled',
      createdAt: now,
      updatedAt: now,
    };
    mockUserGroups.push(created);
    return HttpResponse.json({ code: 0, message: '创建成功', data: publicView(created) });
  }),

  http.put('/api/user-groups/:id', async ({ params, request }) => {
    const grp = mockUserGroups.find((g) => g.id === Number(params.id));
    if (!grp) return HttpResponse.json({ code: 404, message: '用户组不存在', data: null });
    const body = await request.json() as Partial<CreateBody>;
    Object.assign(grp, body, { updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: publicView(grp) });
  }),

  http.delete('/api/user-groups/batch', async ({ request }) => {
    const body = await request.json() as { ids: number[] };
    const ids = body?.ids ?? [];
    // 在用保护：任一选中用户组仍有成员时整体拒绝
    const blocked = mockUserGroups.filter((g) => ids.includes(g.id) && (g.memberCount ?? 0) > 0);
    if (blocked.length > 0) {
      const names = blocked.slice(0, 3).map((g) => `「${g.name}」`).join('、');
      const suffix = blocked.length > 3 ? ` 等 ${blocked.length} 个用户组` : '';
      return HttpResponse.json(
        { code: 409, message: `${names}${suffix}仍有成员，请先移除成员后再删除`, data: null },
        { status: 409 },
      );
    }
    ids.forEach((id) => {
      const idx = mockUserGroups.findIndex((g) => g.id === id);
      if (idx !== -1) mockUserGroups.splice(idx, 1);
    });
    return HttpResponse.json({ code: 0, message: `已删除 ${ids.length} 个用户组`, data: null });
  }),

  http.delete('/api/user-groups/:id', ({ params }) => {
    const idx = mockUserGroups.findIndex((g) => g.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '用户组不存在', data: null });
    const grp = mockUserGroups[idx];
    const memberCount = grp.memberCount ?? 0;
    if (memberCount > 0) {
      return HttpResponse.json(
        { code: 409, message: `该用户组下仍有 ${memberCount} 名成员，请先移除成员后再删除`, data: null },
        { status: 409 },
      );
    }
    mockUserGroups.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
