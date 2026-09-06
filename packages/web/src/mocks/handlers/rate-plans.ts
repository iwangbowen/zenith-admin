import { ratePlanContract } from '@zenith/shared/open-platform';
import type { RatePlan } from '@zenith/shared/open-platform';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound, nextIdFrom } from '@/mocks/utils/handlers';
import { mockRatePlans } from '@/mocks/data/rate-plans';
import { mockDateTime } from '@/mocks/utils/date';
import { filterByKeyword } from '@/mocks/utils/filter';

const plans: RatePlan[] = mockRatePlans.map((p) => ({ ...p }));
let nextId = nextIdFrom(plans);

/** 默认套餐唯一：保留 keepId，其余全部取消默认 */
function clearDefault(keepId: number) {
  for (const plan of plans) {
    if (plan.id !== keepId) plan.isDefault = false;
  }
}

export const ratePlansHandlers = [
  mock(ratePlanContract.options, ({ ok }) => ok(plans.filter((p) => p.status === 'enabled'))),

  mock(ratePlanContract.list, ({ query, ok, paginate }) => {
    let filtered = plans;
    if (query.keyword) filtered = filterByKeyword(filtered, query.keyword, [(p) => p.code, (p) => p.name]);
    if (query.status) filtered = filtered.filter((p) => p.status === query.status);
    return ok(paginate(filtered));
  }),

  mock(ratePlanContract.create, ({ body, ok }) => {
    if (plans.some((p) => p.code === body.code)) {
      return badRequest('套餐编码已存在', { status: 400 });
    }
    const now = mockDateTime();
    const created: RatePlan = {
      id: nextId++,
      code: body.code,
      name: body.name,
      description: body.description ?? null,
      qpsLimit: body.qpsLimit,
      dailyQuota: body.dailyQuota,
      monthlyQuota: body.monthlyQuota,
      isDefault: body.isDefault,
      status: body.status,
      createdAt: now,
      updatedAt: now,
    };
    plans.unshift(created);
    if (created.isDefault) clearDefault(created.id);
    return ok(created, '创建成功');
  }),

  mock(ratePlanContract.detail, ({ params, ok }) => {
    const found = plans.find((p) => p.id === params.id);
    return found ? ok(found) : notFound('限流套餐不存在', { status: 404 });
  }),

  mock(ratePlanContract.update, ({ params, body, ok }) => {
    const idx = plans.findIndex((p) => p.id === params.id);
    if (idx === -1) return notFound('限流套餐不存在', { status: 404 });
    plans[idx] = { ...plans[idx], ...body, updatedAt: mockDateTime() };
    if (plans[idx].isDefault) clearDefault(plans[idx].id);
    return ok(plans[idx], '更新成功');
  }),

  mock(ratePlanContract.remove, ({ params, ok }) => {
    const idx = plans.findIndex((p) => p.id === params.id);
    if (idx === -1) return notFound('限流套餐不存在', { status: 404 });
    plans.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];
