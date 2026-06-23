import { http, HttpResponse } from 'msw';
import { mockMpMenus } from '@/mocks/data/mp-menus';
import { mockDateTime } from '@/mocks/utils/date';
import type { MpMenu, MpMenuButton } from '@zenith/shared';

function emptyMenu(accountId: number): MpMenu {
  return { id: 0, accountId, buttons: [], status: 'draft', publishedAt: null, createdAt: '', updatedAt: '' };
}

export const mpMenuHandlers = [
  http.get('/api/mp/menu', ({ request }) => {
    const accountId = Number(new URL(request.url).searchParams.get('accountId') ?? '0');
    const menu = mockMpMenus.find((m) => m.accountId === accountId) ?? emptyMenu(accountId);
    return HttpResponse.json({ code: 0, message: 'ok', data: menu });
  }),

  http.post('/api/mp/menu/save', async ({ request }) => {
    const body = await request.json() as { accountId: number; buttons: MpMenuButton[] };
    const now = mockDateTime();
    let menu = mockMpMenus.find((m) => m.accountId === body.accountId);
    if (menu) {
      menu.buttons = body.buttons;
      menu.status = 'draft';
      menu.updatedAt = now;
    } else {
      menu = { id: mockMpMenus.length + 1, accountId: body.accountId, buttons: body.buttons, status: 'draft', publishedAt: null, createdAt: now, updatedAt: now };
      mockMpMenus.push(menu);
    }
    return HttpResponse.json({ code: 0, message: '保存成功', data: menu });
  }),

  http.post('/api/mp/menu/publish', async ({ request }) => {
    const body = await request.json() as { accountId: number };
    const menu = mockMpMenus.find((m) => m.accountId === body.accountId);
    if (!menu || menu.buttons.length === 0) return HttpResponse.json({ code: 400, message: '菜单为空，无法发布', data: null }, { status: 400 });
    menu.status = 'published';
    menu.publishedAt = mockDateTime();
    menu.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '发布成功', data: menu });
  }),

  http.post('/api/mp/menu/pull', async ({ request }) => {
    const body = await request.json() as { accountId: number };
    const menu = mockMpMenus.find((m) => m.accountId === body.accountId) ?? emptyMenu(body.accountId);
    return HttpResponse.json({ code: 0, message: '拉取成功', data: menu });
  }),

  http.post('/api/mp/menu/delete', async ({ request }) => {
    const body = await request.json() as { accountId: number };
    const menu = mockMpMenus.find((m) => m.accountId === body.accountId);
    if (menu) { menu.buttons = []; menu.status = 'draft'; menu.publishedAt = null; menu.updatedAt = mockDateTime(); }
    return HttpResponse.json({ code: 0, message: '删除成功', data: menu ?? emptyMenu(body.accountId) });
  }),
];
