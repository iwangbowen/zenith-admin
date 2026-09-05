import { mpConditionalMenuContract, type MpConditionalMenu } from '@zenith/shared/mp';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { mockMpConditionalMenus, getNextMpConditionalMenuId } from '@/mocks/data/mp-conditional-menus';
import { mockDateTime } from '@/mocks/utils/date';

export const mpConditionalMenusHandlers = [
  mock(mpConditionalMenuContract.list, ({ query, ok }) => {
    const list = mockMpConditionalMenus.filter((m) => m.accountId === query.accountId).sort((a, b) => b.id - a.id);
    return ok(list);
  }),

  mock(mpConditionalMenuContract.tryMatch, ({ body, ok }) => {
    // 简单模拟：返回该账号下第一个个性化菜单的按钮
    const m = mockMpConditionalMenus.find((x) => x.accountId === body.accountId);
    return ok({ buttons: m?.buttons ?? [] });
  }),

  mock(mpConditionalMenuContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const item: MpConditionalMenu = {
      id: getNextMpConditionalMenuId(), accountId: body.accountId, name: body.name, buttons: body.buttons,
      matchRule: body.matchRule, menuId: null, status: 'draft', publishedAt: null, createdAt: now, updatedAt: now,
    };
    mockMpConditionalMenus.push(item);
    return ok(item, '创建成功');
  }),

  mock(mpConditionalMenuContract.update, ({ params, body, ok }) => {
    const m = mockMpConditionalMenus.find((x) => x.id === params.id);
    if (!m) return notFound('个性化菜单不存在', { status: 404 });
    if (body.name !== undefined) m.name = body.name;
    if (body.buttons !== undefined) { m.buttons = body.buttons; m.status = 'draft'; }
    if (body.matchRule !== undefined) { m.matchRule = body.matchRule; m.status = 'draft'; }
    m.updatedAt = mockDateTime();
    return ok(m, '更新成功');
  }),

  mock(mpConditionalMenuContract.publish, ({ params, ok }) => {
    const m = mockMpConditionalMenus.find((x) => x.id === params.id);
    if (!m) return notFound('个性化菜单不存在', { status: 404 });
    m.status = 'published'; m.menuId = `mock-${m.id}`; m.publishedAt = mockDateTime(); m.updatedAt = mockDateTime();
    return ok(m, '发布成功');
  }),

  mock(mpConditionalMenuContract.remove, ({ params, ok }) => {
    const idx = mockMpConditionalMenus.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('个性化菜单不存在', { status: 404 });
    mockMpConditionalMenus.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];
