import { http, HttpResponse } from 'msw';
import type { RatePlan } from '@zenith/shared';
import { mockRatePlans } from '@/mocks/data/rate-plans';
import { mockDateTime } from '@/mocks/utils/date';

let plans: RatePlan[] = mockRatePlans.map((p) => ({ ...p }));
let nextId = Math.max(0, ...plans.map((p) => p.id)) + 1;
const BASE = '/api/rate-plans';

const ok = (data: unknown, message = 'success') => HttpResponse.json({ code: 0, message, data });
const notFound = () => HttpResponse.json({ code: 404, message: '限流套餐不存在', data: null }, { status: 404 });

function clearDefault(keepId?: number) {
  plans = plans.map((p) => (p.id === keepId ? p : { ...p, isDefault: false }));
}

export const ratePlansHandlers = [
  http.get(`${BASE}/options`, () => ok(plans.filter((p) => p.status === 'enabled'))),

  http.get(BASE, ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 10);
    let filtered = plans;
    if (keyword) filtered = filtered.filter((p) => p.code.includes(keyword) || p.name.includes(keyword));
    if (status) filtered = filtered.filter((p) => p.status === status);
    const start = (page - 1) * pageSize;
    return ok({ list: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize });
  }),

  http.post(BASE, async ({ request }) => {
    const body = (await request.json()) as Partial<RatePlan>;
    if (plans.some((p) => p.code === body.code)) {
      return HttpResponse.json({ code: 400, message: '套餐编码已存在', data: null }, { status: 400 });
    }
    const now = mockDateTime();
    const created: RatePlan = {
      id: nextId++,
      code: body.code ?? '',
      name: body.name ?? '',
      description: body.description ?? null,
      qpsLimit: body.qpsLimit ?? 10,
      dailyQuota: body.dailyQuota ?? 0,
      monthlyQuota: body.monthlyQuota ?? 0,
      isDefault: body.isDefault ?? false,
      status: body.status ?? 'enabled',
      createdAt: now,
      updatedAt: now,
    };
    plans.unshift(created);
    if (created.isDefault) clearDefault(created.id);
    return ok(created, '创建成功');
  }),

  http.get(`${BASE}/:id`, ({ params }) => {
    const found = plans.find((p) => p.id === Number(params.id));
    return found ? ok(found) : notFound();
  }),

  http.put(`${BASE}/:id`, async ({ params, request }) => {
    const idx = plans.findIndex((p) => p.id === Number(params.id));
    if (idx === -1) return notFound();
    const body = (await request.json()) as Partial<RatePlan>;
    plans[idx] = { ...plans[idx], ...body, code: plans[idx].code, updatedAt: mockDateTime() };
    if (plans[idx].isDefault) clearDefault(plans[idx].id);
    return ok(plans[idx], '更新成功');
  }),

  http.delete(`${BASE}/:id`, ({ params }) => {
    const idx = plans.findIndex((p) => p.id === Number(params.id));
    if (idx === -1) return notFound();
    plans.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];
