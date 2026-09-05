import { workflowDataSourceContract } from '@zenith/shared/workflow';
import type { WorkflowDataSource } from '@zenith/shared/workflow';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { mockWorkflowDataSources, getNextDataSourceId, MOCK_DATA_SOURCE_OPTIONS } from '@/mocks/data/workflow-data-sources';
import { mockDateTime } from '@/mocks/utils/date';

export const workflowDataSourcesHandlers = [
  // 代理拉取选项（demo 返回示例数据 + 关键词过滤）
  mock(workflowDataSourceContract.options, ({ query, ok }) => {
    const keyword = query.keyword ?? '';
    const list = keyword
      ? MOCK_DATA_SOURCE_OPTIONS.filter((o) => o.label.toLowerCase().includes(keyword.toLowerCase()))
      : MOCK_DATA_SOURCE_OPTIONS;
    return ok(list);
  }),

  // 按选项值取完整记录（demo 按选项合成示例记录）
  mock(workflowDataSourceContract.record, ({ query, ok }) => {
    const hit = MOCK_DATA_SOURCE_OPTIONS.find((o) => o.value === query.value);
    const record = hit ? { value: hit.value, label: hit.label, code: hit.value, name: hit.label } : null;
    return ok(record);
  }),

  mock(workflowDataSourceContract.list, ({ query, ok, paginate }) => {
    const keyword = query.keyword ?? '';
    let list = [...mockWorkflowDataSources];
    if (keyword) list = list.filter((x) => x.name.includes(keyword) || x.url.includes(keyword));
    if (query.status) list = list.filter((x) => x.status === query.status);
    return ok(paginate(list));
  }),

  mock(workflowDataSourceContract.detail, ({ params, ok }) => {
    const item = mockWorkflowDataSources.find((x) => x.id === params.id);
    if (!item) return notFound('数据源不存在', { status: 404 });
    return ok(item);
  }),

  mock(workflowDataSourceContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const item: WorkflowDataSource = {
      id: getNextDataSourceId(),
      name: body.name,
      method: body.method,
      url: body.url,
      headers: body.headers ?? null,
      itemsPath: body.itemsPath ?? null,
      valueField: body.valueField,
      labelField: body.labelField,
      keywordParam: body.keywordParam ?? null,
      status: body.status,
      remark: body.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockWorkflowDataSources.push(item);
    return ok(item, '创建成功');
  }),

  mock(workflowDataSourceContract.update, ({ params, body, ok }) => {
    const idx = mockWorkflowDataSources.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('数据源不存在', { status: 404 });
    Object.assign(mockWorkflowDataSources[idx], { ...body, updatedAt: mockDateTime() });
    return ok(mockWorkflowDataSources[idx], '更新成功');
  }),

  mock(workflowDataSourceContract.remove, ({ params, ok }) => {
    const idx = mockWorkflowDataSources.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('数据源不存在', { status: 404 });
    mockWorkflowDataSources.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];
