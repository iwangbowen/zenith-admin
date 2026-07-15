import { lazy, Suspense, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  Form,
  Input,
  JsonViewer,
  Modal,
  Popconfirm,
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
import { Download, FileText, RotateCcw, Search, UserRoundCog } from 'lucide-react';
import dayjs from 'dayjs';
import type { WorkflowApproveMethod, WorkflowAssigneeType, WorkflowCategory, WorkflowDefinition, WorkflowExecutionToken, WorkflowFlowData, WorkflowInstance, WorkflowNodeConfig, WorkflowRuntimeDiagnostics, WorkflowRuntimeIssue, WorkflowRuntimeOutboxEvent, WorkflowTask, WorkflowTriggerExecution } from '@zenith/shared';
import { WORKFLOW_ISSUE_SEVERITY_META as ISSUE_SEVERITY_MAP } from './constants';
import { request } from '@/utils/request';
import { downloadBlob } from '@/utils/download';
import { unwrap } from '@/lib/query';
import { UserAvatar } from '@/components/UserAvatar';
import AppModal from '@/components/AppModal';
import { formatDateTime } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import SavedViewsBar from '@/components/workflow/SavedViewsBar';
import WorkflowPriorityTag, { WORKFLOW_PRIORITY_OPTIONS } from '@/components/workflow/WorkflowPriorityTag';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import WorkflowInstanceDetailPanel from '@/components/workflow/WorkflowInstanceDetailPanel';
import WorkflowGraphView from '@/components/workflow/WorkflowGraphView';
import { NODE_RT_STATUS_COLOR, NODE_RT_STATUS_LABEL, INSTANCE_STATUS_MAP } from '@/components/workflow/workflow-runtime';
import { resolveWorkflowFlowData } from '@/utils/workflow-snapshot';
import WorkflowAnalyticsView from './WorkflowAnalyticsView';
import WorkflowHandoverModal from './WorkflowHandoverModal';
import WorkflowEngineDiagnosticsView from './WorkflowEngineDiagnosticsView';
import WorkflowJobsView from './WorkflowJobsView';
import WorkflowCompensationsView from './WorkflowCompensationsView';
import WorkflowEngineTraceView from './WorkflowEngineTraceView';
import { useWorkflowCategories } from '@/hooks/useWorkflowCategories';
import { renderEllipsis } from '../../../utils/table-columns';
import {
  useWorkflowDefinitionDetail,
  useWorkflowInstanceDetail,
  useWorkflowMigratePreflight,
  useWorkflowMonitorList,
  useWorkflowRuntimeDiagnostics,
  useWorkflowStateMutation,
  workflowMonitorKeys,
} from '@/hooks/queries/workflow-monitor';
import { useAllUsers } from '@/hooks/queries/users';

/** 只读流程设计器（懒加载）：用于在诊断 SideSheet 内查看发起时的流程定义快照 */
const WorkflowDesignerPage = lazy(() => import('@/pages/workflow/designer/WorkflowDesignerPage'));

type TagColor = 'amber' | 'blue' | 'cyan' | 'green' | 'grey' | 'indigo' | 'light-blue' | 'light-green' | 'lime' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'violet' | 'yellow' | 'white';

const RUNNING_STATUSES = new Set(['draft', 'running', 'suspended']);

const ISSUE_SOURCE_MAP: Record<WorkflowRuntimeIssue['source'], string> = {
  instance: '实例',
  task: '任务',
  trigger: '触发器',
  outbox: '事件派发',
  token: '执行令牌',
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

type FocusSeverity = 'success' | 'info' | 'warning' | 'critical';

const FOCUS_SEVERITY_META: Record<FocusSeverity, { text: string; color: TagColor }> = {
  success: { text: '正常', color: 'green' },
  info: { text: '运行中', color: 'blue' },
  warning: { text: '需关注', color: 'orange' },
  critical: { text: '有风险', color: 'red' },
};

interface FocusMetric {
  label: string;
  value: string;
  hint?: string;
}

interface FocusRiskTag {
  label: string;
  color: TagColor;
}

interface FocusDiagnosis {
  severity: FocusSeverity;
  title: string;
  description: string;
  nextAction: string;
  metrics: FocusMetric[];
  riskTags: FocusRiskTag[];
  activeTasks: WorkflowTask[];
}

function diffSeconds(start: string | null | undefined, end: string | null | undefined): number {
  if (!start || !end) return 0;
  return Math.max(0, dayjs(end).diff(dayjs(start), 'second'));
}

function uniqueTexts(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value))];
}

function summarizeNames(values: Array<string | null | undefined>, emptyText: string): string {
  const names = uniqueTexts(values);
  if (names.length === 0) return emptyText;
  if (names.length <= 3) return names.join('、');
  return `${names.slice(0, 3).join('、')} 等 ${names.length} 人`;
}

function getTaskEndTime(task: WorkflowTask, generatedAt: string): string {
  if (task.status === 'pending' || task.status === 'waiting') return generatedAt;
  return task.actionAt || task.createdAt;
}

function buildFocusDiagnosis(diagnostics: WorkflowRuntimeDiagnostics, diagNodes: DiagNode[]): FocusDiagnosis {
  const inst = diagnostics.instance;
  const activeTasks = diagnostics.activeTasks.slice().sort((a, b) => dayjs(a.createdAt).valueOf() - dayjs(b.createdAt).valueOf());
  const oldestActiveTask = activeTasks[0];
  const oldestActiveNode = oldestActiveTask ? diagNodes.find((node) => node.key === oldestActiveTask.nodeKey) : undefined;
  const longestTask = diagnostics.tasks
    .map((task) => ({ task, seconds: diffSeconds(task.createdAt, getTaskEndTime(task, diagnostics.generatedAt)) }))
    .sort((a, b) => b.seconds - a.seconds)[0];

  const criticalIssues = diagnostics.issues.filter((issue) => issue.severity === 'critical');
  const warningIssues = diagnostics.issues.filter((issue) => issue.severity === 'warning');
  const failedTriggers = diagnostics.triggerExecutions.filter((item) => item.status === 'failed');
  const retryingTriggers = diagnostics.triggerExecutions.filter((item) => item.status === 'retrying' || item.status === 'running');
  const failedOutbox = diagnostics.outboxEvents.filter((item) => item.status.toLowerCase() === 'failed');
  const pendingOutbox = diagnostics.outboxEvents.filter((item) => ['pending', 'retrying'].includes(item.status.toLowerCase()));
  const externalFailedTasks = diagnostics.issues.filter((issue) => issue.title === '外部审批分派失败');
  const triggerFailedTasks = diagnostics.issues.filter((issue) => issue.source === 'trigger' && issue.title === '触发器执行失败');
  const emptyAssigneeTasks = activeTasks.filter((task) => task.assigneeId == null && !task.assigneeName);
  const longestActiveWaitingSec = oldestActiveTask ? diffSeconds(oldestActiveTask.createdAt, diagnostics.generatedAt) : 0;
  const longWaitingCritical = longestActiveWaitingSec >= 72 * 3600;
  const longWaitingWarning = longestActiveWaitingSec >= 24 * 3600;

  const riskTags: FocusRiskTag[] = [];
  if (criticalIssues.length > 0) riskTags.push({ label: `严重 ${criticalIssues.length}`, color: 'red' });
  if (warningIssues.length > 0) riskTags.push({ label: `警告 ${warningIssues.length}`, color: 'orange' });
  if (failedTriggers.length > 0) riskTags.push({ label: `触发器失败 ${failedTriggers.length}`, color: 'red' });
  if (failedOutbox.length > 0) riskTags.push({ label: `事件派发失败 ${failedOutbox.length}`, color: 'red' });
  if (externalFailedTasks.length > 0) riskTags.push({ label: `外部分派失败 ${externalFailedTasks.length}`, color: 'red' });
  if (triggerFailedTasks.length > 0) riskTags.push({ label: `任务触发失败 ${triggerFailedTasks.length}`, color: 'red' });
  if (retryingTriggers.length > 0) riskTags.push({ label: `触发器重试中 ${retryingTriggers.length}`, color: 'orange' });
  if (pendingOutbox.length > 0) riskTags.push({ label: `事件派发待处理 ${pendingOutbox.length}`, color: 'orange' });
  if (emptyAssigneeTasks.length > 0) riskTags.push({ label: `处理人为空 ${emptyAssigneeTasks.length}`, color: 'orange' });
  if (longWaitingCritical) riskTags.push({ label: '等待超3天', color: 'red' });
  else if (longWaitingWarning) riskTags.push({ label: '等待超24小时', color: 'orange' });
  if (activeTasks.length > 0) riskTags.push({ label: `活动任务 ${activeTasks.length}`, color: 'light-blue' });
  if (riskTags.length === 0) riskTags.push({ label: '未发现阻断项', color: 'green' });

  const hasCriticalRisk = criticalIssues.length > 0 || failedTriggers.length > 0 || failedOutbox.length > 0 || externalFailedTasks.length > 0 || triggerFailedTasks.length > 0 || longWaitingCritical;
  const hasWarningRisk = warningIssues.length > 0 || retryingTriggers.length > 0 || pendingOutbox.length > 0 || emptyAssigneeTasks.length > 0 || longWaitingWarning;
  const running = RUNNING_STATUSES.has(inst.status);
  const severity: FocusSeverity = hasCriticalRisk ? 'critical' : hasWarningRisk || (running && activeTasks.length === 0) ? 'warning' : running ? 'info' : 'success';

  const activeNodeText = oldestActiveTask ? (oldestActiveTask.nodeName || oldestActiveTask.nodeKey) : '—';
  const assigneeText = summarizeNames(activeTasks.map((task) => task.assigneeName), '未指定处理人');
  const waitText = oldestActiveTask ? formatDuration(oldestActiveTask.createdAt, diagnostics.generatedAt) : '—';
  const assigneeSource = oldestActiveNode?.config.assigneeType ? ASSIGNEE_TYPE_LABEL[oldestActiveNode.config.assigneeType] ?? oldestActiveNode.config.assigneeType : '—';
  const longestStayText = longestTask && longestTask.seconds > 0
    ? `${longestTask.task.nodeName || longestTask.task.nodeKey} ${formatDuration(longestTask.task.createdAt, getTaskEndTime(longestTask.task, diagnostics.generatedAt))}`
    : '—';

  let title = '流程已结束';
  let description = '该实例没有活动任务，可在任务、表单数据和定义快照中核对历史执行依据。';
  let nextAction = '确认终态和历史审批记录即可；如结果异常，优先查看任务列表和定义快照。';

  if (running && oldestActiveTask) {
    title = `当前卡在「${activeNodeText}」`;
    description = `最早活动任务 #${oldestActiveTask.id} 已等待 ${waitText}，当前处理人：${assigneeText}。`;
    nextAction = '联系当前处理人继续审批；若处理人不合适，可使用改派处理人或强制跳转。';
    if (oldestActiveTask.status === 'waiting' || oldestActiveTask.externalCallbackId) {
      nextAction = '该任务正在等待外部系统回调，优先检查外部分派状态、回调地址和外部系统处理结果。';
    } else if (oldestActiveTask.nodeType === 'trigger') {
      nextAction = '该节点依赖触发器执行，优先打开“触发器”标签查看请求、响应、错误和重试状态。';
    }
  } else if (running) {
    title = '运行中但无活动任务';
    description = '实例仍处于运行态，但诊断接口未返回 pending / waiting 任务，可能需要检查流程推进或任务生成逻辑。';
    nextAction = '查看“节点”和“定义快照”，确认当前节点是否应该生成任务；必要时使用强制跳转恢复流程。';
  }

  if (failedOutbox.length > 0) nextAction = '优先打开“事件派发”标签查看失败事件、错误信息和下次重试时间，必要时检查订阅地址或重试投递。';
  if (failedTriggers.length > 0) nextAction = '优先打开“触发器”标签查看失败请求、HTTP 状态、响应体和最近错误。';
  if (externalFailedTasks.length > 0) nextAction = '优先检查外部分派配置和外部系统回调；若无法恢复，可改派到人工处理。';
  if (criticalIssues.length > 0) nextAction = '优先处理诊断结论中的严重项，再回到节点和任务列表确认流程是否恢复。';

  return {
    severity,
    title,
    description,
    nextAction,
    activeTasks,
    riskTags,
    metrics: [
      { label: '当前等待', value: waitText, hint: oldestActiveTask ? `task #${oldestActiveTask.id}` : '无活动任务' },
      { label: '处理人', value: assigneeText, hint: assigneeSource !== '—' ? `来源：${assigneeSource}` : undefined },
      { label: '最久停留', value: longestStayText, hint: longestTask ? `task #${longestTask.task.id}` : undefined },
      { label: '外部事件', value: `${diagnostics.triggerExecutions.length} 触发器 · ${diagnostics.outboxEvents.length} 事件派发`, hint: `${failedTriggers.length + failedOutbox.length} 个失败` },
    ],
  };
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
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  interface SearchParams { keyword: string; initiator: string; status: string; categoryId: number | ''; definitionId: number | ''; priority: string }
  const defaultSearchParams: SearchParams = { keyword: '', initiator: '', status: '', categoryId: '', definitionId: '', priority: '' };
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const listQuery = useWorkflowMonitorList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
    categoryId: submittedParams.categoryId === '' ? undefined : submittedParams.categoryId,
    definitionId: submittedParams.definitionId === '' ? undefined : submittedParams.definitionId,
    initiatorKeyword: submittedParams.initiator || undefined,
    priority: submittedParams.priority || undefined,
  });
  const data = listQuery.data ?? null;

  const { categories } = useWorkflowCategories();
  const { hasPermission } = usePermission();
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

  // 详情弹窗
  const [diagnosticsVisible, setDiagnosticsVisible] = useState(false);
  const [diagnosticsId, setDiagnosticsId] = useState<number | undefined>();
  const diagnosticsQuery = useWorkflowRuntimeDiagnostics(diagnosticsId, diagnosticsVisible);
  const diagnostics = diagnosticsQuery.data ?? null;
  const diagnosticsLoading = diagnosticsQuery.isFetching;
  const [diagnosticsTab, setDiagnosticsTab] = useState('nodes');
  const [defSnapshotVisible, setDefSnapshotVisible] = useState(false);

  // 流程定义（用于数据分析筛选 + 强制跳转节点选择）
  const definitionsQuery = useQuery({
    queryKey: ['workflow', 'definitions', 'options'] as const,
    queryFn: () => request.get<WorkflowDefinition[]>('/api/workflows/definitions/published').then(unwrap),
  });
  const definitions = definitionsQuery.data ?? [];
  // 管理员：强制跳转
  const [jumpRecord, setJumpRecord] = useState<WorkflowInstance | null>(null);
  const [jumpNodes, setJumpNodes] = useState<Array<{ label: string; value: string }>>([]);
  const jumpFormApi = useRef<FormApi | null>(null);
  // 管理员：改派处理人
  const [reassignRecord, setReassignRecord] = useState<WorkflowInstance | null>(null);
  const [reassignTasks, setReassignTasks] = useState<Array<{ label: string; value: number }>>([]);
  const reassignFormApi = useRef<FormApi | null>(null);
  // 管理员：离职交接
  const [handoverVisible, setHandoverVisible] = useState(false);
  const stateMutation = useWorkflowStateMutation();
  const migratePreflightMutation = useWorkflowMigratePreflight();
  const allUsersQuery = useAllUsers({ enabled: !!reassignRecord });
  const userOptions = (allUsersQuery.data ?? []).map((u) => ({ label: u.nickname ?? u.username, value: u.id }));

  const canAdmin = hasPermission('workflow:instance:cancel');

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(searchParams);
    void queryClient.invalidateQueries({ queryKey: workflowMonitorKeys.monitorLists });
  };

  const handleReset = () => {
    setSearchParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: workflowMonitorKeys.monitorLists });
  };

  const handleStatCardClick = (st: string) => {
    const next = searchParams.status === st ? '' : st;
    const newParams = { ...searchParams, status: next };
    setSearchParams(newParams);
    setSubmittedParams(newParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: workflowMonitorKeys.monitorLists });
  };

  const loadDetail = (instanceId: number) => {
    setDetailId(instanceId);
  };

  const openDetail = (item: WorkflowInstance) => {
    setDetailVisible(true);
    loadDetail(item.id);
  };

  const openDiagnosticsById = (instanceId: number) => {
    setDiagnosticsVisible(true);
    setDiagnosticsId(instanceId);
    setDiagnosticsTab('nodes');
  };
  const openDiagnostics = (item: WorkflowInstance) => openDiagnosticsById(item.id);

  /** Token 运营恢复操作（跳过卡死 / 从节点重放），成功后刷新诊断 */
  const runTokenOp = async (tokenId: number, op: 'skip' | 'replay') => {
    await stateMutation.mutateAsync({ url: `/api/workflows/instances/tokens/${tokenId}/${op}` });
    Toast.success(op === 'skip' ? '已跳过并推进' : '已从该节点重放');
    if (diagnostics) void diagnosticsQuery.refetch();
  };

  /** 导出实例诊断包（诊断 + 轨迹 + 执行 Token）为 JSON 文件 */
  const exportDiagnosticBundle = async (instanceId: number) => {
    const res = await request.get<unknown>(`/api/workflows/instances/${instanceId}/diagnostic-bundle`);
    if (res.code !== 0) return;
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `workflow-diagnostic-${instanceId}.json`);
  };

  const handleCancel = (record: WorkflowInstance) => {
    Modal.confirm({
      title: '取消流程',
      content: `确定要强制取消流程「${record.title}」吗？取消后流程将立即终止，待办任务会被跳过，此操作不可恢复。`,
      okText: '确定取消',
      okButtonProps: { type: 'warning', theme: 'solid' },
      cancelText: '关闭',
      onOk: async () => {
        await stateMutation.mutateAsync({ url: `/api/workflows/instances/${record.id}/cancel` });
        Toast.success('流程已取消');
      },
    });
  };

  const handleSuspend = (record: WorkflowInstance) => {
    let reason = '';
    Modal.confirm({
      title: '挂起流程',
      content: (
        <div>
          <Typography.Paragraph>
            挂起后流程「{record.title}」暂停流转：待办不可处理、SLA 超时与延迟计时冻结，恢复后按剩余时长继续。
          </Typography.Paragraph>
          <Input placeholder="请填写挂起原因（必填）" onChange={(v) => { reason = v; }} maxLength={500} />
        </div>
      ),
      okText: '确定挂起',
      okButtonProps: { type: 'warning', theme: 'solid' },
      cancelText: '关闭',
      onOk: async () => {
        if (!reason.trim()) { Toast.warning('请填写挂起原因'); return Promise.reject(new Error('validation')); }
        await stateMutation.mutateAsync({ url: `/api/workflows/instances/${record.id}/suspend`, body: { reason: reason.trim() } });
        Toast.success('流程已挂起，计时已冻结');
      },
    });
  };

  const handleResume = (record: WorkflowInstance) => {
    Modal.confirm({
      title: '恢复流程',
      content: `确定恢复流程「${record.title}」吗？恢复后待办可继续处理，超时计时按挂起前剩余时长续跑。${record.suspendReason ? `挂起原因：${record.suspendReason}` : ''}`,
      okText: '确定恢复',
      okButtonProps: { type: 'primary', theme: 'solid' },
      cancelText: '关闭',
      onOk: async () => {
        await stateMutation.mutateAsync({ url: `/api/workflows/instances/${record.id}/resume` });
        Toast.success('流程已恢复流转');
      },
    });
  };

  const handleMigrate = async (record: WorkflowInstance) => {
    const p = await migratePreflightMutation.mutateAsync(record.id);
    if (!p) return;
    if (!p.migratable) { Toast.warning(p.blocked.length ? `无法迁移：新版本缺失节点 ${p.blocked.join(', ')}` : '无需迁移或已是最新版本'); return; }
    Modal.confirm({
      title: '迁移到最新版本', content: `将实例「${record.title}」从 v${p.fromVersion} 迁移到 v${p.toVersion}？`,
      onOk: async () => {
        await stateMutation.mutateAsync({ url: `/api/workflows/instances/${record.id}/migrate` });
        Toast.success('迁移成功');
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
        await stateMutation.mutateAsync({ url: `/api/workflows/instances/${record.id}`, method: 'delete' });
        Toast.success('流程已删除');
      },
    });
  };

  const stats = data?.stats ?? { total: 0, running: 0, approved: 0, rejected: 0, withdrawn: 0, cancelled: 0 };

  const openJump = async (record: WorkflowInstance) => {
    setJumpRecord(record);
    setJumpNodes([]);
    const definition = await queryClient.fetchQuery({
      queryKey: workflowMonitorKeys.definitionDetail(record.definitionId),
      queryFn: () => request.get<WorkflowDefinition>(`/api/workflows/definitions/${record.definitionId}`).then(unwrap),
    });
    const nodes = (definition.flowData?.nodes ?? [])
      .filter((n) => n.data.type === 'approve' || n.data.type === 'handler')
      .map((n) => ({ label: n.data.label ?? n.data.key, value: n.data.key }));
    setJumpNodes(nodes);
  };

  const submitJump = async () => {
    if (!jumpRecord) return;
    try {
      const values = await jumpFormApi.current?.validate() as { targetNodeKey: string; comment?: string };
      await stateMutation.mutateAsync({ url: `/api/workflows/instances/${jumpRecord.id}/jump`, body: values });
      Toast.success('已强制跳转');
      setJumpRecord(null);
    } catch { /* validation */ }
  };

  const openReassign = async (record: WorkflowInstance) => {
    setReassignRecord(record);
    setReassignTasks([]);
    const instance = await queryClient.fetchQuery({
      queryKey: workflowMonitorKeys.monitorDetail(record.id),
      queryFn: () => request.get<WorkflowInstance>(`/api/workflows/instances/${record.id}`).then(unwrap),
    });
    const tasks = (instance.tasks ?? [])
      .filter((t: WorkflowTask) => t.status === 'pending')
      .map((t: WorkflowTask) => ({ label: `${t.nodeName} · ${t.assigneeName ?? '未指派'}`, value: t.id }));
    setReassignTasks(tasks);
  };

  const submitReassign = async () => {
    if (!reassignRecord) return;
    try {
      const values = await reassignFormApi.current?.validate() as { taskId: number; targetUserId: number; comment?: string };
      await stateMutation.mutateAsync({ url: `/api/workflows/tasks/${values.taskId}/reassign`, body: { targetUserId: values.targetUserId, comment: values.comment } });
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
      { title: 'ID', dataIndex: 'id', width: 70 },
      { title: '节点', dataIndex: 'nodeName', width: 160, render: (_: unknown, row) => row.nodeName || row.nodeKey },
      { title: '类型', dataIndex: 'nodeType', width: 100, render: (v: string | null) => v ?? '—' },
      { title: '状态', dataIndex: 'status', width: 130 },
      { title: '处理人', dataIndex: 'assigneeName', width: 120, render: (v: string | null) => v ?? '—' },
      { title: '外部分派', dataIndex: 'externalDispatchStatus', width: 120, render: (v: string | null) => v ?? '—' },
      { title: '触发器状态', dataIndex: 'triggerDispatchStatus', width: 130, render: (v: string | null) => v ?? '—' },
      { title: '尝试', dataIndex: 'triggerAttempt', width: 70, render: (v: number | undefined) => v ?? '—' },
      { title: '错误', dataIndex: 'triggerLastError', width: 220, ellipsis: { showTitle: true }, render: (v: string | null) => v ?? '—' },
      { title: '创建时间', dataIndex: 'createdAt', width: 210 },
    ];
    const triggerColumns: ColumnProps<WorkflowTriggerExecution>[] = [
      { title: 'ID', dataIndex: 'id', width: 70 },
      { title: '任务', dataIndex: 'taskId', width: 80, render: (v: number | null) => v ? `#${v}` : '—' },
      { title: '节点', dataIndex: 'nodeName', width: 140, render: (_: unknown, row) => row.nodeName || row.nodeKey },
      { title: '类型', dataIndex: 'triggerType', width: 110 },
      { title: '状态', dataIndex: 'status', width: 130 },
      { title: '尝试', dataIndex: 'attempt', width: 70 },
      { title: 'HTTP', dataIndex: 'responseStatus', width: 80, render: (v: number | null) => v ?? '—' },
      { title: '耗时', dataIndex: 'durationMs', width: 90, render: (v: number | null) => v != null ? `${v}ms` : '—' },
      { title: '错误', dataIndex: 'errorMessage', width: 220, ellipsis: { showTitle: true }, render: (v: string | null) => v ?? '—' },
      { title: '创建时间', dataIndex: 'createdAt', width: 210 },
    ];
    const outboxColumns: ColumnProps<WorkflowRuntimeOutboxEvent>[] = [
      { title: 'ID', dataIndex: 'id', width: 70 },
      { title: '事件', dataIndex: 'eventType', width: 170 },
      { title: '任务', dataIndex: 'taskId', width: 80, render: (v: number | null) => v ? `#${v}` : '—' },
      { title: '状态', dataIndex: 'status', width: 130 },
      { title: '尝试', dataIndex: 'attempts', width: 70 },
      { title: '下次重试', dataIndex: 'nextRetryAt', width: 210, render: (v: string | null) => v ?? '—' },
      { title: '错误', dataIndex: 'errorMessage', width: 260, ellipsis: { showTitle: true }, render: (v: string | null) => v ?? '—' },
      { title: '创建时间', dataIndex: 'createdAt', width: 210 },
    ];

    const tokenColumns: ColumnProps<WorkflowExecutionToken>[] = [
      { title: 'ID', dataIndex: 'id', width: 70 },
      { title: '节点', dataIndex: 'nodeName', width: 150, render: (v: string | null, r) => v ?? r.nodeKey },
      { title: '状态', dataIndex: 'status', width: 150, render: (v: WorkflowExecutionToken['status'], r) => (
        <Space spacing={4}>
          <Tag size="small" color={v === 'active' ? 'green' : v === 'consumed' ? 'grey' : 'red'}>{{ active: '活动', consumed: '已消费', dead: '已终止' }[v]}</Tag>
          {r.parkedAtJoin && <Tag size="small" color="amber" type="light">汇聚等待</Tag>}
        </Space>
      ) },
      { title: '分支', dataIndex: 'branchPath', width: 150, render: (bp: WorkflowExecutionToken['branchPath']) => bp.length === 0 ? '主路径' : bp.map((f) => `${f.index + 1}/${f.total}`).join(' · ') },
      { title: '深度', dataIndex: 'depth', width: 70 },
      { title: '父 Token', dataIndex: 'parentTokenId', width: 90, render: (v: number | null) => v ? `#${v}` : '—' },
      { title: '作用域', dataIndex: 'scopeKey', width: 180, ellipsis: { showTitle: true }, render: (v: string | null) => v ?? '—' },
      { title: '创建', dataIndex: 'createdAt', width: 180 },
      { title: '消费/终止', dataIndex: 'consumedAt', width: 180, render: (v: string | null) => v ?? '—' },
      { title: '操作', dataIndex: 'op', width: 130, fixed: 'right', render: (_: unknown, r: WorkflowExecutionToken) => (
        <Space>
          {r.status === 'active' && (
            <Popconfirm title="跳过该卡死 Token 并推进流程？" onConfirm={() => runTokenOp(r.id, 'skip')}>
              <Button theme="borderless" size="small">跳过</Button>
            </Popconfirm>
          )}
          <Popconfirm title="从该 Token 节点重放？将清场全部活动 Token 并在该节点重建路径" onConfirm={() => runTokenOp(r.id, 'replay')}>
            <Button theme="borderless" type="danger" size="small">重放</Button>
          </Popconfirm>
        </Space>
      ) },
    ];

    const inst = diagnostics.instance;
    const flowData = resolveWorkflowFlowData(inst, null);
    const diagNodes = buildDiagNodes(flowData, diagnostics.tasks, inst.currentNodeKeys ?? []);
    const nodeNameByKey = new Map(diagNodes.map((n) => [n.key, n.name]));
    const statusMeta = INSTANCE_STATUS_MAP[inst.status] ?? { text: inst.status, color: 'grey' as TagColor };
    const currentNodeText = inst.currentNodeNames && inst.currentNodeNames.length > 0
      ? inst.currentNodeNames.join('、')
      : (inst.currentNodeName || '—');
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
                    <div style={{ border: '1px solid var(--semi-color-fill-1)', borderTop: 'none', borderRadius: 'var(--semi-border-radius-medium)' }}>
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
            <div><Typography.Text type="tertiary" size="small">实例 ID</Typography.Text><div>#{inst.id}</div></div>
            <div><Typography.Text type="tertiary" size="small">定义 ID</Typography.Text><div>#{inst.definitionId}</div></div>
            <div>
              <Typography.Text type="tertiary" size="small">发起人</Typography.Text>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                {inst.initiatorName ? <UserAvatar name={inst.initiatorName} avatar={inst.initiatorAvatar} size={20} /> : null}
                <span>{inst.initiatorName || '—'}</span>
              </div>
            </div>
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

        <div
          style={{
            border: '1px solid var(--semi-color-border)',
            borderRadius: 'var(--semi-border-radius-medium)',
            padding: 14,
            background: 'var(--semi-color-bg-1)',
          }}
        >
          <Space spacing={8} wrap align="center" style={{ marginBottom: 8 }}>
            <Tag color={focusMeta.color}>{focusMeta.text}</Tag>
            <Typography.Text strong>{focusDiagnosis.title}</Typography.Text>
            {focusDiagnosis.riskTags.map((tag) => (
              <Tag key={tag.label} size="small" color={tag.color}>{tag.label}</Tag>
            ))}
          </Space>
          <Typography.Text type="tertiary" size="small">{focusDiagnosis.description}</Typography.Text>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 12 }}>
            {focusDiagnosis.metrics.map((metric) => (
              <div
                key={metric.label}
                style={{
                  border: '1px solid var(--semi-color-fill-1)',
                  borderRadius: 'var(--semi-border-radius-medium)',
                  padding: '8px 10px',
                  minWidth: 0,
                }}
              >
                <Typography.Text type="tertiary" size="small">{metric.label}</Typography.Text>
                <div style={{ fontWeight: 600, marginTop: 2 }}>{metric.value}</div>
                {metric.hint && <Typography.Text type="tertiary" size="small">{metric.hint}</Typography.Text>}
              </div>
            ))}
          </div>

          {focusDiagnosis.activeTasks.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Typography.Text type="tertiary" size="small">当前活动任务</Typography.Text>
              <Space vertical spacing={6} style={{ width: '100%', marginTop: 6 }}>
                {focusDiagnosis.activeTasks.slice(0, 3).map((task) => (
                  <div
                    key={task.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flexWrap: 'wrap',
                      padding: '7px 10px',
                      border: '1px solid var(--semi-color-fill-1)',
                      borderRadius: 'var(--semi-border-radius-medium)',
                    }}
                  >
                    <Typography.Text type="tertiary" size="small">#{task.id}</Typography.Text>
                    <Tag size="small" color={NODE_RT_STATUS_COLOR[task.status]}>{NODE_RT_STATUS_LABEL[task.status]}</Tag>
                    <Typography.Text strong size="small">{task.nodeName || task.nodeKey}</Typography.Text>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <UserAvatar name={task.assigneeName || '未指定'} avatar={task.assigneeAvatar} size={20} />
                      <Typography.Text size="small">{task.assigneeName || '未指定'}</Typography.Text>
                    </span>
                    <Typography.Text type="tertiary" size="small">
                      等待 {formatDuration(task.createdAt, diagnostics.generatedAt)}
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

          <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 'var(--semi-border-radius-medium)', background: 'var(--semi-color-fill-0)' }}>
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
                <div key={`${issue.source}-${issue.title}-${index}`} style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)' }}>
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
            <ConfigurableTable bordered columns={taskColumns} dataSource={diagnostics.tasks} rowKey="id" pagination={false} scroll={{ x: 1330 }} />
          </TabPane>
          <TabPane tab={`触发器 ${diagnostics.triggerExecutions.length}`} itemKey="triggers">
            <ConfigurableTable bordered columns={triggerColumns} dataSource={diagnostics.triggerExecutions} rowKey="id" pagination={false} scroll={{ x: 1220 }} />
          </TabPane>
          <TabPane tab={`事件派发 ${diagnostics.outboxEvents.length}`} itemKey="outbox">
            <ConfigurableTable bordered columns={outboxColumns} dataSource={diagnostics.outboxEvents} rowKey="id" pagination={false} scroll={{ x: 1200 }} />
          </TabPane>
          <TabPane tab={`执行 Token ${diagnostics.tokens.length}`} itemKey="tokens">
            <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <Typography.Text type="tertiary" size="small">
                显式执行 Token = 活动执行路径的权威单元：fork 沿分支栈分裂、join 凑齐后汇聚消费；已消费/终止 token 保留为执行树血缘。卡死可「跳过」、断点可「重放」。
              </Typography.Text>
              <Button size="small" icon={<Download size={14} />} onClick={() => exportDiagnosticBundle(diagnostics.instance.id)}>导出诊断包</Button>
            </div>
            <ConfigurableTable bordered columns={tokenColumns} dataSource={diagnostics.tokens} rowKey="id" pagination={false} scroll={{ x: 1330 }} />
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
    createOperationColumn<WorkflowInstance>({
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
          { key: 'reassign', label: '改派处理人', hidden: !canJump, onClick: () => void openReassign(record) },
          { key: 'migrate', label: '迁移版本', hidden: !canJump, onClick: () => void handleMigrate(record) },
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
          {
            key: 'delete',
            label: '删除',
            danger: true,
            hidden: !canDelete,
            onClick: () => handleDelete(record),
          },
        ];
      },
    }),
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

  const renderDefinitionFilter = () => (
    <Select
      placeholder="所有流程"
      showClear
      filter
      value={searchParams.definitionId === '' ? undefined : searchParams.definitionId}
      onChange={v => setSearchParams(prev => ({ ...prev, definitionId: (v as number) ?? '' }))}
      style={{ width: 160 }}
      optionList={definitions.map((d) => ({ label: d.name, value: d.id }))}
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
      optionList={['running', 'suspended', 'approved', 'rejected', 'withdrawn', 'cancelled'].map((s) => ({ value: s, label: INSTANCE_STATUS_MAP[s].text }))}
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

  const buildExportQuery = () => {
    const { keyword, status, categoryId, definitionId, initiator, priority } = searchParams;
    return {
      ...(keyword ? { keyword } : {}),
      ...(status ? { status } : {}),
      ...(categoryId !== '' ? { categoryId: String(categoryId) } : {}),
      ...(definitionId !== '' ? { definitionId: String(definitionId) } : {}),
      ...(initiator ? { initiatorKeyword: initiator } : {}),
      ...(priority ? { priority } : {}),
    };
  };

  const renderExportButton = () => (
    <ExportButton entity="workflow.instances" query={buildExportQuery()} formats={['xlsx']} />
  );

  const renderHandoverButton = () => (
    hasPermission('workflow:task:handover') ? (
      <Button type="primary" icon={<UserRoundCog size={14} />} onClick={() => setHandoverVisible(true)}>离职交接</Button>
    ) : null
  );

  return (
    <div className="page-container page-tabs-page">
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
          setSubmittedParams(next);
          setPage(1);
          void queryClient.invalidateQueries({ queryKey: workflowMonitorKeys.monitorLists });
        }}
      />
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderCategoryFilter()}
            {renderDefinitionFilter()}
            {renderInitiatorFilter()}
            {renderStatusFilter()}
            {renderPriorityFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderExportButton()}
            {renderHandoverButton()}
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
            {renderDefinitionFilter()}
            {renderInitiatorFilter()}
            {renderStatusFilter()}
            {renderPriorityFilter()}
          </>
        )}
        mobileActions={(
          <>
            {renderResetButton()}
            {renderExportButton()}
            {renderHandoverButton()}
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
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        scroll={{ x: 1470 }}
        pagination={buildPagination(data?.total ?? 0)}
      />
        </TabPane>
        <TabPane tab="数据分析" itemKey="analytics">
          <WorkflowAnalyticsView definitions={definitions} />
        </TabPane>
        <TabPane tab="引擎诊断" itemKey="engine">
          <WorkflowEngineDiagnosticsView onOpenInstanceDiagnostics={openDiagnosticsById} />
        </TabPane>
        <TabPane tab="作业账本" itemKey="jobs">
          <WorkflowJobsView />
        </TabPane>
        <TabPane tab="补偿工单" itemKey="compensations">
          <WorkflowCompensationsView />
        </TabPane>
      </Tabs>

      {/* 详情弹窗 */}
      <SideSheet
        title="流程详情"
        visible={detailVisible}
        onCancel={() => { setDetailVisible(false); setDetailId(undefined); }}
        width={1080}
        bodyStyle={{ padding: 0, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {detailLoading ? (
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
      <AppModal
        title="强制跳转节点"
        visible={!!jumpRecord}
        onCancel={() => setJumpRecord(null)}
        onOk={() => void submitJump()}
        okButtonProps={{ loading: stateMutation.isPending, type: 'warning', theme: 'solid' }}
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
      </AppModal>

      {/* 管理员：改派处理人 */}
      <AppModal
        title="改派处理人"
        visible={!!reassignRecord}
        onCancel={() => setReassignRecord(null)}
        onOk={() => void submitReassign()}
        okButtonProps={{ loading: stateMutation.isPending, type: 'primary' }}
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
