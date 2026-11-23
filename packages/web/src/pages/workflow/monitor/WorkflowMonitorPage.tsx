import { RUNNING_STATUSES, ISSUE_SOURCE_MAP, NODE_STATE_MAP, NODE_STATE_TIMELINE_TYPE, FOCUS_SEVERITY_META, buildDiagNodes, getNodeConfigItems, buildFocusDiagnosis, type TagColor, type DiagNode } from './diagnostics-model';
import { lazy, Suspense, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, JsonViewer, Modal, SideSheet, Space, Spin, Tabs, TabPane, Tag, Timeline, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Download, FileText, UserRoundCog } from 'lucide-react';
import dayjs from 'dayjs';
import { WORKFLOW_INSTANCE_PRIORITIES, WORKFLOW_INSTANCE_STATUSES, WORKFLOW_JOB_STATUSES, type WorkflowCategory, type WorkflowExecutionToken, type WorkflowInstanceListItem, type WorkflowJobStatus, type WorkflowRuntimeOutboxEvent, type WorkflowTask, type WorkflowTriggerExecution } from '@zenith/shared/workflow';
import { enumValueOf } from '@zenith/shared/core';
import { workflowInstanceOpsContract } from '@zenith/shared/workflow';
import { api } from '@/lib/contract-query';
import { WORKFLOW_ISSUE_SEVERITY_META as ISSUE_SEVERITY_MAP } from './constants';
import { downloadBlob } from '@/utils/download';
import { formatSecondsBetween } from '@/utils/format';
import { UserAvatar } from '@/components/UserAvatar';
import AppModal from '@/components/AppModal';
import ExportButton from '@/components/ExportButton';
import SavedViewsBar from '@/components/workflow/SavedViewsBar';
import WorkflowPriorityTag, { WORKFLOW_PRIORITY_OPTIONS } from '@/components/workflow/WorkflowPriorityTag';
import WorkflowInstanceCell from '@/components/workflow/WorkflowInstanceCell';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { useListSearch } from '@/hooks/useListSearch';
import { useListDeepLink } from '@/hooks/useListDeepLink';
import { usePermission } from '@/hooks/usePermission';
import WorkflowInstanceDetailPanel from '@/components/workflow/WorkflowInstanceDetailPanel';
import WorkflowGraphView from '@/components/workflow/WorkflowGraphView';
import { NODE_RT_STATUS_COLOR, NODE_RT_STATUS_LABEL, INSTANCE_STATUS_MAP, nodeStatusDisplay } from '@/components/workflow/workflow-runtime';
import { resolveWorkflowFlowData, resolveWorkflowFormFields } from '@/utils/workflow-snapshot';
import WorkflowAnalyticsView from './WorkflowAnalyticsView';
import WorkflowTasksMonitorView from './WorkflowTasksMonitorView';
import {
  WORKFLOW_NODE_TYPE_LABEL as NODE_TYPE_LABEL,
  taskAssigneeColumn, taskCommentColumn, taskIdColumn, taskNodeColumn, taskNodeTypeColumn, taskStatusColumn, taskStayDurationColumn,
} from '@/components/workflow/workflow-task-columns';
import WorkflowHandoverModal from './WorkflowHandoverModal';
import WorkflowEngineDiagnosticsView from './WorkflowEngineDiagnosticsView';
import WorkflowJobsView from './WorkflowJobsView';
import WorkflowCompensationsView from './WorkflowCompensationsView';
import WorkflowEngineTraceView from './WorkflowEngineTraceView';
import { useWorkflowCategories } from '@/hooks/useWorkflowCategories';
import { dateTimeColumn, EMPTY_PLACEHOLDER, overflowTagColumn, renderEllipsis } from '../../../utils/table-columns';
import {
  fetchWorkflowDiagnosticBundle,
  useCancelWorkflowInstance,
  useDeleteWorkflowInstanceAsAdmin,
  useJumpWorkflowInstance,
  useMigrateWorkflowInstance,
  useReassignWorkflowTask,
  useReplayWorkflowToken,
  useResumeWorkflowInstance,
  useSkipWorkflowToken,
  useSuspendWorkflowInstance,
  useWorkflowDefinitionDetail,
  useWorkflowInstanceDetail,
  useWorkflowMigratePreflight,
  useWorkflowMonitorDefinitionOptions,
  useWorkflowMonitorList,
  useWorkflowRuntimeDiagnostics,
  workflowMonitorInstanceDetailQuery,
  workflowMonitorKeys,
} from '@/hooks/queries/workflow-monitor';
import { useAllUsers } from '@/hooks/queries/users';

import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { deleteAction, ListSearchToolbar, listTableProps, useRowSelection } from '@/components/list-page';
import { workflowInstanceStatusColumn } from '@/components/workflow/WorkflowInstanceListColumns';
import { confirmDanger } from '@/utils/confirm';

import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useFilterQuery } from '@/hooks/useFilterQuery';
/** 只读流程设计器（懒加载）：用于在诊断 SideSheet 内查看发起时的流程定义快照 */
const WorkflowDesignerPage = lazy(() => import('@/pages/workflow/designer/WorkflowDesignerPage'));

export default function WorkflowMonitorPage() {
  const [activeTab, setActiveTab] = useUrlTabState(['list', 'tasks', 'analytics', 'engine', 'jobs', 'compensations'] as const, 'list');
  const [initialJobStatus, setInitialJobStatus] = useState<WorkflowJobStatus | undefined>();
  useListDeepLink(['status'], (params) => {
    if (activeTab === 'jobs') setInitialJobStatus(enumValueOf(WORKFLOW_JOB_STATUSES, params.status));
  });
  const queryClient = useQueryClient();
  interface SearchParams { keyword: string; initiator: string; status?: string; categoryId?: number; definitionId?: number; priority?: string }
  const defaultSearchParams: SearchParams = { keyword: '', initiator: '', status: undefined, categoryId: undefined, definitionId: undefined, priority: undefined };
  const {
    page, pageSize, buildPagination,
    draftParams, bind, bindKeyword, submittedParams,
    handleSearch, applySearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: workflowMonitorKeys.monitorLists });
  // 已提交筛选 → 契约查询参数：列表与导出共用同一份映射
  const filterQuery = useFilterQuery({
    keyword: submittedParams.keyword,
    status: enumValueOf(WORKFLOW_INSTANCE_STATUSES, submittedParams.status),
    categoryId: submittedParams.categoryId,
    definitionId: submittedParams.definitionId,
    initiatorKeyword: submittedParams.initiator,
    priority: enumValueOf(WORKFLOW_INSTANCE_PRIORITIES, submittedParams.priority),
  });
  const listQuery = useWorkflowMonitorList({ page, pageSize, ...filterQuery });
  const data = listQuery.data ?? null;

  const { hasPermission } = usePermission();
  const canReadDefinitions = hasPermission('workflow:definition:list');
  const { categories } = useWorkflowCategories(canReadDefinitions);
  // 勾选用于批量导出审批单 PDF；翻页 / 重新检索后仅保留仍在当前页的选中项
  const { selectedRowKeys, rowSelection } = useRowSelection();
  const selectedPrintableIds = selectedRowKeys.filter((id) => (data?.list ?? []).some((item) => item.id === id));
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailId, setDetailId] = useState<number | undefined>();
  const detailQuery = useWorkflowInstanceDetail(detailId, detailVisible);
  const detail = detailQuery.data ?? null;
  const detailDefinitionQuery = useWorkflowDefinitionDetail(
    detail && !detail.definitionSnapshot ? detail.definitionId : undefined,
    detailVisible && !!detail && !detail.definitionSnapshot,
    { silent: true },
  );
  const detailDef = detailDefinitionQuery.data ?? null;
  const detailLoading = detailQuery.isFetching || detailDefinitionQuery.isFetching;

  const [diagnosticsVisible, setDiagnosticsVisible] = useState(false);
  const [diagnosticsId, setDiagnosticsId] = useState<number | undefined>();
  const diagnosticsQuery = useWorkflowRuntimeDiagnostics(diagnosticsId, diagnosticsVisible);
  const diagnostics = diagnosticsQuery.data ?? null;
  const diagnosticsLoading = diagnosticsQuery.isFetching;
  const [diagnosticsTab, setDiagnosticsTab] = useState('nodes');
  const [defSnapshotVisible, setDefSnapshotVisible] = useState(false);

  // 流程定义（用于数据分析筛选 + 强制跳转节点选择）；监控只读角色可能没有定义读取权限，避免无效 403
  const definitionsQuery = useWorkflowMonitorDefinitionOptions(canReadDefinitions);
  const definitions = canReadDefinitions ? definitionsQuery.data ?? [] : [];
  // 管理员：强制跳转
  const [jumpRecord, setJumpRecord] = useState<WorkflowInstanceListItem | null>(null);
  const [jumpPreviewToken, setJumpPreviewToken] = useState<string>();
  const [jumpNodes, setJumpNodes] = useState<Array<{ label: string; value: string }>>([]);
  const [jumpActiveTasks, setJumpActiveTasks] = useState<WorkflowTask[]>([]);
  // useEditModal 例外：工作流运行时表单（强制跳转节点），非实体新增 / 编辑
  const jumpFormApi = useRef<FormApi | null>(null);
  // 管理员：改派处理人
  const [reassignRecord, setReassignRecord] = useState<WorkflowInstanceListItem | null>(null);
  const [reassignTasks, setReassignTasks] = useState<Array<{ label: string; value: number }>>([]);
  // useEditModal 例外：工作流运行时表单（改派处理人），非实体新增 / 编辑
  const reassignFormApi = useRef<FormApi | null>(null);
  // 管理员：离职交接
  const [handoverVisible, setHandoverVisible] = useState(false);
  const cancelMutation = useCancelWorkflowInstance();
  const suspendMutation = useSuspendWorkflowInstance();
  const resumeMutation = useResumeWorkflowInstance();
  const migrateMutation = useMigrateWorkflowInstance();
  const deleteMutation = useDeleteWorkflowInstanceAsAdmin();
  const jumpMutation = useJumpWorkflowInstance();
  const reassignMutation = useReassignWorkflowTask();
  const skipTokenMutation = useSkipWorkflowToken();
  const replayTokenMutation = useReplayWorkflowToken();
  const migratePreflightMutation = useWorkflowMigratePreflight();
  const allUsersQuery = useAllUsers({ enabled: !!reassignRecord });
  const userOptions = (allUsersQuery.data ?? []).map((u) => ({ label: u.nickname ?? u.username, value: u.id }));

  const canAdmin = hasPermission('workflow:instance:intervene');

  const handleStatCardClick = (st: string | undefined) => {
    const next = draftParams.status === st ? undefined : st;
    const newParams = { ...draftParams, status: next };
    applySearch(newParams);
  };

  const loadDetail = (instanceId: number) => {
    setDetailId(instanceId);
  };

  const openDetail = (item: WorkflowInstanceListItem) => {
    setDetailVisible(true);
    loadDetail(item.id);
  };

  const openDiagnosticsById = (instanceId: number) => {
    setDiagnosticsVisible(true);
    setDiagnosticsId(instanceId);
    setDiagnosticsTab('nodes');
  };
  const openDiagnostics = (item: WorkflowInstanceListItem) => openDiagnosticsById(item.id);

  /** Token 运营恢复操作（跳过卡死 / 从节点重放）；成功后诊断由 hook 的失效回源 */
  const runTokenOp = async (tokenId: number, op: 'skip' | 'replay') => {
    if (!diagnosticsId) return;
    const tokenView = await api(workflowInstanceOpsContract.tokens, { params: { id: diagnosticsId } });
    let reason = '';
    await new Promise<void>(resolve => { Modal.confirm({ title: '确认强制干预', content: <Input placeholder="必填：干预原因" onChange={v => { reason = v; }} />, onOk: () => { if (reason.trim().length < 2) { Toast.warning('请填写原因'); throw new Error('missing reason'); } resolve(); } }); });
    const input = { params: { id: tokenId }, body: { reason, previewToken: tokenView.previewToken! } };
    await (op === 'skip' ? skipTokenMutation.mutateAsync(input) : replayTokenMutation.mutateAsync(input));
    Toast.success(op === 'skip' ? '已跳过并推进' : '已从该节点重放');
  };

  /** 导出实例诊断包（诊断 + 轨迹 + 执行 Token）为 JSON 文件 */
  const exportDiagnosticBundle = async (instanceId: number) => {
    const bundle = await fetchWorkflowDiagnosticBundle(instanceId);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `workflow-diagnostic-${instanceId}.json`);
  };

  const handleCancel = (record: WorkflowInstanceListItem) => {
    confirmDanger({
      title: '取消流程',
      content: `确定要强制取消流程「${record.title}」吗？取消后流程将立即终止，待办任务会被跳过，此操作不可恢复。`,
      okText: '确定取消',
      okButtonProps: { type: 'warning', theme: 'solid' },
      cancelText: '关闭',
      onOk: async () => {
        await cancelMutation.mutateAsync({ params: { id: record.id } });
        Toast.success('流程已取消');
      },
    });
  };

  const handleSuspend = (record: WorkflowInstanceListItem) => {
    let reason = '';
    Modal.confirm({
      title: '挂起流程',
      content: (
        <div>
          <Typography.Paragraph>
            挂起后流程「{record.title}」暂停流转：待办不可处理，延时、超时、触发器、外部审批与子流程作业暂停；恢复后按剩余时长继续。
          </Typography.Paragraph>
          <Input placeholder="请填写挂起原因（必填）" onChange={(v) => { reason = v; }} maxLength={500} />
        </div>
      ),
      okText: '确定挂起',
      okButtonProps: { type: 'warning', theme: 'solid' },
      cancelText: '关闭',
      onOk: async () => {
        if (!reason.trim()) { Toast.warning('请填写挂起原因'); return Promise.reject(new Error('validation')); }
        await suspendMutation.mutateAsync({ params: { id: record.id }, body: { reason: reason.trim() } });
        Toast.success('流程已挂起，自动推进已暂停');
      },
    });
  };

  const handleResume = (record: WorkflowInstanceListItem) => {
    Modal.confirm({
      title: '恢复流程',
      content: `确定恢复流程「${record.title}」吗？恢复后待办可继续处理，超时计时按挂起前剩余时长续跑。${record.suspendReason ? `挂起原因：${record.suspendReason}` : ''}`,
      okText: '确定恢复',
      okButtonProps: { type: 'primary', theme: 'solid' },
      cancelText: '关闭',
      onOk: async () => {
        await resumeMutation.mutateAsync({ params: { id: record.id } });
        Toast.success('流程已恢复流转');
      },
    });
  };

  const handleMigrate = async (record: WorkflowInstanceListItem) => {
    const p = await migratePreflightMutation.mutateAsync({ params: { id: record.id } });
    if (!p) return;
    if (!p.migratable) { Toast.warning(p.blocked.length ? `无法迁移：新版本缺失节点 ${p.blocked.join(', ')}` : '无需迁移或已是最新版本'); return; }
    Modal.confirm({
      title: '迁移到最新版本', content: `将实例「${record.title}」从 v${p.fromVersion} 迁移到 v${p.toVersion}？`,
      onOk: async () => {
        await migrateMutation.mutateAsync({ params: { id: record.id }, body: { targetVersion: p.toVersion, previewToken: p.previewToken } });
        Toast.success('迁移成功');
      },
    });
  };

  const stats = data?.stats ?? { total: 0, running: 0, suspended: 0, returned: 0, approved: 0, rejected: 0, withdrawn: 0, cancelled: 0 };
  // 首次加载完成前显示占位符，避免统计短暂闪现误导性的 0
  const statValue = (v: number) => (listQuery.isLoading ? EMPTY_PLACEHOLDER : v);

  const openJump = async (record: WorkflowInstanceListItem) => {
    setJumpRecord(record);
    setJumpNodes([]);
    setJumpActiveTasks([]);
    const instance = await queryClient.fetchQuery(workflowMonitorInstanceDetailQuery(record.id));
    setJumpPreviewToken(instance.interventionPreviewToken);
    const nodes = (instance.definitionSnapshot?.flowData?.nodes ?? [])
      .filter((n) => n.data.type === 'approve' || n.data.type === 'handler')
      .map((n) => ({ label: n.data.label ?? n.data.key, value: n.data.key }));
    setJumpNodes(nodes);
    setJumpActiveTasks((instance.tasks ?? []).filter((t) => t.status === 'pending' || t.status === 'waiting'));
  };

  const submitJump = async () => {
    if (!jumpRecord) return;
    try {
      const values = await jumpFormApi.current?.validate() as { targetNodeKey: string; comment: string };
      if (!jumpPreviewToken) return;
      await jumpMutation.mutateAsync({ params: { id: jumpRecord.id }, body: { ...values, previewToken: jumpPreviewToken } });
      Toast.success('已强制跳转');
      setJumpRecord(null);
    } catch { /* validation */ }
  };

  const openReassign = async (record: WorkflowInstanceListItem) => {
    setReassignRecord(record);
    setReassignTasks([]);
    const instance = await queryClient.fetchQuery(workflowMonitorInstanceDetailQuery(record.id));
    const tasks = (instance.tasks ?? [])
      .filter((t: WorkflowTask) => t.status === 'pending' || t.status === 'waiting')
      .map((t: WorkflowTask) => ({ label: `${t.nodeName} · ${t.assigneeName ?? '未指派'}`, value: t.id }));
    setReassignTasks(tasks);
  };

  const submitReassign = async () => {
    if (!reassignRecord) return;
    try {
      const values = await reassignFormApi.current?.validate() as { taskId: number; targetUserId: number; comment?: string };
      await reassignMutation.mutateAsync({ params: { taskId: values.taskId }, body: { targetUserId: values.targetUserId, comment: values.comment } });
      Toast.success('已改派');
      setReassignRecord(null);
    } catch { /* validation */ }
  };

  const renderJsonBlock = (value: unknown) => {
    if (value == null) {
      return (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--semi-color-text-2)' }}>暂无数据</div>
      );
    }
    return (
      <JsonViewer
        value={JSON.stringify(value, null, 2)}
        width="100%"
        height={400}
        showSearch
        options={{ readOnly: true, autoWrap: true, formatOptions: { tabSize: 2 } }}
      />
    );
  };

  const renderDiagnostics = () => {
    if (!diagnostics) return null;
    const taskColumns: ColumnProps<WorkflowTask>[] = [
      taskIdColumn<WorkflowTask>(),
      taskNodeColumn<WorkflowTask>(),
      taskNodeTypeColumn<WorkflowTask>(),
      dateTimeColumn('任务开始时间', 'createdAt'),
      dateTimeColumn('任务结束时间', 'actionAt'),
      taskAssigneeColumn<WorkflowTask>('审批人', 120),
      taskStatusColumn<WorkflowTask>('审批状态', 110),
      taskCommentColumn<WorkflowTask>(),
      taskStayDurationColumn<WorkflowTask>(),
    ];
    const triggerColumns: ColumnProps<WorkflowTriggerExecution>[] = [
      { title: 'ID', dataIndex: 'id', width: 70 },
      { title: '任务', dataIndex: 'taskId', width: 80, render: (v: number | null) => v ? `#${v}` : EMPTY_PLACEHOLDER },
      { title: '节点', dataIndex: 'nodeName', width: 140, render: (_: unknown, row) => row.nodeName || row.nodeKey },
      { title: '类型', dataIndex: 'triggerType', width: 110 },
      { title: '状态', dataIndex: 'status', width: 130 },
      { title: '尝试', dataIndex: 'attempt', width: 70 },
      { title: 'HTTP', dataIndex: 'responseStatus', width: 80, render: (v: number | null) => v ?? EMPTY_PLACEHOLDER },
      { title: '耗时', dataIndex: 'durationMs', width: 90, align: 'right', render: (v: number | null) => v != null ? `${v}ms` : EMPTY_PLACEHOLDER },
      { title: '错误', dataIndex: 'errorMessage', minWidth: 220, ellipsis: { showTitle: true }, render: (v: string | null) => v ?? EMPTY_PLACEHOLDER },
      dateTimeColumn('创建时间', 'createdAt'),
    ];
    const outboxColumns: ColumnProps<WorkflowRuntimeOutboxEvent>[] = [
      { title: 'ID', dataIndex: 'id', width: 70 },
      { title: '事件', dataIndex: 'eventType', width: 360, render: renderEllipsis },
      { title: '任务', dataIndex: 'taskId', width: 80, render: (v: number | null) => v ? `#${v}` : EMPTY_PLACEHOLDER },
      { title: '状态', dataIndex: 'status', width: 130 },
      { title: '尝试', dataIndex: 'attempts', width: 70 },
      dateTimeColumn('下次重试', 'nextRetryAt'),
      { title: '错误', dataIndex: 'errorMessage', minWidth: 260, ellipsis: { showTitle: true }, render: (v: string | null) => v ?? EMPTY_PLACEHOLDER },
      dateTimeColumn('创建时间', 'createdAt'),
    ];

    const tokenColumns: ColumnProps<WorkflowExecutionToken>[] = [
      { title: 'ID', dataIndex: 'id', width: 70 },
      { title: '节点', dataIndex: 'nodeName', minWidth: 150, render: (v: string | null, r) => v ?? r.nodeKey },
      overflowTagColumn<WorkflowExecutionToken>({
        title: '状态',
        dataIndex: 'status',
        width: 150,
        contentWidth: 118,
        getItems: (v, record) => {
          const status = v as WorkflowExecutionToken['status'];
          return [
            {
              key: 'status',
              label: ({ active: '活动', consumed: '已消费', dead: '已终止' } as const)[status],
              color: status === 'active' ? 'green' : status === 'consumed' ? 'grey' : 'red',
            },
            ...(record.parkedAtJoin ? [{ key: 'parked', label: '汇聚等待', color: 'amber' as const }] : []),
          ];
        },
        tagSize: 'small',
      }),
      { title: '分支', dataIndex: 'branchPath', width: 150, render: (bp: WorkflowExecutionToken['branchPath']) => bp.length === 0 ? '主路径' : bp.map((f) => `${f.index + 1}/${f.total}`).join(' · ') },
      { title: '深度', dataIndex: 'depth', width: 70 },
      { title: '父 Token', dataIndex: 'parentTokenId', width: 110, render: (v: number | null) => v ? `#${v}` : EMPTY_PLACEHOLDER },
      { title: '作用域', dataIndex: 'scopeKey', width: 180, ellipsis: { showTitle: true }, render: (v: string | null) => v ?? EMPTY_PLACEHOLDER },
      dateTimeColumn('创建', 'createdAt'),
      dateTimeColumn('消费/终止', 'consumedAt'),
      createOperationColumn<WorkflowExecutionToken>({
        width: 150,
        actions: (r) => [
          {
            key: 'skip', label: '跳过', hidden: r.status !== 'active' || !hasPermission('workflow:instance:intervene'),
            onClick: () => { Modal.confirm({ title: '跳过该卡死 Token 并推进流程？', onOk: () => runTokenOp(r.id, 'skip') }); },
          },
          {
            key: 'replay', label: '重放', danger: true, hidden: !hasPermission('workflow:instance:intervene') || diagnostics.instance.status !== 'running',
            onClick: () => { confirmDanger({ title: '从该 Token 节点重放？', content: '将清场全部活动 Token 并在该节点重建路径', onOk: () => runTokenOp(r.id, 'replay') }); },
          },
        ],
      }),
    ];

    const inst = diagnostics.instance;
    const flowData = resolveWorkflowFlowData(inst, null);
    const diagNodes = buildDiagNodes(flowData, diagnostics.tasks, inst.currentNodeKeys ?? []);
    const nodeNameByKey = new Map(diagNodes.map((n) => [n.key, n.name]));
    const statusMeta = INSTANCE_STATUS_MAP[inst.status] ?? { text: inst.status, color: 'grey' as TagColor };
    const currentNodeText = inst.currentNodeNames && inst.currentNodeNames.length > 0
      ? inst.currentNodeNames.join('、')
      : (inst.currentNodeName || EMPTY_PLACEHOLDER);
    const focusDiagnosis = buildFocusDiagnosis(diagnostics, diagNodes);
    const focusMeta = FOCUS_SEVERITY_META[focusDiagnosis.severity];

    const renderNodeConfigSummary = (node: DiagNode) => {
      const items = getNodeConfigItems(node.config);
      if (items.length === 0) return null;
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 16px', margin: '2px 0 6px' }}>
          {items.map((it) => (
            <span key={it.label} style={{ fontSize: 12 }}>
              <Typography.Text type="tertiary" size="small">{it.label}：</Typography.Text>
              <Typography.Text size="small">{it.value}</Typography.Text>
            </span>
          ))}
        </div>
      );
    };

    const renderNodeTaskRow = (task: WorkflowTask) => {
      const display = nodeStatusDisplay(task.status, task.nodeType === 'ccNode');
      return (
      <div key={task.id} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Typography.Text type="tertiary" size="small" style={{ width: 40 }}>#{task.id}</Typography.Text>
          <Tag size="small" color={display.color}>{display.label}</Tag>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 110 }}>
            <UserAvatar name={task.assigneeName || '未指定'} avatar={task.assigneeAvatar} size={20} />
            <Typography.Text size="small">{task.assigneeName || '未指定'}</Typography.Text>
          </span>
          <Typography.Text type="tertiary" size="small" style={{ marginLeft: 'auto' }}>{task.actionAt || task.createdAt}</Typography.Text>
        </div>
        {task.comment && (
          <Typography.Text size="small" ellipsis={{ showTooltip: true }}>
            “{task.comment}”
          </Typography.Text>
        )}
      </div>
      );
    };

    const renderNodes = () => {
      if (diagNodes.length === 0) {
        return (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--semi-color-text-2)' }}>
            无流程定义节点数据（缺少流程定义快照）
          </div>
        );
      }
      return (
        <Timeline>
          {diagNodes.map((node) => {
            const stateMeta = NODE_STATE_MAP[node.state];
            const typeLabel = NODE_TYPE_LABEL[node.type] ?? node.type;
            return (
              <Timeline.Item key={node.key} type={NODE_STATE_TIMELINE_TYPE[node.state]}>
                <div style={{ paddingBottom: 6 }}>
                  <Space spacing={8} wrap align="center" style={{ marginBottom: 2 }}>
                    <Tag size="small" color="grey" type="light">{typeLabel}</Tag>
                    <Typography.Text strong>{node.name}</Typography.Text>
                    <Typography.Text type="tertiary" size="small">{node.key}</Typography.Text>
                    {node.isCurrent && <Tag size="small" color="light-blue">当前</Tag>}
                    <Tag size="small" color={stateMeta.color}>{stateMeta.text}</Tag>
                    <Typography.Text type="tertiary" size="small">{node.tasks.length} 个任务</Typography.Text>
                  </Space>
                  {renderNodeConfigSummary(node)}
                  {node.tasks.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {node.tasks.map(renderNodeTaskRow)}
                    </div>
                  ) : (
                    <Typography.Text type="tertiary" size="small">该节点暂未生成运行时任务</Typography.Text>
                  )}
                </div>
              </Timeline.Item>
            );
          })}
        </Timeline>
      );
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 12 }}>
            <div><Typography.Text type="tertiary" size="small">流程名称</Typography.Text><div>{inst.definitionName || EMPTY_PLACEHOLDER}</div></div>
            <div><Typography.Text type="tertiary" size="small">状态</Typography.Text><div><Tag color={statusMeta.color}>{statusMeta.text}</Tag></div></div>
            <div><Typography.Text type="tertiary" size="small">当前节点</Typography.Text><div>{currentNodeText}</div></div>
            <div><Typography.Text type="tertiary" size="small">实例 ID</Typography.Text><div>#{inst.id}</div></div>
            <div><Typography.Text type="tertiary" size="small">定义 ID</Typography.Text><div>#{inst.definitionId}</div></div>
            <div>
              <Typography.Text type="tertiary" size="small">发起人</Typography.Text>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                {inst.initiatorName ? <UserAvatar name={inst.initiatorName} avatar={inst.initiatorAvatar} size={20} /> : null}
                <span>{inst.initiatorName || EMPTY_PLACEHOLDER}</span>
              </div>
            </div>
            <div><Typography.Text type="tertiary" size="small">Business Key</Typography.Text><div>{inst.bizType && inst.bizId ? `${inst.bizType}:${inst.bizId}` : EMPTY_PLACEHOLDER}</div></div>
            <div><Typography.Text type="tertiary" size="small">节点 / 任务</Typography.Text><div>{diagNodes.length} 节点 · {diagnostics.tasks.length} 任务（{diagnostics.activeTasks.length} 活动）</div></div>
            <div><Typography.Text type="tertiary" size="small">生成时间</Typography.Text><div>{diagnostics.generatedAt}</div></div>
          </div>
          <Tooltip content="查看该实例发起时的完整流程定义快照（基本信息 / 表单设计 / 流程图 / 节点配置 / 高级设置），即实例实际执行依据，而非最新版本。">
            <Button
              theme="borderless"
              size="small"
              icon={<FileText size={14} />}
              onClick={() => setDefSnapshotVisible(true)}
            >
              查看流程定义
            </Button>
          </Tooltip>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Space spacing={8} wrap align="center">
            <Tag color={focusMeta.color}>{focusMeta.text}</Tag>
            <Typography.Text strong>{focusDiagnosis.title}</Typography.Text>
            {focusDiagnosis.riskTags.map((tag) => (
              <Tag key={tag.label} size="small" color={tag.color}>{tag.label}</Tag>
            ))}
          </Space>
          <Typography.Text type="tertiary" size="small">{focusDiagnosis.description}</Typography.Text>

          <StatGrid minItemWidth={150} gap={10}>
            {focusDiagnosis.metrics.map((metric) => (
              <StatCard key={metric.label} title={metric.label} value={metric.value} sub={metric.hint} />
            ))}
          </StatGrid>

          {focusDiagnosis.activeTasks.length > 0 && (
            <div>
              <Typography.Text type="tertiary" size="small">当前活动任务</Typography.Text>
              <Space vertical align="start" spacing={6} style={{ width: '100%', marginTop: 6 }}>
                {focusDiagnosis.activeTasks.slice(0, 3).map((task) => (
                  <div
                    key={task.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flexWrap: 'wrap',
                      width: '100%',
                      padding: '4px 0',
                    }}
                  >
                    <Typography.Text type="tertiary" size="small">#{task.id}</Typography.Text>
                    <Tag size="small" color={NODE_RT_STATUS_COLOR[task.status]}>{NODE_RT_STATUS_LABEL[task.status]}</Tag>
                    <Typography.Text strong size="small">{task.nodeName || task.nodeKey}</Typography.Text>
                    <Space spacing={6}>
                      <UserAvatar name={task.assigneeName || '未指定'} avatar={task.assigneeAvatar} size={20} />
                      <Typography.Text size="small">{task.assigneeName || '未指定'}</Typography.Text>
                    </Space>
                    <Typography.Text type="tertiary" size="small">
                      等待 {formatSecondsBetween(task.createdAt, diagnostics.generatedAt)}
                    </Typography.Text>
                  </div>
                ))}
                {focusDiagnosis.activeTasks.length > 3 && (
                  <Typography.Text type="tertiary" size="small">
                    还有 {focusDiagnosis.activeTasks.length - 3} 个活动任务，可在“任务”标签查看全部。
                  </Typography.Text>
                )}
              </Space>
            </div>
          )}

          <div style={{ marginTop: 4 }}>
            <Typography.Text type="tertiary" size="small">建议动作：</Typography.Text>
            <Typography.Text size="small">{focusDiagnosis.nextAction}</Typography.Text>
          </div>
        </div>

        <div>
          <Typography.Title heading={6}>诊断结论</Typography.Title>
          <Space vertical align="start" spacing={8} style={{ width: '100%' }}>
            {diagnostics.issues.map((issue, index) => {
              const meta = ISSUE_SEVERITY_MAP[issue.severity];
              return (
                <div key={`${issue.source}-${issue.title}-${index}`} style={{ width: '100%' }}>
                  <Space spacing={8} wrap>
                    <Tag color={meta.color}>{meta.text}</Tag>
                    <Tag color="grey">{ISSUE_SOURCE_MAP[issue.source]}</Tag>
                    {issue.taskId != null && <Typography.Text type="tertiary">task #{issue.taskId}</Typography.Text>}
                    {issue.nodeKey && <Typography.Text type="tertiary">{nodeNameByKey.get(issue.nodeKey) ?? issue.nodeKey}</Typography.Text>}
                  </Space>
                  <div style={{ marginTop: 6 }}><Typography.Text strong>{issue.title}</Typography.Text></div>
                  <Typography.Text type="tertiary" size="small">{issue.description}</Typography.Text>
                </div>
              );
            })}
          </Space>
        </div>

        <Tabs collapsible="auto" type="line" activeKey={diagnosticsTab} onChange={setDiagnosticsTab}>
          <TabPane tab="引擎轨迹" itemKey="trace">
            {diagnosticsTab === 'trace' && <WorkflowEngineTraceView instanceId={inst.id} />}
          </TabPane>
          <TabPane tab={`节点 ${diagNodes.length}`} itemKey="nodes">
            <div style={{ marginBottom: 10 }}>
              <Typography.Text type="tertiary" size="small">
                节点来自发起时的流程定义快照，已与运行时任务按节点关联；一个节点可对应 0 到多个任务。
              </Typography.Text>
            </div>
            {renderNodes()}
          </TabPane>
          <TabPane tab={`任务 ${diagnostics.tasks.length}`} itemKey="tasks">
            <ConfigurableTable bordered columns={taskColumns} dataSource={diagnostics.tasks} rowKey="id" pagination={false} />
          </TabPane>
          <TabPane tab={`触发器 ${diagnostics.triggerExecutions.length}`} itemKey="triggers">
            <ConfigurableTable bordered columns={triggerColumns} dataSource={diagnostics.triggerExecutions} rowKey="id" pagination={false} />
          </TabPane>
          <TabPane tab={`事件派发 ${diagnostics.outboxEvents.length}`} itemKey="outbox">
            <ConfigurableTable bordered columns={outboxColumns} dataSource={diagnostics.outboxEvents} rowKey="id" pagination={false} />
          </TabPane>
          <TabPane tab={`执行 Token ${diagnostics.tokens.length}`} itemKey="tokens">
            <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <Typography.Text type="tertiary" size="small">
                显式执行 Token = 活动执行路径的权威单元：fork 沿分支栈分裂、join 凑齐后汇聚消费；已消费/终止 token 保留为执行树血缘。卡死可「跳过」、断点可「重放」。
              </Typography.Text>
              <Button size="small" icon={<Download size={14} />} onClick={() => exportDiagnosticBundle(diagnostics.instance.id)}>导出诊断包</Button>
            </div>
            <ConfigurableTable bordered columns={tokenColumns} dataSource={diagnostics.tokens} rowKey="id" pagination={false} />
          </TabPane>
          <TabPane tab="流程图" itemKey="graph">
            <div style={{ marginBottom: 10 }}>
              <Typography.Text type="tertiary" size="small">
                基于发起时的流程定义快照，叠加运行时任务状态（驳回回退轨迹会高亮提示）。
              </Typography.Text>
            </div>
            <WorkflowGraphView flowData={flowData} tasks={diagnostics.tasks} instanceStatus={inst.status} formFields={resolveWorkflowFormFields(inst, null)} />
          </TabPane>
          <TabPane tab="表单数据" itemKey="formData">
            {renderJsonBlock(diagnostics.snapshot.formData)}
          </TabPane>
          <TabPane tab="定义快照" itemKey="definitionSnapshot">
            {renderJsonBlock(diagnostics.snapshot.definitionSnapshot)}
          </TabPane>
        </Tabs>
      </div>
    );
  };

  const columns: ColumnProps<WorkflowInstanceListItem>[] = [
    {
      title: '申请标题',
      dataIndex: 'title',
      width: 220,
      render: (v: string, record: WorkflowInstanceListItem) => (
        <WorkflowInstanceCell instanceId={record.id} title={v} showSub={false} onOpen={() => openDetail(record)} />
      ),
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 80,
      render: (v: WorkflowInstanceListItem['priority']) => <WorkflowPriorityTag priority={v} />,
    },
    {
      title: '流程名称',
      dataIndex: 'definitionName',
      minWidth: 160,
      render: renderEllipsis,
    },
    {
      title: '分类',
      dataIndex: 'categoryName',
      width: 200,
      render: (v: string | null) => v
        ? (
          <Tooltip content={v}>
            <Tag size="small" color="blue" style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'middle' }}>{v}</Tag>
          </Tooltip>
        )
        : <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>,
    },
    overflowTagColumn<WorkflowInstanceListItem>({
      title: '当前节点',
      dataIndex: 'currentNodeName',
      width: 180,
      contentWidth: 148,
      getItems: (v, record) => {
        const names = (record.currentNodeNames && record.currentNodeNames.length > 0)
          ? record.currentNodeNames
          : (typeof v === 'string' && v ? [v] : []);
        return names.map((name) => ({ key: name, label: name }));
      },
      tagColor: 'cyan',
      tagSize: 'small',
      popoverWidth: 200,
    }),
    {
      title: '申请人',
      dataIndex: 'initiatorName',
      width: 200,
      render: (v: string | null, record: WorkflowInstanceListItem) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%', overflow: 'hidden', whiteSpace: 'nowrap' }}>
          <span style={{ flexShrink: 0, display: 'inline-flex' }}>
            <UserAvatar name={v ?? '?'} avatar={record.initiatorAvatar} semiSize="extra-extra-small" size={20} />
          </span>
          <Typography.Text ellipsis={{ showTooltip: true }} style={{ minWidth: 0, flex: 1 }}>{v ?? EMPTY_PLACEHOLDER}</Typography.Text>
        </div>
      ),
    },
    dateTimeColumn('提交时间', 'submittedAt'),
    dateTimeColumn('最后更新', 'updatedAt'),
    {
      title: '耗时',
      align: 'right',
      key: 'duration',
      width: 150,
      render: (_: unknown, record: WorkflowInstanceListItem) => {
        // 草稿尚未提交，从创建时间累计耗时没有意义
        if (record.status === 'draft') return <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>;
        if (!record.submittedAt) return EMPTY_PLACEHOLDER;
        const end = RUNNING_STATUSES.has(record.status) ? dayjs().format('YYYY-MM-DD HH:mm:ss') : record.completedAt;
        return <span style={{ color: 'var(--semi-color-text-1)', whiteSpace: 'nowrap' }}>{end ? formatSecondsBetween(record.submittedAt, end) : EMPTY_PLACEHOLDER}</span>;
      },
    },
    workflowInstanceStatusColumn<WorkflowInstanceListItem>(),
    createOperationColumn<WorkflowInstanceListItem>({
      width: 180,
      desktopInlineKeys: ['detail', 'diagnostics'],
      actions: (record) => {
        const canCancel = hasPermission('workflow:instance:cancel') && (record.status === 'running' || record.status === 'suspended');
        const canDelete = hasPermission('workflow:instance:delete') && !RUNNING_STATUSES.has(record.status);
        const canJump = canAdmin && record.status === 'running';
        const canOperate = hasPermission('workflow:engine:operate');
        return [
          { key: 'detail', label: '详情', onClick: () => openDetail(record) },
          { key: 'diagnostics', label: '诊断', onClick: () => openDiagnostics(record) },
          {
            key: 'jump',
            label: '强制跳转',
            hidden: !canJump,
            onClick: () => void openJump(record),
          },
          { key: 'reassign', label: '改派处理人', hidden: !hasPermission('workflow:instance:cancel') || !['running', 'suspended'].includes(record.status), onClick: () => void openReassign(record) },
          { key: 'migrate', label: '迁移版本', hidden: !hasPermission('workflow:engine:operate') || record.status !== 'running', onClick: () => void handleMigrate(record) },
          {
            key: 'suspend',
            label: '挂起',
            hidden: !canOperate || record.status !== 'running',
            onClick: () => handleSuspend(record),
          },
          {
            key: 'resume',
            label: '恢复',
            hidden: !canOperate || record.status !== 'suspended',
            onClick: () => handleResume(record),
          },
          {
            key: 'cancel',
            label: '取消',
            danger: true,
            hidden: !canCancel,
            onClick: () => handleCancel(record),
          },
          deleteAction({
            hidden: !canDelete,
            title: '删除流程',
            content: `确定要删除流程「${record.title}」吗？删除后该流程及其审批记录将被永久移除，此操作不可恢复。`,
            okText: '确定删除',
            run: () => deleteMutation.mutateAsync({ params: { id: record.id } }),
            successMessage: '流程已删除',
          }),
        ];
      },
    }),
  ];


  return (
    <div className="page-container page-tabs-page">
      <Suspense fallback={<Spin />}><Tabs lazyRender keepDOM={false} collapsible="auto" type="line" activeKey={activeTab} onChange={(k) => setActiveTab(k as typeof activeTab)}>
        <TabPane tab="实例监控" itemKey="list">
      <Typography.Text type="tertiary">统计范围：当前筛选（状态除外）</Typography.Text>
      <StatGrid minItemWidth={120} style={{ marginBottom: 16 }}>
        <StatCard title="全部" value={statValue(stats.total)} accent="var(--semi-color-text-0)" onClick={() => handleStatCardClick(undefined)} active={!draftParams.status} />
        <StatCard title="草稿" value={statValue(stats.draft ?? 0)} onClick={() => handleStatCardClick('draft')} active={draftParams.status === 'draft'} />
        <StatCard title="审批中" value={statValue(stats.running)} accent="var(--semi-color-primary)" onClick={() => handleStatCardClick('running')} active={draftParams.status === 'running'} />
        <StatCard title="已挂起" value={statValue(stats.suspended ?? 0)} accent="var(--semi-color-warning)" onClick={() => handleStatCardClick('suspended')} active={draftParams.status === 'suspended'} />
        <StatCard title="已退回" value={statValue(stats.returned ?? 0)} accent="var(--semi-color-warning)" onClick={() => handleStatCardClick('returned')} active={draftParams.status === 'returned'} />
        <StatCard title="已通过" value={statValue(stats.approved)} accent="#0dc87c" onClick={() => handleStatCardClick('approved')} active={draftParams.status === 'approved'} />
        <StatCard title="已驳回" value={statValue(stats.rejected)} accent="#ff4d4f" onClick={() => handleStatCardClick('rejected')} active={draftParams.status === 'rejected'} />
        <StatCard title="已撤回" value={statValue(stats.withdrawn ?? 0)} accent="var(--semi-color-warning)" onClick={() => handleStatCardClick('withdrawn')} active={draftParams.status === 'withdrawn'} />
        <StatCard title="已取消" value={statValue(stats.cancelled ?? 0)} accent="#8b5cf6" onClick={() => handleStatCardClick('cancelled')} active={draftParams.status === 'cancelled'} />
      </StatGrid>

      {/* 搜索栏 */}
      <SavedViewsBar
        pageKey="workflow-monitor"
        currentFilters={draftParams as unknown as Record<string, unknown>}
        onApply={(filters) => {
          const next = { ...defaultSearchParams, ...(filters as Partial<SearchParams>) };
          applySearch(next);
        }}
      />
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索申请标题 / 流程名称" {...bindKeyword('keyword')} width={240} />}
        filters={(
          <>
            {canReadDefinitions && <FilterSelect
              placeholder="全部所有分类"
              items={categories.map((c: WorkflowCategory) => ({ label: c.name, value: c.id }))}
              {...bind('categoryId')}
              width={140}
            />}
            {canReadDefinitions && <FilterSelect
              placeholder="全部所有流程"
              items={definitions.map((d) => ({ label: d.name, value: d.id }))}
              {...bind('definitionId')}
              width={160}
              filter
            />}
            <Input
              placeholder="申请人"
              showClear
              {...bind('initiator')}
              onEnterPress={handleSearch}
              style={{ width: 120 }}
            />
            <FilterSelect
              placeholder="全部所有状态"
              items={['draft', 'running', 'suspended', 'returned', 'approved', 'rejected', 'withdrawn', 'cancelled'].map((s) => ({ value: s, label: INSTANCE_STATUS_MAP[s].text }))}
              {...bind('status')}
              width={140}
            />
            <FilterSelect
              placeholder="全部所有优先级"
              items={WORKFLOW_PRIORITY_OPTIONS}
              {...bind('priority')}
              width={140}
            />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        actions={(
          <>
            <ExportButton entity="workflow.instances" query={filterQuery} formats={['xlsx']} />
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
            {hasPermission('workflow:task:handover') ? (
              <Button type="primary" icon={<UserRoundCog size={14} />} onClick={() => setHandoverVisible(true)}>离职交接</Button>
            ) : null}
          </>
        )}
        filterTitle="实例监控筛选"
      />

      <ConfigurableTable<WorkflowInstanceListItem>
        columns={columns}
        {...listTableProps(listQuery, {
          pagination: buildPagination,
          rowSelection: hasPermission('workflow:instance:print') ? rowSelection : undefined,
        })}
      />
        </TabPane>
        <TabPane tab="任务监控" itemKey="tasks">
          {activeTab === 'tasks' && <WorkflowTasksMonitorView onOpenInstance={(id) => { setDetailVisible(true); loadDetail(id); }} />}
        </TabPane>
        <TabPane tab="数据分析" itemKey="analytics">
          {activeTab === 'analytics' && <WorkflowAnalyticsView definitions={definitions} />}
        </TabPane>
        <TabPane tab="引擎诊断" itemKey="engine">
          {activeTab === 'engine' && <WorkflowEngineDiagnosticsView onOpenInstanceDiagnostics={openDiagnosticsById} />}
        </TabPane>
        <TabPane tab="作业账本" itemKey="jobs">
          {activeTab === 'jobs' && <WorkflowJobsView initialStatus={initialJobStatus} />}
        </TabPane>
        <TabPane tab="补偿工单" itemKey="compensations">
          {activeTab === 'compensations' && <WorkflowCompensationsView />}
        </TabPane>
      </Tabs></Suspense>

      {/* 详情弹窗 */}
      <SideSheet
        title="流程详情"
        visible={detailVisible}
        onCancel={() => { setDetailVisible(false); setDetailId(undefined); }}
        width={1080}
        bodyStyle={{ padding: 0, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {/* 占位符只在首次加载时出现，后台 refetch 不能卸载面板（否则 Tabs 页签与面板内状态会重置） */}
          {detailLoading && !detail ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          ) : (
            <WorkflowInstanceDetailPanel instance={detail} definition={detailDef} loading={detailLoading} onOpenInstance={loadDetail} />
          )}
        </div>
      </SideSheet>

      <SideSheet
        title="运行时诊断"
        visible={diagnosticsVisible}
        onCancel={() => { setDiagnosticsVisible(false); setDiagnosticsId(undefined); setDefSnapshotVisible(false); }}
        width={980}
        bodyStyle={{ padding: 16 }}
      >
        {diagnosticsQuery.isError ? <div role="alert">诊断读取失败。<Button onClick={() => void diagnosticsQuery.refetch()}>重试</Button></div> : diagnosticsLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : renderDiagnostics()}
      </SideSheet>

      <SideSheet
        title="流程定义（发起时快照 · 只读）"
        visible={defSnapshotVisible}
        onCancel={() => setDefSnapshotVisible(false)}
        width="82%"
        zIndex={1061}
        bodyStyle={{ padding: 0, height: '100%' }}
      >
        {defSnapshotVisible && (
          <Suspense fallback={<div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>}>
            <WorkflowDesignerPage embedded readOnly drawerZIndex={1100} presetDefinition={diagnostics?.instance.definitionSnapshot ?? null} />
          </Suspense>
        )}
      </SideSheet>

      {/* 管理员：强制跳转节点 */}
      <AppModal
        title="强制跳转节点"
        visible={!!jumpRecord}
        onCancel={() => setJumpRecord(null)}
        onOk={() => void submitJump()}
        okButtonProps={{ loading: jumpMutation.isPending, type: 'warning', theme: 'solid' }}
        okText="确认跳转"
        closeOnEsc
        width={460}
      >
        <Typography.Text type="tertiary" style={{ display: 'block', marginBottom: 12 }}>
          将终止「{jumpRecord?.title}」当前所有待办任务，直接推进到所选审批节点。此操作不可恢复。
        </Typography.Text>
        {jumpActiveTasks.length > 0 && (
          <div style={{ marginBottom: 12, padding: '8px 10px', background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-medium)' }}>
            <Typography.Text size="small" strong style={{ display: 'block', marginBottom: 4 }}>
              将终止 {jumpActiveTasks.length} 个活动任务：
            </Typography.Text>
            {jumpActiveTasks.map((t) => (
              <Typography.Text key={t.id} size="small" type="tertiary" style={{ display: 'block' }}>
                #{t.id} {t.nodeName || t.nodeKey} · {t.assigneeName ?? '未指定'}（{t.status === 'pending' ? '待处理' : '等待中'}）
              </Typography.Text>
            ))}
          </div>
        )}
        <Form getFormApi={(api) => { jumpFormApi.current = api; }} labelPosition="left" labelWidth={90}>
          <Form.Select field="targetNodeKey" label="目标节点" placeholder="请选择要跳转到的审批节点" optionList={jumpNodes} rules={[{ required: true, message: '请选择目标节点' }]} style={{ width: '100%' }} />
          <Form.TextArea field="comment" label="跳转原因" placeholder="必填，记录到审计与任务备注" rows={2} rules={[{ required: true, message: '请填写跳转原因' }, { validator: (_, v: string) => (v ?? '').trim().length >= 2, message: '原因至少 2 个字符' }]} />
        </Form>
      </AppModal>

      {/* 管理员：改派处理人 */}
      <AppModal
        title="改派处理人"
        visible={!!reassignRecord}
        onCancel={() => setReassignRecord(null)}
        onOk={() => void submitReassign()}
        okButtonProps={{ loading: reassignMutation.isPending, type: 'primary' }}
        okText="确认改派"
        closeOnEsc
        width={460}
      >
        <Form getFormApi={(api) => { reassignFormApi.current = api; }} labelPosition="left" labelWidth={90}>
          <Form.Select field="taskId" label="待办任务" placeholder="请选择要改派的待办" optionList={reassignTasks} rules={[{ required: true, message: '请选择待办任务' }]} style={{ width: '100%' }} />
          <Form.Select field="targetUserId" label="新处理人" placeholder="请选择新的处理人" filter optionList={userOptions} rules={[{ required: true, message: '请选择新处理人' }]} style={{ width: '100%' }} />
          <Form.TextArea field="comment" label="说明" placeholder="可选" rows={2} />
        </Form>
      </AppModal>

      {/* 管理员：离职交接 */}
      <WorkflowHandoverModal visible={handoverVisible} onClose={() => setHandoverVisible(false)} />
    </div>
  );
}
