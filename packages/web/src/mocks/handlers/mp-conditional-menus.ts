import { http, HttpResponse } from 'msw';
import { mockMpConditionalMenus, getNextMpConditionalMenuId } from '@/mocks/data/mp-conditional-menus';
import { mockDateTime } from '@/mocks/utils/date';
import type { MpConditionalMenu, MpMenuButton, MpMenuMatchRule } from '@zenith/shared';

export const mpConditionalMenusHandlers = [
  http.get('/api/mp/conditional-menus', ({ request }) => {
    const accountId = Number(new URL(request.url).searchParams.get('accountId') ?? '0');
    const list = mockMpConditionalMenus.filter((m) => m.accountId === accountId).sort((a, b) => b.id - a.id);
    return HttpResponse.json({ code: 0, message: 'ok', data: list });
  }),

  http.post('/api/mp/conditional-menus/trymatch', async ({ request }) => {
    const body = await request.json() as { accountId: number; userId: string };
    // 简单模拟：返回该账号下第一个个性化菜单的按钮
    const m = mockMpConditionalMenus.find((x) => x.accountId === body.accountId);
    return HttpResponse.json({ code: 0, message: 'ok', data: { buttons: m?.buttons ?? [] } });
  }),

  http.post('/api/mp/conditional-menus', async ({ request }) => {
    const body = await request.json() as { accountId: number; name: string; buttons: MpMenuButton[]; matchRule: MpMenuMatchRule };
    const now = mockDateTime();
    const item: MpConditionalMenu = {
      id: getNextMpConditionalMenuId(), accountId: body.accountId, name: body.name, buttons: body.buttons,
      matchRule: body.matchRule, menuId: null, status: 'draft', publishedAt: null, createdAt: now, updatedAt: now,
    };
    mockMpConditionalMenus.push(item);
    return HttpResponse.json({ code: 0, message: '创建成功', data: item });
  }),

  http.put('/api/mp/conditional-menus/:id', async ({ params, request }) => {
    const m = mockMpConditionalMenus.find((x) => x.id === Number(params.id));
    if (!m) return HttpResponse.json({ code: 404, message: '个性化菜单不存在', data: null }, { status: 404 });
    const body = await request.json() as Partial<Pick<MpConditionalMenu, 'name' | 'buttons' | 'matchRule'>>;
    if (body.name !== undefined) m.name = body.name;
    if (body.buttons !== undefined) { m.buttons = body.buttons; m.status = 'draft'; }
    if (body.matchRule !== undefined) { m.matchRule = body.matchRule; m.status = 'draft'; }
    m.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '更新成功', data: m });
  }),

  http.post('/api/mp/conditional-menus/:id/publish', ({ params }) => {
    const m = mockMpConditionalMenus.find((x) => x.id === Number(params.id));
    if (!m) return HttpResponse.json({ code: 404, message: '个性化菜单不存在', data: null }, { status: 404 });
    m.status = 'published'; m.menuId = `mock-${m.id}`; m.publishedAt = mockDateTime(); m.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '发布成功', data: m });
  }),

  http.delete('/api/mp/conditional-menus/:id', ({ params }) => {
    const idx = mockMpConditionalMenus.findIndex((x) => x.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '个性化菜单不存在', data: null }, { status: 404 });
    mockMpConditionalMenus.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
