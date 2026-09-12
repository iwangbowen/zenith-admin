import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Empty,
  Modal,
  Popconfirm,
  Select,
  SideSheet,
  Space,
  Spin,
  TextArea,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ExternalLink, Megaphone, Plus, Undo2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { WorkflowDefinition, WorkflowInstance } from '@zenith/shared/workflow';
import { buildWorkflowSummaryItems, WORKFLOW_INSTANCE_PRIORITIES, WORKFLOW_INSTANCE_STATUSES } from '@zenith/shared/workflow';
import { enumValueOf } from '@zenith/shared/core';
import SavedViewsBar from '@/components/workflow/SavedViewsBar';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { AppModal } from '@/components/AppModal';
import WorkflowInstanceDetailPanel from '@/components/workflow/WorkflowInstanceDetailPanel';
import WorkflowLaunchForm, { type WorkflowLaunchFormHandle } from '@/components/workflow/WorkflowLaunchForm';
import WorkflowPriorityTag, { WORKFLOW_PRIORITY_OPTIONS } from '@/components/workflow/WorkflowPriorityTag';
import { INSTANCE_STATUS_MAP } from '@/components/workflow/workflow-runtime';
import { useWorkflowCategories } from '@/hooks/useWorkflowCategories';
import { dateTimeColumn, renderEllipsis } from '../../../utils/table-columns';
import { normalizeWorkflowFormSnapshot, resolveWorkflowFormType } from '@/utils/workflow-snapshot';
import WorkflowSummaryLine from '@/components/workflow/WorkflowSummaryLine';
import { useWorkflowInstanceWithDefinition, useWorkflowSelectableUsers } from '@/hooks/queries/workflow-shared';
import {
  useAddWorkflowCc,
  useBatchUrgeWorkflowInstances,
  useBatchWithdrawWorkflowInstances,
  useCreateWorkflowInstance,
  useDeleteWorkflowInstance,
  useMyWorkflowInstances,
  useResubmitWorkflowInstance,
  useSubmitWorkflowDraft,
  useUpdateWorkflowDraft,
  useUrgeWorkflowInstance,
  useWithdrawWorkflowInstance,
  workflowInstanceKeys,
} from '@/hooks/queries/workflow-instances';
import { usePublishedWorkflowDefinitions } from '@/hooks/queries/workflow-definitions';
import { useListSearch } from '@/hooks/useListSearch';
import { deleteAction, ListSearchToolbar, listTableProps, useRowSelection } from '@/components/list-page';
import { workflowInstanceStatusColumn } from '@/components/workflow/WorkflowInstanceListColumns';
import { FilterSelect, StatusSelect } from '@/components/search-filters';
import { compactParams } from '@/lib/query';

function InstanceDetailDrawer({
  instanceId,
  visible,
  onClose,
  onResubmitted,
}: Readonly<{
  instanceId: number | null;
  visible: boolean;
  onClose: () => void;
  /** 已驳回/已撤回实例在详情内重新提交后回调（父级打开草稿编辑） */
  onResubmitted?: (draft: WorkflowInstance) => void;
}>) {
  const [viewId, setViewId] = useState<number | null>(instanceId);
  const navigate = useNavigate();
  const detailQuery = useWorkflowInstanceWithDefinition(viewId, visible);
  const data = detailQuery.data?.instance ?? null;
  const definition = detailQuery.data?.definition ?? null;
  const loading = detailQuery.isFetching;
  // 撤回 / 重新提交 / 补加抄送的列表与详情回源都由各自 hook 的失效负责，抽屉不再额外广播
  const withdrawMutation = useWithdrawWorkflowInstance();
  const urgeMutation = useUrgeWorkflowInstance();
  const addCcMutation = useAddWorkflowCc();
  const resubmitMutation = useResubmitWorkflowInstance();

  useEffect(() => {
    if (visible) setViewId(instanceId);
  }, [visible, instanceId]);

  const handleResubmitFromDetail = async () => {
    if (!viewId) return;
    const draft = await resubmitMutation.mutateAsync({ params: { id: viewId } });
    Toast.success('已生成草稿');
    onClose();
    onResubmitted?.(draft);
  };

  const handleWithdraw = async () => {
    if (!viewId) return;
    await withdrawMutation.mutateAsync({ params: { id: viewId } });
    Toast.success('已撤回');
    onClose();
  };

  const [urgeVisible, setUrgeVisible] = useState(false);
  const [urgeMessage, setUrgeMessage] = useState('');
  const handleUrge = async () => {
    if (!viewId) return;
    try {
      await urgeMutation.mutateAsync({ params: { id: viewId }, body: { message: urgeMessage || undefined } });
      Toast.success('已催办');
      setUrgeVisible(false);
      setUrgeMessage('');
    } catch { /* request 层已提示 */ }
  };

  const ccNodeOptions = (definition?.flowData?.nodes ?? [])
    .filter((n) => n.data.type === 'ccNode')
    .map((n) => ({ label: n.data.label, value: n.data.key }));
  const [ccVisible, setCcVisible] = useState(false);
  const [ccNodeKey, setCcNodeKey] = useState<string | undefined>(undefined);
  const [ccUserIds, setCcUserIds] = useState<number[]>([]);
  const usersQuery = useWorkflowSelectableUsers({ enabled: ccVisible });
  const ccUserOptions = useMemo(
    () => (usersQuery.data ?? []).map((u) => ({ label: u.nickname ?? u.username, value: u.id })),
    [usersQuery.data],
  );
  const openCcModal = () => {
    setCcNodeKey(ccNodeOptions[0]?.value);
    setCcUserIds([]);
    setCcVisible(true);
  };
  const handleAddCc = async () => {
    if (!viewId || !ccNodeKey || ccUserIds.length === 0) {
      Toast.warning('请选择抄送节点与抄送人');
      return;
    }
    await addCcMutation.mutateAsync({ params: { id: viewId }, body: { nodeKey: ccNodeKey, userIds: ccUserIds } });
    Toast.success('已补加抄送');
    setCcVisible(false);
  };

  // 打印入口由 WorkflowInstanceDetailPanel 内置提供，这里只保留页面级动作
  const openInTabAction = data ? (
    <Button
      theme="borderless"
      size="small"
      icon={<ExternalLink size={13} />}
      onClick={() => { onClose(); navigate(`/workflow/instance/${viewId}`, { state: { tabTitle: data.title } }); }}
    >
      在新页签打开
    </Button>
  ) : null;

  return (
    <SideSheet
      title="申请详情"
      visible={visible}
      onCancel={onClose}
      width={1080}
      bodyStyle={{ padding: 0, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      footer={
        data?.status === 'running' ? (
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => { setUrgeMessage(''); setUrgeVisible(true); }}>催办</Button>
            {ccNodeOptions.length > 0 && (
              <Button onClick={() => openCcModal()}>添加抄送人</Button>
            )}
            {data?.allowWithdraw !== false && (
              <Popconfirm title="确定要撤回吗？" onConfirm={() => void handleWithdraw()}>
                <Button type="danger">撤回申请</Button>
              </Popconfirm>
            )}
          </Space>
        ) : ((data?.status === 'rejected' || data?.status === 'withdrawn') && data?.allowResubmit !== false ? (
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button
              type="primary"
              loading={resubmitMutation.isPending}
              onClick={() => void handleResubmitFromDetail()}
            >
              重新提交
            </Button>
          </Space>
        ) : null)
      }
    >
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : (
          <WorkflowInstanceDetailPanel
            instance={data}
            definition={definition}
            loading={loading}
            onOpenInstance={(id) => setViewId(id)}
            extraActions={openInTabAction}
          />
        )}
      </div>
      <AppModal
        title="催办"
        visible={urgeVisible}
        onCancel={() => setUrgeVisible(false)}
        onOk={() => void handleUrge()}
        confirmLoading={urgeMutation.isPending}
        okText="发送催办"
      >
        <Typography.Text type="tertiary" size="small">将对当前实例所有待办人发起催办（5 分钟内已被催办过的人员会被跳过）</Typography.Text>
        <TextArea
          value={urgeMessage}
          onChange={setUrgeMessage}
          placeholder="可选留言（最多 256 个字符）"
          maxLength={256}
          rows={3}
          style={{ marginTop: 8 }}
        />
      </AppModal>
      <AppModal
        title="添加抄送人"
        visible={ccVisible}
        onCancel={() => setCcVisible(false)}
        onOk={() => void handleAddCc()}
        confirmLoading={addCcMutation.isPending}
        okText="提交"
      >
        <Typography.Text type="tertiary" size="small">为运行中的流程实例的抄送节点动态补加抄送人（自动去重，不会重复抄送）。</Typography.Text>
        <div style={{ marginTop: 12 }}>
          <Typography.Text strong>抄送节点</Typography.Text>
          <Select
            style={{ width: '100%', marginTop: 4 }}
            value={ccNodeKey}
            onChange={(v) => setCcNodeKey(v as string)}
            optionList={ccNodeOptions}
            placeholder="请选择抄送节点"
          />
        </div>
        <div style={{ marginTop: 12 }}>
          <Typography.Text strong>抄送人</Typography.Text>
          <Select
            style={{ width: '100%', marginTop: 4 }}
            multiple
            filter
            value={ccUserIds}
            onChange={(v) => setCcUserIds(v as number[])}
            optionList={ccUserOptions}
            placeholder="请选择抄送人"
          />
        </div>
      </AppModal>
    </SideSheet>
  );
}

export default function MyApplicationsPage() {
  const launchFormRef = useRef<WorkflowLaunchFormHandle>(null);
  const {
    page, pageSize, buildPagination,
    bind, submittedParams,
    handleSearch, applySearch, handleReset,
  } = useListSearch<{ status?: string; priority?: string }>({ defaults: { status: undefined, priority: undefined }, listKey: workflowInstanceKeys.lists });
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [applyVisible, setApplyVisible] = useState(false);
  const [selectedDef, setSelectedDef] = useState<WorkflowDefinition | null>(null);
  const [applyCategoryId, setApplyCategoryId] = useState<number | null>(null);
  const { selectedRowKeys, clear: clearSelection, rowSelection } = useRowSelection<number, WorkflowInstance>({
    // 草稿不参与批量操作
    extra: { getCheckboxProps: (record: WorkflowInstance) => ({ disabled: record.status === 'draft' }) },
  });
  const [batchWithdrawVisible, setBatchWithdrawVisible] = useState(false);
  const [batchWithdrawComment, setBatchWithdrawComment] = useState('');
  const [batchUrgeVisible, setBatchUrgeVisible] = useState(false);
  const [batchUrgeMessage, setBatchUrgeMessage] = useState('');
  const { categories } = useWorkflowCategories();
  // draft editing state
  const [editingDraft, setEditingDraft] = useState<WorkflowInstance | null>(null);
  const [dynamicFormInitValues, setDynamicFormInitValues] = useState<Record<string, unknown>>({});
  const [formKey, setFormKey] = useState(0);
  // 已提交筛选 → 契约查询参数：列表与导出共用同一份映射
  const filterQuery = useMemo(() => compactParams({
    status: enumValueOf(WORKFLOW_INSTANCE_STATUSES, submittedParams.status),
    priority: enumValueOf(WORKFLOW_INSTANCE_PRIORITIES, submittedParams.priority),
  }), [submittedParams]);
  const listQuery = useMyWorkflowInstances({ page, pageSize, ...filterQuery });
  const data = listQuery.data;
  const definitionsQuery = usePublishedWorkflowDefinitions({ enabled: applyVisible });
  const definitions = definitionsQuery.data ?? [];
  const submitMutation = useCreateWorkflowInstance();
  const saveDraftMutation = useCreateWorkflowInstance();
  const updateDraftMutation = useUpdateWorkflowDraft();
  const submitDraftMutation = useSubmitWorkflowDraft();
  const deleteMutation = useDeleteWorkflowInstance();
  const resubmitMutation = useResubmitWorkflowInstance();
  const batchWithdrawMutation = useBatchWithdrawWorkflowInstances();
  const batchUrgeMutation = useBatchUrgeWorkflowInstances();
  const submitting = submitMutation.isPending || submitDraftMutation.isPending;
  const savingDraft = saveDraftMutation.isPending || updateDraftMutation.isPending;

  const loadDefinitions = async (): Promise<WorkflowDefinition[]> => {
    const res = await definitionsQuery.refetch();
    return res.data ?? definitions;
  };

  const openDetail = (id: number) => {
    setSelectedId(id);
    setDetailVisible(true);
  };

  // 通知深链：/workflow/applications?instanceId= 自动弹出实例详情（消费后清掉参数）
  const [urlParams, setUrlParams] = useSearchParams();
  useEffect(() => {
    const instanceId = Number(urlParams.get('instanceId'));
    if (instanceId > 0) {
      openDetail(instanceId);
      setUrlParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeApply = () => {
    setApplyVisible(false);
    setEditingDraft(null);
    setSelectedDef(null);
    setApplyCategoryId(null);
    setDynamicFormInitValues({});
  };

  const openApply = async () => {
    setEditingDraft(null);
    setSelectedDef(null);
    setApplyCategoryId(null);
    setDynamicFormInitValues({});
    setFormKey(k => k + 1);
    await loadDefinitions();
    setApplyVisible(true);
  };

  const openEditDraft = async (record: WorkflowInstance) => {
    const defs = await loadDefinitions();
    const def = defs.find(d => d.id === record.definitionId) ?? null;
    setEditingDraft(record);
    setSelectedDef(def);
    setApplyCategoryId(def?.categoryId ?? null);
    setDynamicFormInitValues((record.formData as Record<string, unknown>) ?? {});
    setFormKey(k => k + 1);
    setApplyVisible(true);
  };

  const launchSubmitNonceRef = useRef<string>('');
  const handleSubmitApply = async () => {
    if (!selectedDef) { Toast.error('请先选择流程'); return; }
    const result = await launchFormRef.current?.collectFormData({ requireInitiatorApprovers: true });
    if (!result) return;
    const { values, formData } = result;
    if (!launchSubmitNonceRef.current) launchSubmitNonceRef.current = crypto.randomUUID();
    await submitMutation.mutateAsync({
      body: {
        definitionId: selectedDef.id,
        title: values.title,
        formData,
        priority: values.priority ?? 'normal',
        ccUserIds: Array.isArray(values.ccUserIds) ? values.ccUserIds : undefined,
        selectedInitiatorApprovers: result.selectedInitiatorApprovers,
      },
      idempotencyKey: `workflow-launch-${launchSubmitNonceRef.current}`,
    });
    launchSubmitNonceRef.current = '';
    Toast.success('申请已提交');
    closeApply();
  };

  const handleSaveDraft = async () => {
    if (!selectedDef) { Toast.error('请先选择流程'); return; }
    const result = await launchFormRef.current?.collectFormData({ requireInitiatorApprovers: false, validateForm: false });
    if (!result) return;
    const { values, formData } = result;
    await saveDraftMutation.mutateAsync({
      body: {
        definitionId: selectedDef.id,
        title: values.title,
        formData,
        priority: values.priority ?? 'normal',
        ccUserIds: Array.isArray(values.ccUserIds) ? values.ccUserIds : undefined,
        asDraft: true,
      },
    });
    Toast.success('草稿已保存');
    closeApply();
  };

  const handleUpdateDraft = async () => {
    if (!editingDraft) return;
    const result = await launchFormRef.current?.collectFormData({ requireInitiatorApprovers: false, validateForm: false });
    if (!result) return;
    const { values, formData } = result;
    await updateDraftMutation.mutateAsync({
      params: { id: editingDraft.id },
      body: {
        title: values.title,
        formData,
      },
    });
    Toast.success('草稿已更新');
    closeApply();
  };

  const handleSaveAndSubmitDraft = async () => {
    if (!editingDraft) return;
    const result = await launchFormRef.current?.collectFormData({ requireInitiatorApprovers: true });
    if (!result) return;
    const { values, formData } = result;
    await updateDraftMutation.mutateAsync({
      params: { id: editingDraft.id },
      body: {
        title: values.title,
        formData,
      },
    });
    await submitDraftMutation.mutateAsync({
      params: { id: editingDraft.id },
      body: {
        selectedInitiatorApprovers: result.selectedInitiatorApprovers,
      },
    });
    Toast.success('申请已提交');
    closeApply();
  };

  const handleDirectSubmitDraft = async (id: number) => {
    await submitDraftMutation.mutateAsync({ params: { id }, body: {} });
    Toast.success('申请已提交');
  };

  /**
   * 草稿「提交」入口分流：designer 草稿由服务端按表单快照全量校验兜底，可直接提交；
   * custom 业务表单的校验只存在于业务组件 validate()，直接提交会绕过 —— 引导到编辑抽屉走校验后提交。
   */
  const handleSubmitDraftAction = (record: WorkflowInstance) => {
    if (resolveWorkflowFormType(record) === 'custom') {
      Toast.info('自定义业务表单草稿需在编辑页中校验后提交');
      void openEditDraft(record);
      return;
    }
    Modal.confirm({
      title: '确定要提交此草稿吗？',
      onOk: () => handleDirectSubmitDraft(record.id),
    });
  };

  const handleResubmit = async (id: number) => {
    await resubmitMutation.mutateAsync({ params: { id } });
    Toast.success('已生成草稿，请在草稿箱中编辑提交');
  };

  const selectedRunningIds = selectedRowKeys.filter((id) => (data?.list ?? []).some((item) => item.id === id && item.status === 'running'));

  const selectedWithdrawableIds = selectedRowKeys.filter((id) => (data?.list ?? []).some((item) => item.id === id && item.status === 'running' && item.allowWithdraw !== false));

  // 已提交的申请都可导出审批单（草稿无审批链与流水号）
  const selectedPrintableIds = selectedRowKeys.filter((id) => (data?.list ?? []).some((item) => item.id === id && item.status !== 'draft'));

  const openBatchWithdraw = () => {
    if (selectedWithdrawableIds.length === 0) {
      Toast.warning('请选择审批中且允许撤回的申请');
      return;
    }
    setBatchWithdrawComment('');
    setBatchWithdrawVisible(true);
  };

  const handleBatchWithdraw = async () => {
    const instanceIds = selectedWithdrawableIds;
    if (instanceIds.length === 0) {
      Toast.warning('请选择审批中且允许撤回的申请');
      return;
    }
    const res = await batchWithdrawMutation.mutateAsync({ body: { instanceIds, comment: batchWithdrawComment.trim() || undefined } });
    Toast.success(`成功 ${res.succeeded} 条，失败 ${res.failed} 条`);
    setBatchWithdrawVisible(false);
    setBatchWithdrawComment('');
    clearSelection();
  };

  const openBatchUrge = () => {
    if (selectedRunningIds.length === 0) {
      Toast.warning('请选择审批中的申请');
      return;
    }
    setBatchUrgeMessage('');
    setBatchUrgeVisible(true);
  };

  const handleBatchUrge = async () => {
    const instanceIds = selectedRunningIds;
    if (instanceIds.length === 0) {
      Toast.warning('请选择审批中的申请');
      return;
    }
    const res = await batchUrgeMutation.mutateAsync({ body: { instanceIds, message: batchUrgeMessage.trim() || undefined } });
    Toast.success(`成功 ${res.succeeded} 条，失败 ${res.failed} 条`);
    setBatchUrgeVisible(false);
    setBatchUrgeMessage('');
    clearSelection();
  };

  const columns: ColumnProps<WorkflowInstance>[] = [
    {
      title: '申请标题',
      dataIndex: 'title',
      minWidth: 200,
      render: (v: string, record: WorkflowInstance) => {
        // 客户端按定义快照 settings.summaryFields + 表单快照计算摘要（列表 DTO 含完整快照）
        const summaryKeys = record.definitionSnapshot?.flowData?.settings?.summaryFields;
        const snapFields = normalizeWorkflowFormSnapshot(record.formSnapshot)?.fields ?? [];
        const items = buildWorkflowSummaryItems(snapFields, (record.formData ?? {}) as Record<string, unknown>, summaryKeys);
        return (
          <div style={{ minWidth: 0 }}>
            <Typography.Text ellipsis={{ showTooltip: true }} style={{ display: 'block', minWidth: 0 }}>{v}</Typography.Text>
            <WorkflowSummaryLine items={items} />
          </div>
        );
      },
    },
    {
      title: '业务编号',
      dataIndex: 'serialNo',
      width: 200,
      render: renderEllipsis,
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 80,
      render: (v: WorkflowInstance['priority']) => <WorkflowPriorityTag priority={v} />,
    },
    {
      title: '流程名称',
      dataIndex: 'definitionName',
      width: 160,
      render: renderEllipsis,
    },
    dateTimeColumn('提交时间', 'createdAt'),
    workflowInstanceStatusColumn<WorkflowInstance>(),
    createOperationColumn<WorkflowInstance>({
      // 草稿：编辑 / 提交 + 更多（删除）；已退回：修改重提 / 详情；已驳回：详情 / 重新提交
      width: 180,
      desktopInlineKeys: ['edit-draft', 'submit-draft', 'detail', 'resubmit'],
      actions: (record) => [
        {
          key: 'edit-draft',
          label: record.status === 'returned' ? '修改重提' : '编辑',
          hidden: record.status !== 'draft' && record.status !== 'returned',
          onClick: () => void openEditDraft(record),
        },
        {
          key: 'submit-draft',
          label: '提交',
          hidden: record.status !== 'draft',
          onClick: () => handleSubmitDraftAction(record),
        },
        deleteAction({
          key: 'delete-draft',
          hidden: record.status !== 'draft',
          title: '确定要删除此草稿吗？',
          run: () => deleteMutation.mutateAsync({ params: { id: record.id } }),
          successMessage: '已删除',
        }),
        {
          key: 'detail',
          label: '详情',
          hidden: record.status === 'draft',
          onClick: () => openDetail(record.id),
        },
        {
          key: 'resubmit',
          label: '重新提交',
          hidden: (record.status !== 'rejected' && record.status !== 'withdrawn') || record.allowResubmit === false,
          onClick: () => {
            Modal.confirm({
              title: '将生成新草稿，确定要重新提交吗？',
              onOk: () => handleResubmit(record.id),
            });
          },
        },
      ],
    }),
  ];

  const applySheetTitle = editingDraft
    ? (editingDraft.status === 'returned' ? '修改并重新提交' : '编辑草稿')
    : '发起申请';

  const applySheetFooter = editingDraft ? (
    <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
      <Button onClick={closeApply}>取消</Button>
      <Button loading={savingDraft} disabled={submitting} onClick={() => void handleUpdateDraft()}>保存</Button>
      <Button type="primary" loading={submitting} disabled={savingDraft} onClick={() => void handleSaveAndSubmitDraft()}>保存并提交</Button>
    </Space>
  ) : (
    <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
      <Button onClick={closeApply}>取消</Button>
      <Button loading={savingDraft} disabled={submitting} onClick={() => void handleSaveDraft()}>保存草稿</Button>
      <Button type="primary" loading={submitting} disabled={savingDraft} onClick={() => void handleSubmitApply()}>提交</Button>
    </Space>
  );

  return (
    <div className="page-container">
      <SavedViewsBar
        pageKey="workflow-my-applications"
        currentFilters={submittedParams as unknown as Record<string, unknown>}
        onApply={(filters) => {
          const next = { status: undefined, priority: undefined, ...(filters as Partial<{ status?: string; priority?: string }>) };
          applySearch(next);
        }}
      />
      <ListSearchToolbar
        filters={(
          <>
            <StatusSelect
              items={Object.entries(INSTANCE_STATUS_MAP).map(([value, s]) => ({ value, label: s.text }))}
              {...bind('status')}
            />
            <FilterSelect
              placeholder="全部优先级"
              items={WORKFLOW_PRIORITY_OPTIONS}
              {...bind('priority')}
              width={140}
            />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={(
          <Button type="primary" icon={<Plus size={14} />} onClick={() => { void openApply(); }}>
            发起申请
          </Button>
        )}
        actions={(
          <>
            {selectedWithdrawableIds.length > 0 ? (
              <Button type="tertiary" icon={<Undo2 size={14} />} disabled={selectedWithdrawableIds.length === 0} onClick={openBatchWithdraw}>批量撤回</Button>
            ) : null}
            {selectedRunningIds.length > 0 ? (
              <Button type="primary" icon={<Megaphone size={14} />} disabled={selectedRunningIds.length === 0} onClick={openBatchUrge}>批量催办</Button>
            ) : null}
            {selectedPrintableIds.length > 0 ? (
              <ExportButton
                entity="workflow.approval-sheets"
                formats={['pdf']}
                label={`导出审批单 PDF（${selectedPrintableIds.length}）`}
                executionMode="auto"
                permission="workflow:instance:print"
                query={{ instanceIds: selectedPrintableIds }}
              />
            ) : null}
          </>
        )}
        filterTitle="我的申请筛选"
      />
      <ConfigurableTable<WorkflowInstance>
        columns={columns}
        {...listTableProps(listQuery, {
          pagination: buildPagination,
          rowSelection,
        })}
      />

      {/* 申请详情 */}
      <InstanceDetailDrawer
        instanceId={selectedId}
        visible={detailVisible}
        onClose={() => setDetailVisible(false)}
        onResubmitted={(draft) => { void openEditDraft(draft); }}
      />

      {/* 发起 / 编辑草稿 */}
      <SideSheet
        title={applySheetTitle}
        visible={applyVisible}
        onCancel={closeApply}
        width={1080}
        bodyStyle={{ padding: 0, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        footer={applySheetFooter}
      >
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            gap: 12,
            alignItems: 'flex-end',
            padding: '12px 16px',
            borderBottom: '1px solid var(--semi-color-border)',
          }}
        >
          <div style={{ width: 220 }}>
            <div style={{ fontSize: 13, color: 'var(--semi-color-text-1)', marginBottom: 4 }}>流程分类</div>
            <FilterSelect
              placeholder="全部分类"
              items={categories.map(c => ({ value: c.id, label: c.name }))}
              value={applyCategoryId ?? undefined}
              onChange={(v) => {
                const next = v ?? null;
                setApplyCategoryId(next);
                if (!editingDraft) {
                  setSelectedDef(null);
                  setDynamicFormInitValues({});
                  setFormKey(k => k + 1);
                }
              }}
              width="100%"
              disabled={editingDraft !== null}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--semi-color-text-1)', marginBottom: 4 }}>
              选择流程 <span style={{ color: 'var(--semi-color-danger)' }}>*</span>
            </div>
            <Select
              placeholder="请选择要发起的流程"
              value={selectedDef?.id}
              filter
              disabled={editingDraft !== null}
              style={{ width: '100%' }}
              optionList={definitions
                .filter(d => applyCategoryId === null || d.categoryId === applyCategoryId)
                .map(d => ({ value: d.id, label: d.name }))}
              onChange={v => {
                const def = definitions.find(d => d.id === v) ?? null;
                setSelectedDef(def);
                setDynamicFormInitValues({});
                setFormKey(k => k + 1);
              }}
            />
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          {selectedDef ? (
            <WorkflowLaunchForm
              key={`launch-${selectedDef.id}-${formKey}`}
              ref={launchFormRef}
              def={selectedDef}
              container="sheet"
              initialTitle={editingDraft?.title}
              initialFormData={editingDraft ? dynamicFormInitValues : undefined}
              initialPriority={editingDraft?.priority ?? undefined}
              showCc={!editingDraft}
            />
          ) : (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Empty title="请选择要发起的流程" description="从上方选择流程分类与流程后填写申请表单" />
            </div>
          )}
        </div>
      </SideSheet>

      <AppModal
        title="批量撤回"
        visible={batchWithdrawVisible}
        onCancel={() => setBatchWithdrawVisible(false)}
        onOk={() => void handleBatchWithdraw()}
        confirmLoading={batchWithdrawMutation.isPending}
        okText="确认撤回"
      >
        <Typography.Text>确定撤回选中的 {selectedWithdrawableIds.length} 个申请吗？</Typography.Text>
        <TextArea
          value={batchWithdrawComment}
          onChange={setBatchWithdrawComment}
          placeholder="可选撤回说明（最多 500 个字符）"
          maxLength={500}
          rows={3}
          style={{ marginTop: 12 }}
        />
      </AppModal>

      <AppModal
        title="批量催办"
        visible={batchUrgeVisible}
        onCancel={() => setBatchUrgeVisible(false)}
        onOk={() => void handleBatchUrge()}
        confirmLoading={batchUrgeMutation.isPending}
        okText="发送催办"
      >
        <Typography.Text type="tertiary" size="small">将对选中的运行中申请发起催办（5 分钟内已被催办过的人员会被跳过）</Typography.Text>
        <TextArea
          value={batchUrgeMessage}
          onChange={setBatchUrgeMessage}
          placeholder="可选留言（最多 256 个字符）"
          maxLength={256}
          rows={3}
          style={{ marginTop: 12 }}
        />
      </AppModal>
    </div>
  );
}
