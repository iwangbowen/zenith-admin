import type { WorkflowAssigneeType, WorkflowFlowData, WorkflowNodeConfig, WorkflowRuntimeDiagnostics, WorkflowRuntimeIssue, WorkflowTask } from '@zenith/shared/workflow';
import { WORKFLOW_APPROVE_METHOD_LABELS } from '@zenith/shared/workflow';
import dayjs from 'dayjs';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { formatSecondsBetween } from '@/utils/format';
export type TagColor = 'amber' | 'blue' | 'cyan' | 'green' | 'grey' | 'indigo' | 'light-blue' | 'light-green' | 'lime' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'violet' | 'yellow' | 'white';

export const RUNNING_STATUSES = new Set(['draft', 'running', 'suspended']);

export const ISSUE_SOURCE_MAP: Record<WorkflowRuntimeIssue['source'], string> = {
  instance: '实例',
  task: '任务',
  trigger: '触发器',
  outbox: '事件派发',
  token: '执行令牌',
};

/** 审批人来源类型 → 中文标签 */
export const ASSIGNEE_TYPE_LABEL: Partial<Record<WorkflowAssigneeType, string>> = {
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

/** 节点运行态（由关联任务派生） */
type DiagNodeState = 'done' | 'active' | 'rejected' | 'idle';

export const NODE_STATE_MAP: Record<DiagNodeState, { text: string; color: TagColor }> = {
  done: { text: '已完成', color: 'green' },
  active: { text: '进行中', color: 'blue' },
  rejected: { text: '已驳回', color: 'red' },
  idle: { text: '未进入 / 无需任务', color: 'grey' },
};

/** 节点状态 → Semi Timeline 节点类型（进行中用 ongoing 呈现脉冲态） */
export const NODE_STATE_TIMELINE_TYPE: Record<DiagNodeState, 'success' | 'ongoing' | 'error' | 'default'> = {
  done: 'success',
  active: 'ongoing',
  rejected: 'error',
  idle: 'default',
};

/** 整合后的诊断节点：流程定义节点 + 关联运行时任务 + 派生状态 */
export interface DiagNode {
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
export function getNodeConfigItems(cfg: WorkflowNodeConfig): Array<{ label: string; value: string }> {
  const items: Array<{ label: string; value: string }> = [];
  if (cfg.assigneeType && ASSIGNEE_TYPE_LABEL[cfg.assigneeType]) {
    items.push({ label: '处理人来源', value: ASSIGNEE_TYPE_LABEL[cfg.assigneeType] as string });
  }
  if (cfg.approveMethod && WORKFLOW_APPROVE_METHOD_LABELS[cfg.approveMethod]) {
    const ratio = cfg.approveMethod === 'ratio' && cfg.approveRatio ? ` ${cfg.approveRatio}%` : '';
    items.push({ label: '审批方式', value: `${WORKFLOW_APPROVE_METHOD_LABELS[cfg.approveMethod]}${ratio}` });
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
export function buildDiagNodes(
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
    if (nodeTasks.some((t) => t.status === 'pending' || t.status === 'waiting')) state = 'active';
    else if (nodeTasks.at(-1)?.status === 'rejected') state = 'rejected';
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

type FocusSeverity = 'success' | 'info' | 'warning' | 'critical';

export const FOCUS_SEVERITY_META: Record<FocusSeverity, { text: string; color: TagColor }> = {
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

export function diffSeconds(start: string | null | undefined, end: string | null | undefined): number {
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

export function getTaskEndTime(task: WorkflowTask, generatedAt: string): string {
  if (task.status === 'pending' || task.status === 'waiting') return generatedAt;
  return task.actionAt || task.createdAt;
}

export function buildFocusDiagnosis(diagnostics: WorkflowRuntimeDiagnostics, diagNodes: DiagNode[]): FocusDiagnosis {
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
  const emptyAssigneeTasks = activeTasks.filter((task) => task.taskKind === 'approval' && task.assigneeId == null && !task.assigneeName);
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

  const activeNodeText = oldestActiveTask ? (oldestActiveTask.nodeName || oldestActiveTask.nodeKey) : EMPTY_PLACEHOLDER;
  const assigneeText = summarizeNames(activeTasks.map((task) => task.assigneeName), '未指定处理人');
  const waitText = oldestActiveTask ? formatSecondsBetween(oldestActiveTask.createdAt, diagnostics.generatedAt) : EMPTY_PLACEHOLDER;
  const assigneeSource = oldestActiveNode?.config.assigneeType ? ASSIGNEE_TYPE_LABEL[oldestActiveNode.config.assigneeType] ?? oldestActiveNode.config.assigneeType : EMPTY_PLACEHOLDER;
  const longestStayText = longestTask && longestTask.seconds > 0
    ? `${longestTask.task.nodeName || longestTask.task.nodeKey} ${formatSecondsBetween(longestTask.task.createdAt, getTaskEndTime(longestTask.task, diagnostics.generatedAt))}`
    : EMPTY_PLACEHOLDER;

  let title = '流程已结束';
  let description = '该实例没有活动任务，可在任务、表单数据和定义快照中核对历史执行依据。';
  let nextAction = '确认终态和历史审批记录即可；如结果异常，优先查看任务列表和定义快照。';

  if (running && oldestActiveTask) {
    title = `当前卡在「${activeNodeText}」`;
    description = `最早活动任务 #${oldestActiveTask.id} 已等待 ${waitText}，当前处理人：${assigneeText}。`;
    nextAction = '联系当前处理人继续审批；若处理人不合适，可使用改派处理人或强制跳转。';
    if (oldestActiveTask.nodeType === 'delay') {
      title = '等待计划唤醒'; nextAction = '核对延时唤醒作业与计划时刻，到期后由系统推进。';
    } else if (oldestActiveTask.nodeType === 'subProcess') {
      title = '等待子流程汇聚'; nextAction = '查看关联子实例及汇聚作业。';
    } else if (oldestActiveTask.nodeType === 'trigger') {
      title = '等待自动执行'; nextAction = '查看触发器执行记录和作业状态。';
    } else if (oldestActiveTask.status === 'waiting' || oldestActiveTask.externalCallbackId) {
      nextAction = '该任务正在等待外部系统回调，优先检查外部分派状态、回调地址和外部系统处理结果。';

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
      { label: '处理人', value: assigneeText, hint: assigneeSource !== EMPTY_PLACEHOLDER ? `来源：${assigneeSource}` : undefined },
      { label: '最久停留', value: longestStayText, hint: longestTask ? `task #${longestTask.task.id}` : undefined },
      { label: '外部事件', value: `${diagnostics.triggerExecutions.length} 触发器 · ${diagnostics.outboxEvents.length} 事件派发`, hint: `${failedTriggers.length + failedOutbox.length} 个失败` },
    ],
  };
}

