import { mock } from '@/mocks/utils/contract';
import { badRequest, fail, notFound } from '@/mocks/utils/handlers';
import type {
  WorkflowDefinition,
  WorkflowDefinitionHealthReport,
  WorkflowDefinitionVersion,
  WorkflowEngineActionKey,
  WorkflowEngineHealthPoint,
  WorkflowEngineIntrospection,
  WorkflowEngineOutboxEvent,
  WorkflowEngineRuntimeTask,
  WorkflowExecutionToken,
  WorkflowExecutionTokenView,
  WorkflowFlowData,
  WorkflowFormField,
  WorkflowHandoverResult,
  WorkflowInstance,
  WorkflowInstanceFormSnapshot,
  WorkflowInstanceListItem,
  WorkflowInstanceTrace,
  WorkflowJob,
  WorkflowJobDetail,
  WorkflowJobFailureCluster,
  WorkflowJobFailureClusterMember,
  WorkflowJobStatus,
  WorkflowJobSummaryItem,
  WorkflowJobType,
  WorkflowPendingInstanceItem,
  WorkflowRuntimeDiagnostics,
  WorkflowRuntimeIssue,
  WorkflowRuntimeOutboxEvent,
  WorkflowSerialNoConfig,
  WorkflowSimulationCase,
  WorkflowSimulationDecision,
  WorkflowSimulationResult,
  WorkflowTask,
  WorkflowTaskUrge,
} from '@zenith/shared/workflow';
import {
  buildWorkflowSummaryItems,
  collectReferencedFormFieldKeys,
  findNextApproverSelectNodes,
  renderWorkflowSerialNo,
  resolveNodeFieldPermissions,
  resolveSerialPeriodKey,
  sanitizeFormUpdatesByNodePerms,
  WORKFLOW_SERIAL_SAMPLE_VARS,
  workflowDefinitionContract,
  workflowEngineContract,
  workflowInstanceContract,
  workflowInstanceOpsContract,
  workflowSimulationCaseContract,
  workflowTaskContract,
} from '@zenith/shared/workflow';
import {
  mockWorkflowDefinitions,
  mockWorkflowInstances,
  mockWorkflowTasks,
  mockWorkflowDefinitionVersions,
  getNextInstanceId,
  getNextTaskId,
  getNextDefinitionId,
  getNextDefinitionVersionId,
} from '@/mocks/data/workflow';
import { mockWorkflowForms } from '@/mocks/data/workflow-forms';
import { mockUsers } from '@/mocks/data/users';
import { mockWorkflowJobs, mockWorkflowJobExecutions } from '@/mocks/data/workflow-jobs';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';
import { removeWhere } from '@/mocks/utils/array';
import dayjs from 'dayjs';
import { DATE_TIME_FORMAT } from '@/utils/date';
import { mockWorkflowTriggerExecutions } from './workflow-trigger-executions';

/** 业务编号内存计数器（按 定义ID:周期键 自增），模拟后端的 workflow_serial_counters */
const mockSerialCounters = new Map<string, number>();

/** 审批 / 交接的幂等缓存：同一 X-Idempotency-Key 重复提交时原样回放首次结果 */
const approveIdempotencyCache = new Map<string, { data: WorkflowInstance; message: string }>();
const handoverIdempotencyCache = new Map<string, { data: WorkflowHandoverResult; message: string }>();

function idempotencyKeyOf(request: Request) {
  return request.headers.get('X-Idempotency-Key');
}

function cloneFormFields(fields: WorkflowFormField[] | null | undefined): WorkflowFormField[] | null {
  return fields ? JSON.parse(JSON.stringify(fields)) as WorkflowFormField[] : null;
}

function isBusinessFormType(formType: WorkflowDefinition['formType'] | undefined) {
  return formType === 'custom' || formType === 'external';
}

function resolveWorkflowDefinition(definition: WorkflowDefinition): WorkflowDefinition {
  const form = definition.formId != null ? mockWorkflowForms.find((item) => item.id === definition.formId) : undefined;
  return {
    ...definition,
    formName: form?.name ?? null,
    formFields: cloneFormFields(form?.schema?.fields ?? null),
    formSettings: form?.schema?.settings ?? null,
  };
}

function resolveWorkflowDefinitionVersion(version: WorkflowDefinitionVersion): WorkflowDefinitionVersion {
  const form = version.formId != null ? mockWorkflowForms.find((item) => item.id === version.formId) : undefined;
  return {
    ...version,
    formName: form?.name ?? version.formName ?? null,
    formFields: cloneFormFields(form?.schema?.fields ?? version.formFields ?? null),
  };
}

function resolveDefinitionFormFields(definition: WorkflowDefinition): WorkflowFormField[] | null {
  const form = definition.formId != null ? mockWorkflowForms.find((item) => item.id === definition.formId) : undefined;
  return cloneFormFields(form?.schema?.fields ?? null);
}

function resolveDefinitionFormSnapshot(definition: WorkflowDefinition): WorkflowInstanceFormSnapshot | null {
  if (definition.formType === 'designer') {
    const form = definition.formId != null ? mockWorkflowForms.find((item) => item.id === definition.formId) : undefined;
    if (!form) return null;
    return {
      formType: 'designer',
      formId: definition.formId ?? null,
      formName: form.name,
      fields: cloneFormFields(form.schema?.fields ?? null) ?? [],
      settings: form.schema?.settings ?? null,
      customForm: null,
    };
  }
  return {
    formType: definition.formType,
    formId: null,
    formName: null,
    fields: [],
    settings: null,
    customForm: definition.customForm,
  };
}

function buildMockSimulationResult(
  flowData: WorkflowFlowData | null | undefined,
  starterUserId?: number,
  decisions: WorkflowSimulationDecision[] = [],
): WorkflowSimulationResult {
  if (!flowData?.nodes?.length) {
    return {
      valid: false,
      warnings: ['流程未配置，无法仿真'],
      result: 'invalid',
      timeline: [],
      edgeResults: [],
      nodeStates: {},
      healthIssues: [{ level: 'error', scope: 'flow', message: '流程未配置，无法仿真', suggestion: '请先完成流程设计' }],
      pathSignature: [],
      estimatedDurationMinutes: 0,
      blockingPoints: [],
    };
  }
  const nodeStates: WorkflowSimulationResult['nodeStates'] = {};
  const visited = new Set<string>();
  const timeline: WorkflowSimulationResult['timeline'] = [];
  let result: WorkflowSimulationResult['result'] = 'finished';
  const starterName = starterUserId ? `用户${starterUserId}` : '当前用户';
  const sortedNodes = flowData.nodes.filter((node) => node.data.type !== 'end');
  for (const [index, node] of sortedNodes.entries()) {
    const key = node.data.key;
    visited.add(key);
    if (node.data.type === 'start') {
      timeline.push({
        step: timeline.length + 1,
        nodeKey: key,
        nodeName: node.data.label || '发起',
        nodeType: node.data.type,
        status: 'entered',
        assignees: [{ id: starterUserId ?? 1, name: starterName }],
        reason: 'Demo 仿真开始',
        nextNodeKeys: sortedNodes[index + 1]?.data.key ? [sortedNodes[index + 1].data.key] : undefined,
      });
      nodeStates[key] = { status: 'done' };
      continue;
    }
    const assigneeIds = node.data.assigneeIds ?? (node.data.assigneeId ? [node.data.assigneeId] : []);
    const assignees = assigneeIds.map((id) => ({ id, name: node.data.assigneeNames?.[0] ?? node.data.assigneeName ?? `用户${id}` }));
    const waiting = node.data.type === 'delay' || node.data.type === 'trigger' || node.data.type === 'subProcess';
    const decision = decisions.find((item) => item.nodeKey === key);
    if (decision?.action === 'reject') {
      timeline.push({
        step: timeline.length + 1,
        nodeKey: key,
        nodeName: node.data.label || key,
        nodeType: node.data.type,
        status: 'rejected',
        assignees,
        decision: 'reject',
        reason: decision.reason ?? 'Demo 调试器手动拒绝',
        detail: 'Demo 模式按预设动作终止',
      });
      nodeStates[key] = { status: 'error', message: 'Demo 调试器手动拒绝' };
      result = 'rejected';
      break;
    }
    if (decision?.action === 'wait') {
      timeline.push({
        step: timeline.length + 1,
        nodeKey: key,
        nodeName: node.data.label || key,
        nodeType: node.data.type,
        status: 'waiting',
        assignees,
        decision: 'wait',
        reason: decision.reason ?? 'Demo 调试器暂停等待',
        detail: 'Demo 模式按预设动作停在当前节点',
      });
      nodeStates[key] = { status: 'active', message: 'Demo 调试器暂停等待' };
      result = 'waiting';
      break;
    }
    timeline.push({
      step: timeline.length + 1,
      nodeKey: key,
      nodeName: node.data.label || key,
      nodeType: node.data.type,
      status: decision?.action === 'skip' ? 'skipped' : waiting ? 'waiting' : index === 0 ? 'entered' : 'approved',
      assignees,
      decision: decision?.action === 'skip' ? 'skip' : waiting ? undefined : 'approve',
      reason: decision?.action === 'skip' ? 'Demo 调试器手动跳过' : waiting ? 'Demo 模式模拟等待后继续' : decision?.action === 'approve' ? 'Demo 调试器手动通过' : 'Demo 模式默认通过',
      detail: decision ? 'Demo 模式按预设动作重放' : undefined,
      nextNodeKeys: sortedNodes[index + 1]?.data.key ? [sortedNodes[index + 1].data.key] : undefined,
    });
    nodeStates[key] = { status: decision?.action === 'skip' ? 'skipped' : 'done', message: waiting ? 'Demo 模式模拟继续' : undefined };
  }
  flowData.nodes
    .filter((node) => !nodeStates[node.data.key])
    .forEach((node) => { nodeStates[node.data.key] = { status: node.data.type === 'end' ? 'done' : 'skipped' }; });
  const nodeById = new Map(flowData.nodes.map((node) => [node.id, node.data]));
  // Demo 预估耗时：approve/handler≈480 分钟、delay≈120、subProcess≈480，其余瞬时
  const estMinutes = (t: string): number => (t === 'approve' || t === 'handler' ? 480 : t === 'subProcess' ? 480 : t === 'delay' ? 120 : 0);
  const blockingPoints: WorkflowSimulationResult['blockingPoints'] = [];
  let estimatedDurationMinutes = 0;
  for (const item of timeline) {
    const m = estMinutes(String(item.nodeType));
    item.estimatedMinutes = m;
    estimatedDurationMinutes += m;
    if (m > 0 || item.status === 'waiting' || item.status === 'blocked') {
      const kind = (item.nodeType === 'approve' || item.nodeType === 'handler') ? 'humanTask'
        : item.nodeType === 'delay' ? 'delay'
        : item.nodeType === 'subProcess' ? 'subProcess'
        : item.nodeType === 'trigger' ? 'external' : 'blocked';
      blockingPoints.push({ nodeKey: item.nodeKey, nodeName: item.nodeName, kind, reason: item.status === 'waiting' ? '等待人工处理' : '预计耗时节点', estimatedMinutes: m });
    }
  }
  return {
    valid: true,
    warnings: ['Demo 模式使用轻量仿真，真实环境以后端流程引擎结果为准'],
    result,
    timeline,
    edgeResults: flowData.edges.map((edge) => {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      const taken = !!source?.key && !!target?.key && visited.has(source.key) && (target.type === 'end' || visited.has(target.key));
      return {
        edgeId: edge.id,
        source: edge.source,
        target: edge.target,
        sourceKey: source?.key,
        targetKey: target?.key,
        label: edge.label ?? null,
        taken,
        reason: edge.conditions?.length || edge.condition ? (taken ? 'Demo 条件命中' : 'Demo 条件未命中') : (taken ? 'Demo 仿真路径经过此连线' : 'Demo 仿真未经过此连线'),
        conditionMatched: edge.conditions?.length || edge.condition ? taken : null,
        conditionSummary: edge.label ?? null,
        actualValue: null,
      };
    }),
    nodeStates,
    healthIssues: [],
    pathSignature: timeline.map((item) => item.nodeKey),
    estimatedDurationMinutes,
    blockingPoints,
  };
}

function ageMinutesFrom(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = dayjs(value, DATE_TIME_FORMAT, true);
  if (!parsed.isValid()) return 0;
  return Math.max(0, Math.floor(dayjs().diff(parsed, 'minute', true)));
}

function isMockDateTimeDue(value: string | null | undefined) {
  if (!value) return false;
  const parsed = dayjs(value, DATE_TIME_FORMAT, true);
  return parsed.isValid() && !parsed.isAfter(dayjs());
}

function buildMockWorkflowEngineIntrospection(thresholdMinutes: number): WorkflowEngineIntrospection {
  const timeoutAt = mockDateTimeOffset(-30 * 60 * 1000);
  const delayWakeAt = mockDateTimeOffset(-12 * 60 * 1000);
  const runningInstances = mockWorkflowInstances.filter((item) => item.status === 'running');
  const activeTasks = mockWorkflowTasks.filter((item) => item.status === 'pending' || item.status === 'waiting');
  const activeInstanceIds = new Set(activeTasks.map((item) => item.instanceId));
  const runningWithoutActiveTasks = runningInstances
    .filter((item) => !activeInstanceIds.has(item.id))
    .map((item) => ({
      instanceId: item.id,
      title: item.title,
      serialNo: item.serialNo ?? null,
      definitionId: item.definitionId,
      definitionName: item.definitionName ?? null,
      currentNodeKey: item.currentNodeKey ?? null,
      ageMinutes: ageMinutesFrom(item.createdAt),
      createdAt: item.createdAt,
    }));

  const toEngineTask = (task: WorkflowTask, queue: WorkflowEngineRuntimeTask['queue']): WorkflowEngineRuntimeTask | null => {
    const instance = mockWorkflowInstances.find((item) => item.id === task.instanceId);
    if (!instance) return null;
    return {
      queue,
      taskId: task.id,
      instanceId: instance.id,
      instanceTitle: instance.title,
      serialNo: instance.serialNo ?? null,
      definitionId: instance.definitionId,
      definitionName: instance.definitionName ?? '—',
      nodeKey: task.nodeKey,
      nodeName: task.nodeName,
      nodeType: task.nodeType ?? null,
      status: task.status,
      assigneeId: task.assigneeId ?? null,
      assigneeName: task.assigneeName ?? null,
      priority: instance.priority ?? 'normal',
      externalCallbackId: task.externalCallbackId ?? null,
      externalDispatchStatus: null,
      triggerDispatchStatus: null,
      triggerAttempt: 0,
      triggerNextRetryAt: null,
      triggerLastError: null,
      timeoutAt: task.id === 4 ? timeoutAt : null,
      wakeAt: null,
      ageMinutes: ageMinutesFrom(task.createdAt),
      createdAt: task.createdAt,
    };
  };

  const runtimeTasks = activeTasks
    .flatMap((task) => {
      const queues: WorkflowEngineRuntimeTask['queue'][] = [];
      if (task.status === 'pending' && task.nodeType !== 'trigger') queues.push('humanTasks');
      if (task.id === 4) queues.push('timeouts');
      return queues.map((queue) => toEngineTask(task, queue)).filter(Boolean) as WorkflowEngineRuntimeTask[];
    });

  const subProcessParent = mockWorkflowInstances.find((item) => item.id === 2);
  if (subProcessParent) {
    runtimeTasks.push({
      queue: 'subProcessJoin',
      taskId: 870010,
      instanceId: subProcessParent.id,
      instanceTitle: subProcessParent.title,
      serialNo: subProcessParent.serialNo ?? null,
      definitionId: subProcessParent.definitionId,
      definitionName: subProcessParent.definitionName ?? '—',
      nodeKey: 'subprocess_use_seal',
      nodeName: '用印子流程',
      nodeType: 'subProcess',
      status: 'waiting',
      assigneeId: null,
      assigneeName: null,
      priority: subProcessParent.priority ?? 'normal',
      externalCallbackId: null,
      externalDispatchStatus: null,
      triggerDispatchStatus: null,
      triggerAttempt: 0,
      triggerNextRetryAt: null,
      triggerLastError: null,
      timeoutAt: null,
      wakeAt: null,
      ageMinutes: ageMinutesFrom(subProcessParent.updatedAt),
      createdAt: subProcessParent.updatedAt,
    });
  }

  const delayInstance = mockWorkflowInstances.find((item) => item.id === 3);
  if (delayInstance) {
    runtimeTasks.push({
      queue: 'delayWakeups',
      taskId: 870011,
      instanceId: delayInstance.id,
      instanceTitle: delayInstance.title,
      serialNo: delayInstance.serialNo ?? null,
      definitionId: delayInstance.definitionId,
      definitionName: delayInstance.definitionName ?? '—',
      nodeKey: 'delay_review_window',
      nodeName: '审批冷却期',
      nodeType: 'delay',
      status: 'waiting',
      assigneeId: null,
      assigneeName: null,
      priority: delayInstance.priority ?? 'normal',
      externalCallbackId: null,
      externalDispatchStatus: null,
      triggerDispatchStatus: null,
      triggerAttempt: 0,
      triggerNextRetryAt: null,
      triggerLastError: null,
      timeoutAt: null,
      wakeAt: delayWakeAt,
      ageMinutes: ageMinutesFrom(delayInstance.updatedAt),
      createdAt: delayInstance.updatedAt,
    });
  }

  for (const execution of mockWorkflowTriggerExecutions.filter((item) => item.status !== 'success')) {
    const instance = mockWorkflowInstances.find((item) => item.id === execution.instanceId);
    if (!instance) continue;
    runtimeTasks.push({
      queue: 'triggerDispatch',
      taskId: execution.taskId ?? 870100 + execution.id,
      instanceId: instance.id,
      instanceTitle: instance.title,
      serialNo: instance.serialNo ?? null,
      definitionId: instance.definitionId,
      definitionName: instance.definitionName ?? '—',
      nodeKey: execution.nodeKey,
      nodeName: execution.nodeName ?? '触发器节点',
      nodeType: 'trigger',
      status: 'waiting',
      assigneeId: null,
      assigneeName: null,
      priority: instance.priority ?? 'normal',
      externalCallbackId: null,
      externalDispatchStatus: null,
      triggerDispatchStatus: execution.status,
      triggerAttempt: execution.attempt,
      triggerNextRetryAt: execution.status === 'retrying' ? mockDateTimeOffset(15 * 60 * 1000) : null,
      triggerLastError: execution.errorMessage ?? null,
      timeoutAt: null,
      wakeAt: null,
      ageMinutes: ageMinutesFrom(execution.createdAt),
      createdAt: execution.createdAt,
    });
  }

  const outboxEvents: WorkflowEngineOutboxEvent[] = [
    {
      id: 2101,
      eventId: 'mock-workflow-task-created-2',
      eventType: 'task.created',
      instanceId: 2,
      instanceTitle: mockWorkflowInstances.find((item) => item.id === 2)?.title ?? null,
      taskId: 4,
      status: 'retrying',
      attempts: 2,
      errorMessage: 'Demo：通知订阅者暂时不可用，等待 replay。',
      nextRetryAt: mockDateTimeOffset(10 * 60 * 1000),
      processedAt: null,
      ageMinutes: ageMinutesFrom(mockDateTimeOffset(-25 * 60 * 1000)),
      createdAt: mockDateTimeOffset(-25 * 60 * 1000),
    },
    {
      id: 2102,
      eventId: 'mock-workflow-trigger-failed-2',
      eventType: 'trigger.failed',
      instanceId: 2,
      instanceTitle: mockWorkflowInstances.find((item) => item.id === 2)?.title ?? null,
      taskId: 3,
      status: 'failed',
      attempts: 5,
      errorMessage: 'Demo：触发器回调连续超时。',
      nextRetryAt: null,
      processedAt: null,
      ageMinutes: ageMinutesFrom(mockDateTimeOffset(-40 * 60 * 1000)),
      createdAt: mockDateTimeOffset(-40 * 60 * 1000),
    },
  ];

  const nodeTypeCounts: Record<string, number> = {};
  let edgeCount = 0;
  const invalidDefinitions = mockWorkflowDefinitions
    .flatMap((definition) => {
      const flowData = definition.flowData;
      if (flowData?.nodes) {
        for (const node of flowData.nodes) {
          const type = node.data?.type ?? node.type;
          nodeTypeCounts[type] = (nodeTypeCounts[type] ?? 0) + 1;
        }
        edgeCount += flowData.edges?.length ?? 0;
      }
      if (flowData?.nodes?.length && flowData?.edges?.length) return [];
      return [{
        definitionId: definition.id,
        name: definition.name,
        status: definition.status,
        version: definition.version,
        errors: ['流程图缺少节点或连线。'],
      }];
    });

  const definitions = {
    total: mockWorkflowDefinitions.length,
    published: mockWorkflowDefinitions.filter((item) => item.status === 'published').length,
    invalid: invalidDefinitions.length,
    invalidPublished: invalidDefinitions.filter((item) => item.status === 'published').length,
    nodeTypeCounts,
    edgeCount,
    invalidDefinitions,
  };

  const triggerExecutions = mockWorkflowTriggerExecutions
    .filter((item) => item.status !== 'success')
    .map((item) => ({
      ...item,
      instanceTitle: mockWorkflowInstances.find((inst) => inst.id === item.instanceId)?.title ?? null,
    }));

  const issues: WorkflowEngineIntrospection['issues'] = [];
  for (const item of invalidDefinitions.filter((definition) => definition.status === 'published')) {
    issues.push({
      id: `definition:${item.definitionId}`,
      severity: 'critical',
      component: 'dagExecutor',
      title: '已发布流程定义未通过当前引擎校验',
      description: item.errors[0] ?? '流程图结构不合法。',
      refType: 'definition',
      refId: item.definitionId,
      metadata: { errors: item.errors, version: item.version },
    });
  }
  for (const item of runningWithoutActiveTasks) {
    issues.push({
      id: `instance:${item.instanceId}:no-active-task`,
      severity: 'critical',
      component: 'taskMaterializer',
      title: '运行中实例没有活动任务',
      description: `实例「${item.title}」没有 pending / waiting 任务，可能需要恢复扫描介入。`,
      refType: 'instance',
      refId: item.instanceId,
      ageMinutes: item.ageMinutes,
      createdAt: item.createdAt,
    });
  }
  for (const task of runtimeTasks.filter((item) => item.queue === 'timeouts')) {
    issues.push({
      id: `task:${task.taskId}:timeout-due`,
      severity: 'warning',
      component: 'timeoutProcessor',
      title: '任务超时待处理',
      description: `任务 #${task.taskId} 已到 timeoutAt，等待超时处理器扫描。`,
      refType: 'task',
      refId: task.taskId,
      ageMinutes: task.ageMinutes,
      createdAt: task.createdAt,
    });
  }
  for (const execution of triggerExecutions.filter((item) => item.status === 'failed')) {
    issues.push({
      id: `trigger-execution:${execution.id}`,
      severity: 'critical',
      component: 'triggerDispatcher',
      title: '触发器执行记录失败',
      description: execution.errorMessage ?? `触发器执行 #${execution.id} 失败。`,
      refType: 'triggerExecution',
      refId: execution.id,
      createdAt: execution.createdAt,
    });
  }
  for (const event of outboxEvents.filter((item) => item.status === 'failed')) {
    issues.push({
      id: `outbox:${event.id}`,
      severity: 'critical',
      component: 'outbox',
      title: '事件派发重放失败',
      description: event.errorMessage ?? `事件 ${event.eventType} 重放失败。`,
      refType: 'outbox',
      refId: event.id,
      ageMinutes: event.ageMinutes,
      createdAt: event.createdAt,
    });
  }

  const worstStatus = (statuses: Array<WorkflowEngineIntrospection['components'][number]['status']>) => {
    if (statuses.includes('critical')) return 'critical';
    if (statuses.includes('warning')) return 'warning';
    return 'healthy';
  };
  const queueSnapshot = (
    key: WorkflowEngineRuntimeTask['queue'] | 'eventOutbox',
    name: string,
    counts: { ready?: number; running?: number; delayed?: number; failed?: number; oldestAgeMinutes?: number | null; details?: Record<string, number | string | null> },
  ): WorkflowEngineIntrospection['queues'][number] => {
    const failed = counts.failed ?? 0;
    const oldestAgeMinutes = counts.oldestAgeMinutes ?? null;
    return {
      key,
      name,
      status: failed > 0 ? 'critical' : oldestAgeMinutes != null && oldestAgeMinutes >= 60 ? 'warning' : 'healthy',
      ready: counts.ready ?? 0,
      running: counts.running ?? 0,
      delayed: counts.delayed ?? 0,
      failed,
      oldestAgeMinutes,
      details: counts.details ?? null,
    };
  };

  const byQueue = (queue: WorkflowEngineRuntimeTask['queue']) => runtimeTasks.filter((item) => item.queue === queue);
  const queues = [
    queueSnapshot('humanTasks', '人工任务队列', {
      ready: byQueue('humanTasks').length,
      oldestAgeMinutes: byQueue('humanTasks').length ? Math.max(...byQueue('humanTasks').map((item) => item.ageMinutes)) : null,
      details: { dueSoon: byQueue('humanTasks').filter((item) => item.timeoutAt).length },
    }),
    queueSnapshot('delayWakeups', '延时唤醒队列', {
      ready: byQueue('delayWakeups').filter((item) => isMockDateTimeDue(item.wakeAt)).length,
      delayed: byQueue('delayWakeups').filter((item) => item.wakeAt && !isMockDateTimeDue(item.wakeAt)).length,
      oldestAgeMinutes: byQueue('delayWakeups').length ? Math.max(...byQueue('delayWakeups').map((item) => item.ageMinutes)) : null,
    }),
    queueSnapshot('timeouts', '超时处理队列', {
      ready: byQueue('timeouts').length,
      oldestAgeMinutes: byQueue('timeouts').length ? Math.max(...byQueue('timeouts').map((item) => item.ageMinutes)) : null,
    }),
    queueSnapshot('triggerDispatch', '触发器调度队列', {
      ready: byQueue('triggerDispatch').filter((item) => item.triggerDispatchStatus === 'pending').length,
      delayed: byQueue('triggerDispatch').filter((item) => item.triggerDispatchStatus === 'retrying').length,
      failed: byQueue('triggerDispatch').filter((item) => item.triggerDispatchStatus === 'failed').length,
      oldestAgeMinutes: byQueue('triggerDispatch').length ? Math.max(...byQueue('triggerDispatch').map((item) => item.ageMinutes)) : null,
    }),
    queueSnapshot('externalApprovals', '外部审批分派队列', { ready: 0, oldestAgeMinutes: null }),
    queueSnapshot('subProcessJoin', '子流程汇聚队列', {
      ready: byQueue('subProcessJoin').length,
      oldestAgeMinutes: byQueue('subProcessJoin').length ? Math.max(...byQueue('subProcessJoin').map((item) => item.ageMinutes)) : null,
    }),
    queueSnapshot('eventOutbox', '工作流事件派发', {
      ready: outboxEvents.filter((item) => item.status === 'pending').length,
      delayed: outboxEvents.filter((item) => item.status === 'retrying' || item.status === 'processing').length,
      failed: outboxEvents.filter((item) => item.status === 'failed').length,
      oldestAgeMinutes: outboxEvents.length ? Math.max(...outboxEvents.map((item) => item.ageMinutes)) : null,
    }),
  ];
  const queueStatus = (key: WorkflowEngineIntrospection['queues'][number]['key']) => queues.find((item) => item.key === key)?.status ?? 'healthy';
  const issueStatus = (component: WorkflowEngineIntrospection['components'][number]['key']) => worstStatus(issues.filter((issue) => issue.component === component).map((issue) => issue.severity === 'info' ? 'healthy' : issue.severity));
  const components: WorkflowEngineIntrospection['components'] = [
    {
      key: 'dagExecutor',
      name: 'DAG 执行器',
      description: '流程图遍历、网关分支和节点推进规则。',
      status: definitions.invalidPublished > 0 ? 'critical' : definitions.invalid > 0 ? 'warning' : 'healthy',
      metrics: [
        { label: '定义总数', value: definitions.total },
        { label: '已发布', value: definitions.published },
        { label: '校验失败', value: definitions.invalid, status: definitions.invalidPublished > 0 ? 'critical' : definitions.invalid > 0 ? 'warning' : 'healthy' },
        { label: '节点数', value: Object.values(definitions.nodeTypeCounts).reduce((sum, value) => sum + value, 0) },
        { label: '连线数', value: definitions.edgeCount },
      ],
      internals: { nodeTypeCounts: definitions.nodeTypeCounts },
    },
    {
      key: 'taskMaterializer',
      name: '任务物化器',
      description: '将引擎输出的 TaskAction 展开成任务行。',
      status: issueStatus('taskMaterializer'),
      metrics: [
        { label: '运行实例', value: runningInstances.length },
        { label: '无活动任务实例', value: runningWithoutActiveTasks.length, status: runningWithoutActiveTasks.length > 0 ? 'critical' : 'healthy' },
        { label: '活动任务', value: activeTasks.length },
      ],
    },
    {
      key: 'delayScheduler',
      name: '延时调度器',
      description: 'delay 节点唤醒队列与兜底恢复扫描。',
      status: queueStatus('delayWakeups'),
      metrics: [
        { label: '等待唤醒', value: byQueue('delayWakeups').length },
        { label: '已到期', value: queues.find((item) => item.key === 'delayWakeups')?.ready ?? 0, status: queueStatus('delayWakeups') },
        { label: '队列 worker', value: '已注册', status: 'healthy' },
      ],
    },
    {
      key: 'timeoutProcessor',
      name: '超时处理器',
      description: '处理 timeoutAt 到期的审批任务。',
      status: worstStatus([queueStatus('timeouts'), issueStatus('timeoutProcessor')]),
      metrics: [
        { label: '待处理超时', value: byQueue('timeouts').length, status: byQueue('timeouts').length > 0 ? 'warning' : 'healthy' },
        { label: '作业处理器', value: '已注册', status: 'healthy' },
      ],
    },
    {
      key: 'triggerDispatcher',
      name: '触发器调度器',
      description: '执行 webhook/callback/updateData/deleteData 副作用。',
      status: worstStatus([queueStatus('triggerDispatch'), issueStatus('triggerDispatcher')]),
      metrics: [
        { label: '任务数', value: byQueue('triggerDispatch').length },
        { label: '重试中', value: byQueue('triggerDispatch').filter((item) => item.triggerDispatchStatus === 'retrying').length },
        { label: '失败', value: byQueue('triggerDispatch').filter((item) => item.triggerDispatchStatus === 'failed').length, status: queueStatus('triggerDispatch') },
      ],
    },
    {
      key: 'externalApprover',
      name: '外部审批分派',
      description: '外部审批任务分派与公开回调确认。',
      status: 'healthy',
      metrics: [
        { label: '等待外部回调', value: 0 },
        { label: '分派失败', value: 0, status: 'healthy' },
      ],
    },
    {
      key: 'subProcessRecovery',
      name: '子流程恢复器',
      description: '子流程 spawn / resume / 多实例汇聚恢复。',
      status: queueStatus('subProcessJoin'),
      metrics: [
        { label: '等待汇聚', value: byQueue('subProcessJoin').length },
        { label: '作业处理器', value: '已注册', status: 'healthy' },
      ],
    },
    {
      key: 'eventBus',
      name: '事件总线',
      description: '进程内工作流事件派发器。',
      status: 'healthy',
      metrics: [
        { label: '监听器总数', value: 7, status: 'healthy' },
        { label: '事件类型', value: 5 },
      ],
      internals: {
        listeners: [
          { eventType: '__any__', listenerCount: 1 },
          { eventType: 'node.entered', listenerCount: 2 },
          { eventType: 'task.created', listenerCount: 2 },
          { eventType: 'instance.approved', listenerCount: 1 },
          { eventType: 'task.rejected', listenerCount: 1 },
        ],
      },
    },
    {
      key: 'outbox',
      name: '事件派发',
      description: '持久化工作流事件并兜底重放。',
      status: worstStatus([queueStatus('eventOutbox'), issueStatus('outbox')]),
      metrics: [
        { label: 'pending', value: 0 },
        { label: 'retrying', value: outboxEvents.filter((item) => item.status === 'retrying').length },
        { label: 'failed', value: outboxEvents.filter((item) => item.status === 'failed').length, status: outboxEvents.some((item) => item.status === 'failed') ? 'critical' : 'healthy' },
      ],
    },
    {
      key: 'scheduler',
      name: 'pg-boss 调度器',
      description: '用户 Cron、系统周期任务和工作流统一作业队列。',
      status: 'healthy',
      metrics: [
        { label: '初始化', value: '是', status: 'healthy' },
        { label: '运行中 Job', value: 1 },
        { label: '系统周期任务', value: 3 },
        { label: '系统队列 Worker', value: 1 },
      ],
      internals: { wip: [{ name: 'workflow-jobs', count: 1 }] },
    },
  ];

  const telemetryPendingRetry = outboxEvents.filter((item) => item.status === 'pending' || item.status === 'processing' || item.status === 'retrying').length;
  const telemetryHealthScore = (() => {
    let score = 100;
    for (const issue of issues) {
      if (issue.severity === 'critical') score -= 12;
      else if (issue.severity === 'warning') score -= 4;
    }
    for (const q of queues) {
      if (q.failed > 0) score -= 5;
      if (q.oldestAgeMinutes != null && q.oldestAgeMinutes >= 60) score -= 3;
    }
    return Math.max(0, Math.min(100, Math.round(score)));
  })();
  const triggerSuccess = mockWorkflowTriggerExecutions.filter((item) => item.status === 'success');
  const eventSeries24h = Array.from({ length: 24 }, (_, i) => {
    const hour = dayjs().startOf('hour').subtract(23 - i, 'hour');
    const total = 8 + Math.round(10 * Math.abs(Math.sin((i + 2) / 3)));
    const failed = i % 7 === 0 ? 1 : 0;
    const success = Math.max(0, total - failed);
    return { hour: hour.format(DATE_TIME_FORMAT), total: success + failed, success, failed };
  });
  const instanceSeries24h = Array.from({ length: 24 }, (_, i) => {
    const hour = dayjs().startOf('hour').subtract(23 - i, 'hour');
    return { hour: hour.format(DATE_TIME_FORMAT), created: i % 3 === 0 ? 1 : 0, completed: i % 4 === 0 ? 1 : 0 };
  });
  const scoreBreakdown = (() => {
    const out: Array<{ reason: string; delta: number; severity: 'warning' | 'critical' }> = [];
    const crit = issues.filter((x) => x.severity === 'critical').length;
    const warn = issues.filter((x) => x.severity === 'warning').length;
    const failedQ = queues.filter((q) => q.failed > 0).length;
    const staleQ = queues.filter((q) => q.oldestAgeMinutes != null && q.oldestAgeMinutes >= 60).length;
    if (crit > 0) out.push({ reason: `严重问题 ×${crit}`, delta: crit * 12, severity: 'critical' });
    if (warn > 0) out.push({ reason: `警告问题 ×${warn}`, delta: warn * 4, severity: 'warning' });
    if (failedQ > 0) out.push({ reason: `队列存在失败任务 ×${failedQ}`, delta: failedQ * 5, severity: 'critical' });
    if (staleQ > 0) out.push({ reason: `队列积压≥60 分钟 ×${staleQ}`, delta: staleQ * 3, severity: 'warning' });
    return out;
  })();
  const latencyHistogram = [
    { label: '<50ms', min: 0, max: 50, count: 142 },
    { label: '50-100ms', min: 50, max: 100, count: 168 },
    { label: '100-250ms', min: 100, max: 250, count: 64 },
    { label: '250-500ms', min: 250, max: 500, count: 21 },
    { label: '500ms-1s', min: 500, max: 1000, count: 7 },
    { label: '1-5s', min: 1000, max: 5000, count: 3 },
    { label: '≥5s', min: 5000, max: null, count: 0 },
  ];
  const durationHistogram = [
    { label: '<50ms', min: 0, max: 50, count: 3 },
    { label: '50-100ms', min: 50, max: 100, count: 8 },
    { label: '100-250ms', min: 100, max: 250, count: 11 },
    { label: '250-500ms', min: 250, max: 500, count: 5 },
    { label: '500ms-1s', min: 500, max: 1000, count: 2 },
    { label: '1-5s', min: 1000, max: 5000, count: 1 },
    { label: '≥5s', min: 5000, max: null, count: 0 },
  ];
  const telemetry: WorkflowEngineIntrospection['telemetry'] = {
    healthScore: telemetryHealthScore,
    scoreBreakdown,
    apdex: { score: 0.93, thresholdMs: 100, satisfied: 310, tolerating: 92, frustrated: 3, total: 405 },
    events: {
      last1h: { total: 18, success: 17, failed: 1 },
      last24h: { total: 412, success: 405, failed: 4 },
      prev24h: { total: 388, success: 384, failed: 4 },
      pendingRetry: telemetryPendingRetry,
      avgLatencyMs: 38,
      p95LatencyMs: 96,
      p99LatencyMs: 184,
      latencyHistogram,
      series24h: eventSeries24h,
    },
    triggers: {
      last24h: {
        total: mockWorkflowTriggerExecutions.length,
        success: triggerSuccess.length,
        failed: mockWorkflowTriggerExecutions.filter((item) => item.status === 'failed').length,
        retrying: mockWorkflowTriggerExecutions.filter((item) => item.status === 'retrying').length,
      },
      prev24h: {
        total: Math.max(0, mockWorkflowTriggerExecutions.length - 1),
        success: triggerSuccess.length,
        failed: 0,
        retrying: 0,
      },
      avgDurationMs: triggerSuccess.length
        ? Math.round(triggerSuccess.reduce((sum, item) => sum + (item.durationMs ?? 0), 0) / triggerSuccess.length)
        : null,
      p95DurationMs: triggerSuccess.length
        ? Math.max(...triggerSuccess.map((item) => item.durationMs ?? 0))
        : null,
      p99DurationMs: triggerSuccess.length
        ? Math.max(...triggerSuccess.map((item) => item.durationMs ?? 0))
        : null,
      durationHistogram,
    },
    instances: {
      running: runningInstances.length,
      createdLast24h: 9,
      completedLast24h: 6,
      canceledLast24h: 1,
      createdPrev24h: 7,
      completedPrev24h: 8,
      series24h: instanceSeries24h,
    },
    recurringJobs: [
      { name: 'workflow-schedule-tick', cronExpression: '* * * * *', registeredAt: mockDateTimeOffset(-2 * 60 * 60 * 1000), nextRunAt: mockDateTimeOffset(60 * 1000) },
      { name: 'workflow-jobs-drain', cronExpression: '* * * * *', registeredAt: mockDateTimeOffset(-2 * 60 * 60 * 1000), nextRunAt: mockDateTimeOffset(60 * 1000) },
      { name: 'workflow-engine-health-capture', cronExpression: '*/5 * * * *', registeredAt: mockDateTimeOffset(-2 * 60 * 60 * 1000), nextRunAt: mockDateTimeOffset(3 * 60 * 1000) },
    ],
  };
  const systemSchedulerTaskBase = {
    registeredNodeId: 'dev-host:3001',
    registeredHostname: 'dev-host',
    registeredPid: 3001,
    enabled: true,
    logRetentionDays: 30,
    logRetentionRuns: 1000,
    timeoutMs: null,
    failureAlertThreshold: 1,
    alertEnabled: true,
    alertChannels: [] as [],
    alertUserIds: [] as number[],
    alertEmails: [] as string[],
    alertWebhookUrl: null as string | null,
    manualSingleton: true,
  };

  return {
    healthy: !issues.some((item) => item.severity === 'critical'),
    generatedAt: mockDateTime(),
    thresholdMinutes,
    thresholds: { healthWarn: 90, healthCritical: 70, backlogWarn: 50, backlogCritical: 200, errorRateWarn: 0.05, errorRateCritical: 0.15 },
    telemetry,
    components,
    queues,
    definitions,
    eventBus: {
      totalListenerCount: 7,
      listeners: [
        { eventType: '__any__', listenerCount: 1 },
        { eventType: 'node.entered', listenerCount: 2 },
        { eventType: 'task.created', listenerCount: 2 },
        { eventType: 'instance.approved', listenerCount: 1 },
        { eventType: 'task.rejected', listenerCount: 1 },
      ],
    },
    scheduler: {
      initialized: true,
      runningJobCount: 1,
      node: { id: 'dev-host:3001', hostname: 'dev-host', pid: 3001 },
      registeredHandlers: ['workflow-schedule-tick', 'workflow-jobs-drain', 'workflow-engine-health-capture', 'workflow-jobs'],
      systemRecurringJobs: [
        {
          ...systemSchedulerTaskBase,
          name: 'workflow-schedule-tick',
          title: '工作流定时发起扫描',
          module: '工作流',
          description: '每分钟扫描到期的工作流定时发起规则，并推进下一次执行时间。',
          taskType: 'recurring',
          cronExpression: '* * * * *',
          registeredAt: mockDateTimeOffset(-2 * 60 * 60 * 1000),
          allowManualRun: true,
          lastRunAt: mockDateTimeOffset(-60 * 1000),
          lastRunStatus: 'success',
          lastRunMessage: '工作流定时发起扫描完成',
          lastDurationMs: 21,
        },
        {
          ...systemSchedulerTaskBase,
          name: 'workflow-jobs-drain',
          title: '工作流作业兜底扫描',
          module: '工作流',
          description: '每分钟兜底领取到期的工作流作业并回收卡死的运行中作业。',
          taskType: 'recurring',
          cronExpression: '* * * * *',
          registeredAt: mockDateTimeOffset(-2 * 60 * 60 * 1000),
          allowManualRun: true,
          lastRunAt: mockDateTimeOffset(-60 * 1000),
          lastRunStatus: 'success',
          lastRunMessage: '工作流作业兜底：恢复卡死 0，处理到期 4',
          lastDurationMs: 38,
        },
        {
          ...systemSchedulerTaskBase,
          name: 'workflow-engine-health-capture',
          title: '流程引擎健康采集',
          module: '工作流',
          description: '每 5 分钟采集平台级流程引擎健康快照，驱动健康趋势图与引擎健康告警指标。',
          taskType: 'recurring',
          cronExpression: '*/5 * * * *',
          registeredAt: mockDateTimeOffset(-2 * 60 * 60 * 1000),
          allowManualRun: true,
          lastRunAt: mockDateTimeOffset(-5 * 60 * 1000),
          lastRunStatus: 'success',
          lastRunMessage: '流程引擎健康快照已采集',
          lastDurationMs: 107,
        },
      ],
      systemQueueWorkers: [
        {
          ...systemSchedulerTaskBase,
          manualSingleton: false,
          name: 'workflow-jobs',
          title: '工作流作业 Worker',
          module: '工作流',
          description: '消费工作流统一作业队列，处理延时唤醒、超时、触发器、子流程和事件派发。',
          taskType: 'queue',
          cronExpression: null,
          registeredAt: mockDateTimeOffset(-2 * 60 * 60 * 1000),
          allowManualRun: false,
          lastRunAt: mockDateTimeOffset(-15 * 60 * 1000),
          lastRunStatus: 'success',
          lastRunMessage: '工作流作业执行完成',
          lastDurationMs: 62,
        },
      ],
      wip: [{ name: 'workflow-jobs', count: 1 }],
    },
    runtime: {
      runningInstances: runningInstances.length,
      activeTokens: runtimeTasks.filter((t) => t.status === 'pending' || t.status === 'waiting').length,
      runningWithoutActiveTasks,
      taskQueue: runtimeTasks,
      triggerExecutions,
      outboxEvents,
    },
    issues,
  };
}

function withDefinitionSnapshot(instance: WorkflowInstance): WorkflowInstance {
  const def = mockWorkflowDefinitions.find((item) => item.id === instance.definitionId);
  if (!def) return instance;
  const formSnapshot = instance.formSnapshot ?? resolveDefinitionFormSnapshot(def);
  return {
    ...instance,
    formSnapshot,
    definitionSnapshot: {
      id: def.id,
      name: def.name,
      description: def.description,
      categoryId: def.categoryId,
      categoryName: def.categoryName ?? null,
      categoryColor: def.categoryColor ?? null,
      categoryIcon: def.categoryIcon ?? null,
      flowData: def.flowData,
      formId: def.formId,
      formName: resolveWorkflowDefinition(def).formName ?? null,
      formFields: resolveWorkflowDefinition(def).formFields ?? null,
      formSettings: resolveWorkflowDefinition(def).formSettings ?? null,
      formType: def.formType,
      customForm: def.customForm,
      status: def.status,
      version: def.version,
      tenantId: def.tenantId,
    },
  };
}

/** 从流程定义解析实例当前节点名称 */
function resolveCurrentNodeName(inst: WorkflowInstance): string | null {
  if (!inst.currentNodeKey) return null;
  const def = mockWorkflowDefinitions.find((d) => d.id === inst.definitionId);
  return def?.flowData?.nodes.find((n) => n.data.key === inst.currentNodeKey)?.data.label ?? null;
}

function resolveActiveNodeKeys(instanceId: number, fallbackKey: string | null | undefined): string[] {
  const keys = [...new Set(mockWorkflowTasks
    .filter((task) => task.instanceId === instanceId && (task.status === 'pending' || task.status === 'waiting'))
    .map((task) => task.nodeKey))];
  return keys.length > 0 ? keys : (fallbackKey ? [fallbackKey] : []);
}

function withActiveNodes<T extends WorkflowInstance>(inst: T): T {
  const currentNodeKeys = resolveActiveNodeKeys(inst.id, inst.currentNodeKey);
  const def = mockWorkflowDefinitions.find((d) => d.id === inst.definitionId);
  const currentNodeNames = currentNodeKeys
    .map((key) => def?.flowData?.nodes.find((n) => n.data.key === key)?.data.label ?? null)
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
  const settings = (def?.flowData?.settings ?? {}) as { allowWithdraw?: boolean; allowResubmit?: boolean; allowComment?: boolean };
  return {
    ...inst,
    currentNodeKeys,
    currentNodeNames,
    currentNodeName: currentNodeNames[0] ?? resolveCurrentNodeName(inst),
    allowWithdraw: settings.allowWithdraw !== false,
    allowResubmit: settings.allowResubmit !== false,
    allowComment: settings.allowComment !== false,
  };
}

/** Demo：从 pending/waiting 任务派生执行 Token（frontier 与运行态 1:1，stable id） */
function mockExecutionTokens(instanceId: number): WorkflowExecutionToken[] {
  const inst = mockWorkflowInstances.find((i) => i.id === instanceId);
  const def = inst ? mockWorkflowDefinitions.find((d) => d.id === inst.definitionId) : undefined;
  const nameOf = (key: string) => def?.flowData?.nodes.find((n) => n.data.key === key)?.data.label ?? null;
  const tokens: WorkflowExecutionToken[] = [];
  const seen = new Set<string>();
  for (const t of mockWorkflowTasks.filter((task) => task.instanceId === instanceId && (task.status === 'pending' || task.status === 'waiting'))) {
    if (seen.has(t.nodeKey)) continue;
    seen.add(t.nodeKey);
    tokens.push({
      id: 900000 + t.id, nodeKey: t.nodeKey, nodeName: nameOf(t.nodeKey), status: 'active',
      parkedAtJoin: false, branchPath: [], depth: 0, parentTokenId: null, scopeKey: null,
      createdAt: t.createdAt ?? mockDateTime(), consumedAt: null,
    });
  }
  return tokens;
}

function mockTokenView(instanceId: number): WorkflowExecutionTokenView {
  const tokens = mockExecutionTokens(instanceId);
  return {
    instanceId,
    activeCount: tokens.filter((t) => t.status === 'active' && !t.parkedAtJoin).length,
    parkedCount: tokens.filter((t) => t.parkedAtJoin).length,
    consumedCount: 0,
    deadCount: 0,
    tokens,
    generatedAt: mockDateTime(),
  };
}

// 催办流水（内存）
const mockWorkflowUrges: WorkflowTaskUrge[] = [];
let urgeIdSeq = 1;
const URGE_MIN_INTERVAL_MS = 5 * 60 * 1000;

// 仿真用例内存态（演示用，按定义归档）
const mockSimulationCases: WorkflowSimulationCase[] = [];
let simCaseSeq = 1;

// ─── 流程定义 Handler ──────────────────────────────────────────────────────

// 引擎运维动作 → 固定作业类型 / 标签（与后端 workflow-engine-ops.service 对齐）
const ENGINE_ACTION_JOB_TYPES: Record<WorkflowEngineActionKey, WorkflowJobType[]> = {
  'replay-outbox': ['event_dispatch'],
  'recover-delays': ['delay_wake'],
  'recover-subprocess': ['subprocess_spawn', 'subprocess_join'],
  'process-timeouts': ['task_timeout'],
  'recover-triggers': ['trigger_dispatch'],
  'recover-webhooks': ['webhook_delivery'],
};
const ENGINE_ACTION_LABELS: Record<WorkflowEngineActionKey, string> = {
  'replay-outbox': '事件派发重放（作业账本）',
  'recover-delays': '延时任务兜底（作业账本）',
  'recover-subprocess': '子流程兜底（作业账本）',
  'process-timeouts': '超时任务兜底（作业账本）',
  'recover-triggers': '触发器兜底（作业账本）',
  'recover-webhooks': 'Webhook 投递兜底（作业账本）',
};

/** 引擎运维动作可处理作业筛选（与后端 drain 语义一致：到期 pending + 卡死 running）。 */
function engineDrainableCandidates(action: WorkflowEngineActionKey, body: { instanceId?: number; olderThanMinutes?: number }) {
  const jobTypes = ENGINE_ACTION_JOB_TYPES[action];
  const now = Date.now();
  const base = mockWorkflowJobs.filter((j) =>
    jobTypes.includes(j.jobType)
    && (body.instanceId == null || j.instanceId === body.instanceId)
    && (body.olderThanMinutes == null || body.olderThanMinutes <= 0 || (now - new Date(j.createdAt).getTime()) >= body.olderThanMinutes * 60000));
  const due = base.filter((j) => j.status === 'pending' && new Date(j.runAt).getTime() <= now);
  const later = base.filter((j) => j.status === 'pending' && new Date(j.runAt).getTime() > now);
  const stuck = base.filter((j) => j.status === 'running');
  return { jobTypes, due, later, stuck, targets: [...due, ...stuck] };
}

/** 列表视图项：去掉详情专属的大字段（表单数据 / 快照 / 任务 / 评论 / 协办） */
function toInstanceListItem(inst: WorkflowInstance): WorkflowInstanceListItem {
  const { formData: _formData, formSnapshot: _formSnapshot, definitionSnapshot: _definitionSnapshot, tasks: _tasks, comments: _comments, consults: _consults, ...rest } = withActiveNodes(inst);
  return rest;
}

/** 作业链路：同 traceId 的作业按创建时间升序 + 各自执行记录 + 状态统计 */
function buildJobChain(traceId: string) {
  const jobs = mockWorkflowJobs
    .filter((j) => j.traceId === traceId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id - b.id)
    .map((j) => ({ ...j, executions: mockWorkflowJobExecutions.filter((e) => e.jobId === j.id).sort((a, b) => a.id - b.id) }));
  const countBy = (s: WorkflowJobStatus) => jobs.filter((j) => j.status === s).length;
  return {
    traceId,
    jobs,
    stats: {
      total: jobs.length,
      pending: countBy('pending'), running: countBy('running'), succeeded: countBy('succeeded'),
      failed: countBy('failed'), dead: countBy('dead'), canceled: countBy('canceled'),
      instanceIds: [...new Set(jobs.map((j) => j.instanceId).filter((v): v is number => v != null))],
    },
  };
}

/** 重试 / 重放：作业重新入队并清空锁与错误 */
function requeueJob(job: WorkflowJob) {
  job.status = 'pending';
  job.attempts = 0;
  job.lockedAt = null;
  job.lockedBy = null;
  job.lastError = null;
  job.runAt = mockDateTime();
  job.updatedAt = mockDateTime();
}

function buildMockDiagnostics(inst: WorkflowInstance): WorkflowRuntimeDiagnostics {
  const tasks = mockWorkflowTasks
    .filter(t => t.instanceId === inst.id)
    .sort((a, b) => a.id - b.id);
  const activeTasks = tasks.filter(t => t.status === 'pending' || t.status === 'waiting');
  const triggerExecutions = mockWorkflowTriggerExecutions.filter(item => item.instanceId === inst.id);
  const outboxEvents: WorkflowRuntimeOutboxEvent[] = [
    {
      id: inst.id * 10 + 1,
      eventId: `mock-node-entered-${inst.id}`,
      eventType: 'node.entered',
      taskId: activeTasks[0]?.id ?? null,
      status: 'success',
      attempts: 1,
      errorMessage: null,
      nextRetryAt: null,
      processedAt: inst.updatedAt,
      createdAt: inst.createdAt,
    },
    ...(inst.id === 2 ? [{
      id: inst.id * 10 + 2,
      eventId: `mock-trigger-retry-${inst.id}`,
      eventType: 'task.created',
      taskId: activeTasks[0]?.id ?? null,
      status: 'retrying',
      attempts: 2,
      errorMessage: 'Demo：订阅者暂时不可用，等待重试',
      nextRetryAt: mockDateTime(),
      processedAt: null,
      createdAt: inst.updatedAt,
    }] : []),
  ];
  const issues: WorkflowRuntimeIssue[] = [];
  if (inst.status === 'running' && activeTasks.length === 0) {
    issues.push({
      severity: 'critical',
      source: 'instance',
      title: '运行中实例没有活动任务',
      description: 'Demo 诊断：实例处于运行中但没有可推进任务。',
    });
  }
  for (const task of activeTasks) {
    if (task.nodeType === 'trigger' && task.status === 'waiting') {
      issues.push({
        severity: 'warning',
        source: 'trigger',
        taskId: task.id,
        nodeKey: task.nodeKey,
        title: '触发器暂无执行记录',
        description: 'Demo 诊断：等待中的触发器任务尚未发现作业执行记录。',
      });
    }
  }
  for (const event of outboxEvents) {
    if (event.status !== 'success') {
      issues.push({
        severity: 'warning',
        source: 'outbox',
        taskId: event.taskId,
        title: '事件派发待处理',
        description: `${event.eventType} 当前状态为 ${event.status}，attempts=${event.attempts}。`,
      });
    }
  }
  if (issues.length === 0) {
    issues.push({
      severity: 'info',
      source: 'instance',
      title: '未发现明显运行时异常',
      description: 'Demo 诊断：任务、触发器和事件派发均未命中异常规则。',
    });
  }
  return {
    instance: { ...withDefinitionSnapshot(withActiveNodes(inst)), tasks },
    tasks,
    activeTasks,
    triggerExecutions,
    outboxEvents,
    issues,
    tokens: mockExecutionTokens(inst.id),
    snapshot: {
      formData: inst.formData ?? null,
      formSnapshot: inst.formSnapshot ?? null,
      definitionSnapshot: withDefinitionSnapshot(inst).definitionSnapshot ?? null,
    },
    generatedAt: mockDateTime(),
  };
}

/** 实例运行轨迹 + 引擎解释（固定演示剧本：Webhook 死信阻塞 + 待审批 + 超时作业待执行） */
function buildMockTrace(id: number): WorkflowInstanceTrace {
  const t0 = mockDateTimeOffset(-1000 * 60 * 90); // 90 分钟前
  const t1 = mockDateTimeOffset(-1000 * 60 * 88);
  const t2 = mockDateTimeOffset(-1000 * 60 * 60);
  const trace: WorkflowInstanceTrace['trace'] = [
    {
      key: 'task-new-1', kind: 'task', at: t0, traceId: null,
      title: '创建审批任务：李四', status: 'approved', nodeName: '部门主管', assigneeName: '李四', comment: null,
      jobId: null, jobType: null, attempts: null, maxAttempts: null, runAt: null, nextRetryAt: null, lastError: null, executions: [],
    },
    {
      key: 'job-101', kind: 'job', at: t0, traceId: 'trace-mock-aa01',
      title: '事件派发 · node.entered', status: 'succeeded', nodeName: '部门主管', assigneeName: null, comment: null,
      jobId: 101, jobType: 'event_dispatch', attempts: 1, maxAttempts: 3, runAt: t0, nextRetryAt: null, lastError: null, executions: [],
    },
    {
      key: 'task-act-1', kind: 'task', at: t1, traceId: null,
      title: '李四 通过', status: 'approved', nodeName: '部门主管', assigneeName: '李四', comment: '同意，按流程办理',
      jobId: null, jobType: null, attempts: null, maxAttempts: null, runAt: null, nextRetryAt: null, lastError: null, executions: [],
    },
    {
      key: 'task-new-2', kind: 'task', at: t1, traceId: null,
      title: '创建审批任务：王五', status: 'pending', nodeName: '分管领导', assigneeName: '王五', comment: null,
      jobId: null, jobType: null, attempts: null, maxAttempts: null, runAt: null, nextRetryAt: null, lastError: null, executions: [],
    },
    {
      key: 'job-102', kind: 'job', at: t1, traceId: 'trace-mock-bb02',
      title: 'Webhook 投递 · instance.node_changed', status: 'dead', nodeName: '分管领导', assigneeName: null, comment: null,
      jobId: 102, jobType: 'webhook_delivery', attempts: 5, maxAttempts: 5, runAt: t2,
      nextRetryAt: null, lastError: 'POST https://erp.example.com/hooks/wf 503 Service Unavailable',
      executions: [
        { attempt: 1, status: 'failed', requestUrl: 'https://erp.example.com/hooks/wf', requestMethod: 'POST', responseStatus: 500, durationMs: 1203, errorMessage: 'HTTP 500', finishedAt: t1 },
        { attempt: 5, status: 'failed', requestUrl: 'https://erp.example.com/hooks/wf', requestMethod: 'POST', responseStatus: 503, durationMs: 980, errorMessage: '503 Service Unavailable', finishedAt: t2 },
      ],
    },
    {
      key: 'job-103', kind: 'job', at: t2, traceId: 'trace-mock-bb02',
      title: '任务超时', status: 'pending', nodeName: '分管领导', assigneeName: null, comment: null,
      jobId: 103, jobType: 'task_timeout', attempts: 0, maxAttempts: 10, runAt: mockDateTimeOffset(1000 * 60 * 120),
      nextRetryAt: mockDateTimeOffset(1000 * 60 * 120), lastError: null, executions: [],
    },
  ];
  return {
    instanceId: id,
    title: `流程实例 #${id}`,
    explanation: {
      state: 'blocked',
      headline: '流程推进受阻：1 个自动作业失败，需人工介入',
      blockers: [
        { kind: 'job', severity: 'critical', title: 'Webhook 投递已进入死信', detail: 'POST https://erp.example.com/hooks/wf 503 Service Unavailable', taskId: null, jobId: 102, jobType: 'webhook_delivery', nodeName: '分管领导', waitingMinutes: null, nextRetryAt: null },
        { kind: 'task', severity: 'info', title: '等待王五审批', detail: '节点「分管领导」· 已等待 1 小时', taskId: 2, jobId: null, jobType: null, nodeName: '分管领导', waitingMinutes: 60, nextRetryAt: null },
        { kind: 'job', severity: 'info', title: '任务超时待执行', detail: `计划于 ${mockDateTimeOffset(1000 * 60 * 120)} 执行`, taskId: null, jobId: 103, jobType: 'task_timeout', nodeName: '分管领导', waitingMinutes: null, nextRetryAt: mockDateTimeOffset(1000 * 60 * 120) },
      ],
      lastError: 'POST https://erp.example.com/hooks/wf 503 Service Unavailable',
      nextWakeAt: mockDateTimeOffset(1000 * 60 * 120),
      pendingJobCount: 1,
      failedJobCount: 1,
    },
    trace,
    generatedAt: mockDateTime(),
  };
}

/** 委派回执：关闭当前任务并为原委派人生成新的 pending 任务，不推进流程 */
function createDelegationReceiptTask(current: WorkflowTask, receiptComment: string, now: string): WorkflowTask {
  const newTask: WorkflowTask = {
    id: getNextTaskId(),
    instanceId: current.instanceId,
    nodeKey: current.nodeKey,
    nodeName: current.nodeName,
    nodeType: current.nodeType,
    assigneeId: current.delegatedFromId ?? null,
    assigneeName: `用户${current.delegatedFromId}`,
    status: 'pending',
    comment: receiptComment,
    actionAt: null,
    originalAssigneeId: current.delegatedFromId,
    delegatedFromId: null,
    actionButtons: current.actionButtons,
    createdAt: now,
  };
  mockWorkflowTasks.push(newTask);
  return newTask;
}

export const workflowHandlers = [
  // ─── 流程定义 ─────────────────────────────────────────────────────────────

  // 获取流程定义列表（分页 + 搜索 + 状态筛选）
  mock(workflowDefinitionContract.list, ({ query, ok, paginate }) => {
    const keyword = query.keyword ?? '';
    const status = query.status ?? '';

    let list = [...mockWorkflowDefinitions];
    if (keyword) list = list.filter(d => d.name.includes(keyword) || (d.description ?? '').includes(keyword));
    if (status) list = list.filter(d => d.status === status);

    const page = paginate(list);
    return ok({ ...page, list: page.list.map(resolveWorkflowDefinition) });
  }),

  // 获取已发布的流程定义列表（发起申请时使用，返回数组而非分页对象）
  mock(workflowDefinitionContract.published, ({ ok }) => {
    const list = mockWorkflowDefinitions.filter(d => d.status === 'published' && d.formType !== 'external').map(resolveWorkflowDefinition);
    return ok(list);
  }),

  // 仿真用例（按定义归档，内存态演示）
  mock(workflowSimulationCaseContract.list, ({ query, ok }) => {
    return ok(mockSimulationCases.filter((item) => item.definitionId === query.definitionId).sort((a, b) => b.id - a.id));
  }),

  mock(workflowSimulationCaseContract.save, ({ body, ok }) => {
    const now = mockDateTime();
    const name = body.name.trim();
    const existing = mockSimulationCases.find((item) => item.definitionId === body.definitionId && item.name === name);
    if (existing) {
      existing.starterUserId = body.starterUserId ?? null;
      existing.formData = body.formData;
      existing.decisions = body.decisions;
      existing.updatedAt = now;
      return ok(existing, '已保存');
    }
    const item: WorkflowSimulationCase = {
      id: simCaseSeq++, definitionId: body.definitionId, name,
      starterUserId: body.starterUserId ?? null, formData: body.formData, decisions: body.decisions,
      tenantId: null, createdBy: 1, updatedBy: 1, createdAt: now, updatedAt: now,
    };
    mockSimulationCases.unshift(item);
    return ok(item, '已保存');
  }),

  mock(workflowSimulationCaseContract.remove, ({ params, ok }) => {
    const idx = mockSimulationCases.findIndex((item) => item.id === params.id);
    if (idx === -1) return notFound('仿真用例不存在');
    mockSimulationCases.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // 流程仿真（Demo 模式轻量实现）
  mock(workflowDefinitionContract.simulate, ({ body, ok }) => {
    const definition = body.definitionId ? mockWorkflowDefinitions.find((item) => item.id === body.definitionId) : undefined;
    // 契约仅约束 flowData 为宽松对象，设计器传入的即为流程图结构
    const flowData = (body.flowData as WorkflowFlowData | null | undefined) ?? definition?.flowData ?? null;
    return ok(buildMockSimulationResult(flowData, body.starterUserId, body.decisions ?? []));
  }),

  // 发布前体检（评分 + 分支覆盖）
  mock(workflowDefinitionContract.healthCheck, ({ body, ok }) => {
    const definition = body.definitionId ? mockWorkflowDefinitions.find((item) => item.id === body.definitionId) : undefined;
    const flowData = (body.flowData ?? definition?.flowData ?? null) as { nodes?: Array<{ data?: { type?: string; label?: string; key?: string } }> } | null;
    const nodes = flowData?.nodes ?? [];
    const approveNodes = nodes.filter((n) => n.data?.type === 'approve' || n.data?.type === 'handler');
    const gatewayNodes = nodes.filter((n) => ['exclusiveGateway', 'inclusiveGateway', 'routeGateway'].includes(n.data?.type ?? ''));
    const firstGw = gatewayNodes[0]?.data;
    const report: WorkflowDefinitionHealthReport = {
      score: 82,
      grade: 'B',
      valid: true,
      checks: [
        { key: 'structure', title: '结构合法性', status: 'pass', score: 100, weight: 0.30, summary: '流程结构合法', issues: [] },
        {
          key: 'approver', title: '审批人可解析性', status: 'warn', score: 80, weight: 0.25,
          summary: `${approveNodes.length} 个审批节点，1 个为动态来源`,
          issues: [{ severity: 'info', message: '存在审批人为动态来源但未配置空审批人兜底策略的节点', suggestion: '设置 emptyStrategy 避免运行时无人可审', nodeKey: null, nodeName: approveNodes[0]?.data?.label ?? '审批人' }],
        },
        {
          key: 'branch', title: '分支覆盖', status: gatewayNodes.length > 0 ? 'warn' : 'pass', score: gatewayNodes.length > 0 ? 76 : 100, weight: 0.20,
          summary: gatewayNodes.length > 0 ? '发现 1 处分支问题' : '分支覆盖完整，未发现死路/重叠',
          issues: gatewayNodes.length > 0 ? [{ severity: 'warning', message: `网关「${firstGw?.label ?? '条件分支'}」缺少默认分支`, suggestion: '添加一条默认分支兜底，避免所有条件都不满足时流程卡死', nodeKey: firstGw?.key ?? null, nodeName: firstGw?.label ?? '条件分支' }] : [],
        },
        {
          key: 'timeout', title: '超时/SLA 策略', status: 'pass', score: 90, weight: 0.10,
          summary: approveNodes.length > 0 ? `${approveNodes.length - 1 >= 0 ? approveNodes.length : 0} 个审批节点，部分未配置超时` : '审批节点均已配置超时策略',
          issues: approveNodes.length > 0 ? [{ severity: 'info', message: `节点「${approveNodes[0]?.data?.label ?? '审批人'}」未配置超时/SLA 提醒`, suggestion: '配置超时时长，便于超时预警与自动催办', nodeKey: null, nodeName: approveNodes[0]?.data?.label ?? '审批人' }] : [],
        },
        {
          key: 'expression', title: '表达式与字段引用', status: 'pass', score: 100, weight: 0.15,
          summary: '表达式语法与字段引用均合法', issues: [],
        },
      ],
      branchCoverage: gatewayNodes.map((g, i) => ({
        nodeKey: g.data?.key ?? `gw-${i}`,
        nodeName: g.data?.label ?? '条件分支',
        nodeType: g.data?.type ?? 'exclusiveGateway',
        branchCount: 2,
        hasDefault: i > 0,
        issues: i === 0 ? [{ severity: 'warning', message: `网关「${g.data?.label ?? '条件分支'}」缺少默认分支`, suggestion: '添加默认分支兜底', nodeKey: g.data?.key ?? null, nodeName: g.data?.label ?? '条件分支' }] : [],
      })),
      generatedAt: mockDateTime(),
    };
    return ok(report);
  }),

  // 获取单个流程定义
  mock(workflowDefinitionContract.detail, ({ params, ok }) => {
    const def = mockWorkflowDefinitions.find(d => d.id === params.id);
    if (!def) return notFound('流程定义不存在');
    return ok(resolveWorkflowDefinition(def));
  }),

  // 创建流程定义（新建总是草稿）
  mock(workflowDefinitionContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const newDef: WorkflowDefinition = {
      id: getNextDefinitionId(),
      name: body.name,
      description: body.description ?? null,
      categoryId: body.categoryId ?? null,
      initiatorScopeType: body.initiatorScopeType,
      initiatorScopeIds: body.initiatorScopeType === 'all' ? null : (body.initiatorScopeIds ?? []),
      // 契约仅约束 flowData 为对象，设计器传入的即为流程图结构
      flowData: (body.flowData as WorkflowFlowData | null | undefined) ?? null,
      formId: isBusinessFormType(body.formType) ? null : (body.formId ?? null),
      formFields: null,
      formType: body.formType,
      customForm: isBusinessFormType(body.formType) ? (body.customForm ?? null) : null,
      status: 'draft',
      version: 1,
      tenantId: 1,
      createdBy: 1,
      createdByName: '张三',
      createdAt: now,
      updatedAt: now,
    };
    mockWorkflowDefinitions.push(newDef);
    return ok(resolveWorkflowDefinition(newDef));
  }),

  // 更新流程定义
  mock(workflowDefinitionContract.update, ({ params, body, ok }) => {
    const idx = mockWorkflowDefinitions.findIndex(d => d.id === params.id);
    if (idx === -1) return notFound('流程定义不存在');
    const prev = mockWorkflowDefinitions[idx];
    // 已发布的流程保存后自动转为草稿
    const nextStatus = prev.status === 'published' && body.status === undefined ? 'draft' : prev.status;
    const nextFormType = body.formType ?? prev.formType;
    const updated: WorkflowDefinition = {
      ...prev,
      ...body,
      id: prev.id,
      // 契约仅约束 flowData 为对象，设计器传入的即为流程图结构
      flowData: body.flowData !== undefined ? ((body.flowData as WorkflowFlowData | null | undefined) ?? null) : prev.flowData,
      description: body.description !== undefined ? body.description ?? null : prev.description,
      categoryId: body.categoryId !== undefined ? body.categoryId ?? null : prev.categoryId,
      initiatorScopeType: body.initiatorScopeType ?? prev.initiatorScopeType,
      initiatorScopeIds: body.initiatorScopeIds !== undefined ? body.initiatorScopeIds ?? null : prev.initiatorScopeIds,
      formType: nextFormType,
      formId: isBusinessFormType(nextFormType) ? null : (body.formId !== undefined ? body.formId ?? null : prev.formId),
      formName: null,
      formFields: null,
      formSettings: null,
      customForm: isBusinessFormType(nextFormType)
        ? (body.customForm !== undefined ? body.customForm ?? null : prev.customForm)
        : null,
      status: nextStatus,
      version: prev.version,
      updatedAt: mockDateTime(),
    };
    mockWorkflowDefinitions[idx] = updated;
    return ok(resolveWorkflowDefinition(updated));
  }),

  // 批量禁用流程定义（仅已发布）
  mock(workflowDefinitionContract.batchDisable, ({ body, ok }) => {
    const now = mockDateTime();
    let updated = 0;
    for (const id of body.ids) {
      const idx = mockWorkflowDefinitions.findIndex(d => d.id === id);
      if (idx === -1 || mockWorkflowDefinitions[idx].status !== 'published') continue;
      mockWorkflowDefinitions[idx] = { ...mockWorkflowDefinitions[idx], status: 'disabled', updatedAt: now };
      updated++;
    }
    const skipped = body.ids.length - updated;
    return ok(null, skipped > 0 ? `成功禁用 ${updated} 条，${skipped} 条已跳过（非已发布状态）` : `成功禁用 ${updated} 条`);
  }),

  // 批量启用流程定义（仅已禁用）
  mock(workflowDefinitionContract.batchEnable, ({ body, ok }) => {
    const now = mockDateTime();
    let updated = 0;
    for (const id of body.ids) {
      const idx = mockWorkflowDefinitions.findIndex(d => d.id === id);
      if (idx === -1 || mockWorkflowDefinitions[idx].status !== 'disabled') continue;
      mockWorkflowDefinitions[idx] = { ...mockWorkflowDefinitions[idx], status: 'published', updatedAt: now };
      updated++;
    }
    const skipped = body.ids.length - updated;
    return ok(null, skipped > 0 ? `成功启用 ${updated} 条，${skipped} 条已跳过（非已禁用状态）` : `成功启用 ${updated} 条`);
  }),

  // 批量删除流程定义（仅非已发布且无发起实例）
  mock(workflowDefinitionContract.batchDelete, ({ body, ok }) => {
    let deleted = 0;
    for (const id of body.ids) {
      const idx = mockWorkflowDefinitions.findIndex(d => d.id === id);
      if (idx === -1) continue;
      if (mockWorkflowDefinitions[idx].status === 'published') continue;
      if (mockWorkflowInstances.some(i => i.definitionId === id)) continue;
      mockWorkflowDefinitions.splice(idx, 1);
      deleted++;
    }
    const skipped = body.ids.length - deleted;
    return ok(null, skipped > 0 ? `成功删除 ${deleted} 条，${skipped} 条已跳过（已发布或存在发起实例）` : `成功删除 ${deleted} 条`);
  }),

  // 发布流程定义
  mock(workflowDefinitionContract.publish, ({ params, ok }) => {
    const idx = mockWorkflowDefinitions.findIndex(d => d.id === params.id);
    if (idx === -1) return notFound('流程定义不存在');
    if (!mockWorkflowDefinitions[idx].flowData) return badRequest('流程图不能为空，请先设计流程');
    const cur = mockWorkflowDefinitions[idx];
    if (cur.formType === 'custom' && !cur.customForm?.createComponent?.trim()) {
      return badRequest('请先在「表单」步骤配置自定义业务表单的创建页组件路径');
    }
    if (cur.formType === 'external' && !cur.customForm?.viewComponent?.trim()) {
      return badRequest('请先在「表单」步骤配置业务系统主导流程的审批查看页组件路径');
    }
    // designer 发布门禁（与真实 API assertPublishable 一致）：引用字段未绑定表单 / 绑定表单停用
    if ((cur.formType ?? 'designer') === 'designer') {
      if (cur.formId == null) {
        const referenced = [...collectReferencedFormFieldKeys(cur.flowData)];
        if (referenced.length > 0) {
          const head = referenced.slice(0, 5).join('、');
          const suffix = referenced.length > 5 ? ` 等 ${referenced.length} 个字段` : '';
          return badRequest(`流程的分支条件/审批人配置引用了表单字段（${head}${suffix}），但未绑定表单，请先在「表单」步骤选择表单`);
        }
      } else {
        const boundForm = mockWorkflowForms.find((f) => f.id === cur.formId);
        if (!boundForm) return badRequest('绑定的表单不存在，请在「表单」步骤重新选择');
        if (boundForm.status === 'disabled') return badRequest(`绑定的表单「${boundForm.name}」已停用，请启用该表单或更换后再发布`);
      }
    }
    const newVersion = cur.version + 1;
    const now = mockDateTime();
    // 生成快照
    mockWorkflowDefinitionVersions.push({
      id: getNextDefinitionVersionId(),
      definitionId: cur.id,
      version: newVersion,
      name: cur.name,
      description: cur.description,
      flowData: cur.flowData,
      formId: cur.formId,
      formName: resolveWorkflowDefinition(cur).formName,
      formFields: resolveDefinitionFormFields(cur),
      formType: cur.formType,
      customForm: cur.customForm,
      publishedAt: now,
      publishedBy: 1,
      publishedByName: '张三',
      tenantId: cur.tenantId,
    });
    mockWorkflowDefinitions[idx] = {
      ...cur,
      status: 'published',
      version: newVersion,
      updatedAt: now,
    };
    return ok(resolveWorkflowDefinition(mockWorkflowDefinitions[idx]));
  }),

  // 禁用流程定义
  mock(workflowDefinitionContract.disable, ({ params, ok }) => {
    const idx = mockWorkflowDefinitions.findIndex(d => d.id === params.id);
    if (idx === -1) return notFound('流程定义不存在');
    mockWorkflowDefinitions[idx] = {
      ...mockWorkflowDefinitions[idx],
      status: 'disabled',
      updatedAt: mockDateTime(),
    };
    return ok(resolveWorkflowDefinition(mockWorkflowDefinitions[idx]));
  }),

  // 启用流程定义
  mock(workflowDefinitionContract.enable, ({ params, ok }) => {
    const idx = mockWorkflowDefinitions.findIndex(d => d.id === params.id);
    if (idx === -1) return notFound('流程定义不存在');
    if (mockWorkflowDefinitions[idx].status !== 'disabled') return badRequest('流程定义不存在或不处于禁用状态');
    mockWorkflowDefinitions[idx] = {
      ...mockWorkflowDefinitions[idx],
      status: 'published',
      updatedAt: mockDateTime(),
    };
    return ok(resolveWorkflowDefinition(mockWorkflowDefinitions[idx]));
  }),

  // 删除流程定义
  mock(workflowDefinitionContract.remove, ({ params, ok }) => {
    const idx = mockWorkflowDefinitions.findIndex(d => d.id === params.id);
    if (idx === -1) return notFound('流程定义不存在');
    mockWorkflowDefinitions.splice(idx, 1);
    return ok(null);
  }),

  // 流程定义历史版本列表
  mock(workflowDefinitionContract.versions, ({ params, ok, paginate }) => {
    if (!mockWorkflowDefinitions.some(d => d.id === params.id)) return notFound('流程定义不存在');
    const all = mockWorkflowDefinitionVersions
      .filter(v => v.definitionId === params.id)
      .sort((a, b) => b.version - a.version);
    const page = paginate(all);
    return ok({ ...page, list: page.list.map(resolveWorkflowDefinitionVersion) });
  }),

  // 恢复历史版本
  mock(workflowDefinitionContract.restoreVersion, ({ params, ok }) => {
    const idx = mockWorkflowDefinitions.findIndex(d => d.id === params.id);
    if (idx === -1) return notFound('流程定义不存在');
    const ver = mockWorkflowDefinitionVersions.find(v => v.id === params.versionId && v.definitionId === params.id);
    if (!ver) return notFound('历史版本不存在');
    mockWorkflowDefinitions[idx] = {
      ...mockWorkflowDefinitions[idx],
      name: ver.name,
      description: ver.description,
      flowData: ver.flowData,
      formId: ver.formId,
      formType: ver.formType,
      customForm: ver.customForm,
      formName: null,
      formFields: null,
      formSettings: null,
      status: 'draft',
      updatedAt: mockDateTime(),
    };
    return ok(resolveWorkflowDefinition(mockWorkflowDefinitions[idx]));
  }),

  // ─── 流程实例 ─────────────────────────────────────────────────────────────

  // 我的申请列表（当前用户 initiatorId=1）
  mock(workflowInstanceContract.list, ({ query, ok, paginate }) => {
    let list = mockWorkflowInstances.filter(i => i.initiatorId === 1);
    if (query.status) list = list.filter(i => i.status === query.status);
    if (query.definitionId) list = list.filter(i => i.definitionId === query.definitionId);
    list = [...list].sort((a, b) => b.id - a.id);

    const page = paginate(list);
    return ok({
      ...page,
      list: page.list.map(i => ({
        ...withActiveNodes(i),
        tasks: undefined, // 列表不返回 tasks
      })),
    });
  }),

  // 工作流协作选人清单（转办/委派/加签/协办/转发/抄送共用，面向普通审批人开放）
  mock(workflowInstanceContract.selectableUsers, ({ ok }) => ok(
    mockUsers
      .filter((u) => u.status === 'enabled')
      .map((u) => ({
        id: u.id,
        username: u.username,
        nickname: u.nickname,
        avatar: u.avatar ?? null,
        departmentName: u.departmentName ?? null,
      })),
  )),

  // 待我审批总数（assigneeId=1 且 status=pending 的任务所对应的运行中实例）
  mock(workflowInstanceContract.pendingMineCount, ({ ok }) => {
    const count = mockWorkflowTasks.filter((t) => {
      if (t.assigneeId !== 1 || t.status !== 'pending') return false;
      const inst = mockWorkflowInstances.find((i) => i.id === t.instanceId);
      return inst?.status === 'running';
    }).length;
    return ok({ count });
  }),

  // 待我审批列表
  mock(workflowInstanceContract.pendingMine, ({ query, ok, paginate }) => {
    const keyword = query.keyword ?? '';
    const definitionId = query.definitionId ?? null;

    const pendingTaskIds = mockWorkflowTasks
      .filter(t => t.assigneeId === 1 && t.status === 'pending')
      .map(t => ({ instanceId: t.instanceId, taskId: t.id, signatureRequired: t.signatureRequired ?? false }));

    let list = pendingTaskIds.flatMap(({ instanceId, taskId, signatureRequired }, idx): WorkflowPendingInstanceItem[] => {
      const inst = mockWorkflowInstances.find(i => i.id === instanceId);
      if (!inst) return [];
      // Demo SLA：轮换演示 已超时 / 即将超时 / 充裕 / 未配置
      const slaCases: Array<Pick<WorkflowInstanceListItem, 'slaLevel' | 'slaOverdueSec' | 'slaDeadline'>> = [
        { slaLevel: 'overdue', slaOverdueSec: 7200, slaDeadline: mockDateTimeOffset(-1000 * 60 * 120) },
        { slaLevel: 'warning', slaOverdueSec: -1800, slaDeadline: mockDateTimeOffset(1000 * 60 * 30) },
        { slaLevel: 'safe', slaOverdueSec: -86400, slaDeadline: mockDateTimeOffset(1000 * 60 * 60 * 24) },
        { slaLevel: 'none', slaOverdueSec: null, slaDeadline: null },
      ];
      const sla = slaCases[idx % slaCases.length];
      // 列表摘要：与后端一致，按定义 settings.summaryFields + 表单快照解析
      const def = mockWorkflowDefinitions.find(d => d.id === inst.definitionId);
      const settings = inst.definitionSnapshot?.flowData?.settings ?? def?.flowData?.settings;
      const snapFields = inst.formSnapshot?.fields ?? [];
      const summary = buildWorkflowSummaryItems(snapFields, inst.formData ?? {}, settings?.summaryFields);
      // 与服务端一致：下游紧邻节点含 approverSelect 时需逐条选人，不可极速同意
      const task = mockWorkflowTasks.find(t => t.id === taskId);
      const flowForNext = inst.definitionSnapshot?.flowData ?? def?.flowData;
      const requiresIndividual = !!task && !!flowForNext && findNextApproverSelectNodes(flowForNext, task.nodeKey).length > 0;
      return [{ ...toInstanceListItem(inst), pendingTaskId: taskId, pendingSignatureRequired: signatureRequired, requiresIndividual, ...sla, summary }];
    });

    if (keyword) list = list.filter(i => i.title?.includes(keyword));
    if (definitionId !== null) list = list.filter(i => i.definitionId === definitionId);

    return ok(paginate(list));
  }),

  // 全局流程监控（管理员看板）— 必须在 /instances/:id 之前注册，避免被参数路由捕获
  mock(workflowInstanceContract.monitor, ({ query, ok, paginate }) => {
    const keyword = query.keyword ?? '';
    const initiatorKeyword = query.initiatorKeyword ?? '';

    const stats = {
      total: mockWorkflowInstances.length,
      running:   mockWorkflowInstances.filter(i => i.status === 'running').length,
      approved:  mockWorkflowInstances.filter(i => i.status === 'approved').length,
      rejected:  mockWorkflowInstances.filter(i => i.status === 'rejected').length,
      withdrawn: mockWorkflowInstances.filter(i => i.status === 'withdrawn').length,
      cancelled: mockWorkflowInstances.filter(i => i.status === 'cancelled').length,
    };

    let list = [...mockWorkflowInstances];
    if (keyword) list = list.filter(i => i.title.includes(keyword) || (i.definitionName ?? '').includes(keyword));
    if (query.status) list = list.filter(i => i.status === query.status);
    if (query.categoryId) list = list.filter(i => i.categoryId === query.categoryId);
    if (query.definitionId) list = list.filter(i => i.definitionId === query.definitionId);
    if (initiatorKeyword) list = list.filter(i => (i.initiatorName ?? '').includes(initiatorKeyword));

    const page = paginate(list.slice().sort((a, b) => b.id - a.id));
    return ok({ stats, ...page, list: page.list.map(toInstanceListItem) });
  }),

  // ─── 流程引擎运维 ─────────────────────────────────────────────────────────

  mock(workflowEngineContract.introspection, ({ query, ok }) => {
    const threshold = query.thresholdMinutes || 30;
    return ok(buildMockWorkflowEngineIntrospection(Math.max(1, Math.min(threshold, 24 * 60))));
  }),

  mock(workflowEngineContract.healthHistory, ({ query, ok }) => {
    const hours = Math.max(1, Math.min(query.hours || 24, 24 * 30));
    const stepMin = 30;
    const count = Math.min(Math.floor((hours * 60) / stepMin), 5000);
    const points = Array.from({ length: count }, (_, i): WorkflowEngineHealthPoint => {
      const at = dayjs().subtract((count - 1 - i) * stepMin, 'minute');
      const wave = Math.sin(i / 5);
      const score = Math.max(60, Math.min(100, Math.round(94 + wave * 5 - (i % 11 === 0 ? 8 : 0))));
      const severity = score >= 90 ? 'healthy' : score >= 70 ? 'warning' : 'critical';
      const backlog = Math.max(0, Math.round(6 + wave * 4 + (i % 11 === 0 ? 10 : 0)));
      return {
        capturedAt: at.format(DATE_TIME_FORMAT),
        healthScore: score,
        severity,
        backlog,
        errorRate: i % 9 === 0 ? 0.03 : 0,
        criticalCount: score < 70 ? 1 : 0,
        warningCount: score < 90 ? 1 : 0,
        runningInstances: 4,
      };
    });
    return ok({
      points,
      thresholds: { healthWarn: 90, healthCritical: 70, backlogWarn: 50, backlogCritical: 200, errorRateWarn: 0.05, errorRateCritical: 0.15 },
    });
  }),

  mock(workflowEngineContract.previewAction, ({ params, body, ok }) => {
    const action = params.action;
    const limit = Math.min(Math.max(Math.floor(body.limit ?? 200) || 200, 1), 500);
    const { jobTypes, due, later, stuck, targets } = engineDrainableCandidates(action, body);
    const sample = targets.slice(0, 10).map((j) => ({
      id: j.id,
      jobType: j.jobType,
      status: j.status,
      instanceId: j.instanceId ?? null,
      traceId: j.traceId ?? null,
      attempts: j.attempts,
      runAt: j.runAt,
      createdAt: j.createdAt,
      lastError: j.lastError ?? null,
    }));
    return ok({
      action,
      label: ENGINE_ACTION_LABELS[action],
      jobTypes,
      duePending: due.length,
      stuckRunning: stuck.length,
      scheduledLater: later.length,
      matched: due.length + stuck.length,
      limit,
      sample,
    });
  }),

  mock(workflowEngineContract.runAction, ({ params, body, ok }) => {
    const action = params.action;
    const limit = Math.min(Math.max(Math.floor(body.limit ?? 200) || 200, 1), 500);
    const { due, stuck, targets } = engineDrainableCandidates(action, body);
    const processed = targets.slice(0, limit);
    processed.forEach((j) => { j.status = 'succeeded'; j.lockedAt = null; j.lockedBy = null; j.lastError = null; j.updatedAt = mockDateTime(); });
    const detail: Record<string, number> = { recovered: stuck.length, processed: processed.length };
    const summary = Object.entries(detail).map(([k, v]) => `${k} ${v}`).join(' · ');
    const matched = due.length + stuck.length;
    const more = matched > processed.length ? `，剩余 ${matched - processed.length} 条超单次上限未处理` : '';
    return ok({ action, ok: true, message: `${ENGINE_ACTION_LABELS[action]}完成：${summary || '无待处理项'}${more}`, detail });
  }),

  // ── 统一作业账本（workflow_jobs）死信 / 补偿中心 ──
  mock(workflowEngineContract.jobs, ({ query, ok, paginate }) => {
    const keyword = (query.keyword ?? '').trim().toLowerCase();
    let list = [...mockWorkflowJobs].sort((a, b) => b.id - a.id);
    if (query.jobType) list = list.filter((j) => j.jobType === query.jobType);
    if (query.status) list = list.filter((j) => j.status === query.status);
    if (keyword) {
      list = list.filter((j) =>
        (j.idempotencyKey ?? '').toLowerCase().includes(keyword)
        || (j.traceId ?? '').toLowerCase().includes(keyword)
        || (j.nodeKey ?? '').toLowerCase().includes(keyword));
    }
    return ok(paginate(list));
  }),

  mock(workflowEngineContract.jobsSummary, ({ ok }) => {
    const types = ['delay_wake', 'task_timeout', 'trigger_dispatch', 'external_dispatch', 'subprocess_spawn', 'subprocess_join', 'event_dispatch', 'webhook_delivery'] as const;
    const summary = types.map((jobType): WorkflowJobSummaryItem => {
      const rows = mockWorkflowJobs.filter((j) => j.jobType === jobType);
      const countBy = (s: WorkflowJobStatus) => rows.filter((j) => j.status === s).length;
      return {
        jobType,
        total: rows.length,
        pending: countBy('pending'),
        running: countBy('running'),
        succeeded: countBy('succeeded'),
        failed: countBy('failed'),
        dead: countBy('dead'),
        canceled: countBy('canceled'),
      };
    });
    return ok(summary);
  }),

  mock(workflowEngineContract.jobChainBundle, ({ params, ok }) => {
    return ok({ traceId: params.traceId, generatedAt: mockDateTime(), chain: buildJobChain(params.traceId), instances: [] });
  }),

  mock(workflowEngineContract.jobChain, ({ params, ok }) => {
    return ok(buildJobChain(params.traceId));
  }),

  mock(workflowEngineContract.batchRetryJobs, ({ body, ok }) => {
    const ids = body.ids;
    let success = 0;
    for (const id of ids) {
      const job = mockWorkflowJobs.find((j) => j.id === id);
      if (job && ['failed', 'dead', 'canceled'].includes(job.status)) {
        requeueJob(job);
        success += 1;
      }
    }
    const skipped = ids.length - success;
    return ok({ total: ids.length, success, skipped }, `已重试 ${success} 项${skipped > 0 ? `，${skipped} 项状态不满足已跳过` : ''}`);
  }),

  mock(workflowEngineContract.batchSkipJobs, ({ body, ok }) => {
    const ids = body.ids;
    let success = 0;
    for (const id of ids) {
      const job = mockWorkflowJobs.find((j) => j.id === id);
      if (job && ['pending', 'failed', 'dead'].includes(job.status)) {
        job.status = 'canceled'; job.lockedAt = null; job.updatedAt = mockDateTime();
        success += 1;
      }
    }
    const skipped = ids.length - success;
    return ok({ total: ids.length, success, skipped }, `已跳过 ${success} 项${skipped > 0 ? `，${skipped} 项状态不满足已跳过` : ''}`);
  }),

  mock(workflowEngineContract.replayDeadJobs, ({ body: b, ok }) => {
    const status = b.status === 'failed' ? 'failed' : 'dead';
    const rate = Math.min(Math.max(Math.floor(b.ratePerSecond ?? 20) || 20, 1), 200);
    const limit = Math.min(Math.max(Math.floor(b.limit ?? 500) || 500, 1), 500);
    const kw = b.reasonKeyword?.trim().toLowerCase();
    const match = (j: WorkflowJob) => j.status === status
      && (!b.jobType || j.jobType === b.jobType)
      && (b.instanceId == null || j.instanceId === b.instanceId)
      && (!b.traceId || j.traceId === b.traceId)
      && (!kw || (j.lastError ?? '').toLowerCase().includes(kw))
      && (b.olderThanMinutes == null || b.olderThanMinutes <= 0 || (Date.now() - new Date(j.createdAt).getTime()) >= b.olderThanMinutes * 60000);
    const matchedList = mockWorkflowJobs.filter(match);
    const target = matchedList.slice(0, limit);
    target.forEach(requeueJob);
    const more = matchedList.length > target.length ? `，剩余 ${matchedList.length - target.length} 条超单次上限未处理` : '';
    return ok({ total: target.length, success: target.length, skipped: 0, matched: matchedList.length, ratePerSecond: rate, limit }, `已按 ${rate} 条/秒错峰重放 ${target.length}/${target.length}（匹配 ${matchedList.length} 条）${more}`);
  }),

  mock(workflowEngineContract.replayPreview, ({ body: b, ok }) => {
    const status = b.status === 'failed' ? 'failed' : 'dead';
    const kw = b.reasonKeyword?.trim().toLowerCase();
    const matched = mockWorkflowJobs.filter((j) => j.status === status
      && (!b.jobType || j.jobType === b.jobType)
      && (b.instanceId == null || j.instanceId === b.instanceId)
      && (!b.traceId || j.traceId === b.traceId)
      && (!kw || (j.lastError ?? '').toLowerCase().includes(kw))
      && (b.olderThanMinutes == null || b.olderThanMinutes <= 0 || (Date.now() - new Date(j.createdAt).getTime()) >= b.olderThanMinutes * 60000)).length;
    return ok({ matched });
  }),

  mock(workflowEngineContract.failureClusters, ({ query, ok }) => {
    const dim = query.dimension ?? 'reason';
    const MEMBER_LIMIT = 10;
    const rows = mockWorkflowJobs
      .filter((j) => j.status === 'dead' || j.status === 'failed')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    type ClusterBase = Pick<WorkflowJobFailureCluster, 'dimension' | 'key' | 'label' | 'instanceId' | 'traceId' | 'reasonKeyword'>;
    type ClusterAcc = ClusterBase & Pick<WorkflowJobFailureCluster, 'count' | 'firstAt' | 'lastAt'> & { jobs: WorkflowJobFailureClusterMember[]; _types: Set<string>; _instances: Set<number> };
    const map = new Map<string, ClusterAcc>();
    const bump = (key: string, base: ClusterBase, j: WorkflowJob) => {
      const e: ClusterAcc = map.get(key) ?? { ...base, count: 0, firstAt: null, lastAt: null, jobs: [], _types: new Set<string>(), _instances: new Set<number>() };
      e.count++; e._types.add(j.jobType);
      if (j.instanceId != null) e._instances.add(j.instanceId);
      // 行已按 failedAt 倒序：首行即最近失败，末次覆盖即最早失败
      e.lastAt = e.lastAt ?? j.updatedAt;
      e.firstAt = j.updatedAt;
      if (e.jobs.length < MEMBER_LIMIT) {
        e.jobs.push({
          id: j.id, jobType: j.jobType, status: j.status, instanceId: j.instanceId, instanceTitle: j.instanceTitle,
          definitionName: j.definitionName, nodeKey: j.nodeKey, attempts: j.attempts, maxAttempts: j.maxAttempts,
          lockedBy: j.lockedBy, traceId: j.traceId, lastError: j.lastError, failedAt: j.updatedAt, createdAt: j.createdAt,
        });
      }
      map.set(key, e);
    };
    for (const j of rows) {
      if (dim === 'jobType') {
        bump(j.jobType, { dimension: dim, key: j.jobType, label: j.jobType, instanceId: null, traceId: null, reasonKeyword: null }, j);
      } else if (dim === 'instance') {
        if (j.instanceId == null) continue;
        const k = String(j.instanceId);
        bump(k, { dimension: dim, key: k, label: j.instanceTitle ? `${j.instanceTitle} (#${j.instanceId})` : `实例 #${j.instanceId}`, instanceId: j.instanceId, traceId: null, reasonKeyword: null }, j);
      } else if (dim === 'trace') {
        if (!j.traceId) continue;
        bump(j.traceId, { dimension: dim, key: j.traceId, label: j.traceId, instanceId: null, traceId: j.traceId, reasonKeyword: null }, j);
      } else {
        const reason = (j.lastError ?? '未知错误').replace(/\d+/g, 'N').slice(0, 60);
        const lead = (j.lastError ?? '').trim().split(/\d/)[0]?.trim() ?? '';
        const kwRaw = (lead.length >= 4 ? lead : (j.lastError ?? '').trim()).slice(0, 40).trim();
        bump(reason, { dimension: dim, key: reason, label: reason, instanceId: null, traceId: null, reasonKeyword: kwRaw.length >= 2 ? kwRaw : null }, j);
      }
    }
    const clusters: WorkflowJobFailureCluster[] = [...map.values()]
      .map(({ _types, _instances, ...c }) => ({ ...c, jobTypes: [..._types], instanceCount: _instances.size }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
    return ok(clusters);
  }),

  mock(workflowEngineContract.jobRuntimeStatus, ({ ok }) => {
    const running = mockWorkflowJobs.filter((j) => j.status === 'running');
    const dead = mockWorkflowJobs.filter((j) => j.status === 'dead').length;
    const backlog = mockWorkflowJobs.filter((j) => j.status === 'pending').length;
    const lastClaimed = running.map((j) => j.lockedAt).filter((v): v is string => !!v).sort().pop() ?? null;
    return ok({
      activeWorkers: 1,
      totalWorkers: 1,
      workers: [{ nodeId: 'mock-node-1', hostname: 'mock-scheduler', runningJobCount: running.length, lastHeartbeatAt: mockDateTime(), fresh: true }],
      runningJobs: running.length,
      stuckRunningJobs: 0,
      backlog,
      deadLetter: dead,
      lastClaimedAt: lastClaimed,
      failureRate: dead > 0 ? 12.5 : 0,
      avgDurationMs: 420,
      recentExecutions: mockWorkflowJobs.length,
    });
  }),

  // 作业详情（参数路由，必须在 /jobs/* 静态路由之后注册）
  mock(workflowEngineContract.jobDetail, ({ params, ok }) => {
    const job = mockWorkflowJobs.find((j) => j.id === params.id);
    if (!job) return notFound('作业不存在');
    const executions = mockWorkflowJobExecutions
      .filter((e) => e.jobId === params.id)
      .sort((a, b) => b.id - a.id);
    const detail: WorkflowJobDetail = { ...job, executions };
    return ok(detail);
  }),

  mock(workflowEngineContract.retryJob, ({ params, body, ok }) => {
    const job = mockWorkflowJobs.find((j) => j.id === params.id);
    if (!job) return notFound('作业不存在');
    if (!['failed', 'dead', 'canceled'].includes(job.status)) return badRequest('仅失败 / 死信 / 已取消的作业可重试');
    if (body.payload) job.payload = body.payload;
    requeueJob(job);
    return ok(job, '已重新入队');
  }),

  mock(workflowEngineContract.skipJob, ({ params, ok }) => {
    const job = mockWorkflowJobs.find((j) => j.id === params.id);
    if (!job) return notFound('作业不存在');
    if (!['pending', 'failed', 'dead'].includes(job.status)) return badRequest('仅待处理 / 失败 / 死信的作业可跳过');
    job.status = 'canceled';
    job.lockedAt = null;
    job.updatedAt = mockDateTime();
    return ok(job, '已跳过');
  }),

  // ─── 实例运行诊断 / 执行 Token / 轨迹 ────────────────────────────────────

  mock(workflowInstanceOpsContract.diagnostics, ({ params, ok }) => {
    const inst = mockWorkflowInstances.find(i => i.id === params.id);
    if (!inst) return notFound('流程实例不存在');
    return ok(buildMockDiagnostics(inst));
  }),

  // 实例显式执行 Token（执行树 / 活动路径）
  mock(workflowInstanceOpsContract.tokens, ({ params, ok }) => {
    return ok(mockTokenView(params.id));
  }),

  // Token 运营恢复（demo）：跳过卡死 Token / 从节点重放 / 导出诊断包
  mock(workflowInstanceOpsContract.skipToken, ({ params, ok }) => {
    const task = mockWorkflowTasks.find((t) => 900000 + t.id === params.id);
    if (task && (task.status === 'pending' || task.status === 'waiting')) task.status = 'skipped';
    const inst = task ? mockWorkflowInstances.find((i) => i.id === task.instanceId) : undefined;
    if (!inst) return notFound('流程实例不存在');
    return ok(withDefinitionSnapshot(withActiveNodes(inst)));
  }),
  mock(workflowInstanceOpsContract.replayToken, ({ params, ok }) => {
    const task = mockWorkflowTasks.find((t) => 900000 + t.id === params.id);
    const inst = task ? mockWorkflowInstances.find((i) => i.id === task.instanceId) : undefined;
    if (!inst) return notFound('流程实例不存在');
    return ok(withDefinitionSnapshot(withActiveNodes(inst)));
  }),
  mock(workflowInstanceOpsContract.batchSkipStuck, ({ body, ok }) => {
    const total = mockWorkflowInstances.filter((i) => i.definitionId === body.definitionId && i.status === 'running').length;
    return ok({ total, success: total, failed: 0 }, `已推进 ${total}/${total} 个实例`);
  }),
  mock(workflowInstanceOpsContract.diagnosticBundle, ({ params, ok }) => {
    const inst = mockWorkflowInstances.find(i => i.id === params.id);
    if (!inst) return notFound('流程实例不存在');
    return ok({
      instanceId: params.id,
      generatedAt: mockDateTime(),
      diagnostics: buildMockDiagnostics(inst),
      trace: buildMockTrace(params.id),
      tokens: mockTokenView(params.id),
    });
  }),

  // 实例运行轨迹 + 引擎解释
  mock(workflowInstanceOpsContract.trace, ({ params, ok }) => {
    return ok(buildMockTrace(params.id));
  }),

  // ─── 实例生命周期 ─────────────────────────────────────────────────────────

  // 获取流程实例详情（含任务列表）
  mock(workflowInstanceContract.detail, ({ params, ok }) => {
    const inst = mockWorkflowInstances.find(i => i.id === params.id);
    if (!inst) return notFound('流程实例不存在');
    const tasks = mockWorkflowTasks.filter(t => t.instanceId === inst.id)
      .sort((a, b) => a.id - b.id);
    // 子流程：聚合本实例发起的子实例摘要
    const childInstances = mockWorkflowInstances
      .filter(i => i.parentInstanceId === inst.id)
      .map(c => ({ id: c.id, title: c.title, status: c.status, parentTaskNodeKey: null, createdAt: c.createdAt }));
    return ok({ ...withDefinitionSnapshot(withActiveNodes(inst)), tasks, childInstances });
  }),

  // 发起流程申请（支持保存草稿 asDraft）
  mock(workflowInstanceContract.create, ({ body, ok }) => {
    const def = mockWorkflowDefinitions.find(d => d.id === body.definitionId);
    if (!def) return badRequest('流程定义不存在');
    if (def.status !== 'published') return badRequest('该流程未发布，无法发起申请');
    if (def.formType === 'external') return badRequest('业务系统主导流程请从对应业务模块发起');

    const now = mockDateTime();
    const instanceId = getNextInstanceId();
    const isDraft = body.asDraft === true;
    const formData = body.formData ?? null;

    // 业务编号：仅正式发起时生成（用内存计数器模拟按定义+周期自增）
    const serialCfg = (def.flowData?.settings as { serialNo?: WorkflowSerialNoConfig } | undefined)?.serialNo;
    let serialNo: string | null = null;
    if (!isDraft && serialCfg?.enabled) {
      const formatDate = (pattern: string) => dayjs().format(pattern);
      const periodKey = resolveSerialPeriodKey(serialCfg.resetPeriod ?? 'never', formatDate);
      const counterKey = `${def.id}:${periodKey}`;
      const ordinal = (mockSerialCounters.get(counterKey) ?? 0) + 1;
      mockSerialCounters.set(counterKey, ordinal);
      serialNo = renderWorkflowSerialNo(serialCfg, {
        ordinal,
        formatDate,
        vars: WORKFLOW_SERIAL_SAMPLE_VARS,
        formData: formData ?? {},
      });
    }

    // 创建初始审批任务（取第一个 approve 节点）；草稿不创建任务
    const firstApproveNode = def.flowData?.nodes.find(n => n.data.type === 'approve');
    const newTasks: WorkflowTask[] = [];
    if (!isDraft && firstApproveNode) {
      newTasks.push({
        id: getNextTaskId(),
        instanceId,
        nodeKey: firstApproveNode.data.key,
        nodeName: firstApproveNode.data.label,
        nodeType: 'approve',
        assigneeId: firstApproveNode.data.assigneeId ?? null,
        assigneeName: firstApproveNode.data.assigneeName ?? null,
        assigneeAvatar: null,
        status: 'pending',
        comment: null,
        actionAt: null,
        createdAt: now,
      });
    }

    const newInstance: WorkflowInstance = {
      id: instanceId,
      definitionId: body.definitionId,
      definitionName: def.name,
      title: body.title,
      serialNo,
      priority: body.priority ?? 'normal',
      formData,
      formSnapshot: resolveDefinitionFormSnapshot(def),
      status: isDraft ? 'draft' : 'running',
      currentNodeKey: isDraft ? null : (firstApproveNode?.data.key ?? null),
      initiatorId: 1,
      initiatorName: '张三',
      initiatorAvatar: null,
      tenantId: 1,
      tasks: newTasks,
      createdAt: now,
      updatedAt: now,
    };

    mockWorkflowInstances.push(newInstance);
    for (const task of newTasks) mockWorkflowTasks.push(task);

    return ok(withActiveNodes(newInstance));
  }),

  // 撤回流程实例
  mock(workflowInstanceContract.withdraw, ({ params, ok }) => {
    const idx = mockWorkflowInstances.findIndex(i => i.id === params.id);
    if (idx === -1) return notFound('流程实例不存在');
    if (mockWorkflowInstances[idx].status !== 'running') return badRequest('只有审批中的流程才能撤回');
    const def = mockWorkflowDefinitions.find(d => d.id === mockWorkflowInstances[idx].definitionId);
    const allowWithdraw = (def?.flowData?.settings as { allowWithdraw?: boolean } | undefined)?.allowWithdraw;
    if (allowWithdraw === false) return badRequest('该流程不允许发起人撤回');
    mockWorkflowInstances[idx] = {
      ...mockWorkflowInstances[idx],
      status: 'withdrawn',
      updatedAt: mockDateTime(),
    };
    // 将所有 pending 任务设为 skipped
    mockWorkflowTasks
      .filter(t => t.instanceId === params.id && t.status === 'pending')
      .forEach(t => {
        t.status = 'skipped';
        t.actionAt = mockDateTime();
      });
    return ok(mockWorkflowInstances[idx]);
  }),

  // 取消流程实例（管理员强制终止）
  mock(workflowInstanceContract.cancel, ({ params, ok }) => {
    const idx = mockWorkflowInstances.findIndex(i => i.id === params.id);
    if (idx === -1) return notFound('流程实例不存在');
    if (mockWorkflowInstances[idx].status !== 'running' && mockWorkflowInstances[idx].status !== 'suspended') return badRequest('只能取消进行中或已挂起的流程');
    mockWorkflowInstances[idx] = {
      ...mockWorkflowInstances[idx],
      status: 'cancelled',
      currentNodeKey: null,
      suspendedAt: null,
      suspendReason: null,
      updatedAt: mockDateTime(),
    };
    mockWorkflowTasks
      .filter(t => t.instanceId === params.id && (t.status === 'pending' || t.status === 'waiting'))
      .forEach(t => {
        t.status = 'skipped';
        t.actionAt = mockDateTime();
      });
    return ok(mockWorkflowInstances[idx]);
  }),

  // 挂起流程实例（冻结待办与计时）
  mock(workflowInstanceOpsContract.suspend, ({ params, body, ok }) => {
    const idx = mockWorkflowInstances.findIndex(i => i.id === params.id);
    if (idx === -1) return notFound('流程实例不存在');
    if (mockWorkflowInstances[idx].status !== 'running') return badRequest('仅审批中的流程可挂起');
    mockWorkflowInstances[idx] = {
      ...mockWorkflowInstances[idx],
      status: 'suspended',
      suspendedAt: mockDateTime(),
      suspendReason: body.reason,
      updatedAt: mockDateTime(),
    };
    return ok(mockWorkflowInstances[idx], '已挂起，计时已冻结');
  }),

  // 恢复挂起的流程实例
  mock(workflowInstanceOpsContract.resume, ({ params, ok }) => {
    const idx = mockWorkflowInstances.findIndex(i => i.id === params.id);
    if (idx === -1) return notFound('流程实例不存在');
    if (mockWorkflowInstances[idx].status !== 'suspended') return badRequest('仅已挂起的流程可恢复');
    mockWorkflowInstances[idx] = {
      ...mockWorkflowInstances[idx],
      status: 'running',
      suspendedAt: null,
      suspendReason: null,
      updatedAt: mockDateTime(),
    };
    return ok(mockWorkflowInstances[idx], '已恢复流转');
  }),

  // 离职交接：影响范围预览
  mock(workflowTaskContract.handoverPreview, ({ query, ok }) => {
    const fromUserId = query.fromUserId;
    const from = mockUsers.find(u => u.id === fromUserId);
    if (!from) return notFound('交接人不存在');
    const open = mockWorkflowTasks.filter(t => {
      if (t.assigneeId !== fromUserId) return false;
      if (t.status !== 'pending' && t.status !== 'waiting') return false;
      const inst = mockWorkflowInstances.find(i => i.id === t.instanceId);
      return inst?.status === 'running' || inst?.status === 'suspended';
    });
    return ok({
      fromUserName: from.nickname ?? from.username,
      pendingTaskCount: open.filter(t => t.status === 'pending').length,
      waitingTaskCount: open.filter(t => t.status === 'waiting').length,
      delegationCount: 0,
      affectedDefinitions: [],
    });
  }),

  // 离职交接：批量移交待办（按 X-Idempotency-Key 幂等）
  mock(workflowTaskContract.handover, ({ body, ok, request }) => {
    const idemKey = idempotencyKeyOf(request);
    const cached = idemKey ? handoverIdempotencyCache.get(idemKey) : undefined;
    if (cached) return ok(cached.data, cached.message);
    if (body.fromUserId === body.toUserId) return badRequest('接手人不能与交接人相同');
    const target = mockUsers.find(u => u.id === body.toUserId);
    if (!target) return badRequest('接手人不存在');
    const open = mockWorkflowTasks.filter(t => {
      if (t.assigneeId !== body.fromUserId) return false;
      if (t.status !== 'pending' && t.status !== 'waiting') return false;
      const inst = mockWorkflowInstances.find(i => i.id === t.instanceId);
      return inst?.status === 'running' || inst?.status === 'suspended';
    });
    let nextTransferId = 90_000;
    const results = open.map(t => {
      const inst = mockWorkflowInstances.find(i => i.id === t.instanceId);
      const fromName = t.assigneeName ?? null;
      t.transfers = [...(t.transfers ?? []), {
        id: nextTransferId++,
        fromUserId: t.assigneeId,
        fromUserName: fromName,
        toUserId: body.toUserId,
        toUserName: target.nickname ?? target.username,
        action: 'handover',
        reason: body.comment ?? null,
        operatorName: '管理员',
        createdAt: mockDateTime(),
      }];
      t.assigneeId = body.toUserId;
      t.assigneeName = target.nickname ?? target.username;
      t.comment = `[离职交接]${body.comment ? ' ' + body.comment : ''}`;
      return { taskId: t.id, title: inst?.title ?? `实例#${t.instanceId}`, nodeName: t.nodeName, success: true };
    });
    const data: WorkflowHandoverResult = {
      taskTotal: open.length,
      succeeded: open.length,
      failed: 0,
      delegationsDisabled: body.disableDelegations === false ? 0 : 1,
      results,
    };
    const message = `已交接 ${open.length}/${open.length} 条待办`;
    if (idemKey) handoverIdempotencyCache.set(idemKey, { data, message });
    return ok(data, message);
  }),

  // 删除流程实例（仅终态可删，级联删除任务）
  mock(workflowInstanceContract.remove, ({ params, ok }) => {
    const id = params.id;
    const idx = mockWorkflowInstances.findIndex(i => i.id === id);
    if (idx === -1) return notFound('流程实例不存在');
    if (mockWorkflowInstances[idx].status === 'running' || mockWorkflowInstances[idx].status === 'draft') {
      return badRequest('请先取消进行中的流程再删除');
    }
    mockWorkflowInstances.splice(idx, 1);
    removeWhere(mockWorkflowTasks, (task) => task.instanceId === id);
    return ok(null);
  }),

  // ─── 审批任务 ─────────────────────────────────────────────────────────────

  // 下一节点自选审批人候选
  mock(workflowTaskContract.selectableNextApprovers, ({ params, ok }) => {
    const task = mockWorkflowTasks.find(t => t.id === params.taskId);
    if (!task) return notFound('任务不存在');
    // 与服务端一致：已处理任务无需再选下一审批人，返回空组而非报错
    if (task.status !== 'pending') return ok([]);
    const inst = mockWorkflowInstances.find(i => i.id === task.instanceId);
    if (!inst) return notFound('流程实例不存在');
    const def = mockWorkflowDefinitions.find(d => d.id === inst.definitionId);
    const flowData = def?.flowData ?? null;
    if (!flowData) return ok([]);
    const groups = findNextApproverSelectNodes(flowData, task.nodeKey).map((node) => {
      const scopeType = node.data.selectScopeType ?? 'user';
      const scopeIds = node.data.selectScopeIds ?? [];
      const enabled = mockUsers.filter((u) => u.status === 'enabled');
      const inScope = scopeType === 'user' && scopeIds.length > 0
        ? enabled.filter((u) => scopeIds.includes(u.id))
        : enabled;
      return {
        nodeKey: node.data.key,
        label: node.data.label || node.data.key,
        selectableApprovers: inScope.map((u) => ({ id: u.id, name: u.nickname ?? u.username })),
      };
    });
    return ok(groups);
  }),

  // 审批通过（按 X-Idempotency-Key 幂等；返回所属实例最新状态）
  mock(workflowTaskContract.approve, ({ params, body, ok, request }) => {
    const idemKey = idempotencyKeyOf(request);
    const cached = idemKey ? approveIdempotencyCache.get(idemKey) : undefined;
    if (cached) return ok(cached.data, cached.message);
    const taskIdx = mockWorkflowTasks.findIndex(t => t.id === params.taskId);
    if (taskIdx === -1) return notFound('任务不存在');
    if (mockWorkflowTasks[taskIdx].status !== 'pending') return badRequest('该任务已处理');

    const now = mockDateTime();
    const attachments = body.attachments && body.attachments.length > 0 ? body.attachments : undefined;
    const current = mockWorkflowTasks[taskIdx];
    const instForUpdate = mockWorkflowInstances.find(i => i.id === current.instanceId);

    // 可编辑字段写回：与服务端一致，按节点 fieldPermissions 白名单过滤后合并进实例 formData
    if (body.formUpdates && instForUpdate) {
      const flow = instForUpdate.definitionSnapshot?.flowData
        ?? mockWorkflowDefinitions.find(d => d.id === instForUpdate.definitionId)?.flowData;
      const sanitized = sanitizeFormUpdatesByNodePerms(resolveNodeFieldPermissions(flow, current.nodeKey), body.formUpdates);
      if (Object.keys(sanitized).length > 0) {
        instForUpdate.formData = { ...(instForUpdate.formData ?? {}), ...sanitized };
        instForUpdate.updatedAt = now;
      }
    }

    const respond = (message?: string) => {
      const inst = mockWorkflowInstances.find(i => i.id === current.instanceId);
      if (!inst) return notFound('流程实例不存在');
      const data = withActiveNodes(inst);
      if (idemKey) approveIdempotencyCache.set(idemKey, { data, message: message ?? 'ok' });
      return ok(data, message);
    };

    // 委派回执：仅关闭当前任务、为原委派人生成新 pending，不推进流程
    if (current.delegatedFromId) {
      const receiptComment = `[委派回执] ${current.assigneeName ?? '审批人'} 建议同意：${body.comment ?? ''}`;
      mockWorkflowTasks[taskIdx] = { ...current, status: 'approved', comment: receiptComment, attachments, actionAt: now };
      createDelegationReceiptTask(current, receiptComment, now);
      return respond('已提交委派回执，等待原审批人确认');
    }

    mockWorkflowTasks[taskIdx] = {
      ...current,
      status: 'approved',
      comment: body.comment ?? null,
      attachments,
      signature: body.signature ?? null,
      actionAt: now,
    };

    const instanceId = mockWorkflowTasks[taskIdx].instanceId;
    const inst = mockWorkflowInstances.find(i => i.id === instanceId);
    if (inst) {
      // 检查是否还有 pending 任务
      const remainingPending = mockWorkflowTasks.filter(
        t => t.instanceId === instanceId && t.status === 'pending' && t.id !== mockWorkflowTasks[taskIdx].id
      );
      if (remainingPending.length === 0) {
        // 流程完成
        const instIdx = mockWorkflowInstances.findIndex(i => i.id === instanceId);
        if (instIdx !== -1) {
          mockWorkflowInstances[instIdx] = {
            ...mockWorkflowInstances[instIdx],
            status: 'approved',
            currentNodeKey: null,
            updatedAt: now,
          };
        }
      }
    }

    return respond();
  }),

  // 审批驳回（按 X-Idempotency-Key 幂等；返回所属实例最新状态）
  mock(workflowTaskContract.reject, ({ params, body, ok, request }) => {
    const idemKey = idempotencyKeyOf(request);
    const cached = idemKey ? approveIdempotencyCache.get(idemKey) : undefined;
    if (cached) return ok(cached.data, cached.message);
    const taskIdx = mockWorkflowTasks.findIndex(t => t.id === params.taskId);
    if (taskIdx === -1) return notFound('任务不存在');
    if (mockWorkflowTasks[taskIdx].status !== 'pending') return badRequest('该任务已处理');

    const now = mockDateTime();
    const attachments = body.attachments && body.attachments.length > 0 ? body.attachments : undefined;
    const current = mockWorkflowTasks[taskIdx];

    const respond = (message?: string) => {
      const inst = mockWorkflowInstances.find(i => i.id === current.instanceId);
      if (!inst) return notFound('流程实例不存在');
      const data = withActiveNodes(inst);
      if (idemKey) approveIdempotencyCache.set(idemKey, { data, message: message ?? 'ok' });
      return ok(data, message);
    };

    // 委派回执：仅关闭当前任务、为原委派人生成新 pending，不驳回流程
    if (current.delegatedFromId) {
      const receiptComment = `[委派回执] ${current.assigneeName ?? '审批人'} 建议拒绝：${body.comment ?? ''}`;
      mockWorkflowTasks[taskIdx] = { ...current, status: 'rejected', comment: receiptComment, attachments, actionAt: now };
      createDelegationReceiptTask(current, receiptComment, now);
      return respond('已提交委派回执，等待原审批人确认');
    }

    mockWorkflowTasks[taskIdx] = {
      ...mockWorkflowTasks[taskIdx],
      status: 'rejected',
      comment: body.comment ?? null,
      attachments,
      actionAt: now,
    };

    const instanceId = mockWorkflowTasks[taskIdx].instanceId;
    const instIdx = mockWorkflowInstances.findIndex(i => i.id === instanceId);
    if (instIdx !== -1) {
      mockWorkflowInstances[instIdx] = {
        ...mockWorkflowInstances[instIdx],
        status: 'rejected',
        currentNodeKey: null,
        updatedAt: now,
      };
      // 将其他 pending 任务设为 skipped
      mockWorkflowTasks
        .filter(t => t.instanceId === instanceId && t.status === 'pending')
        .forEach(t => {
          t.status = 'skipped';
          t.actionAt = now;
        });
    }

    return respond();
  }),

  // 转办
  mock(workflowTaskContract.transfer, ({ params, body, ok }) => {
    const taskIdx = mockWorkflowTasks.findIndex(t => t.id === params.taskId);
    if (taskIdx === -1) return notFound('任务不存在');
    const current = mockWorkflowTasks[taskIdx];
    if (current.status !== 'pending') return badRequest('该任务已处理');
    if (body.targetUserId === current.assigneeId) return badRequest('转办人不能是当前处理人');
    const handled = new Set((current.transfers ?? []).flatMap(tr => [tr.fromUserId, tr.toUserId]).filter((v): v is number => v != null));
    const original = current.originalAssigneeId ?? current.assigneeId;
    if (handled.has(body.targetUserId) || body.targetUserId === original) {
      return badRequest('禁止将任务转回曾经经手的处理人');
    }
    mockWorkflowTasks[taskIdx] = {
      ...current,
      assigneeId: body.targetUserId,
      assigneeName: `用户${body.targetUserId}`,
      comment: `[转办] ${body.comment ?? ''}`,
      attachments: body.attachments && body.attachments.length > 0 ? body.attachments : undefined,
      originalAssigneeId: current.originalAssigneeId ?? current.assigneeId,
      transfers: [...(current.transfers ?? []), {
        id: Date.now(),
        fromUserId: current.assigneeId,
        fromUserName: current.assigneeName ?? null,
        toUserId: body.targetUserId,
        toUserName: `用户${body.targetUserId}`,
        action: 'transfer',
        reason: body.comment ?? null,
        operatorName: current.assigneeName ?? null,
        createdAt: mockDateTime(),
      }],
    };
    return ok(mockWorkflowTasks[taskIdx]);
  }),

  // 委派
  mock(workflowTaskContract.delegate, ({ params, body, ok }) => {
    const taskIdx = mockWorkflowTasks.findIndex(t => t.id === params.taskId);
    if (taskIdx === -1) return notFound('任务不存在');
    const current = mockWorkflowTasks[taskIdx];
    if (current.status !== 'pending') return badRequest('该任务已处理');
    if (body.targetUserId === current.assigneeId) return badRequest('委派人不能是当前处理人');
    const delegateHandled = new Set((current.transfers ?? []).flatMap(tr => [tr.fromUserId, tr.toUserId]).filter((v): v is number => v != null));
    const original = current.originalAssigneeId ?? current.assigneeId;
    if (delegateHandled.has(body.targetUserId) || body.targetUserId === original) {
      return badRequest('禁止将任务委派给曾经经手的处理人');
    }
    mockWorkflowTasks[taskIdx] = {
      ...current,
      assigneeId: body.targetUserId,
      assigneeName: `用户${body.targetUserId}`,
      comment: `[委派] ${body.comment ?? ''}`,
      attachments: body.attachments && body.attachments.length > 0 ? body.attachments : undefined,
      originalAssigneeId: current.originalAssigneeId ?? current.assigneeId,
      transfers: [...(current.transfers ?? []), {
        id: Date.now(),
        fromUserId: current.assigneeId,
        fromUserName: current.assigneeName ?? null,
        toUserId: body.targetUserId,
        toUserName: `用户${body.targetUserId}`,
        action: 'delegate',
        reason: body.comment ?? null,
        operatorName: current.assigneeName ?? null,
        createdAt: mockDateTime(),
      }],
      delegatedFromId: current.delegatedFromId ?? current.assigneeId,
    };
    return ok(mockWorkflowTasks[taskIdx]);
  }),

  // 加签
  mock(workflowTaskContract.addSign, ({ params, body, ok }) => {
    const taskIdx = mockWorkflowTasks.findIndex(t => t.id === params.taskId);
    if (taskIdx === -1) return notFound('任务不存在');
    const current = mockWorkflowTasks[taskIdx];
    if (current.status !== 'pending') return badRequest('该任务已处理');
    const now = mockDateTime();
    const attachments = body.attachments && body.attachments.length > 0 ? body.attachments : undefined;
    if (body.position === 'before') {
      mockWorkflowTasks[taskIdx] = { ...current, status: 'waiting' };
    }
    body.targetUserIds.forEach(uid => {
      mockWorkflowTasks.push({
        id: getNextTaskId(),
        instanceId: current.instanceId,
        nodeKey: current.nodeKey,
        nodeName: current.nodeName,
        nodeType: current.nodeType,
        assigneeId: uid,
        assigneeName: `用户${uid}`,
        assigneeAvatar: null,
        status: 'pending',
        comment: `[加签] ${body.comment ?? ''}`,
        attachments,
        actionAt: null,
        actionButtons: null,
        createdAt: now,
      });
    });
    return ok(null, `已加签 ${body.targetUserIds.length} 人`);
  }),

  // 减签
  mock(workflowTaskContract.reduceSign, ({ params, body, ok }) => {
    const taskIdx = mockWorkflowTasks.findIndex(t => t.id === params.taskId);
    if (taskIdx === -1) return notFound('任务不存在');
    if (mockWorkflowTasks[taskIdx].status !== 'pending') return badRequest('该任务已处理');
    if (body.targetTaskIds.includes(params.taskId)) return badRequest('不能减去自己');
    const now = mockDateTime();
    const suffix = body.comment ? `：${body.comment}` : '';
    let removed = 0;
    body.targetTaskIds.forEach((tid) => {
      const idx = mockWorkflowTasks.findIndex((t) => t.id === tid);
      if (idx === -1) return;
      const t = mockWorkflowTasks[idx];
      if (t.status !== 'pending' && t.status !== 'waiting') return;
      if (!t.comment?.includes('[加签')) return;
      mockWorkflowTasks[idx] = { ...t, status: 'skipped', actionAt: now, comment: `[减签]${suffix}` };
      removed += 1;
    });
    return ok(null, `已减签 ${removed} 人`);
  }),

  // 催办：单任务
  mock(workflowTaskContract.urgeTask, ({ params, body, ok }) => {
    const taskId = params.taskId;
    const task = mockWorkflowTasks.find(t => t.id === taskId);
    if (!task) return notFound('任务不存在');
    if (task.status !== 'pending') return badRequest('该任务已处理');
    const inst = mockWorkflowInstances.find(i => i.id === task.instanceId);
    if (!inst) return notFound('流程不存在');
    if (inst.status !== 'running') return badRequest('流程已结束，无需催办');
    const last = mockWorkflowUrges.filter(u => u.taskId === taskId).sort((a, b) => b.id - a.id)[0];
    if (last && Date.now() - new Date(last.createdAt).getTime() < URGE_MIN_INTERVAL_MS) {
      const wait = Math.ceil((URGE_MIN_INTERVAL_MS - (Date.now() - new Date(last.createdAt).getTime())) / 1000);
      return fail(429, `催办过于频繁，请 ${wait}s 后再试`);
    }
    const row: WorkflowTaskUrge = {
      id: urgeIdSeq++,
      taskId,
      instanceId: inst.id,
      urgerId: 1,
      urgerName: 'admin',
      message: body.message?.trim() || null,
      createdAt: mockDateTime(),
    };
    mockWorkflowUrges.push(row);
    return ok(row, '已催办');
  }),

  // 催办：单任务历史
  mock(workflowTaskContract.taskUrges, ({ params, ok }) => {
    const list = mockWorkflowUrges.filter(u => u.taskId === params.taskId).sort((a, b) => b.id - a.id);
    return ok(list);
  }),

  // 催办：实例历史
  mock(workflowInstanceContract.urges, ({ params, ok }) => {
    const list = mockWorkflowUrges.filter(u => u.instanceId === params.id).sort((a, b) => b.id - a.id);
    return ok(list);
  }),

  // 催办：实例批量
  mock(workflowInstanceContract.urge, ({ params, body, ok }) => {
    const instId = params.id;
    const inst = mockWorkflowInstances.find(i => i.id === instId);
    if (!inst) return notFound('流程不存在');
    if (inst.status !== 'running') return badRequest('流程已结束，无需催办');
    const pendings = mockWorkflowTasks.filter(t => t.instanceId === instId && t.status === 'pending');
    if (pendings.length === 0) return badRequest('没有待办任务可催办');
    const now = mockDateTime();
    const nowMs = Date.now();
    const created: WorkflowTaskUrge[] = [];
    let skipped = 0;
    pendings.forEach((task) => {
      const last = mockWorkflowUrges.filter(u => u.taskId === task.id).sort((a, b) => b.id - a.id)[0];
      if (last && nowMs - new Date(last.createdAt).getTime() < URGE_MIN_INTERVAL_MS) {
        skipped += 1;
        return;
      }
      const row: WorkflowTaskUrge = {
        id: urgeIdSeq++,
        taskId: task.id,
        instanceId: instId,
        urgerId: 1,
        urgerName: 'admin',
        message: body.message?.trim() || null,
        createdAt: now,
      };
      mockWorkflowUrges.push(row);
      created.push(row);
    });
    const msg = skipped > 0
      ? `已催办 ${created.length} 人，${skipped} 人催办过于频繁已跳过`
      : `已催办 ${created.length} 人`;
    return ok(created, msg);
  }),

  // 动态补加抄送
  mock(workflowInstanceContract.addCc, ({ params, body, ok }) => {
    const instId = params.id;
    const inst = mockWorkflowInstances.find(i => i.id === instId);
    if (!inst) return notFound('流程不存在');
    if (inst.status !== 'running') return badRequest('流程已结束，无法补加抄送');

    // 去重：过滤掉当前实例 + 节点已经抄送过的用户
    const existingSet = new Set(
      mockWorkflowTasks
        .filter(t => t.instanceId === instId && t.nodeKey === body.nodeKey && t.nodeType === 'ccNode')
        .map(t => t.assigneeId)
        .filter((v): v is number => typeof v === 'number'),
    );
    const toAdd = Array.from(new Set(body.userIds)).filter(uid => !existingSet.has(uid));
    if (toAdd.length === 0) {
      return ok([], '所选用户均已抄送，无需重复添加');
    }
    const now = mockDateTime();
    const sample = mockWorkflowTasks.find(t => t.instanceId === instId && t.nodeKey === body.nodeKey);
    const inserted = toAdd.map((uid) => {
      const task: WorkflowTask = {
        id: getNextTaskId(),
        instanceId: instId,
        nodeKey: body.nodeKey,
        nodeName: sample?.nodeName ?? '抄送',
        nodeType: 'ccNode',
        assigneeId: uid,
        status: 'skipped',
        comment: null,
        actionAt: null,
        createdAt: now,
      };
      mockWorkflowTasks.push(task);
      return task;
    });
    return ok(inserted, `已补加 ${inserted.length} 人抄送`);
  }),

  // 退回
  mock(workflowTaskContract.returnTask, ({ params, body, ok }) => {
    const taskIdx = mockWorkflowTasks.findIndex(t => t.id === params.taskId);
    if (taskIdx === -1) return notFound('任务不存在');
    if (mockWorkflowTasks[taskIdx].status !== 'pending') return badRequest('该任务已处理');
    const firstNodeKey = body.targetNodeKeys[0];
    const now = mockDateTime();
    const current = mockWorkflowTasks[taskIdx];
    const tag = body.targetNodeKeys.length > 1
      ? `[退回多节点: ${body.targetNodeKeys.join('、')}]`
      : `[退回至 ${firstNodeKey}]`;
    mockWorkflowTasks[taskIdx] = {
      ...current,
      status: 'rejected',
      comment: `${tag} ${body.comment}`,
      attachments: body.attachments && body.attachments.length > 0 ? body.attachments : undefined,
      actionAt: now,
    };
    const instIdx = mockWorkflowInstances.findIndex(i => i.id === current.instanceId);
    if (instIdx === -1) return notFound('流程实例不存在');
    mockWorkflowInstances[instIdx] = {
      ...mockWorkflowInstances[instIdx],
      currentNodeKey: firstNodeKey,
      updatedAt: now,
    };
    return ok(mockWorkflowInstances[instIdx]);
  }),
];
