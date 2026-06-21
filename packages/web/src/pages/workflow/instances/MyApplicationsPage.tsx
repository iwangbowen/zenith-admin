import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Form,
  Popconfirm,
  Select,
  SideSheet,
  Space,
  Spin,
  Tabs,
  TabPane,
  Tag,
  TextArea,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import dayjs from 'dayjs';
import { FileInput, Megaphone, Plus, RotateCcw, Search, Undo2 } from 'lucide-react';
import type { WorkflowDefinition, WorkflowInstance, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { useAuth } from '@/hooks/useAuth';
import { formatDateTime } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { AppModal } from '@/components/AppModal';
import WorkflowFormRenderer from '@/pages/workflow/designer/components/WorkflowFormRenderer';
import WorkflowInstanceDetailPanel from '@/components/workflow/WorkflowInstanceDetailPanel';
import WorkflowGraphView from '@/components/workflow/WorkflowGraphView';
import WorkflowNodeListView from '@/components/workflow/WorkflowNodeListView';
import WorkflowApproverPreview from '@/components/workflow/WorkflowApproverPreview';
import WorkflowPriorityTag, { WORKFLOW_PRIORITY_OPTIONS } from '@/components/workflow/WorkflowPriorityTag';
import { useWorkflowCategories } from '@/hooks/useWorkflowCategories';
import { renderEllipsis } from '../../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';

type TagColor = 'amber' | 'blue' | 'cyan' | 'green' | 'grey' | 'indigo' | 'light-blue' | 'light-green' | 'lime' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'violet' | 'yellow' | 'white';

type WorkflowInstanceBatchActionResponse = {
  succeeded: number;
  failed: number;
  results: Array<{ instanceId: number; success: boolean; message?: string }>;
};

const INSTANCE_STATUS_MAP: Record<string, { text: string; color: TagColor }> = {
  draft: { text: '草稿', color: 'grey' },
  running: { text: '审批中', color: 'blue' },
  approved: { text: '已通过', color: 'green' },
  rejected: { text: '已驳回', color: 'red' },
  withdrawn: { text: '已撤回', color: 'orange' },
  cancelled: { text: '已取消', color: 'purple' },
};

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
  const formFields = instance.formSnapshot ?? [];
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
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<WorkflowInstance | null>(null);
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [viewId, setViewId] = useState<number | null>(instanceId);

  useEffect(() => {
    if (visible) setViewId(instanceId);
  }, [visible, instanceId]);

  useEffect(() => {
    if (!visible || !viewId) return;
    setLoading(true);
    setDefinition(null);
    const p = request.get<WorkflowInstance>(`/api/workflows/instances/${viewId}`)
      .then(res => {
        if (res.code === 0) {
          setData(res.data);
          return request.get<WorkflowDefinition>(`/api/workflows/definitions/${res.data.definitionId}`);
        }
        return null;
      })
      .then(defRes => { if (defRes?.code === 0) setDefinition(defRes.data); })
      .finally(() => setLoading(false));
    p.catch(() => undefined);
  }, [visible, viewId]);

  const handleWithdraw = async () => {
    if (!viewId) return;
    const res = await request.post(`/api/workflows/instances/${viewId}/withdraw`, {});
    if (res.code === 0) {
      Toast.success('已撤回');
      onRefresh();
      onClose();
    }
  };

  const handlePrint = () => {
    if (!data) return;
    const html = buildPrintHtml(data);
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) {
      Toast.warning('请允许浏览器弹出窗口以打印');
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  };

  const [urgeVisible, setUrgeVisible] = useState(false);
  const [urgeMessage, setUrgeMessage] = useState('');
  const [urgeLoading, setUrgeLoading] = useState(false);
  const handleUrge = async () => {
    if (!viewId) return;
    setUrgeLoading(true);
    try {
      const res = await request.post<unknown>(`/api/workflows/instances/${viewId}/urge`, { message: urgeMessage || undefined });
      if (res.code === 0) {
        Toast.success(res.message || '已催办');
        setUrgeVisible(false);
        setUrgeMessage('');
      } else if (res.code === 429) {
        Toast.warning(res.message);
      }
    } finally {
      setUrgeLoading(false);
    }
  };

  const ccNodeOptions = (definition?.flowData?.nodes ?? [])
    .filter((n) => n.data.type === 'ccNode')
    .map((n) => ({ label: n.data.label, value: n.data.key }));
  const [ccVisible, setCcVisible] = useState(false);
  const [ccNodeKey, setCcNodeKey] = useState<string | undefined>(undefined);
  const [ccUserIds, setCcUserIds] = useState<number[]>([]);
  const [ccUserOptions, setCcUserOptions] = useState<Array<{ label: string; value: number }>>([]);
  const [ccLoading, setCcLoading] = useState(false);
  const openCcModal = async () => {
    setCcNodeKey(ccNodeOptions[0]?.value);
    setCcUserIds([]);
    setCcVisible(true);
    if (ccUserOptions.length === 0) {
      try {
        const res = await request.get<Array<{ id: number; nickname: string; username: string }>>('/api/users/all');
        if (res.code === 0) {
          setCcUserOptions(res.data.map((u) => ({ label: u.nickname ?? u.username, value: u.id })));
        }
      } catch { /* ignore */ }
    }
  };
  const handleAddCc = async () => {
    if (!viewId || !ccNodeKey || ccUserIds.length === 0) {
      Toast.warning('请选择抄送节点与抄送人');
      return;
    }
    setCcLoading(true);
    try {
      const res = await request.post<unknown>(`/api/workflows/instances/${viewId}/cc/add`, { nodeKey: ccNodeKey, userIds: ccUserIds });
      if (res.code === 0) {
        Toast.success(res.message || '已补加抄送');
        setCcVisible(false);
        onRefresh();
      }
    } finally {
      setCcLoading(false);
    }
  };

  const printAction = data ? (
    <>
      <Button theme="borderless" size="small" onClick={handlePrint}>
        打印审批单
      </Button>
      <Button theme="borderless" size="small" onClick={handlePrint}>
        导出 PDF
      </Button>
    </>
  ) : null;

  return (
    <SideSheet
      title="申请详情"
      visible={visible}
      onCancel={onClose}
      width={760}
      bodyStyle={{ padding: 16 }}
      footer={
        data?.status === 'running' ? (
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => { setUrgeMessage(''); setUrgeVisible(true); }}>催办</Button>
            {ccNodeOptions.length > 0 && (
              <Button onClick={() => void openCcModal()}>添加抄送人</Button>
            )}
            <Popconfirm title="确定要撤回吗？" onConfirm={() => void handleWithdraw()}>
              <Button type="danger">撤回申请</Button>
            </Popconfirm>
          </Space>
        ) : null
      }
    >
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
      <AppModal
        title="催办"
        visible={urgeVisible}
        onCancel={() => setUrgeVisible(false)}
        onOk={() => void handleUrge()}
        confirmLoading={urgeLoading}
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
        confirmLoading={ccLoading}
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
  const { user } = useAuth();
  const formApi = useRef<FormApi | null>(null);
  const dynamicFormApi = useRef<FormApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PaginatedResponse<WorkflowInstance> | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<{ status: string }>({ status: '' });
  const searchParamsRef = useRef<{ status: string }>({ status: '' });
  searchParamsRef.current = searchParams;
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [userOptions, setUserOptions] = useState<Array<{ label: string; value: number }>>([]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [applyVisible, setApplyVisible] = useState(false);
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [selectedDef, setSelectedDef] = useState<WorkflowDefinition | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [applyCategoryId, setApplyCategoryId] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [batchWithdrawVisible, setBatchWithdrawVisible] = useState(false);
  const [batchWithdrawComment, setBatchWithdrawComment] = useState('');
  const [batchWithdrawLoading, setBatchWithdrawLoading] = useState(false);
  const [batchUrgeVisible, setBatchUrgeVisible] = useState(false);
  const [batchUrgeMessage, setBatchUrgeMessage] = useState('');
  const [batchUrgeLoading, setBatchUrgeLoading] = useState(false);
  const { categories } = useWorkflowCategories();
  // draft editing state
  const [editingDraft, setEditingDraft] = useState<WorkflowInstance | null>(null);
  const [dynamicFormInitValues, setDynamicFormInitValues] = useState<Record<string, unknown>>({});
  const [formKey, setFormKey] = useState(0);
  const priorityFilterRef = useRef('');
  priorityFilterRef.current = priorityFilter;

  const fetchList = useCallback(async (p = page, ps = pageSize, params?: { status: string }) => {
    const { status: activeStatus } = params ?? searchParamsRef.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(activeStatus ? { status: activeStatus } : {}),
        ...(priorityFilterRef.current ? { priority: priorityFilterRef.current } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<WorkflowInstance>>(`/api/workflows/instances?${query}`);
      if (res.code === 0) {
        setData(res.data);
        setPage(res.data.page);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const loadDefinitions = async (): Promise<WorkflowDefinition[]> => {
    if (userOptions.length === 0) {
      void request.get<Array<{ id: number; nickname: string; username: string }>>('/api/users/all').then((res) => {
        if (res.code === 0 && res.data) setUserOptions(res.data.map((u) => ({ label: u.nickname ?? u.username, value: u.id })));
      });
    }
    const res = await request.get<WorkflowDefinition[]>('/api/workflows/definitions/published');
    if (res.code === 0 && res.data) {
      setDefinitions(res.data);
      return res.data;
    }
    return definitions;
  };

  const handleSearch = () => {
    setPage(1);
    void fetchList(1);
  };

  const handleReset = () => {
    setSearchParams({ status: '' });
    setPriorityFilter('');
    priorityFilterRef.current = '';
    setPage(1);
    void fetchList(1, pageSize, { status: '' });
  };

  const openDetail = (id: number) => {
    setSelectedId(id);
    setDetailVisible(true);
  };

  const closeApply = () => {
    setApplyVisible(false);
    setEditingDraft(null);
    setSelectedDef(null);
    setApplyCategoryId(null);
    setDynamicFormInitValues({});
  };

  const openApply = async () => {
    setEditingDraft(null);
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

  const collectFormData = async () => {
    if (!formApi.current) return null;
    try {
      const values = await formApi.current.validate() as Record<string, unknown>;
      let formData: Record<string, unknown> = {};
      if (dynamicFormApi.current && selectedDef?.formFields && selectedDef.formFields.length > 0) {
        formData = await dynamicFormApi.current.validate() as Record<string, unknown>;
      }
      return { values, formData };
    } catch {
      return null;
    }
  };

  const handleSubmitApply = async () => {
    const result = await collectFormData();
    if (!result) return;
    const { values, formData } = result;
    setSubmitting(true);
    try {
      const res = await request.post('/api/workflows/instances', {
        definitionId: values.definitionId,
        title: values.title,
        formData,
        priority: values.priority ?? 'normal',
        ccUserIds: Array.isArray(values.ccUserIds) ? values.ccUserIds : undefined,
      });
      if (res.code === 0) {
        Toast.success('申请已提交');
        closeApply();
        void fetchList();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    const result = await collectFormData();
    if (!result) return;
    const { values, formData } = result;
    setSavingDraft(true);
    try {
      const res = await request.post('/api/workflows/instances', {
        definitionId: values.definitionId,
        title: values.title,
        formData,
        priority: values.priority ?? 'normal',
        ccUserIds: Array.isArray(values.ccUserIds) ? values.ccUserIds : undefined,
        asDraft: true,
      });
      if (res.code === 0) {
        Toast.success('草稿已保存');
        closeApply();
        void fetchList();
      }
    } finally {
      setSavingDraft(false);
    }
  };

  const handleUpdateDraft = async () => {
    if (!editingDraft) return;
    const result = await collectFormData();
    if (!result) return;
    const { values, formData } = result;
    setSavingDraft(true);
    try {
      const res = await request.put(`/api/workflows/instances/${editingDraft.id}/draft`, {
        title: values.title,
        formData,
      });
      if (res.code === 0) {
        Toast.success('草稿已更新');
        closeApply();
        void fetchList();
      }
    } finally {
      setSavingDraft(false);
    }
  };

  const handleSaveAndSubmitDraft = async () => {
    if (!editingDraft) return;
    const result = await collectFormData();
    if (!result) return;
    const { values, formData } = result;
    setSubmitting(true);
    try {
      const updateRes = await request.put(`/api/workflows/instances/${editingDraft.id}/draft`, {
        title: values.title,
        formData,
      });
      if (updateRes.code !== 0) return;
      const submitRes = await request.post(`/api/workflows/instances/${editingDraft.id}/submit`, {});
      if (submitRes.code === 0) {
        Toast.success('申请已提交');
        closeApply();
        void fetchList();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDirectSubmitDraft = async (id: number) => {
    const res = await request.post(`/api/workflows/instances/${id}/submit`, {});
    if (res.code === 0) {
      Toast.success('申请已提交');
      void fetchList();
    }
  };

  const handleDeleteDraft = async (id: number) => {
    const res = await request.delete(`/api/workflows/instances/${id}`);
    if (res.code === 0) {
      Toast.success('已删除');
      void fetchList();
    }
  };

  const handleResubmit = async (id: number) => {
    const res = await request.post<WorkflowInstance>(`/api/workflows/instances/${id}/resubmit`, {});
    if (res.code === 0) {
      Toast.success('已生成草稿，请在草稿箱中编辑提交');
      void fetchList();
    }
  };

  const selectedRunningIds = selectedRowKeys.filter((id) => (data?.list ?? []).some((item) => item.id === id && item.status === 'running'));

  const openBatchWithdraw = () => {
    if (selectedRunningIds.length === 0) {
      Toast.warning('请选择审批中的申请');
      return;
    }
    setBatchWithdrawComment('');
    setBatchWithdrawVisible(true);
  };

  const handleBatchWithdraw = async () => {
    const instanceIds = selectedRunningIds;
    if (instanceIds.length === 0) {
      Toast.warning('请选择审批中的申请');
      return;
    }
    setBatchWithdrawLoading(true);
    try {
      const res = await request.post<WorkflowInstanceBatchActionResponse>('/api/workflows/instances/batch-withdraw', {
        instanceIds,
        comment: batchWithdrawComment.trim() || undefined,
      });
      if (res.code === 0) {
        Toast.success(res.message || `成功 ${res.data.succeeded} 条，失败 ${res.data.failed} 条`);
        setBatchWithdrawVisible(false);
        setBatchWithdrawComment('');
        setSelectedRowKeys([]);
        void fetchList();
      }
    } finally {
      setBatchWithdrawLoading(false);
    }
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
    setBatchUrgeLoading(true);
    try {
      const res = await request.post<WorkflowInstanceBatchActionResponse>('/api/workflows/instances/batch-urge', {
        instanceIds,
        message: batchUrgeMessage.trim() || undefined,
      });
      if (res.code === 0) {
        Toast.success(res.message || `成功 ${res.data.succeeded} 条，失败 ${res.data.failed} 条`);
        setBatchUrgeVisible(false);
        setBatchUrgeMessage('');
        setSelectedRowKeys([]);
        void fetchList();
      }
    } finally {
      setBatchUrgeLoading(false);
    }
  };

  const columns: ColumnProps<WorkflowInstance>[] = [
    {
      title: '申请标题',
      dataIndex: 'title',
      width: 200,
      render: renderEllipsis,
    },
    {
      title: '业务编号',
      dataIndex: 'serialNo',
      width: 130,
      render: (v: string | null) => v ?? '—',
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
    {
      title: '操作',
      key: 'action',
      width: 120,
      fixed: 'right',
      render: (_: unknown, record: WorkflowInstance) => {
        if (record.status === 'draft') {
          return (
            <Space>
              <Button theme="borderless" size="small" onClick={() => void openEditDraft(record)}>编辑</Button>
              <Popconfirm title="确定要提交此草稿吗？" onConfirm={() => void handleDirectSubmitDraft(record.id)}>
                <Button theme="borderless" size="small">提交</Button>
              </Popconfirm>
              <Popconfirm title="确定要删除此草稿吗？" onConfirm={() => void handleDeleteDraft(record.id)}>
                <Button theme="borderless" size="small" type="danger">删除</Button>
              </Popconfirm>
            </Space>
          );
        }
        if (record.status === 'rejected' || record.status === 'withdrawn') {
          return (
            <Space>
              <Button theme="borderless" size="small" onClick={() => openDetail(record.id)}>详情</Button>
              {record.allowResubmit !== false && (
                <Popconfirm title="将生成新草稿，确定要重新提交吗？" onConfirm={() => void handleResubmit(record.id)}>
                  <Button theme="borderless" size="small">重新提交</Button>
                </Popconfirm>
              )}
            </Space>
          );
        }
        return (
          <Space>
            <Button theme="borderless" size="small" onClick={() => openDetail(record.id)}>详情</Button>
          </Space>
        );
      },
    },
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

  return (
    <div className="page-container">
      <SearchToolbar>
          <Select
            placeholder="全部状态"
            value={searchParams.status || undefined}
            onChange={v => setSearchParams({ status: typeof v === 'string' ? v : '' })}
            showClear
            style={{ width: 140 }}
          >
            {Object.entries(INSTANCE_STATUS_MAP).map(([k, s]) => (
              <Select.Option key={k} value={k}>{s.text}</Select.Option>
            ))}
          </Select>
          <Select
            placeholder="全部优先级"
            value={priorityFilter || undefined}
            onChange={v => setPriorityFilter(typeof v === 'string' ? v : '')}
            showClear
            style={{ width: 130 }}
            optionList={WORKFLOW_PRIORITY_OPTIONS}
          />
          <Button type="primary" icon={<Search size={14} />} onClick={() => { handleSearch(); }}>查询</Button>
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { handleReset(); }}>重置</Button>
          <Button type="tertiary" icon={<Undo2 size={14} />} disabled={selectedRunningIds.length === 0} onClick={openBatchWithdraw}>批量撤回</Button>
          <Button type="primary" icon={<Megaphone size={14} />} disabled={selectedRunningIds.length === 0} onClick={openBatchUrge}>批量催办</Button>
          <Button type="primary" icon={<Plus size={14} />} onClick={() => { void openApply(); }}>
            发起申请
          </Button>
      </SearchToolbar>
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        rowKey="id"
        loading={loading}
        pagination={buildPagination(data?.total ?? 0, fetchList)}
        onRefresh={() => void fetchList()}
        refreshLoading={loading}
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
        onRefresh={() => void fetchList()}
      />

      {/* 发起 / 编辑草稿 */}
      <SideSheet
        title={applySheetTitle}
        visible={applyVisible}
        onCancel={closeApply}
        width={720}
        bodyStyle={{ padding: 16 }}
        footer={applySheetFooter}
      >
        <Form key={formKey} getFormApi={api => { formApi.current = api; }}>
          <Form.Select
            field="categoryId"
            label="流程分类"
            placeholder="全部分类"
            showClear
            style={{ width: '100%' }}
            initValue={applyCategoryId ?? undefined}
            disabled={editingDraft !== null}
            onChange={v => {
              const next = typeof v === 'number' ? v : null;
              setApplyCategoryId(next);
              if (!editingDraft) {
                setSelectedDef(null);
                formApi.current?.setValue('definitionId', undefined);
                formApi.current?.setValue('title', '');
              }
            }}
            optionList={categories.map(c => ({ value: c.id, label: c.name }))}
          />
          <Form.Select
            field="definitionId"
            label="选择流程"
            placeholder="请选择要发起的流程"
            rules={[{ required: true, message: '请选择流程' }]}
            style={{ width: '100%' }}
            initValue={editingDraft?.definitionId}
            disabled={editingDraft !== null}
            optionList={definitions
              .filter(d => applyCategoryId === null || d.categoryId === applyCategoryId)
              .map(d => ({ value: d.id, label: d.name }))}
            onChange={v => {
              const def = definitions.find(d => d.id === v) ?? null;
              setSelectedDef(def);
              setDynamicFormInitValues({});
              if (def) {
                const who = user?.nickname || user?.username || '我';
                const auto = `${def.name} - ${who} - ${dayjs().format('YYYY-MM-DD')}`;
                formApi.current?.setValue('title', auto);
              }
            }}
          />
          <Form.Input
            field="title"
            label="申请标题"
            placeholder="选择流程后自动生成，可手动修改"
            rules={[{ required: true, message: '请填写申请标题' }]}
            initValue={editingDraft?.title}
          />
          <Form.Select
            field="priority"
            label="优先级"
            style={{ width: '100%' }}
            initValue={editingDraft?.priority ?? 'normal'}
            optionList={WORKFLOW_PRIORITY_OPTIONS}
          />
          {!editingDraft && (
            <Form.Select
              field="ccUserIds"
              label="抄送人"
              placeholder="可选，提交后立即抄送给所选成员"
              multiple
              filter
              showClear
              style={{ width: '100%' }}
              optionList={userOptions}
            />
          )}
          {selectedDef?.description && (
            <div style={{ padding: '8px 0', color: 'var(--semi-color-text-2)', fontSize: 13 }}>
              <FileInput size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              {selectedDef.description}
            </div>
          )}
        </Form>
        {selectedDef && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--semi-color-border)', paddingTop: 12 }}>
            <Tabs type="line" defaultActiveKey="form">
              <TabPane tab="填写表单" itemKey="form">
                {selectedDef.formFields && selectedDef.formFields.length > 0 ? (
                  <WorkflowFormRenderer
                    key={`form-${formKey}-${selectedDef.id}`}
                    fields={selectedDef.formFields}
                    initValues={dynamicFormInitValues}
                    getFormApi={api => { dynamicFormApi.current = api; }}
                  />
                ) : (
                  <Typography.Text type="tertiary">该流程未配置表单字段</Typography.Text>
                )}
              </TabPane>
              <TabPane tab="审批链路" itemKey="chain">
                <WorkflowApproverPreview
                  definitionId={selectedDef.id}
                  getFormData={() => (dynamicFormApi.current?.getValues?.() as Record<string, unknown>) ?? {}}
                />
              </TabPane>
              <TabPane tab="流程图预览" itemKey="graph">
                <WorkflowGraphView flowData={selectedDef.flowData} />
              </TabPane>
              <TabPane tab="节点详情" itemKey="nodes">
                <WorkflowNodeListView flowData={selectedDef.flowData} />
              </TabPane>
            </Tabs>
          </div>
        )}
      </SideSheet>

      <AppModal
        title="批量撤回"
        visible={batchWithdrawVisible}
        onCancel={() => setBatchWithdrawVisible(false)}
        onOk={() => void handleBatchWithdraw()}
        confirmLoading={batchWithdrawLoading}
        okText="确认撤回"
      >
        <Typography.Text>确定撤回选中的 {selectedRunningIds.length} 个申请吗？</Typography.Text>
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
        confirmLoading={batchUrgeLoading}
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
