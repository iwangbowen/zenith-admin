import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Empty,
  Modal,
  Popconfirm,
  Select,
  SideSheet,
  Space,
  Spin,
  Tag,
  TextArea,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ExternalLink, Megaphone, Plus, RotateCcw, Search, Undo2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { WorkflowDefinition, WorkflowInstance } from '@zenith/shared';
import { buildWorkflowSummaryItems } from '@zenith/shared';
import { formatDateTime } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { AppModal } from '@/components/AppModal';
import WorkflowInstanceDetailPanel from '@/components/workflow/WorkflowInstanceDetailPanel';
import WorkflowLaunchForm, { type WorkflowLaunchFormHandle } from '@/components/workflow/WorkflowLaunchForm';
import WorkflowPriorityTag, { WORKFLOW_PRIORITY_OPTIONS } from '@/components/workflow/WorkflowPriorityTag';
import { INSTANCE_STATUS_MAP } from '@/components/workflow/workflow-runtime';
import { useWorkflowCategories } from '@/hooks/useWorkflowCategories';
import { renderEllipsis } from '../../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { normalizeWorkflowFormSnapshot } from '@/utils/workflow-snapshot';
import WorkflowSummaryLine from '@/components/workflow/WorkflowSummaryLine';
import { useAllUsers } from '@/hooks/queries/users';
import { useWorkflowInstanceWithDefinition } from '@/hooks/queries/workflow-shared';
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

const TASK_STATUS_TEXT: Record<string, string> = {
  pending: '待处理',
  approved: '已通过',
  rejected: '已驳回',
  skipped: '已跳过',
  waiting: '等待中',
};

const LAYOUT_ONLY_TYPES = new Set(['divider', 'description', 'group', 'row']);

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildPrintHtml(instance: WorkflowInstance): string {
  const statusText = INSTANCE_STATUS_MAP[instance.status]?.text ?? instance.status;
  const formFields = normalizeWorkflowFormSnapshot(instance.formSnapshot)?.fields ?? [];
  const formData = instance.formData ?? {};

  const formRows = formFields.length > 0
    ? formFields
        .filter(f => !LAYOUT_ONLY_TYPES.has(f.type) && f.key)
        .map(f => {
          const val = formData[f.key];
          const display = val === null || val === undefined ? ''
            : typeof val === 'object' ? escapeHtml(JSON.stringify(val))
            : escapeHtml(String(val));
          return `<tr>
            <td style="width:160px;background:#f9f9f9;font-weight:bold;padding:8px 12px;border:1px solid #ddd;">${escapeHtml(f.label ?? f.key)}</td>
            <td style="padding:8px 12px;border:1px solid #ddd;">${display}</td>
          </tr>`;
        }).join('')
    : Object.entries(formData).map(([k, v]) => {
        const display = typeof v === 'object' ? escapeHtml(JSON.stringify(v)) : escapeHtml(String(v ?? ''));
        return `<tr>
          <td style="width:160px;background:#f9f9f9;font-weight:bold;padding:8px 12px;border:1px solid #ddd;">${escapeHtml(k)}</td>
          <td style="padding:8px 12px;border:1px solid #ddd;">${display}</td>
        </tr>`;
      }).join('');

  const tasks = instance.tasks ?? [];
  const taskRows = tasks.map(t =>
    `<tr>
      <td style="padding:8px 12px;border:1px solid #ddd;">${escapeHtml(t.nodeName)}</td>
      <td style="padding:8px 12px;border:1px solid #ddd;">${escapeHtml(t.assigneeName ?? '—')}</td>
      <td style="padding:8px 12px;border:1px solid #ddd;">${TASK_STATUS_TEXT[t.status] ?? t.status}</td>
      <td style="padding:8px 12px;border:1px solid #ddd;">${escapeHtml(t.comment ?? '')}</td>
      <td style="padding:8px 12px;border:1px solid #ddd;">${t.actionAt ? formatDateTime(t.actionAt) : '—'}</td>
      <td style="padding:8px 12px;border:1px solid #ddd;">${t.signature ? `<img src="${escapeHtml(t.signature)}" alt="签名" style="max-height:48px;" />` : '—'}</td>
    </tr>`
  ).join('');

  return `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <title>${escapeHtml(instance.title)} - 审批单</title>
  <style>
    body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 14px; color: #333; padding: 20px; max-width: 860px; margin: 0 auto; }
    h1 { font-size: 22px; text-align: center; margin: 0 0 4px; }
    .subtitle { text-align: center; color: #888; font-size: 12px; margin-bottom: 20px; }
    h2 { font-size: 15px; border-bottom: 2px solid #333; padding-bottom: 4px; margin: 20px 0 10px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    th { background: #f5f5f5; font-weight: bold; text-align: left; padding: 8px 12px; border: 1px solid #ddd; }
    @media print { @page { margin: 1.5cm; } }
  </style>
</head><body>
  <h1>${escapeHtml(instance.title)}</h1>
  <div class="subtitle">${instance.serialNo ? `业务编号：${escapeHtml(instance.serialNo)}` : '&nbsp;'}</div>
  <h2>基本信息</h2>
  <table>
    <tr>
      <td style="width:120px;background:#f9f9f9;font-weight:bold;padding:8px 12px;border:1px solid #ddd;">流程名称</td>
      <td style="padding:8px 12px;border:1px solid #ddd;">${escapeHtml(instance.definitionName ?? '—')}</td>
      <td style="width:120px;background:#f9f9f9;font-weight:bold;padding:8px 12px;border:1px solid #ddd;">发起人</td>
      <td style="padding:8px 12px;border:1px solid #ddd;">${escapeHtml(instance.initiatorName ?? '—')}</td>
    </tr>
    <tr>
      <td style="background:#f9f9f9;font-weight:bold;padding:8px 12px;border:1px solid #ddd;">发起时间</td>
      <td style="padding:8px 12px;border:1px solid #ddd;">${formatDateTime(instance.createdAt)}</td>
      <td style="background:#f9f9f9;font-weight:bold;padding:8px 12px;border:1px solid #ddd;">状态</td>
      <td style="padding:8px 12px;border:1px solid #ddd;">${statusText}</td>
    </tr>
  </table>
  <h2>表单内容</h2>
  <table>
    ${formRows || '<tr><td colspan="2" style="text-align:center;color:#888;padding:12px;border:1px solid #ddd;">无表单数据</td></tr>'}
  </table>
  <h2>审批记录</h2>
  ${tasks.length > 0
    ? `<table>
        <thead><tr>
          <th>节点</th><th>处理人</th><th>状态</th><th>审批意见</th><th>处理时间</th><th>签名</th>
        </tr></thead>
        <tbody>${taskRows}</tbody>
      </table>`
    : '<p style="color:#888;">无审批记录</p>'}
</body></html>`;
}

function InstanceDetailDrawer({
  instanceId,
  visible,
  onClose,
  onRefresh,
}: Readonly<{
  instanceId: number | null;
  visible: boolean;
  onClose: () => void;
  onRefresh: () => void;
}>) {
  const [viewId, setViewId] = useState<number | null>(instanceId);
  const navigate = useNavigate();
  const detailQuery = useWorkflowInstanceWithDefinition(viewId, visible);
  const data = detailQuery.data?.instance ?? null;
  const definition = detailQuery.data?.definition ?? null;
  const loading = detailQuery.isFetching;
  const withdrawMutation = useWithdrawWorkflowInstance();
  const urgeMutation = useUrgeWorkflowInstance();
  const addCcMutation = useAddWorkflowCc();

  useEffect(() => {
    if (visible) setViewId(instanceId);
  }, [visible, instanceId]);

  const handleWithdraw = async () => {
    if (!viewId) return;
    await withdrawMutation.mutateAsync({ id: viewId });
    Toast.success('已撤回');
    onRefresh();
    onClose();
  };

  const handlePrint = () => {
    if (!data) return;
    const html = buildPrintHtml(data);
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    iframe.srcdoc = html;
    iframe.onload = () => {
      const cw = iframe.contentWindow;
      if (!cw) { iframe.remove(); return; }
      cw.addEventListener('afterprint', () => iframe.remove(), { once: true });
      cw.focus();
      cw.print();
    };
    document.body.appendChild(iframe);
  };

  const [urgeVisible, setUrgeVisible] = useState(false);
  const [urgeMessage, setUrgeMessage] = useState('');
  const handleUrge = async () => {
    if (!viewId) return;
    try {
      await urgeMutation.mutateAsync({ id: viewId, message: urgeMessage || undefined });
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
  const usersQuery = useAllUsers({ enabled: ccVisible });
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
    await addCcMutation.mutateAsync({ id: viewId, nodeKey: ccNodeKey, userIds: ccUserIds });
    Toast.success('已补加抄送');
    setCcVisible(false);
    onRefresh();
  };

  const printAction = data ? (
    <Space>
      <Button
        theme="borderless"
        size="small"
        icon={<ExternalLink size={13} />}
        onClick={() => { onClose(); navigate(`/workflow/instance/${viewId}`, { state: { tabTitle: data.title } }); }}
      >
        在新页签打开
      </Button>
      <Button theme="borderless" size="small" onClick={handlePrint}>
        打印 / 保存 PDF
      </Button>
    </Space>
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
        ) : null
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
            extraActions={printAction}
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
  const queryClient = useQueryClient();
  const launchFormRef = useRef<WorkflowLaunchFormHandle>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<{ status: string; priority: string }>({ status: '', priority: '' });
  const [submittedParams, setSubmittedParams] = useState<{ status: string; priority: string }>({ status: '', priority: '' });
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [applyVisible, setApplyVisible] = useState(false);
  const [selectedDef, setSelectedDef] = useState<WorkflowDefinition | null>(null);
  const [applyCategoryId, setApplyCategoryId] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [batchWithdrawVisible, setBatchWithdrawVisible] = useState(false);
  const [batchWithdrawComment, setBatchWithdrawComment] = useState('');
  const [batchUrgeVisible, setBatchUrgeVisible] = useState(false);
  const [batchUrgeMessage, setBatchUrgeMessage] = useState('');
  const { categories } = useWorkflowCategories();
  // draft editing state
  const [editingDraft, setEditingDraft] = useState<WorkflowInstance | null>(null);
  const [dynamicFormInitValues, setDynamicFormInitValues] = useState<Record<string, unknown>>({});
  const [formKey, setFormKey] = useState(0);
  const listQuery = useMyWorkflowInstances({
    page,
    pageSize,
    status: submittedParams.status || undefined,
    priority: submittedParams.priority || undefined,
  });
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

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: workflowInstanceKeys.lists });
  };

  const handleReset = () => {
    setDraftParams({ status: '', priority: '' });
    setSubmittedParams({ status: '', priority: '' });
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: workflowInstanceKeys.lists });
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
      values: {
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
    const result = await launchFormRef.current?.collectFormData({ requireInitiatorApprovers: false });
    if (!result) return;
    const { values, formData } = result;
    await saveDraftMutation.mutateAsync({
      values: {
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
    const result = await launchFormRef.current?.collectFormData({ requireInitiatorApprovers: false });
    if (!result) return;
    const { values, formData } = result;
    await updateDraftMutation.mutateAsync({
      id: editingDraft.id,
      values: {
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
      id: editingDraft.id,
      values: {
        title: values.title,
        formData,
      },
    });
    await submitDraftMutation.mutateAsync({
      id: editingDraft.id,
      values: {
        selectedInitiatorApprovers: result.selectedInitiatorApprovers,
      },
    });
    Toast.success('申请已提交');
    closeApply();
  };

  const handleDirectSubmitDraft = async (id: number) => {
    await submitDraftMutation.mutateAsync({ id });
    Toast.success('申请已提交');
  };

  const handleDeleteDraft = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    Toast.success('已删除');
  };

  const handleResubmit = async (id: number) => {
    await resubmitMutation.mutateAsync(id);
    Toast.success('已生成草稿，请在草稿箱中编辑提交');
  };

  const selectedRunningIds = selectedRowKeys.filter((id) => (data?.list ?? []).some((item) => item.id === id && item.status === 'running'));

  const selectedWithdrawableIds = selectedRowKeys.filter((id) => (data?.list ?? []).some((item) => item.id === id && item.status === 'running' && item.allowWithdraw !== false));

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
    const res = await batchWithdrawMutation.mutateAsync({ instanceIds, comment: batchWithdrawComment.trim() || undefined });
    Toast.success(`成功 ${res.succeeded} 条，失败 ${res.failed} 条`);
    setBatchWithdrawVisible(false);
    setBatchWithdrawComment('');
    setSelectedRowKeys([]);
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
    const res = await batchUrgeMutation.mutateAsync({ instanceIds, message: batchUrgeMessage.trim() || undefined });
    Toast.success(`成功 ${res.succeeded} 条，失败 ${res.failed} 条`);
    setBatchUrgeVisible(false);
    setBatchUrgeMessage('');
    setSelectedRowKeys([]);
  };

  const columns: ColumnProps<WorkflowInstance>[] = [
    {
      title: '申请标题',
      dataIndex: 'title',
      width: 200,
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
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      fixed: 'right',
      render: (v: string) => {
        const s = INSTANCE_STATUS_MAP[v];
        return <Tag color={s?.color ?? 'grey'}>{s?.text ?? v}</Tag>;
      },
    },
    createOperationColumn<WorkflowInstance>({
      width: 160,
      desktopInlineKeys: ['edit-draft', 'submit-draft', 'delete-draft', 'detail', 'resubmit'],
      actions: (record) => [
        {
          key: 'edit-draft',
          label: '编辑',
          hidden: record.status !== 'draft',
          onClick: () => void openEditDraft(record),
        },
        {
          key: 'submit-draft',
          label: '提交',
          hidden: record.status !== 'draft',
          onClick: () => {
            Modal.confirm({
              title: '确定要提交此草稿吗？',
              onOk: () => handleDirectSubmitDraft(record.id),
            });
          },
        },
        {
          key: 'delete-draft',
          label: '删除',
          danger: true,
          hidden: record.status !== 'draft',
          onClick: () => {
            Modal.confirm({
              title: '确定要删除此草稿吗？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDeleteDraft(record.id),
            });
          },
        },
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

  const applySheetTitle = editingDraft ? '编辑草稿' : '发起申请';

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

  const renderStatusFilter = () => (
    <Select
      placeholder="全部状态"
      value={draftParams.status || undefined}
      onChange={v => setDraftParams((prev) => ({ ...prev, status: typeof v === 'string' ? v : '' }))}
      showClear
      style={{ width: 140 }}
    >
      {Object.entries(INSTANCE_STATUS_MAP).map(([k, s]) => (
        <Select.Option key={k} value={k}>{s.text}</Select.Option>
      ))}
    </Select>
  );

  const renderPriorityFilter = () => (
    <Select
      placeholder="全部优先级"
      value={draftParams.priority || undefined}
      onChange={v => setDraftParams((prev) => ({ ...prev, priority: typeof v === 'string' ? v : '' }))}
      showClear
      style={{ width: 130 }}
      optionList={WORKFLOW_PRIORITY_OPTIONS}
    />
  );

  const renderSearchButton = () => (
    <Button type="primary" icon={<Search size={14} />} onClick={() => { handleSearch(); }}>查询</Button>
  );

  const renderResetButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { handleReset(); }}>重置</Button>
  );

  const renderBatchWithdrawButton = () => selectedWithdrawableIds.length > 0 ? (
    <Button type="tertiary" icon={<Undo2 size={14} />} disabled={selectedWithdrawableIds.length === 0} onClick={openBatchWithdraw}>批量撤回</Button>
  ) : null;

  const renderBatchUrgeButton = () => selectedRunningIds.length > 0 ? (
    <Button type="primary" icon={<Megaphone size={14} />} disabled={selectedRunningIds.length === 0} onClick={openBatchUrge}>批量催办</Button>
  ) : null;

  const renderCreateButton = () => (
    <Button type="primary" icon={<Plus size={14} />} onClick={() => { void openApply(); }}>
      发起申请
    </Button>
  );

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderStatusFilter()}
            {renderPriorityFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderBatchWithdrawButton()}
            {renderBatchUrgeButton()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderStatusFilter()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={renderPriorityFilter()}
        mobileActions={(
          <>
            {renderResetButton()}
            {renderBatchWithdrawButton()}
            {renderBatchUrgeButton()}
          </>
        )}
        filterTitle="我的申请筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        rowKey="id"
        loading={listQuery.isFetching}
        pagination={buildPagination(data?.total ?? 0)}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(((keys as (string | number)[]) ?? []).map(Number)),
          getCheckboxProps: (record: WorkflowInstance) => ({ disabled: record.status !== 'running' }),
        }}
      />

      {/* 申请详情 */}
      <InstanceDetailDrawer
        instanceId={selectedId}
        visible={detailVisible}
        onClose={() => setDetailVisible(false)}
        onRefresh={() => void queryClient.invalidateQueries({ queryKey: ['workflow'] })}
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
            <Select
              placeholder="全部分类"
              value={applyCategoryId ?? undefined}
              showClear
              disabled={editingDraft !== null}
              style={{ width: '100%' }}
              optionList={categories.map(c => ({ value: c.id, label: c.name }))}
              onChange={v => {
                const next = typeof v === 'number' ? v : null;
                setApplyCategoryId(next);
                if (!editingDraft) {
                  setSelectedDef(null);
                  setDynamicFormInitValues({});
                  setFormKey(k => k + 1);
                }
              }}
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
