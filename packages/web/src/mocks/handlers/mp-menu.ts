import { mpMenuContract, type MpMenu } from '@zenith/shared/mp';
import { mock } from '@/mocks/utils/contract';
import { badRequest } from '@/mocks/utils/handlers';
import { mockMpMenus } from '@/mocks/data/mp-menus';
import { mockDateTime } from '@/mocks/utils/date';

function emptyMenu(accountId: number): MpMenu {
  return { id: 0, accountId, buttons: [], status: 'draft', publishedAt: null, createdAt: '', updatedAt: '' };
}

export const mpMenuHandlers = [
  mock(mpMenuContract.get, ({ query, ok }) => {
    const menu = mockMpMenus.find((m) => m.accountId === query.accountId) ?? emptyMenu(query.accountId);
    return ok(menu);
  }),

  mock(mpMenuContract.save, ({ body, ok }) => {
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
    return ok(menu, '保存成功');
  }),

  mock(mpMenuContract.publish, ({ body, ok }) => {
    const menu = mockMpMenus.find((m) => m.accountId === body.accountId);
    if (!menu || menu.buttons.length === 0) return badRequest('菜单为空，无法发布', { status: 400 });
    menu.status = 'published';
    menu.publishedAt = mockDateTime();
    menu.updatedAt = mockDateTime();
    return ok(menu, '发布成功');
  }),

  mock(mpMenuContract.pull, ({ body, ok }) => {
    const menu = mockMpMenus.find((m) => m.accountId === body.accountId) ?? emptyMenu(body.accountId);
    return ok(menu, '拉取成功');
  }),

  mock(mpMenuContract.remove, ({ body, ok }) => {
    const menu = mockMpMenus.find((m) => m.accountId === body.accountId);
    if (menu) { menu.buttons = []; menu.status = 'draft'; menu.publishedAt = null; menu.updatedAt = mockDateTime(); }
    return ok(menu ?? emptyMenu(body.accountId), '删除成功');
  }),
];
