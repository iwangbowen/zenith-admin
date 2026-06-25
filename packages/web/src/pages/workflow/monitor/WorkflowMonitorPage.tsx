import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Card,
  Dropdown,
  Form,
  Input,
  JsonViewer,
  Modal,
  Select,
  SideSheet,
  Space,
  Spin,
  Tabs,
  TabPane,
  Tag,
  Timeline,
  Toast,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Download, FileText, MoreHorizontal, RotateCcw, Search } from 'lucide-react';
import dayjs from 'dayjs';
import type { WorkflowApproveMethod, WorkflowAssigneeType, WorkflowCategory, WorkflowDefinition, WorkflowFlowData, WorkflowInstance, WorkflowNodeConfig, WorkflowRuntimeDiagnostics, WorkflowRuntimeIssue, WorkflowRuntimeOutboxEvent, WorkflowTask, WorkflowTriggerExecution } from '@zenith/shared';
import { request } from '@/utils/request';
import { UserAvatar } from '@/components/UserAvatar';
import { formatDateTime } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';
import SavedViewsBar from '@/components/workflow/SavedViewsBar';
import WorkflowPriorityTag, { WORKFLOW_PRIORITY_OPTIONS } from '@/components/workflow/WorkflowPriorityTag';
import ConfigurableTable from '@/components/ConfigurableTable';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import WorkflowInstanceDetailPanel from '@/components/workflow/WorkflowInstanceDetailPanel';
import WorkflowGraphView from '@/components/workflow/WorkflowGraphView';
import { NODE_RT_STATUS_COLOR, NODE_RT_STATUS_LABEL } from '@/components/workflow/workflow-runtime';
import { resolveWorkflowFlowData } from '@/utils/workflow-snapshot';
import WorkflowAnalyticsView from './WorkflowAnalyticsView';
import { useWorkflowCategories } from '@/hooks/useWorkflowCategories';
import { renderEllipsis } from '../../../utils/table-columns';

/** 只读流程设计器（懒加载）：用于在诊断 SideSheet 内查看发起时的流程定义快照 */
const WorkflowDesignerPage = lazy(() => import('@/pages/workflow/designer/WorkflowDesignerPage'));

type TagColor = 'amber' | 'blue' | 'cyan' | 'green' | 'grey' | 'indigo' | 'light-blue' | 'light-green' | 'lime' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'violet' | 'yellow' | 'white';

const INSTANCE_STATUS_MAP: Record<string, { text: string; color: TagColor }> = {
  draft:     { text: '草稿',  color: 'grey'   },
  running:   { text: '审批中', color: 'blue'   },
  approved:  { text: '已通过', color: 'green'  },
  rejected:  { text: '已驳回', color: 'red'    },
  withdrawn: { text: '已撤回', color: 'orange' },
  cancelled: { text: '已取消', color: 'purple' },
};

const RUNNING_STATUSES = new Set(['draft', 'running']);

const ISSUE_SEVERITY_MAP: Record<WorkflowRuntimeIssue['severity'], { text: string; color: TagColor }> = {
  info: { text: '信息', color: 'blue' },
  warning: { text: '警告', color: 'orange' },
  critical: { text: '严重', color: 'red' },
};

const ISSUE_SOURCE_MAP: Record<WorkflowRuntimeIssue['source'], string> = {
  instance: '实例',
  task: '任务',
  trigger: '触发器',
  outbox: 'Outbox',
};

/** 节点类型 → 中文标签（含网关 / 抄送 / 触发器等结构节点） */
const NODE_TYPE_LABEL: Record<string, string> = {
  start: '发起',
  approve: '审批',
  handler: '办理',
  end: '结束',
  exclusiveGateway: '条件分支',
  parallelGateway: '并行分支',
  inclusiveGateway: '包容分支',
  routeGateway: '路由分支',
  ccNode: '抄送',
  delay: '延时',
  trigger: '触发器',
  subProcess: '子流程',
  catchNode: '捕获',
};

/** 审批人来源类型 → 中文标签 */
const ASSIGNEE_TYPE_LABEL: Partial<Record<WorkflowAssigneeType, string>> = {
  user: '指定成员',
  role: '指定角色',
  department: '部门负责人',
  userGroup: '用户组',
  post: '指定岗位',
  deptMember: '部门成员',
  initiator: '发起人本人',
  initiatorLeader: '发起人上级',
  initiatorDept: '发起人部门主管',
  startUserDeptResponsible: '部门分管领导',
  manager: '直属主管',
  multiLevelManager: '连续多级上级',
  multiLevelDeptHead: '连续多级部门负责人',
  formUser: '表单联系人',
  formDepartment: '表单部门',
  nodeApprover: '关联节点审批人',
  initiatorSelect: '发起人自选',
  initiatorSelectScope: '发起人自选(范围)',
  approverSelect: '上节点审批人自选',
  expression: '流程表达式',
};

/** 审批方式 → 中文标签 */
const APPROVE_METHOD_LABEL: Partial<Record<WorkflowApproveMethod, string>> = {
  and: '会签',
  or: '或签',
  sequential: '顺序会签',
  ratio: '比例会签',
  random: '随机',
  auto: '自动通过',
};

/** 节点运行态（由关联任务派生） */
type DiagNodeState = 'done' | 'active' | 'rejected' | 'idle';

const NODE_STATE_MAP: Record<DiagNodeState, { text: string; color: TagColor }> = {
  done: { text: '已完成', color: 'green' },
  active: { text: '进行中', color: 'blue' },
  rejected: { text: '已驳回', color: 'red' },
  idle: { text: '无任务', color: 'grey' },
};

/** 节点状态 → Semi Timeline 节点类型（进行中用 ongoing 呈现脉冲态） */
const NODE_STATE_TIMELINE_TYPE: Record<DiagNodeState, 'success' | 'ongoing' | 'error' | 'default'> = {
  done: 'success',
  active: 'ongoing',
  rejected: 'error',
  idle: 'default',
};

/** 整合后的诊断节点：流程定义节点 + 关联运行时任务 + 派生状态 */
interface DiagNode {
  key: string;
  name: string;
  type: string;
  config: WorkflowNodeConfig;
  tasks: WorkflowTask[];
  state: DiagNodeState;
  isCurrent: boolean;
}

/** 提取节点配置中已静态指定的处理人名称（运行态解析的来源不在此列） */
function getConfiguredAssigneeNames(cfg: WorkflowNodeConfig): string[] {
  const names = [
    ...(cfg.assigneeNames ?? []),
    ...(cfg.assigneeName ? [cfg.assigneeName] : []),
    ...(cfg.postNames ?? []),
    ...(cfg.deptMemberDeptNames ?? []),
  ].filter((name): name is string => !!name);
  return [...new Set(names)];
}

/** 节点配置摘要项（处理人来源 / 审批方式 / 指定处理人 / 触发类型 / 子流程等），供节点列表与定义快照复用 */
function getNodeConfigItems(cfg: WorkflowNodeConfig): Array<{ label: string; value: string }> {
  const items: Array<{ label: string; value: string }> = [];
  if (cfg.assigneeType && ASSIGNEE_TYPE_LABEL[cfg.assigneeType]) {
    items.push({ label: '处理人来源', value: ASSIGNEE_TYPE_LABEL[cfg.assigneeType] as string });
  }
  if (cfg.approveMethod && APPROVE_METHOD_LABEL[cfg.approveMethod]) {
    const ratio = cfg.approveMethod === 'ratio' && cfg.approveRatio ? ` ${cfg.approveRatio}%` : '';
    items.push({ label: '审批方式', value: `${APPROVE_METHOD_LABEL[cfg.approveMethod]}${ratio}` });
  }
  const names = getConfiguredAssigneeNames(cfg);
  if (names.length > 0) items.push({ label: '指定处理人', value: names.join('、') });
  if (cfg.type === 'trigger' && cfg.triggerConfig?.triggerType) {
    items.push({ label: '触发类型', value: String(cfg.triggerConfig.triggerType) });
  }
  if (cfg.type === 'subProcess' && cfg.subProcessName) {
    items.push({ label: '子流程', value: cfg.subProcessName });
  }
  return items;
}

/**
 * 整合流程定义节点（flat flowData.nodes）与运行时任务（按 nodeKey 关联）。
 * 排序：发起节点置顶、结束节点置底，其余保持定义顺序；并派生每个节点的运行态。
 */
function buildDiagNodes(
  flowData: WorkflowFlowData | null,
  tasks: WorkflowTask[],
  currentNodeKeys: string[],
): DiagNode[] {
  const flatNodes = flowData?.nodes ?? [];
  if (flatNodes.length === 0) return [];
  const tasksByNode = new Map<string, WorkflowTask[]>();
  for (const task of tasks) {
    const arr = tasksByNode.get(task.nodeKey) ?? [];
    arr.push(task);
    tasksByNode.set(task.nodeKey, arr);
  }
  const currentSet = new Set(currentNodeKeys);
  const rank = (type: string) => (type === 'start' ? 0 : type === 'end' ? 2 : 1);
  const ordered = [...flatNodes].sort((a, b) => rank(a.data.type) - rank(b.data.type));
  return ordered.map((node) => {
    const cfg = node.data;
    const nodeTasks = (tasksByNode.get(cfg.key) ?? []).slice().sort((a, b) => a.id - b.id);
    let state: DiagNodeState;
    if (nodeTasks.some((t) => t.status === 'rejected')) state = 'rejected';
    else if (nodeTasks.some((t) => t.status === 'pending' || t.status === 'waiting')) state = 'active';
    else if (nodeTasks.some((t) => t.status === 'approved' || t.status === 'skipped')) state = 'done';
    else state = 'idle';
    return {
      key: cfg.key,
      name: cfg.label || cfg.key,
      type: cfg.type,
      config: cfg,
      tasks: nodeTasks,
      state,
      isCurrent: currentSet.has(cfg.key),
    };
  });
}

/** 计算流程耗时：运行中算到当前，已结束算到最后更新时间 */
function formatDuration(start: string, end: string): string {
  let sec = Math.max(0, dayjs(end).diff(dayjs(start), 'second'));
  const d = Math.floor(sec / 86400); sec -= d * 86400;
  const h = Math.floor(sec / 3600); sec -= h * 3600;
  const m = Math.floor(sec / 60); sec -= m * 60;
  if (d > 0) return `${d}天${h}小时`;
  if (h > 0) return `${h}小时${m}分`;
  if (m > 0) return `${m}分${sec}秒`;
  return `${sec}秒`;
}

interface MonitorStats {
  total: number;
  running: number;
  approved: number;
  rejected: number;
  withdrawn: number;
  cancelled: number;
}

interface MonitorResponse {
  stats: MonitorStats;
  list: WorkflowInstance[];
  total: number;
  page: number;
  pageSize: number;
}

/** 状态统计卡片 */
function StatCard({
  label,
  value,
  color,
  onClick,
  active,
}: Readonly<{
  label: string;
  value: number;
  color: string;
  onClick: () => void;
  active: boolean;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        cursor: 'pointer',
        flex: 1,
        minWidth: 120,
        border: 'none',
        background: 'none',
        padding: 0,
        textAlign: 'left',
      }}
    >
      <Card
        style={{
          border: active ? `2px solid ${color}` : '2px solid transparent',
          transition: 'border-color 0.2s',
        }}
        bodyStyle={{ padding: '16px 20px' }}
      >
        <Typography.Text type="tertiary" size="small">{label}</Typography.Text>
        <div style={{ fontSize: 28, fontWeight: 700, color, marginTop: 4, lineHeight: 1 }}>{value}</div>
      </Card>
    </button>
  );
}

export default function WorkflowMonitorPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<MonitorResponse | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  interface SearchParams { keyword: string; initiator: string; status: string; categoryId: number | ''; priority: string }
  const defaultSearchParams: SearchParams = { keyword: '', initiator: '', status: '', categoryId: '', priority: '' };
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;

  const { categories } = useWorkflowCategories();
  const { hasPermission } = usePermission();
  const [detail, setDetail] = useState<WorkflowInstance | null>(null);
  const [detailDef, setDetailDef] = useState<WorkflowDefinition | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 详情弹窗
  const [detailVisible, setDetailVisible] = useState(false);
  const [diagnosticsVisible, setDiagnosticsVisible] = useState(false);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnostics, setDiagnostics] = useState<WorkflowRuntimeDiagnostics | null>(null);
  const [diagnosticsTab, setDiagnosticsTab] = useState('nodes');
  const [defSnapshotVisible, setDefSnapshotVisible] = useState(false);

  // 流程定义（用于数据分析筛选 + 强制跳转节点选择）
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  // 管理员：强制跳转
  const [jumpRecord, setJumpRecord] = useState<WorkflowInstance | null>(null);
  const [jumpNodes, setJumpNodes] = useState<Array<{ label: string; value: string }>>([]);
  const [jumpSubmitting, setJumpSubmitting] = useState(false);
  const jumpFormApi = useRef<FormApi | null>(null);
  // 管理员：改派处理人
  const [reassignRecord, setReassignRecord] = useState<WorkflowInstance | null>(null);
  const [reassignTasks, setReassignTasks] = useState<Array<{ label: string; value: number }>>([]);
  const [reassignSubmitting, setReassignSubmitting] = useState(false);
  const [userOptions, setUserOptions] = useState<Array<{ label: string; value: number }>>([]);
  const reassignFormApi = useRef<FormApi | null>(null);

  const canAdmin = hasPermission('workflow:instance:cancel');

  const fetchList = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const { keyword: kw, status: st, categoryId: cat, initiator: initKw, priority: pr } = params ?? searchParamsRef.current;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(p), pageSize: String(ps) });
      if (kw) qs.set('keyword', kw);
      if (st) qs.set('status', st);
      if (cat !== '') qs.set('categoryId', String(cat));
      if (initKw) qs.set('initiatorKeyword', initKw);
      if (pr) qs.set('priority', pr);
      const res = await request.get<MonitorResponse>(`/api/workflows/instances/all?${qs.toString()}`);
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
    request.get<WorkflowDefinition[]>('/api/workflows/definitions/published')
      .then((res) => { if (res.code === 0 && res.data) setDefinitions(res.data); });
  }, [fetchList]);

  const handleSearch = () => {
    setPage(1);
    void fetchList(1, pageSize);
  };

  const handleReset = () => {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchList(1, pageSize, defaultSearchParams);
  };

  const handleStatCardClick = (st: string) => {
    const next = searchParams.status === st ? '' : st;
    const newParams = { ...searchParams, status: next };
    setSearchParams(newParams);
    setPage(1);
    void fetchList(1, pageSize, newParams);
  };

  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    const { keyword, status, categoryId, initiator } = searchParamsRef.current;
    const qs = new URLSearchParams();
    if (keyword) qs.set('keyword', keyword);
    if (status) qs.set('status', status);
    if (categoryId !== '') qs.set('categoryId', String(categoryId));
    if (initiator) qs.set('initiatorKeyword', initiator);
    setExporting(true);
    try {
      await request.download(`/api/workflows/instances/export?${qs.toString()}`, '流程实例.xlsx');
    } finally {
      setExporting(false);
    }
  };

  const loadDetail = (instanceId: number) => {
    setDetailLoading(true);
    setDetailDef(null);
    const p = request.get<WorkflowInstance>(`/api/workflows/instances/${instanceId}`)
      .then(res => {
        if (res.code === 0) {
          setDetail(res.data);
          if (res.data.definitionSnapshot) return null;
          return request.get<WorkflowDefinition>(`/api/workflows/definitions/${res.data.definitionId}`, { silent: true });
        }
        return null;
      })
      .then(defRes => { if (defRes?.code === 0) setDetailDef(defRes.data); })
      .finally(() => setDetailLoading(false));
    p.catch(() => undefined);
  };

  const openDetail = (item: WorkflowInstance) => {
    setDetailVisible(true);
    loadDetail(item.id);
  };

  const openDiagnostics = (item: WorkflowInstance) => {
    setDiagnosticsVisible(true);
    setDiagnostics(null);
    setDiagnosticsTab('nodes');
    setDiagnosticsLoading(true);
    request.get<WorkflowRuntimeDiagnostics>(`/api/workflows/instances/${item.id}/diagnostics`)
      .then((res) => {
        if (res.code === 0) setDiagnostics(res.data);
        else Toast.error(res.message || '加载诊断信息失败');
      })
      .finally(() => setDiagnosticsLoading(false));
  };

  const handleCancel = (record: WorkflowInstance) => {
    Modal.confirm({
      title: '取消流程',
      content: `确定要强制取消流程「${record.title}」吗？取消后流程将立即终止，待办任务会被跳过，此操作不可恢复。`,
      okText: '确定取消',
      okButtonProps: { type: 'warning', theme: 'solid' },
      cancelText: '关闭',
      onOk: async () => {
        const res = await request.post(`/api/workflows/instances/${record.id}/cancel`);
        if (res.code === 0) {
          Toast.success('流程已取消');
          void fetchList();
        }
      },
    });
  };

  const handleDelete = (record: WorkflowInstance) => {
    Modal.confirm({
      title: '删除流程',
      content: `确定要删除流程「${record.title}」吗？删除后该流程及其审批记录将被永久移除，此操作不可恢复。`,
      okText: '确定删除',
      okButtonProps: { type: 'danger', theme: 'solid' },
      cancelText: '取消',
      onOk: async () => {
        const res = await request.delete(`/api/workflows/instances/${record.id}`);
        if (res.code === 0) {
          Toast.success('流程已删除');
          void fetchList();
        }
      },
    });
  };

  const stats = data?.stats ?? { total: 0, running: 0, approved: 0, rejected: 0, withdrawn: 0, cancelled: 0 };

  const loadUserOptions = useCallback(async () => {
    if (userOptions.length > 0) return;
    const res = await request.get<Array<{ id: number; nickname: string; username: string }>>('/api/users/all');
    if (res.code === 0) setUserOptions(res.data.map((u) => ({ label: u.nickname ?? u.username, value: u.id })));
  }, [userOptions.length]);

  const openJump = async (record: WorkflowInstance) => {
    setJumpRecord(record);
    setJumpNodes([]);
    const res = await request.get<WorkflowDefinition>(`/api/workflows/definitions/${record.definitionId}`);
    if (res.code === 0) {
      const nodes = (res.data.flowData?.nodes ?? [])
        .filter((n) => n.data.type === 'approve' || n.data.type === 'handler')
        .map((n) => ({ label: n.data.label ?? n.data.key, value: n.data.key }));
      setJumpNodes(nodes);
    }
  };

  const submitJump = async () => {
    if (!jumpRecord) return;
    try {
      const values = await jumpFormApi.current?.validate() as { targetNodeKey: string; comment?: string };
      setJumpSubmitting(true);
      const res = await request.post(`/api/workflows/instances/${jumpRecord.id}/jump`, values);
      if (res.code === 0) {
        Toast.success('已强制跳转');
        setJumpRecord(null);
        void fetchList();
      } else {
        Toast.error(res.message || '跳转失败');
      }
    } catch { /* validation */ } finally {
      setJumpSubmitting(false);
    }
  };

  const openReassign = async (record: WorkflowInstance) => {
    setReassignRecord(record);
    setReassignTasks([]);
    void loadUserOptions();
    const res = await request.get<WorkflowInstance>(`/api/workflows/instances/${record.id}`);
    if (res.code === 0) {
      const tasks = (res.data.tasks ?? [])
        .filter((t: WorkflowTask) => t.status === 'pending')
        .map((t: WorkflowTask) => ({ label: `${t.nodeName} · ${t.assigneeName ?? '未指派'}`, value: t.id }));
      setReassignTasks(tasks);
    }
  };

  const submitReassign = async () => {
    if (!reassignRecord) return;
    try {
      const values = await reassignFormApi.current?.validate() as { taskId: number; targetUserId: number; comment?: string };
      setReassignSubmitting(true);
      const res = await request.post(`/api/workflows/tasks/${values.taskId}/reassign`, { targetUserId: values.targetUserId, comment: values.comment });
      if (res.code === 0) {
        Toast.success('已改派');
        setReassignRecord(null);
        void fetchList();
      } else {
        Toast.error(res.message || '改派失败');
      }
    } catch { /* validation */ } finally {
      setReassignSubmitting(false);
    }
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
      { title: 'ID', dataIndex: 'id', width: 70 },
      { title: '节点', dataIndex: 'nodeName', width: 160, render: (_: unknown, row) => row.nodeName || row.nodeKey },
      { title: '类型', dataIndex: 'nodeType', width: 100, render: (v: string | null) => v ?? '—' },
      { title: '状态', dataIndex: 'status', width: 100 },
      { title: '处理人', dataIndex: 'assigneeName', width: 120, render: (v: string | null) => v ?? '—' },
      { title: '外部分派', dataIndex: 'externalDispatchStatus', width: 120, render: (v: string | null) => v ?? '—' },
      { title: '触发器状态', dataIndex: 'triggerDispatchStatus', width: 130, render: (v: string | null) => v ?? '—' },
      { title: '尝试', dataIndex: 'triggerAttempt', width: 70, render: (v: number | undefined) => v ?? '—' },
      { title: '错误', dataIndex: 'triggerLastError', width: 220, ellipsis: { showTitle: true }, render: (v: string | null) => v ?? '—' },
      { title: '创建时间', dataIndex: 'createdAt', width: 170 },
    ];
    const triggerColumns: ColumnProps<WorkflowTriggerExecution>[] = [
      { title: 'ID', dataIndex: 'id', width: 70 },
      { title: '任务', dataIndex: 'taskId', width: 80, render: (v: number | null) => v ? `#${v}` : '—' },
      { title: '节点', dataIndex: 'nodeName', width: 140, render: (_: unknown, row) => row.nodeName || row.nodeKey },
      { title: '类型', dataIndex: 'triggerType', width: 110 },
      { title: '状态', dataIndex: 'status', width: 100 },
      { title: '尝试', dataIndex: 'attempt', width: 70 },
      { title: 'HTTP', dataIndex: 'responseStatus', width: 80, render: (v: number | null) => v ?? '—' },
      { title: '耗时', dataIndex: 'durationMs', width: 90, render: (v: number | null) => v != null ? `${v}ms` : '—' },
      { title: '错误', dataIndex: 'errorMessage', width: 220, ellipsis: { showTitle: true }, render: (v: string | null) => v ?? '—' },
      { title: '创建时间', dataIndex: 'createdAt', width: 170 },
    ];
    const outboxColumns: ColumnProps<WorkflowRuntimeOutboxEvent>[] = [
      { title: 'ID', dataIndex: 'id', width: 70 },
      { title: '事件', dataIndex: 'eventType', width: 170 },
      { title: '任务', dataIndex: 'taskId', width: 80, render: (v: number | null) => v ? `#${v}` : '—' },
      { title: '状态', dataIndex: 'status', width: 90 },
      { title: '尝试', dataIndex: 'attempts', width: 70 },
      { title: '下次重试', dataIndex: 'nextRetryAt', width: 170, render: (v: string | null) => v ?? '—' },
      { title: '错误', dataIndex: 'errorMessage', width: 260, ellipsis: { showTitle: true }, render: (v: string | null) => v ?? '—' },
      { title: '创建时间', dataIndex: 'createdAt', width: 170 },
    ];

    const inst = diagnostics.instance;
    const flowData = resolveWorkflowFlowData(inst, null);
    const diagNodes = buildDiagNodes(flowData, diagnostics.tasks, inst.currentNodeKeys ?? []);
    const nodeNameByKey = new Map(diagNodes.map((n) => [n.key, n.name]));
    const statusMeta = INSTANCE_STATUS_MAP[inst.status] ?? { text: inst.status, color: 'grey' as TagColor };
    const currentNodeText = inst.currentNodeNames && inst.currentNodeNames.length > 0
      ? inst.currentNodeNames.join('、')
      : (inst.currentNodeName || '—');

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

    const renderNodeTaskRow = (task: WorkflowTask) => (
      <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderTop: '1px solid var(--semi-color-fill-1)', flexWrap: 'wrap' }}>
        <Typography.Text type="tertiary" size="small" style={{ width: 40 }}>#{task.id}</Typography.Text>
        <Tag size="small" color={NODE_RT_STATUS_COLOR[task.status]}>{NODE_RT_STATUS_LABEL[task.status]}</Tag>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 110 }}>
          <UserAvatar name={task.assigneeName || '未指定'} avatar={task.assigneeAvatar} size={20} />
          <Typography.Text size="small">{task.assigneeName || '未指定'}</Typography.Text>
        </span>
        <Typography.Text type="tertiary" size="small">{task.actionAt || task.createdAt}</Typography.Text>
        {task.comment && (
          <Typography.Text size="small" ellipsis={{ showTooltip: true }} style={{ maxWidth: 220 }}>
            “{task.comment}”
          </Typography.Text>
        )}
        {task.externalDispatchStatus && <Tag size="small" color="grey">外部 {task.externalDispatchStatus}</Tag>}
        {task.triggerDispatchStatus && <Tag size="small" color="grey">触发 {task.triggerDispatchStatus}</Tag>}
      </div>
    );

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
            const lastTask = node.tasks[node.tasks.length - 1];
            const nodeTime = lastTask ? (lastTask.actionAt || lastTask.createdAt) : undefined;
            return (
              <Timeline.Item key={node.key} type={NODE_STATE_TIMELINE_TYPE[node.state]} time={nodeTime}>
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
                    <div style={{ border: '1px solid var(--semi-color-fill-1)', borderTop: 'none', borderRadius: 6 }}>
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
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <div><Typography.Text type="tertiary" size="small">流程名称</Typography.Text><div>{inst.definitionName || '—'}</div></div>
            <div><Typography.Text type="tertiary" size="small">状态</Typography.Text><div><Tag color={statusMeta.color}>{statusMeta.text}</Tag></div></div>
            <div><Typography.Text type="tertiary" size="small">当前节点</Typography.Text><div>{currentNodeText}</div></div>
            <div>
              <Typography.Text type="tertiary" size="small">发起人</Typography.Text>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {inst.initiatorName ? <UserAvatar name={inst.initiatorName} avatar={inst.initiatorAvatar} size={20} /> : null}
                <span>{inst.initiatorName || '—'}</span>
              </div>
            </div>
            <div><Typography.Text type="tertiary" size="small">实例 ID</Typography.Text><div>#{inst.id}</div></div>
            <div><Typography.Text type="tertiary" size="small">定义 ID</Typography.Text><div>#{inst.definitionId}</div></div>
            <div><Typography.Text type="tertiary" size="small">Business Key</Typography.Text><div>{inst.bizType && inst.bizId ? `${inst.bizType}:${inst.bizId}` : '—'}</div></div>
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

        <div>
          <Typography.Title heading={6}>诊断结论</Typography.Title>
          <Space vertical align="start" spacing={8} style={{ width: '100%' }}>
            {diagnostics.issues.map((issue, index) => {
              const meta = ISSUE_SEVERITY_MAP[issue.severity];
              return (
                <div key={`${issue.source}-${issue.title}-${index}`} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--semi-color-border)', borderRadius: 6 }}>
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

        <Tabs type="line" activeKey={diagnosticsTab} onChange={setDiagnosticsTab}>
          <TabPane tab={`节点 ${diagNodes.length}`} itemKey="nodes">
            <div style={{ marginBottom: 10 }}>
              <Typography.Text type="tertiary" size="small">
                节点来自发起时的流程定义快照，已与运行时任务按节点关联；一个节点可对应 0 到多个任务。
              </Typography.Text>
            </div>
            {renderNodes()}
          </TabPane>
          <TabPane tab={`任务 ${diagnostics.tasks.length}`} itemKey="tasks">
            <ConfigurableTable bordered columns={taskColumns} dataSource={diagnostics.tasks} rowKey="id" pagination={false} scroll={{ x: 1270 }} />
          </TabPane>
          <TabPane tab={`触发器 ${diagnostics.triggerExecutions.length}`} itemKey="triggers">
            <ConfigurableTable bordered columns={triggerColumns} dataSource={diagnostics.triggerExecutions} rowKey="id" pagination={false} scroll={{ x: 1220 }} />
          </TabPane>
          <TabPane tab={`Outbox ${diagnostics.outboxEvents.length}`} itemKey="outbox">
            <ConfigurableTable bordered columns={outboxColumns} dataSource={diagnostics.outboxEvents} rowKey="id" pagination={false} scroll={{ x: 1080 }} />
          </TabPane>
          <TabPane tab="流程图" itemKey="graph">
            <div style={{ marginBottom: 10 }}>
              <Typography.Text type="tertiary" size="small">
                基于发起时的流程定义快照，叠加运行时任务状态（驳回回退轨迹会高亮提示）。
              </Typography.Text>
            </div>
            <WorkflowGraphView flowData={flowData} tasks={diagnostics.tasks} instanceStatus={inst.status} />
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

  const columns: ColumnProps<WorkflowInstance>[] = [
    {
      title: '申请标题',
      dataIndex: 'title',
      width: 220,
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
      title: '分类',
      dataIndex: 'categoryName',
      width: 110,
      render: (v: string | null) => v
        ? <Tag size="small" color="blue">{v}</Tag>
        : <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>,
    },
    {
      title: '当前节点',
      dataIndex: 'currentNodeName',
      width: 180,
      render: (v: string | null | undefined, record: WorkflowInstance) => {
        const names = (record.currentNodeNames && record.currentNodeNames.length > 0)
          ? record.currentNodeNames
          : (v ? [v] : []);
        return names.length > 0
          ? <Space spacing={4} wrap>{names.map((name) => <Tag key={name} size="small" color="cyan">{name}</Tag>)}</Space>
          : <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>;
      },
    },
    {
      title: '申请人',
      dataIndex: 'initiatorName',
      width: 120,
      render: (v: string | null, record: WorkflowInstance) => (
        <Space spacing={6}>
          <UserAvatar name={v ?? '?'} avatar={record.initiatorAvatar} semiSize="extra-extra-small" size={20} />
          <span>{v ?? '—'}</span>
        </Space>
      ),
    },
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '最后更新',
      dataIndex: 'updatedAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '耗时',
      key: 'duration',
      width: 120,
      render: (_: unknown, record: WorkflowInstance) => {
        const end = RUNNING_STATUSES.has(record.status) ? dayjs().format('YYYY-MM-DD HH:mm:ss') : record.updatedAt;
        return <span style={{ color: 'var(--semi-color-text-1)' }}>{formatDuration(record.createdAt, end)}</span>;
      },
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
      width: 160,
      fixed: 'right',
      render: (_: unknown, record: WorkflowInstance) => {
        const canCancel = hasPermission('workflow:instance:cancel') && record.status === 'running';
        const canDelete = hasPermission('workflow:instance:delete') && !RUNNING_STATUSES.has(record.status);
        const canJump = canAdmin && record.status === 'running';
        return (
          <Space>
            <Button theme="borderless" size="small" onClick={() => openDetail(record)}>详情</Button>
            <Button theme="borderless" size="small" onClick={() => openDiagnostics(record)}>诊断</Button>
            {(canCancel || canDelete || canJump) && (
              <Dropdown
                trigger="click"
                position="bottomRight"
                render={(
                  <Dropdown.Menu>
                    {canJump && <Dropdown.Item onClick={() => void openJump(record)}>强制跳转</Dropdown.Item>}
                    {canJump && <Dropdown.Item onClick={() => void openReassign(record)}>改派处理人</Dropdown.Item>}
                    {canCancel && <Dropdown.Item type="warning" onClick={() => handleCancel(record)}>取消</Dropdown.Item>}
                    {canDelete && <Dropdown.Item type="danger" onClick={() => handleDelete(record)}>删除</Dropdown.Item>}
                  </Dropdown.Menu>
                )}
              >
                <Button theme="borderless" size="small" icon={<MoreHorizontal size={14} />} />
              </Dropdown>
            )}
          </Space>
        );
      },
    },
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索申请标题 / 流程名称"
      showClear
      value={searchParams.keyword}
      onChange={v => setSearchParams(prev => ({ ...prev, keyword: v }))}
      onEnterPress={handleSearch}
      style={{ width: 240 }}
    />
  );

  const renderCategoryFilter = () => (
    <Select
      placeholder="所有分类"
      showClear
      value={searchParams.categoryId === '' ? undefined : searchParams.categoryId}
      onChange={v => setSearchParams(prev => ({ ...prev, categoryId: (v as number) ?? '' }))}
      style={{ width: 140 }}
      optionList={categories.map((c: WorkflowCategory) => ({ label: c.name, value: c.id }))}
    />
  );

  const renderInitiatorFilter = () => (
    <Input
      placeholder="申请人"
      showClear
      value={searchParams.initiator}
      onChange={v => setSearchParams(prev => ({ ...prev, initiator: v }))}
      onEnterPress={handleSearch}
      style={{ width: 120 }}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="所有状态"
      showClear
      value={searchParams.status || undefined}
      onChange={v => setSearchParams(prev => ({ ...prev, status: (v as string) ?? '' }))}
      style={{ width: 140 }}
      optionList={[
        { label: '审批中', value: 'running' },
        { label: '已通过', value: 'approved' },
        { label: '已驳回', value: 'rejected' },
        { label: '已撤回', value: 'withdrawn' },
        { label: '已取消', value: 'cancelled' },
      ]}
    />
  );

  const renderPriorityFilter = () => (
    <Select
      placeholder="所有优先级"
      showClear
      value={searchParams.priority || undefined}
      onChange={v => setSearchParams(prev => ({ ...prev, priority: (v as string) ?? '' }))}
      style={{ width: 130 }}
      optionList={WORKFLOW_PRIORITY_OPTIONS}
    />
  );

  const renderSearchButton = () => (
    <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
  );

  const renderResetButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
  );

  const renderExportButton = () => (
    <Button type="primary" icon={<Download size={14} />} loading={exporting} onClick={() => void handleExport()}>导出</Button>
  );

  return (
    <div className="page-container">
      <Tabs type="line">
        <TabPane tab="实例监控" itemKey="list">
      {/* 统计卡片 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard label="全部" value={stats.total}     color="var(--semi-color-text-0)" onClick={() => handleStatCardClick('')}          active={searchParams.status === ''} />
        <StatCard label="审批中" value={stats.running}  color="var(--semi-color-primary)"        onClick={() => handleStatCardClick('running')}   active={searchParams.status === 'running'} />
        <StatCard label="已通过" value={stats.approved} color="#0dc87c"                          onClick={() => handleStatCardClick('approved')}  active={searchParams.status === 'approved'} />
        <StatCard label="已驳回" value={stats.rejected} color="#ff4d4f"                          onClick={() => handleStatCardClick('rejected')}  active={searchParams.status === 'rejected'} />
        <StatCard label="已撤回" value={stats.withdrawn ?? 0} color="var(--semi-color-warning)"  onClick={() => handleStatCardClick('withdrawn')} active={searchParams.status === 'withdrawn'} />
        <StatCard label="已取消" value={stats.cancelled ?? 0} color="#8b5cf6"                   onClick={() => handleStatCardClick('cancelled')} active={searchParams.status === 'cancelled'} />
      </div>

      {/* 搜索栏 */}
      <SavedViewsBar
        pageKey="workflow-monitor"
        currentFilters={searchParams as unknown as Record<string, unknown>}
        onApply={(filters) => {
          const next = { ...defaultSearchParams, ...(filters as Partial<SearchParams>) };
          setSearchParams(next);
          setPage(1);
          void fetchList(1, pageSize, next);
        }}
      />
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderCategoryFilter()}
            {renderInitiatorFilter()}
            {renderStatusFilter()}
            {renderPriorityFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderExportButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderCategoryFilter()}
            {renderInitiatorFilter()}
            {renderStatusFilter()}
            {renderPriorityFilter()}
          </>
        )}
        mobileActions={(
          <>
            {renderResetButton()}
            {renderExportButton()}
          </>
        )}
        filterTitle="实例监控筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        rowKey="id"
        loading={loading}
        onRefresh={() => void fetchList()}
        refreshLoading={loading}
        scroll={{ x: 1450 }}
        pagination={buildPagination(data?.total ?? 0, (p, ps) => void fetchList(p, ps))}
      />
        </TabPane>
        <TabPane tab="数据分析" itemKey="analytics">
          <WorkflowAnalyticsView definitions={definitions} />
        </TabPane>
      </Tabs>

      {/* 详情弹窗 */}
      <SideSheet
        title="流程详情"
        visible={detailVisible}
        onCancel={() => { setDetailVisible(false); setDetail(null); setDetailDef(null); }}
        width={760}
        bodyStyle={{ padding: 16 }}
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : (
          <WorkflowInstanceDetailPanel instance={detail} definition={detailDef} loading={detailLoading} onOpenInstance={loadDetail} />
        )}
      </SideSheet>

      <SideSheet
        title="运行时诊断"
        visible={diagnosticsVisible}
        onCancel={() => { setDiagnosticsVisible(false); setDiagnostics(null); setDefSnapshotVisible(false); }}
        width={980}
        bodyStyle={{ padding: 16 }}
      >
        {diagnosticsLoading ? (
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
      <Modal
        title="强制跳转节点"
        visible={!!jumpRecord}
        onCancel={() => setJumpRecord(null)}
        onOk={() => void submitJump()}
        okButtonProps={{ loading: jumpSubmitting, type: 'warning', theme: 'solid' }}
        okText="确认跳转"
        closeOnEsc
        width={460}
      >
        <Typography.Text type="tertiary" style={{ display: 'block', marginBottom: 12 }}>
          将终止「{jumpRecord?.title}」当前所有待办任务，直接推进到所选审批节点。此操作不可恢复。
        </Typography.Text>
        <Form getFormApi={(api) => { jumpFormApi.current = api; }} labelPosition="left" labelWidth={90}>
          <Form.Select field="targetNodeKey" label="目标节点" placeholder="请选择要跳转到的审批节点" optionList={jumpNodes} rules={[{ required: true, message: '请选择目标节点' }]} style={{ width: '100%' }} />
          <Form.TextArea field="comment" label="说明" placeholder="可选，记录跳转原因" rows={2} />
        </Form>
      </Modal>

      {/* 管理员：改派处理人 */}
      <Modal
        title="改派处理人"
        visible={!!reassignRecord}
        onCancel={() => setReassignRecord(null)}
        onOk={() => void submitReassign()}
        okButtonProps={{ loading: reassignSubmitting, type: 'primary' }}
        okText="确认改派"
        closeOnEsc
        width={460}
      >
        <Form getFormApi={(api) => { reassignFormApi.current = api; }} labelPosition="left" labelWidth={90}>
          <Form.Select field="taskId" label="待办任务" placeholder="请选择要改派的待办" optionList={reassignTasks} rules={[{ required: true, message: '请选择待办任务' }]} style={{ width: '100%' }} />
          <Form.Select field="targetUserId" label="新处理人" placeholder="请选择新的处理人" filter optionList={userOptions} rules={[{ required: true, message: '请选择新处理人' }]} style={{ width: '100%' }} />
          <Form.TextArea field="comment" label="说明" placeholder="可选" rows={2} />
        </Form>
      </Modal>
    </div>
  );
}
