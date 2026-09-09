/**
 * 业务接入示例：请假管理（业务模块自有列表页）
 *
 * 演示「业务模块自存数据 + 工作流编排」：请假数据存 biz_leaves，提交审批时由后端
 * 通过 workflow-biz-bridge 发起并关联工作流；列表展示业务状态，详情跳转到流程实例整页。
 */
import { useNavigate } from 'react-router-dom';
import { Button, Form, Modal, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Send } from 'lucide-react';
import dayjs from 'dayjs';
import { BIZ_LEAVE_TYPES, type BizLeave, type CreateBizLeaveInput } from '@zenith/shared/biz';
import { enumValueOf } from '@zenith/shared/core';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { useDictItems } from '@/hooks/useDictItems';
import { useListSearch } from '@/hooks/useListSearch';
import { formatDateForApi } from '@/utils/date';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import {
  bizLeaveKeys,
  useBizLeaveList,
  useDeleteBizLeave,
  useReopenBizLeave,
  useSaveBizLeave,
  useSubmitBizLeave,
} from '@/hooks/queries/biz-leave';
import { CreateButton } from '@/components/toolbar-controls';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { useEditModal } from '@/hooks/useEditModal';
import { abortSubmit } from '@/lib/abort-submit';

type TagColor = 'grey' | 'blue' | 'green' | 'red' | 'orange';

const STATUS_MAP: Record<string, { text: string; color: TagColor }> = {
  draft: { text: '草稿', color: 'grey' },
  pending: { text: '审批中', color: 'blue' },
  approved: { text: '已通过', color: 'green' },
  rejected: { text: '已驳回', color: 'red' },
  cancelled: { text: '已取消', color: 'orange' },
};

interface LeaveSearchParams {
  keyword: string;
  status?: BizLeave['status'];
}

const DEFAULT_LEAVE_SEARCH_PARAMS: LeaveSearchParams = {
  keyword: '',
  status: undefined,
};

export default function LeavePage() {
  const navigate = useNavigate();
  const { items: leaveTypeItems, getLabel: getLeaveTypeLabel } = useDictItems('leave_type');
  const {
    page, pageSize, buildPagination,
    draftParams, setField, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<LeaveSearchParams>({ defaults: DEFAULT_LEAVE_SEARCH_PARAMS, listKey: bizLeaveKeys.lists });

  const listQuery = useBizLeaveList({
    page,
    pageSize,
    keyword: submittedParams.keyword.trim() || undefined,
    status: submittedParams.status || undefined,
  });
  const saveMutation = useSaveBizLeave();
  const saveForApprovalMutation = useSaveBizLeave();
  const submitApprovalMutation = useSubmitBizLeave();
  const submitFromListMutation = useSubmitBizLeave();
  const deleteMutation = useDeleteBizLeave();
  const reopenMutation = useReopenBizLeave();
  const saving = saveMutation.isPending;
  const submittingApproval = saveForApprovalMutation.isPending || submitApprovalMutation.isPending;
  const modal = useEditModal<BizLeave, Record<string, unknown>, Partial<CreateBizLeaveInput>>({
    save: saveMutation,
    defaults: {},
    toValues: (record) => ({
      leaveType: record.leaveType,
      dateRange: [dayjs(record.startDate).toDate(), dayjs(record.endDate).toDate()],
      days: record.days,
      reason: record.reason ?? '',
    }),
    beforeSave: (values) => {
      const payload = payloadFromValues(values);
      if (!payload) abortSubmit('validation');
      return payload;
    },
    successMessage: () => '保存成功',
  });

  const openCreate = modal.openCreate;
  const openEdit = modal.openEdit;

  const payloadFromValues = (values: Record<string, unknown>): CreateBizLeaveInput | null => {
    const leaveType = enumValueOf(BIZ_LEAVE_TYPES, values.leaveType);
    if (!leaveType) { Toast.error('请选择请假类型'); return null; }
    const range = values.dateRange as [Date, Date] | undefined;
    if (!range || range.length !== 2) { Toast.error('请选择请假日期'); return null; }
    return {
      leaveType,
      startDate: formatDateForApi(range[0]),
      endDate: formatDateForApi(range[1]),
      days: Number(values.days),
      reason: (values.reason as string) || null,
    };
  };

  const collectPayload = async () => {
    if (!modal.formApi.current) return null;
    let values: Record<string, unknown>;
    try { values = await modal.formApi.current.validate() as Record<string, unknown>; } catch { return; }
    return payloadFromValues(values);
  };

  const saveLeave = async (
    payload: Awaited<ReturnType<typeof collectPayload>>,
    mutation: typeof saveMutation,
  ) => {
    if (!payload) return null;
    return mutation.mutateAsync({ id: modal.editing?.id, values: payload });
  };

  const handleSubmit = async () => {
    const payload = await collectPayload();
    if (!payload) return;
    const saved = await saveLeave(payload, saveMutation);
    if (saved) { Toast.success('保存成功'); modal.close(); }
  };

  const handleSubmitFromModal = async () => {
    const payload = await collectPayload();
    if (!payload) return;
    const saved = await saveLeave(payload, saveForApprovalMutation);
    if (!saved) return;
    await submitApprovalMutation.mutateAsync({ params: { id: saved.id } });
    Toast.success('已提交审批');
    modal.close();
  };


  const handleSubmitApproval = async (id: number) => {
    await submitFromListMutation.mutateAsync({ params: { id } });
    Toast.success('已提交审批');
  };

  /** 驳回/取消后重新编辑：转回草稿并打开编辑弹窗，修改后再次提交将发起新流程 */
  const handleReopen = async (record: BizLeave) => {
    const fresh = await reopenMutation.mutateAsync({ params: { id: record.id } });
    Toast.success('已转为草稿，编辑后可重新提交审批');
    openEdit(fresh);
  };

  const openWorkflow = (record: BizLeave) => {
    if (!record.workflowInstanceId) return;
    navigate(`/workflow/instance/${record.workflowInstanceId}`, { state: { tabTitle: `请假审批 - ${record.applicantName ?? ''}` } });
  };

  const columns: ColumnProps<BizLeave>[] = [
    { title: '请假类型', dataIndex: 'leaveType', width: 110, render: (v: string) => getLeaveTypeLabel(v) },
    { title: '日期', width: 200, render: (_: unknown, r: BizLeave) => `${r.startDate} ~ ${r.endDate}` },
    { title: '天数', dataIndex: 'days', width: 90, align: 'right', render: (v: number) => `${v} 天` },
    { title: '事由', dataIndex: 'reason', render: renderEllipsis },
    createdAtColumn as ColumnProps<BizLeave>,
    {
      title: '状态', dataIndex: 'status', width: 110, fixed: 'right',
      render: (v: string) => { const s = STATUS_MAP[v]; return s ? <Tag color={s.color}>{s.text}</Tag> : <span>{v}</span>; },
    },
    createOperationColumn<BizLeave>({
      // 草稿只有「编辑」（流程实例在转回草稿时清空），其余状态只有「流程详情」；低频动作进更多
      width: 150,
      desktopInlineKeys: ['edit', 'workflow'],
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: record.status !== 'draft',
          onClick: () => openEdit(record),
        },
        {
          key: 'submit',
          label: '提交审批',
          type: 'primary',
          hidden: record.status !== 'draft',
          onClick: () => {
            Modal.confirm({
              title: '确定提交审批吗？',
              onOk: () => handleSubmitApproval(record.id),
            });
          },
        },
        {
          key: 'workflow',
          label: '流程详情',
          hidden: !record.workflowInstanceId,
          onClick: () => openWorkflow(record),
        },
        {
          key: 'reopen',
          label: '重新编辑',
          hidden: record.status !== 'rejected' && record.status !== 'cancelled',
          onClick: () => {
            Modal.confirm({
              title: '重新编辑该请假单？',
              content: '将转回草稿状态，修改后可再次提交审批（届时发起新的审批流程）。',
              onOk: () => handleReopen(record),
            });
          },
        },
        deleteAction({
          hidden: record.status !== 'draft',
          title: '确定删除吗？',
          run: () => deleteMutation.mutateAsync([record.id]),
          successMessage: '已删除',
        }),
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="搜索事由" value={draftParams.keyword} onChange={setField('keyword')} onSearch={handleSearch} />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={Object.entries(STATUS_MAP).map(([value, s]) => ({ value, label: s.text }))}
      value={draftParams.status}
      onChange={(value) => setField('status')(value as LeaveSearchParams['status'] | undefined)}
    />
  );

  const renderCreateButton = () => <CreateButton onClick={openCreate}>新建请假</CreateButton>;

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={renderKeywordSearch()}
        filters={renderStatusFilter()}
        onSearch={handleSearch}
        onReset={handleReset}
        create={renderCreateButton()}
        filterTitle="请假筛选"
      />

      <ConfigurableTable<BizLeave>
        columns={columns}
        columnSettingsKey="biz-leave"
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <Modal
        title={modal.isEdit ? '编辑请假单' : '新建请假单'}
        visible={modal.visible}
        onCancel={modal.close}
        footer={(
          <Space>
            <Button onClick={modal.close}>取消</Button>
            <Button loading={saving} disabled={submittingApproval} onClick={() => void handleSubmit()}>保存草稿</Button>
            <Button type="primary" loading={submittingApproval} disabled={saving} onClick={() => void handleSubmitFromModal()}>提交审批</Button>
          </Space>
        )}
        closeOnEsc
        width={520}
      >
        <Form key={modal.formKey} {...modal.formProps}
          onValueChange={(values: Record<string, unknown>, changed: Record<string, unknown>) => {
            // 选完日期区间自动按自然日算天数（含首尾），仍可手动改成 0.5 步进的实际天数
            if (!('dateRange' in changed)) return;
            const range = values.dateRange as [Date, Date] | undefined;
            if (!range || range.length !== 2 || !range[0] || !range[1]) return;
            const days = dayjs(range[1]).startOf('day').diff(dayjs(range[0]).startOf('day'), 'day') + 1;
            if (days > 0) modal.formApi.current?.setValue('days', days);
          }}>
          <Form.Select field="leaveType" label="请假类型" optionList={leaveTypeItems.map((i) => ({ value: i.value, label: i.label }))} rules={[{ required: true, message: '请选择请假类型' }]} style={{ width: '100%' }} />
          <Form.DatePicker field="dateRange" label="请假日期" type="dateRange" style={{ width: '100%' }} rules={[{ required: true, message: '请选择请假日期' }]} />
          <Form.InputNumber field="days" label="天数" min={0.5} step={0.5} style={{ width: '100%' }} rules={[{ required: true, message: '请输入天数' }]} />
          <Form.TextArea field="reason" label="事由" autosize rows={2} maxCount={500} />
        </Form>
        <Typography.Text type="tertiary" size="small">
          <Send size={12} style={{ verticalAlign: -2, marginRight: 4 }} />可保存为草稿稍后提交，也可直接「提交审批」发起请假审批流程。
        </Typography.Text>
      </Modal>
    </div>
  );
}
