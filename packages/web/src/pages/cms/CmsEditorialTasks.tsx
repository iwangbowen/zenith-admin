/* eslint-disable react-refresh/only-export-components -- 私有事项编辑 hook 与其业务面板共用侧栏实现。 */
import { useEffect, useRef, useState } from 'react';
import { Banner, Button, Form, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import type { BodyOf } from '@zenith/shared/core';
import { cmsOperationsContract, CMS_EDITORIAL_TASK_SOURCE_LABELS, CMS_EDITORIAL_TASK_STATUS_LABELS, CMS_EDITORIAL_TASK_STATUS_OPTIONS, type CmsEditorialTask } from '@zenith/shared/cms';
import { useCmsContentList } from '@/hooks/queries/cms';
import { useCmsEditorialTaskDetail, useCmsEditorialTasks, useCmsOperationsAssignees, useSaveCmsEditorialTask } from '@/hooks/queries/cms-operations';
import { useEditModal } from '@/hooks/useEditModal';
import { useListPage } from '@/hooks/useListPage';
import { usePermission } from '@/hooks/usePermission';
import { EditFormSheet } from '@/components/EditFormModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { ListSearchToolbar } from '@/components/list-page';
import { FilterSelect } from '@/components/search-filters';
import { dateTimeColumn } from '@/utils/table-columns';
import { formatDateTimeForApi } from '@/utils/date';

type TaskValues = Partial<BodyOf<typeof cmsOperationsContract.createTask> & BodyOf<typeof cmsOperationsContract.updateTask>>;

export function useCmsTaskEditor(siteId?: number) {
  const { hasPermission } = usePermission();
  const save = useSaveCmsEditorialTask();
  const modal = useEditModal<CmsEditorialTask, TaskValues>({
    entityName: '编辑事项', save, useDetail: useCmsEditorialTaskDetail,
    defaults: { source: 'manual', description: '' },
    toValues: (record) => ({ title: record.title, description: record.description, ownerId: record.ownerId, dueAt: record.dueAt, contentId: record.contentId, status: record.status, expectedVersion: record.version }),
    beforeSave: (values, { editing }) => ({ ...values, ownerId: values.ownerId ?? null, contentId: values.contentId ?? null,
      dueAt: values.dueAt ? formatDateTimeForApi(values.dueAt) : null,
      ...(editing ? { expectedVersion: values.expectedVersion } : { siteId, source: 'manual' as const }),
    }),
  });
  const assignees = useCmsOperationsAssignees(modal.visible);
  const [keyword, setKeyword] = useState('');
  const contents = useCmsContentList({ siteId: siteId ?? 0, page: 1, pageSize: 50, keyword }, modal.visible && !!siteId && hasPermission('cms:content:list'));
  const options = (contents.data?.list ?? []).map((content) => ({ value: content.id, label: `${content.title}（${content.status}）` }));
  if (modal.editing?.contentId && !options.some((option) => option.value === modal.editing?.contentId)) options.push({ value: modal.editing.contentId, label: modal.editing.contentTitle ?? `稿件 #${modal.editing.contentId}` });
  return { ...modal, editor: <EditFormSheet modal={modal} width={760}>
    {modal.editing ? <Typography.Paragraph type="secondary">来源：{CMS_EDITORIAL_TASK_SOURCE_LABELS[modal.editing.source]}{modal.editing.sourceKeyword ? ` · ${modal.editing.sourceKeyword}` : ''}{modal.editing.feedbackId ? ` · 来信 #${modal.editing.feedbackId}` : ''}</Typography.Paragraph> : null}
    <Form.Input field="title" label="事项标题" maxLength={255} rules={[{ required: true, message: '请输入事项标题' }]} />
    <Form.TextArea field="description" label="选题与处理说明" maxCount={5000} rows={4} />
    <Form.Select field="ownerId" label="负责人" showClear filter optionList={(assignees.data ?? []).map((user) => ({ value: user.id, label: user.name }))} loading={assignees.isFetching} style={{ width: '100%' }} />
    <Form.DatePicker field="dueAt" label="截止时间" type="dateTime" showClear style={{ width: '100%' }} />
    <Form.Select field="contentId" label="关联稿件" showClear remote filter onSearch={setKeyword} optionList={options} loading={contents.isFetching} disabled={!hasPermission('cms:content:list')} style={{ width: '100%' }} extraText="输入标题搜索本站稿件。来自搜索或来信的事项，完成前须关联处理稿件。" />
    {modal.isEdit ? <Form.Select field="status" label="事项状态" optionList={CMS_EDITORIAL_TASK_STATUS_OPTIONS} style={{ width: '100%' }} /> : null}
    {assignees.isError || contents.isError ? <Banner type="warning" description="人员或稿件选项加载失败，请关闭后重试。" /> : null}
  </EditFormSheet> };
}

export default function CmsEditorialTasks({ siteId, initialTaskId, onTaskOpened }: Readonly<{ siteId: number; initialTaskId?: number; onTaskOpened?: () => void }>) {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const editor = useCmsTaskEditor(siteId);
  const selected = useCmsEditorialTaskDetail(initialTaskId, !!initialTaskId && hasPermission('cms:editorial-task:manage'));
  const opened = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!initialTaskId) { opened.current = undefined; return; }
    if (selected.data && selected.data.siteId === siteId && selected.data.id !== opened.current) { opened.current = selected.data.id; editor.openEdit(selected.data); onTaskOpened?.(); }
  }, [initialTaskId, selected.data, siteId, editor.openEdit, onTaskOpened]);
  const page = useListPage({ op: cmsOperationsContract.tasks, useList: useCmsEditorialTasks, params: { siteId }, resetKey: siteId, table: { empty: '暂无编辑事项' } });
  return <>
    {selected.isError ? <Banner type="warning" description={selected.error.message} /> : null}
    <ListSearchToolbar page={page} filters={['keyword', 'status']} overrides={{ status: (p) => <FilterSelect {...p.bind('status')} placeholder="全部事项状态" items={CMS_EDITORIAL_TASK_STATUS_OPTIONS} /> }} create={hasPermission('cms:editorial-task:manage') ? <Button theme="solid" onClick={editor.openCreate}>新建事项</Button> : undefined} />
    <ConfigurableTable<CmsEditorialTask> columns={[
      { title: '事项', dataIndex: 'title', minWidth: 200 },
      { title: '来源', width: 110, render: (_, row) => CMS_EDITORIAL_TASK_SOURCE_LABELS[row.source] },
      { title: '状态', width: 100, render: (_, row) => <Tag>{CMS_EDITORIAL_TASK_STATUS_LABELS[row.status]}</Tag> },
      { title: '负责人', dataIndex: 'ownerName', width: 100, render: (value) => value ?? '未分派' },
      dateTimeColumn('截止时间', 'dueAt'),
      { title: '关联稿件', width: 240, render: (_, row) => row.contentId ? <Space vertical align="start" spacing={4}><Button theme="borderless" onClick={() => navigate(`/cms/contents/edit?id=${row.contentId}&site=${siteId}`)}>{row.contentTitle ?? `稿件 #${row.contentId}`}</Button><Typography.Text type="tertiary">{row.contentStatus === 'published' ? '已上线' : '尚未上线'}{row.hasUnpublishedChanges ? ' · 有未发布修改' : ''}</Typography.Text></Space> : '未关联' },
      createOperationColumn<CmsEditorialTask>({ width: 90, desktopInlineKeys: ['edit'], actions: (row) => hasPermission('cms:editorial-task:manage') ? [{ key: 'edit', label: '编辑', onClick: () => editor.openEdit(row) }] : [] }),
    ]} {...page.tableProps} />
    {editor.editor}
  </>;
}
