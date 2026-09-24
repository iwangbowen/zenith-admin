/* eslint-disable react-refresh/only-export-components -- 表单页复用办理策略编辑 hook，非独立路由入口。 */
import { useState } from 'react';
import { Banner, Form, Tag } from '@douyinfe/semi-ui';
import { cmsOperationsContract, CMS_FEEDBACK_STATUS_LABELS, CMS_FEEDBACK_STATUS_OPTIONS, type CmsFeedback, type CmsFormHandlingPolicy } from '@zenith/shared/cms';
import type { BodyOf } from '@zenith/shared/core';
import { useCmsFeedbackList, useCmsFormHandlingPolicy, useCmsHandlingWorkflows, useCmsOperationsAssignees, useSaveCmsFormHandlingPolicy } from '@/hooks/queries/cms-operations';
import { useListPage } from '@/hooks/useListPage';
import { useEditModal } from '@/hooks/useEditModal';
import { ListSearchToolbar } from '@/components/list-page';
import { FilterSelect } from '@/components/search-filters';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { EditFormSheet } from '@/components/EditFormModal';
import { dateTimeColumn } from '@/utils/table-columns';
import CmsFeedbackSheet from './CmsFeedbackSheet';

export default function CmsFeedbackList({ siteId, formId, selectedId, onSelect }: Readonly<{ siteId?: number; formId?: number; selectedId?: number; onSelect?: (id?: number) => void }>) {
  const [localId, setLocalId] = useState<number>();
  const select = onSelect ?? setLocalId;
  const page = useListPage({ op: cmsOperationsContract.feedback, useList: useCmsFeedbackList, params: { siteId: siteId ?? 0, formId }, enabled: !!siteId, resetKey: `${siteId}:${formId}`, table: { empty: '暂无读者反馈' } });
  return <>
    <ListSearchToolbar page={page} filters={['keyword', 'status']} overrides={{ status: (p) => <FilterSelect {...p.bind('status')} placeholder="全部办理状态" items={CMS_FEEDBACK_STATUS_OPTIONS} /> }} />
    <ConfigurableTable<CmsFeedback> columns={[
      { title: '来信标题', dataIndex: 'title', minWidth: 240 },
      { title: '表单', dataIndex: 'formName', width: 140 },
      { title: '状态', width: 100, render: (_, row) => <Tag>{CMS_FEEDBACK_STATUS_LABELS[row.status]}</Tag> },
      { title: '负责人', dataIndex: 'ownerName', width: 100, render: (value) => value ?? '未分派' },
      dateTimeColumn('截止时间', 'dueAt'), dateTimeColumn('收到时间', 'createdAt'),
      createOperationColumn<CmsFeedback>({ width: 90, desktopInlineKeys: ['handle'], actions: (row) => [{ key: 'handle', label: '查看办理', onClick: () => select(row.id) }] }),
    ]} {...page.tableProps} />
    {(selectedId ?? localId) ? <CmsFeedbackSheet key={selectedId ?? localId} id={selectedId ?? localId} onClose={() => select(undefined)} /> : null}
  </>;
}

function usePolicyDetail(id?: number) {
  const query = useCmsFormHandlingPolicy(id);
  return { ...query, data: query.data ? { ...query.data, id: query.data.formId } : undefined };
}
export function useCmsHandlingPolicyEditor() {
  const mutation = useSaveCmsFormHandlingPolicy();
  const modal = useEditModal<CmsFormHandlingPolicy & { id: number }, Partial<BodyOf<typeof cmsOperationsContract.saveHandlingPolicy>>>({
    entityName: '来信办理策略', useDetail: usePolicyDetail,
    save: { isPending: mutation.isPending, mutateAsync: async ({ id, values }) => { const result = await mutation.mutateAsync({ params: { id: id! }, body: { expectedVersion: values.expectedVersion ?? 0, defaultOwnerId: values.defaultOwnerId ?? null, workflowDefinitionId: values.workflowDefinitionId ?? null } }); return { ...result, id: result.formId }; } },
    toValues: (row) => ({ defaultOwnerId: row.defaultOwnerId, workflowDefinitionId: row.workflowDefinitionId, expectedVersion: row.version }),
  });
  const assignees = useCmsOperationsAssignees(modal.visible);
  const workflows = useCmsHandlingWorkflows(modal.visible);
  return { open: (formId: number) => modal.openEdit({ id: formId, formId, version: 0, defaultOwnerId: null, workflowDefinitionId: null, workflowName: null }), editor: <EditFormSheet modal={modal} width={680}>
    <Banner type="info" description="设置仅应用于之后收到的新来信。既有来信保留收件时的审批策略。" style={{ marginBottom: 16 }} />
    <Form.Select field="defaultOwnerId" label="默认负责人" filter showClear loading={assignees.isFetching} optionList={(assignees.data ?? []).map((user) => ({ value: user.id, label: user.name }))} style={{ width: '100%' }} />
    <Form.Select field="workflowDefinitionId" label="办理审批" filter showClear loading={workflows.isFetching} optionList={(workflows.data ?? []).map((flow) => ({ value: flow.id, label: flow.name }))} placeholder="不启用审批，由办理人直接完成" style={{ width: '100%' }} extraText="仅可选已发布的 CMS 来信办理流程；审批通过后自动完成办理。" />
    {assignees.isError || workflows.isError ? <Banner type="warning" description="配置选项加载失败，请关闭后重试。" /> : null}
  </EditFormSheet> };
}
