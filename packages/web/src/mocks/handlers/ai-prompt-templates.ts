import { http, HttpResponse } from 'msw';
import { SEED_AI_PROMPT_TEMPLATES } from '@zenith/shared';
import type { AiPromptScope, AiPromptTemplate, CreateAiPromptTemplateInput, UpdateAiPromptTemplateInput } from '@zenith/shared';
import { mockDateTime } from '../utils/date';

const store: AiPromptTemplate[] = SEED_AI_PROMPT_TEMPLATES.map((item) => ({ ...item }));
let nextId = Math.max(...store.map((item) => item.id), 0) + 1;

function nextTemplateId() {
  return nextId++;
}

function sortTemplates(list: AiPromptTemplate[]) {
  return [...list].sort((a, b) => a.sort - b.sort || a.id - b.id);
}

function notFound() {
  return HttpResponse.json({ code: 404, message: '提示词模板不存在', data: null }, { status: 404 });
}

export const aiPromptTemplatesHandlers = [
  http.get('/api/ai/prompt-templates', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const scope = url.searchParams.get('scope') as AiPromptScope | null;
    const keyword = (url.searchParams.get('keyword') ?? '').trim().toLowerCase();

    let list = sortTemplates(store);
    if (scope) list = list.filter((item) => item.scope === scope);
    if (keyword) {
      list = list.filter((item) =>
        item.name.toLowerCase().includes(keyword) ||
        item.content.toLowerCase().includes(keyword) ||
        (item.description ?? '').toLowerCase().includes(keyword) ||
        (item.category ?? '').toLowerCase().includes(keyword),
      );
    }

    const total = list.length;
    const sliced = list.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'success', data: { list: sliced, total, page, pageSize } });
  }),

  http.get('/api/ai/prompt-templates/available', () => {
    return HttpResponse.json({ code: 0, message: 'success', data: sortTemplates(store.filter((item) => item.isEnabled)) });
  }),

  // 记录模板被应用一次（使用统计）
  http.post('/api/ai/prompt-templates/:id/use', ({ params }) => {
    const item = store.find((template) => template.id === Number(params.id));
    if (!item) return notFound();
    item.usageCount += 1;
    return HttpResponse.json({ code: 0, message: '已记录', data: null });
  }),

  http.get('/api/ai/prompt-templates/:id', ({ params }) => {
    const item = store.find((template) => template.id === Number(params.id));
    if (!item) return notFound();
    return HttpResponse.json({ code: 0, message: 'success', data: item });
  }),

  http.post('/api/ai/prompt-templates', async ({ request }) => {
    const body = (await request.json()) as Partial<CreateAiPromptTemplateInput>;
    const now = mockDateTime();
    const scope = (body.scope ?? 'system') as AiPromptScope;
    const item: AiPromptTemplate = {
      id: nextTemplateId(),
      name: body.name ?? '未命名模板',
      content: body.content ?? '',
      description: body.description ?? null,
      category: body.category ?? null,
      scope,
      userId: scope === 'user' ? 1 : null,
      isBuiltin: false,
      sort: body.sort ?? 0,
      usageCount: 0,
      isEnabled: body.isEnabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    store.push(item);
    return HttpResponse.json({ code: 0, message: '创建成功', data: item });
  }),

  http.put('/api/ai/prompt-templates/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const idx = store.findIndex((template) => template.id === id);
    if (idx === -1) return notFound();
    const body = (await request.json()) as Partial<UpdateAiPromptTemplateInput>;
    const scope = (body.scope ?? store[idx].scope) as AiPromptScope;
    store[idx] = {
      ...store[idx],
      ...body,
      id,
      scope,
      userId: scope === 'user' ? (store[idx].userId ?? 1) : null,
      isBuiltin: store[idx].isBuiltin,
      updatedAt: mockDateTime(),
    };
    return HttpResponse.json({ code: 0, message: '更新成功', data: store[idx] });
  }),

  http.delete('/api/ai/prompt-templates/:id', ({ params }) => {
    const id = Number(params.id);
    const idx = store.findIndex((template) => template.id === id);
    if (idx === -1) return notFound();
    if (store[idx].isBuiltin) {
      return HttpResponse.json({ code: 400, message: '内置提示词模板不允许删除', data: null }, { status: 400 });
    }
    store.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
