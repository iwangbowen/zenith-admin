import { aiPromptTemplateContract } from '@zenith/shared/ai';
import type { AiPromptTemplate } from '@zenith/shared/ai';
import { SEED_AI_PROMPT_TEMPLATES } from '@zenith/shared/seed';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound, nextIdFrom } from '@/mocks/utils/handlers';
import { mockDateTime } from '../utils/date';

const store: AiPromptTemplate[] = SEED_AI_PROMPT_TEMPLATES.map((item) => ({ ...item }));
let nextId = nextIdFrom(store);

function nextTemplateId() {
  return nextId++;
}

function sortTemplates(list: AiPromptTemplate[]) {
  return [...list].sort((a, b) => a.sort - b.sort || a.id - b.id);
}

export const aiPromptTemplatesHandlers = [
  mock(aiPromptTemplateContract.list, ({ query, ok, paginate }) => {
    const keyword = (query.keyword ?? '').trim().toLowerCase();
    let list = sortTemplates(store);
    if (query.scope) list = list.filter((item) => item.scope === query.scope);
    if (keyword) {
      list = list.filter((item) =>
        item.name.toLowerCase().includes(keyword) ||
        item.content.toLowerCase().includes(keyword) ||
        (item.description ?? '').toLowerCase().includes(keyword) ||
        (item.category ?? '').toLowerCase().includes(keyword),
      );
    }
    return ok(paginate(list), 'success');
  }),

  // 静态 /available 早于动态 /:id
  mock(aiPromptTemplateContract.all, ({ ok }) => ok(sortTemplates(store.filter((item) => item.isEnabled)), 'success')),

  // 记录模板被应用一次（使用统计）
  mock(aiPromptTemplateContract.use, ({ params, ok }) => {
    const item = store.find((template) => template.id === params.id);
    if (!item) return notFound('提示词模板不存在', { status: 404 });
    item.usageCount += 1;
    return ok(null, '已记录');
  }),

  mock(aiPromptTemplateContract.detail, ({ params, ok }) => {
    const item = store.find((template) => template.id === params.id);
    if (!item) return notFound('提示词模板不存在', { status: 404 });
    return ok(item, 'success');
  }),

  // 恢复历史版本（Demo：版本内容为演示文本，仅回写 content）
  mock(aiPromptTemplateContract.restoreVersion, ({ params, ok }) => {
    const item = store.find((template) => template.id === params.id);
    if (!item) return notFound('提示词模板不存在', { status: 404 });
    item.updatedAt = mockDateTime();
    return ok(item, '已恢复到历史版本');
  }),

  mock(aiPromptTemplateContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const item: AiPromptTemplate = {
      id: nextTemplateId(),
      name: body.name,
      content: body.content,
      description: body.description ?? null,
      category: body.category ?? null,
      scope: body.scope,
      userId: body.scope === 'user' ? 1 : null,
      isBuiltin: false,
      sort: body.sort,
      usageCount: 0,
      isEnabled: body.isEnabled,
      createdAt: now,
      updatedAt: now,
    };
    store.push(item);
    return ok(item, '创建成功');
  }),

  mock(aiPromptTemplateContract.update, ({ params, body, ok }) => {
    const idx = store.findIndex((template) => template.id === params.id);
    if (idx === -1) return notFound('提示词模板不存在', { status: 404 });
    const scope = body.scope ?? store[idx].scope;
    store[idx] = {
      ...store[idx],
      ...body,
      id: params.id,
      scope,
      userId: scope === 'user' ? (store[idx].userId ?? 1) : null,
      isBuiltin: store[idx].isBuiltin,
      updatedAt: mockDateTime(),
    };
    return ok(store[idx], '更新成功');
  }),

  mock(aiPromptTemplateContract.remove, ({ params, ok }) => {
    const idx = store.findIndex((template) => template.id === params.id);
    if (idx === -1) return notFound('提示词模板不存在', { status: 404 });
    if (store[idx].isBuiltin) {
      return badRequest('内置提示词模板不允许删除', { status: 400 });
    }
    store.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];
