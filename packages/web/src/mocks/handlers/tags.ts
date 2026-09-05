import { tagContract, type Tag } from '@zenith/shared/platform';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { removeWhere } from '@/mocks/utils/array';
import { mockTags, getNextTagId, getTagGroups } from '@/mocks/data/tags';
import { mockDateTime } from '@/mocks/utils/date';

export const tagsHandlers = [
  // 标签列表（支持分页 + 关键字/状态/分组筛选）
  mock(tagContract.list, ({ query, ok, paginate }) => {
    const { keyword, status, groupName } = query;
    const filtered = mockTags.filter((t) => {
      if (keyword && !t.name.includes(keyword) && !(t.description ?? '').includes(keyword)) return false;
      if (status && t.status !== status) return false;
      if (groupName && t.groupName !== groupName) return false;
      return true;
    });
    return ok(paginate(filtered));
  }),

  // 获取分组列表
  mock(tagContract.groups, ({ ok }) => ok(getTagGroups())),

  // 获取单个标签
  mock(tagContract.detail, ({ params, ok }) => {
    const tag = mockTags.find((t) => t.id === params.id);
    if (!tag) return notFound('标签不存在', { status: 404 });
    return ok(tag);
  }),

  // 新增标签
  mock(tagContract.create, ({ body, ok }) => {
    if (mockTags.some((t) => t.name === body.name)) {
      return badRequest('标签名称已存在', { status: 400 });
    }
    const now = mockDateTime();
    const newTag: Tag = {
      id: getNextTagId(),
      name: body.name,
      color: body.color ?? null,
      groupName: body.groupName ?? null,
      description: body.description ?? null,
      status: body.status,
      sortOrder: body.sortOrder,
      createdAt: now,
      updatedAt: now,
    };
    mockTags.push(newTag);
    return ok(newTag, '创建成功');
  }),

  // 更新标签
  mock(tagContract.update, ({ params, body, ok }) => {
    const tag = mockTags.find((t) => t.id === params.id);
    if (!tag) return notFound('标签不存在', { status: 404 });
    if (body.name && body.name !== tag.name && mockTags.some((t) => t.name === body.name)) {
      return badRequest('标签名称已存在', { status: 400 });
    }
    Object.assign(tag, body, { updatedAt: mockDateTime() });
    return ok(tag, '更新成功');
  }),

  // 批量删除（静态 /batch 早于动态 /{id}）
  mock(tagContract.removeBatch, ({ body, ok }) => {
    const ids = new Set(body.ids);
    const count = removeWhere(mockTags, (tag) => ids.has(tag.id));
    return ok(null, `已删除 ${count} 条标签`);
  }),

  // 删除标签
  mock(tagContract.remove, ({ params, ok }) => {
    const index = mockTags.findIndex((t) => t.id === params.id);
    if (index === -1) return notFound('标签不存在', { status: 404 });
    mockTags.splice(index, 1);
    return ok(null, '删除成功');
  }),
];
