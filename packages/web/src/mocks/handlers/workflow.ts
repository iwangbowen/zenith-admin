import { http, HttpResponse } from 'msw';
import type { WorkflowDefinition, WorkflowDefinitionVersion, WorkflowEngineIntrospection, WorkflowEngineOutboxEvent, WorkflowEngineRuntimeTask, WorkflowFlowData, WorkflowFormField, WorkflowInstance, WorkflowInstanceFormSnapshot, WorkflowRuntimeDiagnostics, WorkflowRuntimeIssue, WorkflowSimulationDecision, WorkflowSimulationResult, WorkflowTask, WorkflowTaskUrge } from '@zenith/shared';
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
import { mockWorkflowJobs, mockWorkflowJobExecutions } from '@/mocks/data/workflow-jobs';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';
import dayjs from 'dayjs';
import { DATE_TIME_FORMAT } from '@/utils/date';
import { mockWorkflowTriggerExecutions } from './workflow-trigger-executions';

function ok<T>(data: T, message = 'ok') {
  return HttpResponse.json({ code: 0, message, data });
}

function err(message: string, code = 400) {
  return HttpResponse.json({ code, message });
}

type MockApiPayload<T = unknown> = { code: number; message: string; data: T };
const idempotencyCache = new Map<string, MockApiPayload>();

function readIdempotentResponse(request: Request) {
  const key = request.headers.get('X-Idempotency-Key');
  const payload = key ? idempotencyCache.get(key) : undefined;
  return payload ? HttpResponse.json(payload) : null;
}

function okIdempotent<T>(request: Request, data: T, message = 'ok') {
  const payload: MockApiPayload<T> = { code: 0, message, data };
  const key = request.headers.get('X-Idempotency-Key');
  if (key) idempotencyCache.set(key, payload);
  return HttpResponse.json(payload);
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
      title: '事件 Outbox 重放失败',
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
    queueSnapshot('eventOutbox', '工作流事件 Outbox', {
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
        { label: 'Cron Handler', value: '已注册', status: 'healthy' },
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
        { label: 'Cron Handler', value: '已注册', status: 'healthy' },
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
      name: '事件 Outbox',
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
      description: '用户 Cron、系统周期任务、延时唤醒队列和恢复扫描。',
      status: 'healthy',
      metrics: [
        { label: '初始化', value: '是', status: 'healthy' },
        { label: '运行中 Job', value: 1 },
        { label: '系统周期任务', value: 2 },
        { label: '系统队列 Worker', value: 1 },
      ],
      internals: { wip: [{ name: 'workflow-delay-wakeup', count: 1 }] },
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
      { name: 'workflow-timeout-scan', cronExpression: '*/5 * * * *', registeredAt: mockDateTimeOffset(-2 * 60 * 60 * 1000), nextRunAt: mockDateTimeOffset(3 * 60 * 1000) },
      { name: 'workflow-subprocess-recovery', cronExpression: '*/10 * * * *', registeredAt: mockDateTimeOffset(-2 * 60 * 60 * 1000), nextRunAt: mockDateTimeOffset(7 * 60 * 1000) },
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
      registeredHandlers: ['processWorkflowTaskTimeouts', 'recoverStuckWorkflowSubProcesses', 'replayWorkflowEventOutbox'],
      systemRecurringJobs: [
        {
          ...systemSchedulerTaskBase,
          name: 'workflow-timeout-scan',
          title: '工作流超时扫描',
          module: '工作流',
          description: '扫描超时待办并触发提醒、自动处理或升级。',
          taskType: 'recurring',
          cronExpression: '*/5 * * * *',
          registeredAt: mockDateTimeOffset(-2 * 60 * 60 * 1000),
          allowManualRun: true,
          lastRunAt: mockDateTimeOffset(-5 * 60 * 1000),
          lastRunStatus: 'success',
          lastRunMessage: '扫描 3 个超时任务',
          lastDurationMs: 420,
        },
        {
          ...systemSchedulerTaskBase,
          name: 'workflow-subprocess-recovery',
          title: '工作流子流程恢复',
          module: '工作流',
          description: '恢复子流程 spawn、resume 和多实例汇聚中断场景。',
          taskType: 'recurring',
          cronExpression: '*/10 * * * *',
          registeredAt: mockDateTimeOffset(-2 * 60 * 60 * 1000),
          allowManualRun: true,
          lastRunAt: mockDateTimeOffset(-10 * 60 * 1000),
          lastRunStatus: 'success',
          lastRunMessage: '子流程恢复扫描完成',
          lastDurationMs: 380,
        },
      ],
      systemQueueWorkers: [
        {
          ...systemSchedulerTaskBase,
          manualSingleton: false,
          name: 'workflow-delay-wakeup',
          title: '工作流延时唤醒 Worker',
          module: '工作流',
          description: '消费 delay 节点唤醒队列，到期后恢复等待中的工作流任务。',
          taskType: 'queue',
          cronExpression: null,
          registeredAt: mockDateTimeOffset(-2 * 60 * 60 * 1000),
          allowManualRun: false,
          lastRunAt: mockDateTimeOffset(-15 * 60 * 1000),
          lastRunStatus: 'success',
          lastRunMessage: '任务 1024 已恢复执行',
          lastDurationMs: 80,
        },
      ],
      wip: [{ name: 'workflow-delay-wakeup', count: 1 }],
    },
    runtime: {
      runningInstances: runningInstances.length,
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
  return {
    ...inst,
    currentNodeKeys,
    currentNodeNames,
    currentNodeName: currentNodeNames[0] ?? resolveCurrentNodeName(inst),
  };
}

// 催办流水（内存）
const mockWorkflowUrges: WorkflowTaskUrge[] = [];
let urgeIdSeq = 1;
const URGE_MIN_INTERVAL_MS = 5 * 60 * 1000;

// ─── 流程定义 Handler ──────────────────────────────────────────────────────

export const workflowHandlers = [
  // 获取流程定义列表（分页 + 搜索 + 状态筛选）
  http.get('/api/workflows/definitions', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';

    let list = [...mockWorkflowDefinitions];
    if (keyword) list = list.filter(d => d.name.includes(keyword) || (d.description ?? '').includes(keyword));
    if (status) list = list.filter(d => d.status === status);

    const total = list.length;
    const paged = list.slice((page - 1) * pageSize, page * pageSize).map(resolveWorkflowDefinition);
    return ok({ list: paged, total, page, pageSize });
  }),

  // 获取已发布的流程定义列表（发起申请时使用，返回数组而非分页对象）
  http.get('/api/workflows/definitions/published', () => {
    const list = mockWorkflowDefinitions.filter(d => d.status === 'published' && d.formType !== 'external').map(resolveWorkflowDefinition);
    return ok(list);
  }),

  // 流程仿真（Demo 模式轻量实现）
  http.post('/api/workflows/definitions/simulate', async ({ request }) => {
    const body = await request.json().catch(() => ({})) as { definitionId?: number; flowData?: WorkflowFlowData | null; starterUserId?: number; decisions?: WorkflowSimulationDecision[] };
    const definition = body.definitionId ? mockWorkflowDefinitions.find((item) => item.id === body.definitionId) : undefined;
    const flowData = body.flowData ?? definition?.flowData ?? null;
    return ok(buildMockSimulationResult(flowData, body.starterUserId, body.decisions ?? []));
  }),

  // 获取单个流程定义
  http.get('/api/workflows/definitions/:id', ({ params }) => {
    const def = mockWorkflowDefinitions.find(d => d.id === Number(params.id));
    if (!def) return err('流程定义不存在', 404);
    return ok(resolveWorkflowDefinition(def));
  }),

  // 创建流程定义
  http.post('/api/workflows/definitions', async ({ request }) => {
    const body = await request.json() as Partial<WorkflowDefinition>;
    const now = mockDateTime();
    const newDef: WorkflowDefinition = {
      id: getNextDefinitionId(),
      name: body.name ?? '新流程',
      description: body.description ?? null,
      categoryId: body.categoryId ?? null,
      initiatorScopeType: body.initiatorScopeType ?? 'all',
      initiatorScopeIds: body.initiatorScopeType === 'all' ? null : (body.initiatorScopeIds ?? []),
      flowData: body.flowData ?? null,
      formId: isBusinessFormType(body.formType) ? null : (body.formId ?? null),
      formFields: null,
      formType: body.formType ?? 'designer',
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
  http.put('/api/workflows/definitions/:id', async ({ params, request }) => {
    const idx = mockWorkflowDefinitions.findIndex(d => d.id === Number(params.id));
    if (idx === -1) return err('流程定义不存在', 404);
    const body = await request.json() as Partial<WorkflowDefinition>;
    const prev = mockWorkflowDefinitions[idx];
    // 已发布的流程保存后自动转为草稿
    const nextStatus = prev.status === 'published' && body.status === undefined ? 'draft' : prev.status;
    const nextFormType = body.formType ?? prev.formType;
    const updated: WorkflowDefinition = {
      ...prev,
      ...body,
      id: prev.id,
      formId: isBusinessFormType(nextFormType) ? null : (body.formId !== undefined ? body.formId : prev.formId),
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

  // 发布流程定义
  // 批量禁用流程定义（仅已发布）
  http.post('/api/workflows/definitions/batch-disable', async ({ request }) => {
    const { ids } = await request.json() as { ids: number[] };
    const now = mockDateTime();
    let updated = 0;
    for (const id of ids ?? []) {
      const idx = mockWorkflowDefinitions.findIndex(d => d.id === id);
      if (idx === -1 || mockWorkflowDefinitions[idx].status !== 'published') continue;
      mockWorkflowDefinitions[idx] = { ...mockWorkflowDefinitions[idx], status: 'disabled', updatedAt: now };
      updated++;
    }
    const skipped = (ids?.length ?? 0) - updated;
    return ok(null, skipped > 0 ? `成功禁用 ${updated} 条，${skipped} 条已跳过（非已发布状态）` : `成功禁用 ${updated} 条`);
  }),

  // 批量启用流程定义（仅已禁用）
  http.post('/api/workflows/definitions/batch-enable', async ({ request }) => {
    const { ids } = await request.json() as { ids: number[] };
    const now = mockDateTime();
    let updated = 0;
    for (const id of ids ?? []) {
      const idx = mockWorkflowDefinitions.findIndex(d => d.id === id);
      if (idx === -1 || mockWorkflowDefinitions[idx].status !== 'disabled') continue;
      mockWorkflowDefinitions[idx] = { ...mockWorkflowDefinitions[idx], status: 'published', updatedAt: now };
      updated++;
    }
    const skipped = (ids?.length ?? 0) - updated;
    return ok(null, skipped > 0 ? `成功启用 ${updated} 条，${skipped} 条已跳过（非已禁用状态）` : `成功启用 ${updated} 条`);
  }),

  // 批量删除流程定义（仅非已发布且无发起实例）
  http.post('/api/workflows/definitions/batch-delete', async ({ request }) => {
    const { ids } = await request.json() as { ids: number[] };
    let deleted = 0;
    for (const id of ids ?? []) {
      const idx = mockWorkflowDefinitions.findIndex(d => d.id === id);
      if (idx === -1) continue;
      if (mockWorkflowDefinitions[idx].status === 'published') continue;
      if (mockWorkflowInstances.some(i => i.definitionId === id)) continue;
      mockWorkflowDefinitions.splice(idx, 1);
      deleted++;
    }
    const skipped = (ids?.length ?? 0) - deleted;
    return ok(null, skipped > 0 ? `成功删除 ${deleted} 条，${skipped} 条已跳过（已发布或存在发起实例）` : `成功删除 ${deleted} 条`);
  }),

  http.post('/api/workflows/definitions/:id/publish', ({ params }) => {
    const idx = mockWorkflowDefinitions.findIndex(d => d.id === Number(params.id));
    if (idx === -1) return err('流程定义不存在', 404);
    if (!mockWorkflowDefinitions[idx].flowData) return err('流程图不能为空，请先设计流程');
    const cur = mockWorkflowDefinitions[idx];
    if (cur.formType === 'custom' && !cur.customForm?.createComponent?.trim()) {
      return err('请先在「表单」步骤配置自定义业务表单的创建页组件路径');
    }
    if (cur.formType === 'external' && !cur.customForm?.viewComponent?.trim()) {
      return err('请先在「表单」步骤配置业务系统主导流程的审批查看页组件路径');
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
  http.post('/api/workflows/definitions/:id/disable', ({ params }) => {
    const idx = mockWorkflowDefinitions.findIndex(d => d.id === Number(params.id));
    if (idx === -1) return err('流程定义不存在', 404);
    mockWorkflowDefinitions[idx] = {
      ...mockWorkflowDefinitions[idx],
      status: 'disabled',
      updatedAt: mockDateTime(),
    };
    return ok(resolveWorkflowDefinition(mockWorkflowDefinitions[idx]));
  }),

  // 启用流程定义
  http.post('/api/workflows/definitions/:id/enable', ({ params }) => {
    const idx = mockWorkflowDefinitions.findIndex(d => d.id === Number(params.id));
    if (idx === -1) return err('流程定义不存在', 404);
    if (mockWorkflowDefinitions[idx].status !== 'disabled') return err('流程定义不存在或不处于禁用状态');
    mockWorkflowDefinitions[idx] = {
      ...mockWorkflowDefinitions[idx],
      status: 'published',
      updatedAt: mockDateTime(),
    };
    return ok(resolveWorkflowDefinition(mockWorkflowDefinitions[idx]));
  }),

  // 删除流程定义
  http.delete('/api/workflows/definitions/:id', ({ params }) => {
    const idx = mockWorkflowDefinitions.findIndex(d => d.id === Number(params.id));
    if (idx === -1) return err('流程定义不存在', 404);
    mockWorkflowDefinitions.splice(idx, 1);
    return ok(null);
  }),

  // 流程定义历史版本列表
  http.get('/api/workflows/definitions/:id/versions', ({ params }) => {
    const definitionId = Number(params.id);
    if (!mockWorkflowDefinitions.some(d => d.id === definitionId)) return err('流程定义不存在', 404);
    const list = mockWorkflowDefinitionVersions
      .filter(v => v.definitionId === definitionId)
      .sort((a, b) => b.version - a.version)
      .map(resolveWorkflowDefinitionVersion);
    return ok(list);
  }),

  // 恢复历史版本
  http.post('/api/workflows/definitions/:id/versions/:versionId/restore', ({ params }) => {
    const idx = mockWorkflowDefinitions.findIndex(d => d.id === Number(params.id));
    if (idx === -1) return err('流程定义不存在', 404);
    const ver = mockWorkflowDefinitionVersions.find(v => v.id === Number(params.versionId) && v.definitionId === Number(params.id));
    if (!ver) return err('历史版本不存在', 404);
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

  // ─── 流程实例 Handler ──────────────────────────────────────────────────────

  // 我的申请列表（当前用户 initiatorId=1）
  http.get('/api/workflows/instances', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const status = url.searchParams.get('status') ?? '';

    let list = mockWorkflowInstances.filter(i => i.initiatorId === 1);
    if (status) list = list.filter(i => i.status === status);
    list = [...list].sort((a, b) => b.id - a.id);

    const total = list.length;
    const paged = list.slice((page - 1) * pageSize, page * pageSize).map(i => ({
      ...withActiveNodes(i),
      tasks: undefined, // 列表不返回 tasks
    }));
    return ok({ list: paged, total, page, pageSize });
  }),

  // 待我审批列表（assigneeId=1 且 status=pending 的任务所对应的实例）
  http.get('/api/workflows/instances/pending-mine', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const keyword = url.searchParams.get('keyword') ?? '';
    const definitionIdStr = url.searchParams.get('definitionId') ?? '';
    const definitionId = definitionIdStr ? Number(definitionIdStr) : null;

    const pendingTaskIds = mockWorkflowTasks
      .filter(t => t.assigneeId === 1 && t.status === 'pending')
      .map(t => ({ instanceId: t.instanceId, taskId: t.id }));

    let list = pendingTaskIds.map(({ instanceId, taskId }) => {
      const inst = mockWorkflowInstances.find(i => i.id === instanceId);
      return inst ? { ...withActiveNodes(inst), pendingTaskId: taskId, tasks: undefined } : null;
    }).filter(Boolean) as (WorkflowInstance & { pendingTaskId: number })[];

    if (keyword) list = list.filter(i => i.title?.includes(keyword));
    if (definitionId !== null) list = list.filter(i => i.definitionId === definitionId);

    const total = list.length;
    const paged = list.slice((page - 1) * pageSize, page * pageSize);
    return ok({ list: paged, total, page, pageSize });
  }),

  // 全局流程监控（管理员看板）— 必须在 /instances/:id 之前注册，避免被参数路由捕获
  http.get('/api/workflows/instances/all', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 20;
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const categoryIdStr = url.searchParams.get('categoryId') ?? '';
    const initiatorKeyword = url.searchParams.get('initiatorKeyword') ?? '';

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
    if (status) list = list.filter(i => i.status === status);
    if (categoryIdStr) list = list.filter(i => i.categoryId === Number(categoryIdStr));
    if (initiatorKeyword) list = list.filter(i => (i.initiatorName ?? '').includes(initiatorKeyword));

    const total = list.length;
    const paged = list
      .slice()
      .sort((a, b) => b.id - a.id)
      .slice((page - 1) * pageSize, page * pageSize)
      .map(i => ({ ...withActiveNodes(i), tasks: undefined }));

    return ok({ stats, list: paged, total, page, pageSize });
  }),

  http.get('/api/workflows/engine/introspection', ({ request }) => {
    const url = new URL(request.url);
    const threshold = Number(url.searchParams.get('thresholdMinutes')) || 30;
    return ok(buildMockWorkflowEngineIntrospection(Math.max(1, Math.min(threshold, 24 * 60))));
  }),

  http.get('/api/workflows/engine/health-history', ({ request }) => {
    const url = new URL(request.url);
    const hours = Math.max(1, Math.min(Number(url.searchParams.get('hours')) || 24, 24 * 30));
    const stepMin = 30;
    const count = Math.min(Math.floor((hours * 60) / stepMin), 5000);
    const points = Array.from({ length: count }, (_, i) => {
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

  http.post('/api/workflows/engine/actions/:action', ({ params }) => {
    const action = String(params.action);
    const labels: Record<string, string> = {
      'replay-outbox': '事件 Outbox 重放',
      'recover-delays': '延时任务恢复扫描',
      'recover-subprocess': '子流程恢复扫描',
      'process-timeouts': '超时任务处理',
      'recover-triggers': '触发器恢复重派',
    };
    if (!(action in labels)) return err('未知运维动作', 400);
    const detail: Record<string, number> = { scanned: 2, dispatched: 1, failed: 0 };
    const summary = Object.entries(detail).map(([k, v]) => `${k} ${v}`).join(' · ');
    return ok({ action, ok: true, message: `${labels[action]}完成：${summary}`, detail });
  }),

  // ── 统一作业账本（workflow_jobs）死信 / 补偿中心 ──
  http.get('/api/workflows/engine/jobs', ({ request }) => {
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const pageSize = Math.max(1, Number(url.searchParams.get('pageSize')) || 10);
    const jobType = url.searchParams.get('jobType') || '';
    const status = url.searchParams.get('status') || '';
    const keyword = (url.searchParams.get('keyword') || '').trim().toLowerCase();
    let list = [...mockWorkflowJobs].sort((a, b) => b.id - a.id);
    if (jobType) list = list.filter((j) => j.jobType === jobType);
    if (status) list = list.filter((j) => j.status === status);
    if (keyword) {
      list = list.filter((j) =>
        (j.idempotencyKey ?? '').toLowerCase().includes(keyword)
        || (j.traceId ?? '').toLowerCase().includes(keyword)
        || (j.nodeKey ?? '').toLowerCase().includes(keyword));
    }
    const total = list.length;
    const start = (page - 1) * pageSize;
    return ok({ list: list.slice(start, start + pageSize), total, page, pageSize });
  }),

  http.get('/api/workflows/engine/jobs/summary', () => {
    const types = ['delay_wake', 'task_timeout', 'trigger_dispatch', 'external_dispatch', 'subprocess_spawn', 'subprocess_join', 'event_dispatch', 'webhook_delivery'] as const;
    const statuses = ['pending', 'running', 'succeeded', 'failed', 'dead', 'canceled'] as const;
    const summary = types.map((jobType) => {
      const rows = mockWorkflowJobs.filter((j) => j.jobType === jobType);
      const item: Record<string, number | string> = { jobType, total: rows.length };
      for (const s of statuses) item[s] = rows.filter((j) => j.status === s).length;
      return item;
    });
    return ok(summary);
  }),

  http.get('/api/workflows/engine/jobs/:id', ({ params }) => {
    const id = Number(params.id);
    const job = mockWorkflowJobs.find((j) => j.id === id);
    if (!job) return err('作业不存在', 404);
    const executions = mockWorkflowJobExecutions
      .filter((e) => e.jobId === id)
      .sort((a, b) => b.id - a.id);
    return ok({ ...job, executions });
  }),

  http.post('/api/workflows/engine/jobs/:id/retry', async ({ params, request }) => {
    const id = Number(params.id);
    const job = mockWorkflowJobs.find((j) => j.id === id);
    if (!job) return err('作业不存在', 404);
    if (!['failed', 'dead', 'canceled'].includes(job.status)) return err('仅失败 / 死信 / 已取消的作业可重试', 400);
    const body = await request.json().catch(() => ({})) as { payload?: Record<string, unknown> };
    if (body?.payload) job.payload = body.payload;
    job.status = 'pending';
    job.attempts = 0;
    job.lockedAt = null;
    job.lockedBy = null;
    job.lastError = null;
    job.runAt = mockDateTime();
    job.updatedAt = mockDateTime();
    return ok(job, '已重新入队');
  }),

  http.post('/api/workflows/engine/jobs/:id/skip', ({ params }) => {
    const id = Number(params.id);
    const job = mockWorkflowJobs.find((j) => j.id === id);
    if (!job) return err('作业不存在', 404);
    if (!['pending', 'failed', 'dead'].includes(job.status)) return err('仅待处理 / 失败 / 死信的作业可跳过', 400);
    job.status = 'canceled';
    job.lockedAt = null;
    job.updatedAt = mockDateTime();
    return ok(job, '已跳过');
  }),

  http.get('/api/workflows/instances/:id/diagnostics', ({ params }) => {
    const inst = mockWorkflowInstances.find(i => i.id === Number(params.id));
    if (!inst) return err('流程实例不存在', 404);
    const tasks = mockWorkflowTasks
      .filter(t => t.instanceId === inst.id)
      .sort((a, b) => a.id - b.id);
    const activeTasks = tasks.filter(t => t.status === 'pending' || t.status === 'waiting');
    const triggerExecutions = mockWorkflowTriggerExecutions.filter(item => item.instanceId === inst.id);
    const outboxEvents = [
      {
        id: inst.id * 10 + 1,
        eventId: `mock-node-entered-${inst.id}`,
        eventType: 'node.entered',
        taskId: activeTasks[0]?.id ?? null,
        status: inst.status === 'running' ? 'success' : 'success',
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
          title: 'Outbox 事件待处理',
          description: `${event.eventType} 当前状态为 ${event.status}，attempts=${event.attempts}。`,
        });
      }
    }
    if (issues.length === 0) {
      issues.push({
        severity: 'info',
        source: 'instance',
        title: '未发现明显运行时异常',
        description: 'Demo 诊断：任务、触发器和 outbox 均未命中异常规则。',
      });
    }
    const diagnostics: WorkflowRuntimeDiagnostics = {
      instance: { ...withDefinitionSnapshot(withActiveNodes(inst)), tasks },
      tasks,
      activeTasks,
      triggerExecutions,
      outboxEvents,
      issues,
      snapshot: {
        formData: inst.formData ?? null,
        formSnapshot: inst.formSnapshot ?? null,
        definitionSnapshot: withDefinitionSnapshot(inst).definitionSnapshot ?? null,
      },
      generatedAt: mockDateTime(),
    };
    return ok(diagnostics);
  }),

  // 实例运行轨迹 + 引擎解释
  http.get('/api/workflows/instances/:id/trace', ({ params }) => {
    const id = Number(params.id);
    const t0 = mockDateTimeOffset(-1000 * 60 * 90); // 90 分钟前
    const t1 = mockDateTimeOffset(-1000 * 60 * 88);
    const t2 = mockDateTimeOffset(-1000 * 60 * 60);
    const trace = [
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
    const trace_instance = {
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
    return ok(trace_instance);
  }),

  // 获取流程实例详情（含任务列表）
  http.get('/api/workflows/instances/:id', ({ params }) => {
    const inst = mockWorkflowInstances.find(i => i.id === Number(params.id));
    if (!inst) return err('流程实例不存在', 404);
    const tasks = mockWorkflowTasks.filter(t => t.instanceId === inst.id)
      .sort((a, b) => a.id - b.id);
    // 子流程：聚合本实例发起的子实例摘要
    const childInstances = mockWorkflowInstances
      .filter(i => i.parentInstanceId === inst.id)
      .map(c => ({ id: c.id, title: c.title, status: c.status, parentTaskNodeKey: null, createdAt: c.createdAt }));
    return ok({ ...withDefinitionSnapshot(withActiveNodes(inst)), tasks, childInstances });
  }),

  // 发起流程申请（支持保存草稿 asDraft）
  http.post('/api/workflows/instances', async ({ request }) => {
    const body = await request.json() as { definitionId: number; title: string; formData: Record<string, unknown>; asDraft?: boolean; priority?: 'low' | 'normal' | 'high' | 'urgent'; ccUserIds?: number[] };
    const def = mockWorkflowDefinitions.find(d => d.id === body.definitionId);
    if (!def) return err('流程定义不存在');
    if (def.status !== 'published') return err('该流程未发布，无法发起申请');
    if (def.formType === 'external') return err('业务系统主导流程请从对应业务模块发起');

    const now = mockDateTime();
    const instanceId = getNextInstanceId();
    const isDraft = body.asDraft === true;

    // 业务编号：仅正式发起时生成
    const serialCfg = (def.flowData?.settings as { serialNo?: { enabled?: boolean; prefix?: string; seqLength?: number } } | undefined)?.serialNo;
    let serialNo: string | null = null;
    if (!isDraft && serialCfg?.enabled) {
      serialNo = `${serialCfg.prefix ?? ''}${String(instanceId).padStart(serialCfg.seqLength ?? 4, '0')}`;
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
      formData: body.formData,
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
  http.post('/api/workflows/instances/:id/withdraw', ({ params }) => {
    const idx = mockWorkflowInstances.findIndex(i => i.id === Number(params.id));
    if (idx === -1) return err('流程实例不存在', 404);
    if (mockWorkflowInstances[idx].status !== 'running') return err('只有审批中的流程才能撤回');
    mockWorkflowInstances[idx] = {
      ...mockWorkflowInstances[idx],
      status: 'withdrawn',
      updatedAt: mockDateTime(),
    };
    // 将所有 pending 任务设为 skipped
    mockWorkflowTasks
      .filter(t => t.instanceId === Number(params.id) && t.status === 'pending')
      .forEach(t => {
        t.status = 'skipped';
        t.actionAt = mockDateTime();
      });
    return ok(mockWorkflowInstances[idx]);
  }),

  // 取消流程实例（管理员强制终止）
  http.post('/api/workflows/instances/:id/cancel', ({ params }) => {
    const idx = mockWorkflowInstances.findIndex(i => i.id === Number(params.id));
    if (idx === -1) return err('流程实例不存在', 404);
    if (mockWorkflowInstances[idx].status !== 'running') return err('只能取消进行中的流程');
    mockWorkflowInstances[idx] = {
      ...mockWorkflowInstances[idx],
      status: 'cancelled',
      currentNodeKey: null,
      updatedAt: mockDateTime(),
    };
    mockWorkflowTasks
      .filter(t => t.instanceId === Number(params.id) && (t.status === 'pending' || t.status === 'waiting'))
      .forEach(t => {
        t.status = 'skipped';
        t.actionAt = mockDateTime();
      });
    return ok(mockWorkflowInstances[idx]);
  }),

  // 删除流程实例（仅终态可删，级联删除任务）
  http.delete('/api/workflows/instances/:id', ({ params }) => {
    const id = Number(params.id);
    const idx = mockWorkflowInstances.findIndex(i => i.id === id);
    if (idx === -1) return err('流程实例不存在', 404);
    if (mockWorkflowInstances[idx].status === 'running' || mockWorkflowInstances[idx].status === 'draft') {
      return err('请先取消进行中的流程再删除');
    }
    mockWorkflowInstances.splice(idx, 1);
    for (let i = mockWorkflowTasks.length - 1; i >= 0; i--) {
      if (mockWorkflowTasks[i].instanceId === id) mockWorkflowTasks.splice(i, 1);
    }
    return ok(null);
  }),

  // ─── 审批任务 Handler ──────────────────────────────────────────────────────

  // 审批通过
  http.post('/api/workflows/tasks/:taskId/approve', async ({ params, request }) => {
    const cached = readIdempotentResponse(request);
    if (cached) return cached;
    const body = await request.json() as { comment?: string; signature?: string; attachments?: Array<{ name: string; url: string; size?: number }>; selectedNextApprovers?: number[] };
    const taskIdx = mockWorkflowTasks.findIndex(t => t.id === Number(params.taskId));
    if (taskIdx === -1) return err('任务不存在', 404);
    if (mockWorkflowTasks[taskIdx].status !== 'pending') return err('该任务已处理');

    const now = mockDateTime();
    const attachSuffix = body.attachments && body.attachments.length > 0
      ? `\n[附件]${body.attachments.map(a => a.name).join(', ')}`
      : '';
    const current = mockWorkflowTasks[taskIdx];

    // 委派回执：仅关闭当前任务、为原委派人生成新 pending，不推进流程
    if (current.delegatedFromId) {
      const receiptComment = `[委派回执] ${current.assigneeName ?? '审批人'} 建议同意：${body.comment ?? ''}${attachSuffix}`;
      mockWorkflowTasks[taskIdx] = { ...current, status: 'approved', comment: receiptComment, actionAt: now };
      const newTask: WorkflowTask = {
        id: getNextTaskId(),
        instanceId: current.instanceId,
        nodeKey: current.nodeKey,
        nodeName: current.nodeName,
        nodeType: current.nodeType,
        assigneeId: current.delegatedFromId,
        assigneeName: `用户${current.delegatedFromId}`,
        status: 'pending',
        comment: receiptComment,
        actionAt: null,
        originalAssigneeId: current.delegatedFromId,
        transferChain: [],
        delegatedFromId: null,
        actionButtons: current.actionButtons,
        createdAt: now,
      };
      mockWorkflowTasks.push(newTask);
      return okIdempotent(request, newTask, '已提交委派回执，等待原审批人确认');
    }

    mockWorkflowTasks[taskIdx] = {
      ...current,
      status: 'approved',
      comment: (body.comment ?? '') + attachSuffix || null,
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

    return okIdempotent(request, mockWorkflowTasks[taskIdx]);
  }),

  // 审批驳回
  http.post('/api/workflows/tasks/:taskId/reject', async ({ params, request }) => {
    const cached = readIdempotentResponse(request);
    if (cached) return cached;
    const body = await request.json() as { comment?: string };
    const taskIdx = mockWorkflowTasks.findIndex(t => t.id === Number(params.taskId));
    if (taskIdx === -1) return err('任务不存在', 404);
    if (mockWorkflowTasks[taskIdx].status !== 'pending') return err('该任务已处理');

    const now = mockDateTime();
    const current = mockWorkflowTasks[taskIdx];

    // 委派回执：仅关闭当前任务、为原委派人生成新 pending，不驳回流程
    if (current.delegatedFromId) {
      const receiptComment = `[委派回执] ${current.assigneeName ?? '审批人'} 建议拒绝：${body.comment ?? ''}`;
      mockWorkflowTasks[taskIdx] = { ...current, status: 'rejected', comment: receiptComment, actionAt: now };
      const newTask: WorkflowTask = {
        id: getNextTaskId(),
        instanceId: current.instanceId,
        nodeKey: current.nodeKey,
        nodeName: current.nodeName,
        nodeType: current.nodeType,
        assigneeId: current.delegatedFromId,
        assigneeName: `用户${current.delegatedFromId}`,
        status: 'pending',
        comment: receiptComment,
        actionAt: null,
        originalAssigneeId: current.delegatedFromId,
        transferChain: [],
        delegatedFromId: null,
        actionButtons: current.actionButtons,
        createdAt: now,
      };
      mockWorkflowTasks.push(newTask);
      return okIdempotent(request, newTask, '已提交委派回执，等待原审批人确认');
    }

    mockWorkflowTasks[taskIdx] = {
      ...mockWorkflowTasks[taskIdx],
      status: 'rejected',
      comment: body.comment ?? null,
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

    return okIdempotent(request, mockWorkflowTasks[taskIdx]);
  }),

  // 转办
  http.post('/api/workflows/tasks/:taskId/transfer', async ({ params, request }) => {
    const body = await request.json() as { targetUserId: number; comment?: string };
    const taskIdx = mockWorkflowTasks.findIndex(t => t.id === Number(params.taskId));
    if (taskIdx === -1) return err('任务不存在', 404);
    const current = mockWorkflowTasks[taskIdx];
    if (current.status !== 'pending') return err('该任务已处理');
    if (body.targetUserId === current.assigneeId) return err('转办人不能是当前处理人');
    const chain = current.transferChain ?? [];
    const original = current.originalAssigneeId ?? current.assigneeId;
    if (chain.includes(body.targetUserId) || body.targetUserId === original) {
      return err('禁止将任务转回曾经经手的处理人');
    }
    mockWorkflowTasks[taskIdx] = {
      ...current,
      assigneeId: body.targetUserId,
      assigneeName: `用户${body.targetUserId}`,
      comment: `[转办] ${body.comment ?? ''}`,
      originalAssigneeId: current.originalAssigneeId ?? current.assigneeId,
      transferChain: current.assigneeId ? [...chain, current.assigneeId] : chain,
    };
    return ok(mockWorkflowTasks[taskIdx]);
  }),

  // 委派
  http.post('/api/workflows/tasks/:taskId/delegate', async ({ params, request }) => {
    const body = await request.json() as { targetUserId: number; comment?: string };
    const taskIdx = mockWorkflowTasks.findIndex(t => t.id === Number(params.taskId));
    if (taskIdx === -1) return err('任务不存在', 404);
    const current = mockWorkflowTasks[taskIdx];
    if (current.status !== 'pending') return err('该任务已处理');
    if (body.targetUserId === current.assigneeId) return err('委派人不能是当前处理人');
    const chain = current.transferChain ?? [];
    const original = current.originalAssigneeId ?? current.assigneeId;
    if (chain.includes(body.targetUserId) || body.targetUserId === original) {
      return err('禁止将任务委派给曾经经手的处理人');
    }
    mockWorkflowTasks[taskIdx] = {
      ...current,
      assigneeId: body.targetUserId,
      assigneeName: `用户${body.targetUserId}`,
      comment: `[委派] ${body.comment ?? ''}`,
      originalAssigneeId: current.originalAssigneeId ?? current.assigneeId,
      transferChain: current.assigneeId ? [...chain, current.assigneeId] : chain,
      delegatedFromId: current.delegatedFromId ?? current.assigneeId,
    };
    return ok(mockWorkflowTasks[taskIdx]);
  }),

  // 加签
  http.post('/api/workflows/tasks/:taskId/add-sign', async ({ params, request }) => {
    const body = await request.json() as { targetUserIds: number[]; position: 'before' | 'after' | 'parallel'; comment?: string };
    const taskIdx = mockWorkflowTasks.findIndex(t => t.id === Number(params.taskId));
    if (taskIdx === -1) return err('任务不存在', 404);
    const current = mockWorkflowTasks[taskIdx];
    if (current.status !== 'pending') return err('该任务已处理');
    const now = mockDateTime();
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
        actionAt: null,
        actionButtons: null,
        createdAt: now,
      });
    });
    return HttpResponse.json({ code: 0, message: `已加签 ${body.targetUserIds.length} 人`, data: null });
  }),

  // 减签
  http.post('/api/workflows/tasks/:taskId/reduce-sign', async ({ params, request }) => {
    const body = await request.json() as { targetTaskIds: number[]; comment?: string };
    const taskIdx = mockWorkflowTasks.findIndex(t => t.id === Number(params.taskId));
    if (taskIdx === -1) return err('任务不存在', 404);
    if (mockWorkflowTasks[taskIdx].status !== 'pending') return err('该任务已处理');
    if (body.targetTaskIds.includes(Number(params.taskId))) return err('不能减去自己');
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
    return HttpResponse.json({ code: 0, message: `已减签 ${removed} 人`, data: null });
  }),

  // 催办：单任务
  http.post('/api/workflows/tasks/:taskId/urge', async ({ params, request }) => {
    const body = await request.json().catch(() => ({})) as { message?: string };
    const taskId = Number(params.taskId);
    const task = mockWorkflowTasks.find(t => t.id === taskId);
    if (!task) return err('任务不存在', 404);
    if (task.status !== 'pending') return err('该任务已处理');
    const inst = mockWorkflowInstances.find(i => i.id === task.instanceId);
    if (!inst) return err('流程不存在', 404);
    if (inst.status !== 'running') return err('流程已结束，无需催办');
    const last = mockWorkflowUrges.filter(u => u.taskId === taskId).sort((a, b) => b.id - a.id)[0];
    if (last && Date.now() - new Date(last.createdAt).getTime() < URGE_MIN_INTERVAL_MS) {
      const wait = Math.ceil((URGE_MIN_INTERVAL_MS - (Date.now() - new Date(last.createdAt).getTime())) / 1000);
      return err(`催办过于频繁，请 ${wait}s 后再试`, 429);
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
    return HttpResponse.json({ code: 0, message: '已催办', data: row });
  }),

  // 催办：单任务历史
  http.get('/api/workflows/tasks/:taskId/urges', ({ params }) => {
    const taskId = Number(params.taskId);
    const list = mockWorkflowUrges.filter(u => u.taskId === taskId).sort((a, b) => b.id - a.id);
    return ok(list);
  }),

  // 催办：实例历史
  http.get('/api/workflows/instances/:id/urges', ({ params }) => {
    const instId = Number(params.id);
    const list = mockWorkflowUrges.filter(u => u.instanceId === instId).sort((a, b) => b.id - a.id);
    return ok(list);
  }),

  // 催办：实例批量
  http.post('/api/workflows/instances/:id/urge', async ({ params, request }) => {
    const body = await request.json().catch(() => ({})) as { message?: string };
    const instId = Number(params.id);
    const inst = mockWorkflowInstances.find(i => i.id === instId);
    if (!inst) return err('流程不存在', 404);
    if (inst.status !== 'running') return err('流程已结束，无需催办');
    const pendings = mockWorkflowTasks.filter(t => t.instanceId === instId && t.status === 'pending');
    if (pendings.length === 0) return err('没有待办任务可催办');
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
    return HttpResponse.json({ code: 0, message: msg, data: created });
  }),

  // 动态补加抄送
  http.post('/api/workflows/instances/:id/cc/add', async ({ params, request }) => {
    const body = await request.json().catch(() => ({})) as { nodeKey?: string; userIds?: number[] };
    const instId = Number(params.id);
    const inst = mockWorkflowInstances.find(i => i.id === instId);
    if (!inst) return err('流程不存在', 404);
    if (inst.status !== 'running') return err('流程已结束，无法补加抄送');
    if (!body.nodeKey) return err('请选择抄送节点');
    if (!Array.isArray(body.userIds) || body.userIds.length === 0) return err('请选择抄送人');

    // 去重：过滤掉当前实例 + 节点已经抄送过的用户
    const existingSet = new Set(
      mockWorkflowTasks
        .filter(t => t.instanceId === instId && t.nodeKey === body.nodeKey && t.nodeType === 'ccNode')
        .map(t => t.assigneeId)
        .filter((v): v is number => typeof v === 'number'),
    );
    const toAdd = Array.from(new Set(body.userIds)).filter(uid => !existingSet.has(uid));
    if (toAdd.length === 0) {
      return HttpResponse.json({ code: 0, message: '所选用户均已抄送，无需重复添加', data: [] });
    }
    const now = mockDateTime();
    const sample = mockWorkflowTasks.find(t => t.instanceId === instId && t.nodeKey === body.nodeKey);
    const inserted = toAdd.map((uid) => {
      const task = {
        id: getNextTaskId(),
        instanceId: instId,
        nodeKey: body.nodeKey!,
        nodeName: sample?.nodeName ?? '抄送',
        nodeType: 'ccNode' as const,
        assigneeId: uid,
        status: 'skipped' as const,
        comment: null,
        actionAt: null,
        createdAt: now,
      };
      mockWorkflowTasks.push(task);
      return task;
    });
    return HttpResponse.json({ code: 0, message: `已补加 ${inserted.length} 人抄送`, data: inserted });
  }),

  // 退回
  http.post('/api/workflows/tasks/:taskId/return', async ({ params, request }) => {
    const body = await request.json() as { targetNodeKeys: string[]; comment: string };
    const taskIdx = mockWorkflowTasks.findIndex(t => t.id === Number(params.taskId));
    if (taskIdx === -1) return err('任务不存在', 404);
    if (mockWorkflowTasks[taskIdx].status !== 'pending') return err('该任务已处理');
    if (!Array.isArray(body.targetNodeKeys) || body.targetNodeKeys.length === 0) return err('请选择退回节点');
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
      actionAt: now,
    };
    const instIdx = mockWorkflowInstances.findIndex(i => i.id === current.instanceId);
    if (instIdx !== -1) {
      mockWorkflowInstances[instIdx] = {
        ...mockWorkflowInstances[instIdx],
        currentNodeKey: firstNodeKey,
        updatedAt: now,
      };
    }
    return ok(mockWorkflowInstances[instIdx] ?? null);
  }),
];
