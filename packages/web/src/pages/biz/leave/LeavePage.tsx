/** 业务表单直接承载流程预览、当前审批与往次记录。 */
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import EntityRelationButton from '@/components/entity-relations/EntityRelationButton';
import { entityRelationColumn } from '@/components/entity-relations/entity-relation-columns';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { Button, Form, Modal, Space, Spin, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import dayjs from 'dayjs';
import { BIZ_LEAVE_STATUS_LABELS, BIZ_LEAVE_TYPES, bizLeaveContract, type BizLeave, type BizLeaveStatus, type CreateBizLeaveInput } from '@zenith/shared/biz';
import { enumValueOf } from '@zenith/shared/core';
import ConfigurableTable from '@/components/ConfigurableTable';
import WorkflowSideSheet from '@/components/workflow/WorkflowSideSheet';
import { useDictItems } from '@/hooks/useDictItems';
import { usePermission } from '@/hooks/usePermission';
import { formatDateRangeValuesForApi } from '@/utils/date';
import { createdAtColumn, DATE_RANGE_COLUMN_WIDTH, renderEllipsis } from '@/utils/table-columns';
import {
  useBizLeaveList, useBizLeaveRecord, useDeleteBizLeave, useReopenBizLeave,
  useSaveBizLeave, useSubmitBizLeave, useBizLeaveWorkflowPreview, useBizLeaveWorkflowContext,
} from '@/hooks/queries/biz-leave';
import { ListSearchToolbar, useCrudOperationColumn } from '@/components/list-page';
import { CreateButton } from '@/components/toolbar-controls';
import { useEditModal } from '@/hooks/useEditModal';
import { abortSubmit } from '@/lib/abort-submit';
import { useListPage } from '@/hooks/useListPage';
import { useListDeepLink } from '@/hooks/useListDeepLink';
import LeaveDetails from './LeaveDetails';

const BusinessWorkflowPanel = lazy(() => import('@/components/workflow/BusinessWorkflowPanel'));
const STATUS_COLORS: Record<BizLeaveStatus, 'grey' | 'blue' | 'green' | 'red' | 'orange'> = {
  draft: 'grey', pending: 'blue', approved: 'green', rejected: 'red', cancelled: 'orange',
};

function leaveValues(record: BizLeave): Record<string, unknown> {
  return {
    leaveType: record.leaveType,
    dateRange: [dayjs(record.startDate).toDate(), dayjs(record.endDate).toDate()],
    days: record.days, reason: record.reason ?? '',
  };
}

function payloadFromValues(values: Record<string, unknown>): CreateBizLeaveInput {
  if (!values) return abortSubmit('validation');
  const leaveType = enumValueOf(BIZ_LEAVE_TYPES, values.leaveType);
  if (!leaveType) { Toast.error('请选择请假类型'); return abortSubmit('validation'); }
  const range = values.dateRange as [Date, Date] | undefined;
  if (!range?.[0] || !range[1]) { Toast.error('请选择请假日期'); return abortSubmit('validation'); }
  const [startDate, endDate] = formatDateRangeValuesForApi(range);
  return { leaveType, startDate, endDate, days: Number(values.days), reason: (values.reason as string) || null };
}

/** Semi 的 getFormApi 在构造阶段触发；表单提交到 DOM 后才允许父页面启用操作。 */
function LeaveFormReady({ onReady }: Readonly<{ onReady: () => void }>) {
  useLayoutEffect(() => { onReady(); }, [onReady]);
  return null;
}

export default function LeavePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const leaveKey = searchParams.get('leaveId');
  const deepLinkedId = leaveKey && /^[1-9]\d*$/.test(leaveKey) && Number.isSafeInteger(Number(leaveKey)) ? Number(leaveKey) : undefined;
  const deepLinked = useBizLeaveRecord(deepLinkedId);
  const { hasPermission } = usePermission();
  const { options: leaveTypeOptions, getLabel: getLeaveTypeLabel } = useDictItems('leave_type');
  const page = useListPage({ contract: bizLeaveContract, useList: useBizLeaveList });
  useListDeepLink(['keyword'], (params) => page.applySearch({ keyword: params.keyword ?? '', status: undefined }));
  const saveMutation = useSaveBizLeave();
  const submitMutation = useSubmitBizLeave();
  const deleteMutation = useDeleteBizLeave();
  const reopenMutation = useReopenBizLeave();
  const [mode, setMode] = useState<'edit' | 'view'>('edit');
  const [formReady, setFormReady] = useState(false);
  const handleFormReady = useCallback(() => setFormReady(true), []);
  const [selectedInstanceId, setSelectedInstanceId] = useState<number>();
  // 预览/往次记录切换不丢失尚未保存的字段，业务值仍由业务保存接口持久化。
  const [formValues, setFormValues] = useState<Record<string, unknown> | null>(null);
  const modal = useEditModal<BizLeave, Record<string, unknown>, Partial<CreateBizLeaveInput>>({
    save: saveMutation, useDetail: useBizLeaveRecord, defaults: {},
    toValues: leaveValues, beforeSave: payloadFromValues,
  });
  const editing = modal.editing;
  const openLinkedRecord = modal.openEdit;
  useEffect(() => {
    if (!deepLinkedId || !deepLinked.data) return;
    setMode('view'); setSelectedInstanceId(undefined); setFormValues(null);
    openLinkedRecord(deepLinked.data);
    const next = new URLSearchParams(searchParams);
    next.delete('leaveId');
    setSearchParams(next, { replace: true });
  }, [deepLinkedId, deepLinked.data, openLinkedRecord, searchParams, setSearchParams]);
  const canEdit = mode === 'edit' && (!editing || editing.status === 'draft') && selectedInstanceId === undefined;
  const showPreview = (!editing || editing.status === 'draft') && selectedInstanceId === undefined;
  const previewBody = useMemo(() => {
    const values = formValues ?? (editing ? leaveValues(editing) : {});
    const days = Number(values.days);
    return {
      days: Number.isFinite(days) && days > 0 ? days : undefined,
      leaveType: enumValueOf(BIZ_LEAVE_TYPES, values.leaveType) ?? undefined,
    };
  }, [formValues, editing]);
  const [debouncedPreview] = useDebouncedValue(previewBody, { wait: 400 });
  const preview = useBizLeaveWorkflowPreview(debouncedPreview, modal.visible && showPreview);
  const context = useBizLeaveWorkflowContext(editing?.id, selectedInstanceId, modal.visible);
  const saving = saveMutation.isPending;
  const submitting = submitMutation.isPending;
  const busy = saving || submitting || modal.detailLoading;

  const openCreate = () => {
    setFormReady(false);
    setMode('edit'); setSelectedInstanceId(undefined); setFormValues(null); modal.openCreate();
  };
  const openEdit = (record: BizLeave) => {
    setFormReady(false);
    setMode('edit'); setSelectedInstanceId(undefined); setFormValues(null); modal.openEdit(record);
  };
  const openDetails = (record: BizLeave) => {
    setMode('view'); setSelectedInstanceId(undefined); setFormValues(null); modal.openEdit(record);
  };
  const submitFromForm = async () => {
    let values: Record<string, unknown>;
    try { values = await modal.formApi.current!.validate() as Record<string, unknown>; } catch { return; }
    const payload = payloadFromValues(values);
    const saved = await saveMutation.mutateAsync({ id: editing?.id, values: payload });
    // 保存成功而提审失败时保留该草稿 ID，重试不会再创建另一张请假单。
    modal.openEdit(saved);
    const submitted = await submitMutation.mutateAsync({ params: { id: saved.id } });
    Toast.success('已提交审批');
    openDetails(submitted);
  };
  const submitFromList = async (record: BizLeave) => {
    const submitted = await submitMutation.mutateAsync({ params: { id: record.id } });
    Toast.success('已提交审批'); openDetails(submitted);
  };
  const reopen = async (record: BizLeave) => {
    const fresh = await reopenMutation.mutateAsync({ params: { id: record.id } });
    Toast.success('已转为草稿，编辑后可重新提交审批'); openEdit(fresh);
  };
  const operationColumn = useCrudOperationColumn<BizLeave>({
    edit: openEdit, remove: deleteMutation,
    hidden: { edit: (record) => record.status !== 'draft', remove: (record) => record.status !== 'draft' },
    title: '确定删除吗？', successMessage: '已删除',
    extraBetween: (record) => [
      { key: 'submit', label: '提交审批', type: 'primary', hidden: record.status !== 'draft',
        onClick: () => { Modal.confirm({ title: '确定提交审批吗？', onOk: () => submitFromList(record) }); } },
      { key: 'workflow', label: '查看详情', onClick: () => openDetails(record) },
      { key: 'reopen', label: '重新编辑', hidden: record.status !== 'rejected' && record.status !== 'cancelled',
        onClick: () => { Modal.confirm({ title: '重新编辑该请假单？', content: '转回草稿后可修改，再次提交将发起新一轮审批。', onOk: () => reopen(record) }); } },
    ],
    width: 200, desktopInlineKeys: ['edit', 'workflow'],
  });
  const columns: ColumnProps<BizLeave>[] = [
    entityRelationColumn<BizLeave>('biz.leave'),
    { title: '请假类型', dataIndex: 'leaveType', width: 110, render: (v: string) => getLeaveTypeLabel(v) },
    { title: '日期', key: 'dateRange', width: DATE_RANGE_COLUMN_WIDTH,
      render: (_: unknown, record: BizLeave) => <span style={{ whiteSpace: 'nowrap' }}>{record.startDate} ~ {record.endDate}</span> },
    { title: '天数', dataIndex: 'days', width: 90, align: 'right', render: (v: number) => `${v} 天` },
    { title: '事由', dataIndex: 'reason', render: renderEllipsis },
    createdAtColumn as ColumnProps<BizLeave>,
    { title: '状态', dataIndex: 'status', width: 110, fixed: 'right', render: (v: BizLeaveStatus) => <Tag color={STATUS_COLORS[v]}>{BIZ_LEAVE_STATUS_LABELS[v]}</Tag> },
    operationColumn,
  ];
  const formContent = canEdit ? (
    <Form key={modal.formKey} {...modal.formProps} initValues={formValues ?? modal.formProps.initValues}
      onValueChange={(values: Record<string, unknown>, changed: Record<string, unknown>) => {
        setFormValues(values);
        if (!('dateRange' in changed)) return;
        const range = values.dateRange as [Date, Date] | undefined;
        if (!range?.[0] || !range[1]) return;
        const days = dayjs(range[1]).startOf('day').diff(dayjs(range[0]).startOf('day'), 'day') + 1;
        if (days > 0) modal.formApi.current?.setValue('days', days);
      }}>
      <LeaveFormReady onReady={handleFormReady} />
      <Form.Select field="leaveType" label="请假类型" optionList={leaveTypeOptions} rules={[{ required: true, message: '请选择请假类型' }]} style={{ width: '100%' }} />
      <Form.DatePicker field="dateRange" label="请假日期" type="dateRange" style={{ width: '100%' }} rules={[{ required: true, message: '请选择请假日期' }]} />
      <Form.InputNumber field="days" label="天数" min={0.5} step={0.5} style={{ width: '100%' }} rules={[{ required: true, message: '请输入天数' }]} />
      <Form.TextArea field="reason" label="事由" autosize rows={2} maxCount={500} />
    </Form>
  ) : <><LeaveDetails data={editing} />{editing && <EntityRelationButton entityRef={{ type: 'biz.leave', key: String(editing.id) }} />}</>;
  const instanceId = context.data?.instance?.id;
  const canOpenWorkflow = hasPermission('workflow:instance:list') || hasPermission('workflow:task:handle') || hasPermission('workflow:instance:monitor');

  return (
    <div className="page-container">
      <ListSearchToolbar page={page} filters={['keyword', 'status']} create={<CreateButton onClick={openCreate}>新建请假</CreateButton>} />
      <ConfigurableTable<BizLeave> columns={columns} columnSettingsKey="biz-leave" {...page.tableProps} />
      <WorkflowSideSheet title={canEdit ? (editing ? '编辑请假单' : '新建请假单') : '请假详情'}
        visible={modal.visible} onCancel={modal.close} variant="split"
        footerLeft={instanceId && canOpenWorkflow
          ? <Button onClick={() => navigate(`/workflow/instance/${instanceId}`, { state: { tabTitle: '请假审批' } })}>在新页签打开</Button> : null}
        footerRight={canEdit ? (
          <Space>
            <Button disabled={saving || submitting} onClick={modal.close}>取消</Button>
            <Button loading={saving} disabled={busy || !formReady} onClick={() => void modal.modalProps.onOk()}>保存草稿</Button>
            <Button type="primary" loading={submitting} disabled={busy || !formReady || preview.isError || !preview.data?.definition} onClick={() => void submitFromForm()}>提交审批</Button>
          </Space>
        ) : <Button onClick={modal.close}>关闭</Button>}
      >
        {modal.visible && <Suspense fallback={<Spin />}>
          <BusinessWorkflowPanel formContent={formContent} preview={preview.data} context={context.data}
            loading={context.isLoading || (showPreview && preview.isLoading)}
            error={context.error ?? (showPreview ? preview.error : null)}
            selectedInstanceId={selectedInstanceId} onSelectInstance={setSelectedInstanceId}
            onRetry={() => { if (editing) void context.refetch(); if (showPreview) void preview.refetch(); }} />
        </Suspense>}
      </WorkflowSideSheet>
    </div>
  );
}
