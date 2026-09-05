import { dictContract, type Dict, type DictItem } from '@zenith/shared/platform';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { removeWhere } from '@/mocks/utils/array';
import { mockDicts, mockDictItems, getNextDictId, getNextDictItemId } from '@/mocks/data/dicts';
import { mockDateTime } from '@/mocks/utils/date';

export const dictsHandlers = [
  // 字典列表（支持服务端分页）
  mock(dictContract.list, ({ query, ok, paginate }) => {
    const { keyword, status, startDate, endDate } = query;
    const filtered = mockDicts.filter((d) => {
      if (keyword && !d.name.includes(keyword) && !d.code.includes(keyword)) return false;
      if (status && d.status !== status) return false;
      if (startDate && d.createdAt < startDate) return false;
      if (endDate && d.createdAt > `${endDate} 23:59:59`) return false;
      return true;
    });
    return ok(paginate(filtered));
  }),

  // 获取单个字典
  mock(dictContract.detail, ({ params, ok }) => {
    const dict = mockDicts.find((d) => d.id === params.id);
    if (!dict) return notFound('字典不存在');
    return ok(dict);
  }),

  // 新增字典
  mock(dictContract.create, ({ body, ok }) => {
    const newDict: Dict = {
      id: getNextDictId(),
      name: body.name,
      code: body.code,
      description: body.description ?? null,
      status: body.status,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockDicts.push(newDict);
    return ok(newDict, '新增成功');
  }),

  // 更新字典
  mock(dictContract.update, ({ params, body, ok }) => {
    const dict = mockDicts.find((d) => d.id === params.id);
    if (!dict) return notFound('字典不存在');
    Object.assign(dict, body, { updatedAt: mockDateTime() });
    return ok(dict, '更新成功');
  }),

  // 删除字典（同时删除该字典下的所有条目）
  mock(dictContract.remove, ({ params, ok }) => {
    const index = mockDicts.findIndex((d) => d.id === params.id);
    if (index === -1) return notFound('字典不存在');
    mockDicts.splice(index, 1);
    removeWhere(mockDictItems, (item) => item.dictId === params.id);
    return ok(null, '删除成功');
  }),

  // 获取字典条目列表
  mock(dictContract.items, ({ params, ok }) => {
    return ok(mockDictItems.filter((item) => item.dictId === params.id));
  }),

  // 通过 code 查询字典条目（供前端下拉框使用）
  mock(dictContract.itemsByCode, ({ params, ok }) => {
    const dict = mockDicts.find((d) => d.code === params.code);
    if (!dict) return ok([]);
    return ok(mockDictItems.filter((item) => item.dictId === dict.id));
  }),

  // 字典条目详情
  mock(dictContract.itemDetail, ({ params, ok }) => {
    const item = mockDictItems.find((i) => i.id === params.itemId && i.dictId === params.id);
    if (!item) return notFound('字典条目不存在');
    return ok(item);
  }),

  // 新增字典条目
  mock(dictContract.createItem, ({ params, body, ok }) => {
    const newItem: DictItem = {
      id: getNextDictItemId(),
      dictId: params.id,
      parentId: body.parentId ?? null,
      label: body.label,
      value: body.value,
      color: body.color ?? null,
      sort: body.sort,
      status: body.status,
      remark: body.remark ?? null,
      metadata: body.metadata ?? null,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockDictItems.push(newItem);
    return ok(newItem, '新增成功');
  }),

  // 更新字典条目
  mock(dictContract.updateItem, ({ params, body, ok }) => {
    const item = mockDictItems.find((i) => i.id === params.itemId);
    if (!item) return notFound('字典条目不存在');
    Object.assign(item, body, { updatedAt: mockDateTime() });
    return ok(item, '更新成功');
  }),

  // 删除字典条目
  mock(dictContract.removeItem, ({ params, ok }) => {
    const index = mockDictItems.findIndex((i) => i.id === params.itemId);
    if (index === -1) return notFound('字典条目不存在');
    mockDictItems.splice(index, 1);
    return ok(null, '删除成功');
  }),
];
