import { applyRuntimeInitiatorSelections } from './initiator-selection';
import type { WorkflowFlowData, WorkflowNodeConfig, WorkflowFormField, WorkflowStarterContext, WorkflowNodeActivation, WorkflowSimulationDecision, WorkflowSimulationTimelineItem, WorkflowSimulationNodeState } from '@zenith/shared/workflow';
import { applyFieldPermissionsToFields, collectWorkflowFormValidationErrors, computeWorkflowDerivedValues, evaluateWorkflowApprovalActivation, findNextApproverSelectNodes, resolveNodeFieldPermissions, sanitizeFormUpdatesByNodePerms, workflowApprovalRequirements, resolveWorkflowActionButton } from '@zenith/shared/workflow';
import type { RuleRef } from '@zenith/shared/rules';
import type { TokenSnapshot, AdvanceTrigger } from '../../../lib/workflow-token-engine';
import { validateFlowData } from '../../../lib/workflow-engine';
import { computeTimeoutAt } from '../../../lib/workflow-timeout';
import { executeWorkflow, planRuntimeActivation, runtimeTaskIdentity, type RuntimeTrigger } from './execute';
import { expandRuntimeTasks, type ExpandedTaskRow } from './expand-tasks';
import { applyRuntimeAssigneePolicy } from './assignee-policy';
import { runtimeRejectRoute } from './reject-route';
import { buildChildFormData, resolveMultiItems } from './subprocess-input';
import { runtimeFailureDisposition, runtimeSubprocessOutcome, runtimeTimeoutAction } from './effect-policy';
import { resolveFailurePolicy } from '@zenith/shared/workflow';
import { runtimeDelayWakeAt } from './clock';
import { runtimeTriggerData } from './trigger-data';
import { runtimeStartForm } from './start-form';

export interface MemoryExecutionDefinition {
  id: number;
  flowData: WorkflowFlowData;
  fields: WorkflowFormField[];
}
export interface MemoryRuntimeFacts {
  resolve(config: WorkflowNodeConfig, context: { initiatorId: number; formData: Record<string, unknown> }): Promise<number[]>;
  filterSelected(config: WorkflowNodeConfig, ids: number[]): Promise<number[]>;
  candidates(config: WorkflowNodeConfig): Promise<number[]>;
  starter(userId: number): Promise<WorkflowStarterContext>;
  names(ids: number[]): Promise<Map<number, string>>;
  admin(): Promise<number | null>;
  delegate(userId: number, definitionId: number, now: number): Promise<{ delegateId: number; mode: 'full' | 'suggest' } | null>;
  decide(ref: RuleRef, form: Record<string, unknown>, starter: WorkflowStarterContext): Promise<Record<string, unknown>>;
  definition(id: number): Promise<MemoryExecutionDefinition | null>;
  timeoutTarget?(userId: number | null, level: number, excludedUserIds: ReadonlySet<number>): Promise<number | null>;
  validateUsers?(ids: number[]): Promise<void>;
}
type RunStatus = 'running' | 'finished' | 'rejected' | 'returned';
export interface MemoryTask {
  id: number; executionPath: string; activationId: string; slotId: number | null;
  nodeKey: string; nodeName: string; nodeType: WorkflowNodeConfig['type']; assigneeId: number | null;
  status: 'pending' | 'waiting' | 'approved' | 'rejected' | 'skipped';
  waitReason: string | null; taskKind: string; delegatedFromId: number | null;
  dueAt: number | null; timeoutAt: number | null; returnOrigin?: string;
  remindCount?: number;
  pausedTimeoutMs?: number;
  handledBy?: number[];
}
interface Execution {
  id: number; path: string; definitionId: number; flow: WorkflowFlowData; fields: WorkflowFormField[];
  formData: Record<string, unknown>; initiatorId: number; starter: WorkflowStarterContext;
  status: RunStatus; tokens: TokenSnapshot[]; activations: WorkflowNodeActivation[]; tasks: MemoryTask[];
  selected: Record<string, number[]>; completed: string[]; roundStart: number;
  parentTaskId?: number; childIndex?: number;
}

/** Only storage, identity generation, the clock, and effects are in memory. Business rules are shared. */
export class MemoryWorkflowRuntime {
  readonly timeline: WorkflowSimulationTimelineItem[] = [];
  readonly warnings: string[] = [];
  readonly executions: Execution[] = [];
  private nextId = 1;
  private randomState: number;
  private operations = 0;
  private readonly maxOperations: number;
  now: number;
  stepLimit = false;
  commandCount = 0;

  constructor(private readonly facts: MemoryRuntimeFacts, private readonly options: { maxSteps?: number; seed?: number; now?: number } = {}) {
    this.randomState = options.seed ?? 1;
    this.now = options.now ?? Date.now();
    this.maxOperations = options.maxSteps ?? 160;
  }
  private random = () => {
    this.randomState = (Math.imul(1664525, this.randomState) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  };
  private config(run: Execution, key: string) { return run.flow.nodes.find(node => node.data.key === key)?.data; }
  private getTask(id: number) { return this.executions.flatMap(run => run.tasks).find(task => task.id === id); }
  private runFor(task: MemoryTask) { return this.executions.find(run => run.path === task.executionPath)!; }
  private budget() {
    if (++this.operations > this.maxOperations) { this.stepLimit = true; throw new Error('仿真达到执行步数上限'); }
  }
  private async emit(run: Execution, task: MemoryTask | null, status: WorkflowSimulationTimelineItem['status'], reason: string) {
    const ids = task?.assigneeId ? [task.assigneeId] : task ? [] : [run.initiatorId];
    const names = await this.facts.names(ids);
    this.timeline.push({ step: this.timeline.length + 1, nodeKey: task?.nodeKey ?? 'start', nodeName: task?.nodeName ?? '发起',
      nodeType: task?.nodeType ?? 'start', status, reason, executionPath: run.path, taskId: task?.id, virtualTime: this.now,
      assignees: ids.map(id => ({ id, name: names.get(id) ?? '用户#' + id })) });
  }
  async start(definition: MemoryExecutionDefinition, form: Record<string, unknown>, initiatorId: number, selected: Record<string, number[]> = {}) {
    await this.createExecution(definition, form, initiatorId, 'root', selected);
    return this;
  }
  private async createExecution(def: MemoryExecutionDefinition, form: Record<string, unknown>, initiatorId: number, path: string,
    selected: Record<string, number[]> = {}, parentTaskId?: number, childIndex?: number) {
    this.budget();
    const validation = validateFlowData(def.flowData);
    if (!validation.valid) throw new Error(validation.errors.join('；'));
    if ((path.split('/').length - 1) / 2 > 16) throw new Error('子流程嵌套超过16层');
    const run: Execution = { id: this.nextId++, path, definitionId: def.id, flow: structuredClone(def.flowData), fields: structuredClone(def.fields),
      formData: computeWorkflowDerivedValues(def.fields, runtimeStartForm(def.flowData, structuredClone(form))), initiatorId, starter: await this.facts.starter(initiatorId),
      status: 'running', tokens: [], activations: [], tasks: [], selected: structuredClone(selected), completed: [], roundStart: 0, parentTaskId, childIndex };
    const formErrors = collectWorkflowFormValidationErrors(run.fields, run.formData, run.flow.nodes.find(node => node.data.type === 'start')?.data.fieldPermissions);
    if (formErrors.length) throw new Error(formErrors[0].message);
    run.flow = await applyRuntimeInitiatorSelections(run.flow, selected, { formData: run.formData, formFields: run.fields, starter: run.starter }, this.facts.filterSelected);
    this.executions.push(run);
    await this.emit(run, null, 'entered', parentTaskId ? '进入子流程 ' + path : '内存运行时已启动');
    await this.advance(run, { kind: 'seed' });
    return run;
  }
  private async resolve(run: Execution, config: WorkflowNodeConfig): Promise<number[]> {
    if (config.assigneeType === 'nodeApprover') return [...new Set(run.tasks.filter(task => task.nodeKey === config.nodeApproverNodeId && task.status === 'approved').flatMap(task => task.assigneeId ? [task.assigneeId] : []))];
    if (config.assigneeType === 'approverSelect') {
      const ids = run.selected[config.key];
      if (!ids?.length) throw new Error('请选择节点「' + config.label + '」的审批人');
      return this.facts.filterSelected(config, ids);
    }
    if ((config.assigneeType === 'initiatorSelect' || config.assigneeType === 'initiatorSelectScope') && !(config.userIds?.length || config.assigneeIds?.length)) throw new Error('请选择节点「' + config.label + '」的发起自选审批人');
    return this.facts.resolve(config, { initiatorId: run.initiatorId, formData: run.formData });
  }
  private async advance(run: Execution, trigger: RuntimeTrigger) {
    this.budget();
    const result = await executeWorkflow(trigger, { flowData: run.flow, formData: run.formData, starter: run.starter, instanceId: run.id, now: this.now }, {
      loadTokens: async () => run.tokens,
      completedKeys: async () => {
        const latest = new Map(run.activations.map(activation => [activation.nodeKey, activation]));
        return new Set(['start', ...[...latest.values()].filter(a => a.status === 'approved').map(a => a.nodeKey)]);
      },
      completeToken: async id => { for (const activation of run.activations) if (activation.tokenId === id) activation.status = 'approved'; },
      consumeTokens: async ids => { run.tokens = run.tokens.filter(token => !ids.includes(token.id)); },
      createToken: async spec => { const id = this.nextId++; run.tokens.push({ id, nodeKey: spec.nodeKey, branchPath: spec.branchPath }); return id; },
      expand: tasks => expandRuntimeTasks(tasks, { instanceId: run.id, initiatorId: run.initiatorId, flowData: run.flow,
        ports: { resolve: config => this.resolve(run, config), admin: this.facts.admin,
          applyPolicy: (task, ids) => applyRuntimeAssigneePolicy(task, ids, { initiatorId: run.initiatorId, settings: run.flow.settings,
            resolve: config => this.resolve(run, config), collectDedup: async (mode, key) => {
              const previous = run.tasks.slice(run.roundStart).filter(task => task.status === 'approved' && task.nodeKey !== key && (mode !== 'consecutive' || task.nodeType !== 'ccNode'));
              const last = previous.at(-1)?.nodeKey;
              return new Set(previous.filter(task => mode === 'all' || task.nodeKey === last).flatMap(task => task.assigneeId ? [task.assigneeId] : []));
            } }),
          delegate: async ids => {
            const seen = new Set<number>(); const assigned = [];
            for (const id of ids) { const delegate = await this.facts.delegate(id, run.definitionId, this.now); const assigneeId = delegate?.delegateId ?? id;
              if (!seen.has(assigneeId)) assigned.push({ assigneeId, delegatedFromId: delegate ? id : null, delegationMode: delegate?.mode ?? null }); seen.add(assigneeId); }
            return assigned;
          },
          notifyException: async (node, detail) => { this.warnings.push(node + '：' + detail + '（通知仅记录在内存）'); },
          now: () => new Date(this.now), random: this.random, callbackId: () => 'memory-' + this.nextId++,
        } }),
      materialize: (rows, tokens) => this.materialize(run, rows, tokens),
      resolveDecisions: async pending => {
        const triggers: AdvanceTrigger[] = [];
        for (const item of pending) { this.budget(); const config = this.config(run, item.nodeKey)!;
          const outputs = await this.facts.decide({ kind: config.decisionRefKind ?? 'table', key: config.decisionRuleKey! }, run.formData, run.starter);
          Object.assign(run.formData, outputs); triggers.push({ type: 'resumeDecision', ...item }); }
        return triggers;
      },
      reject: async created => { this.cancel(run); return created.filter(task => task.status !== 'pending' && task.status !== 'waiting'); },
      genBranchId: () => 'memory-fork-' + this.nextId++,
      checkpoint: () => this.budget(),
    });
    if (result.rejected) run.status = 'rejected';
    else if (result.finished && run.tokens.length === 0) run.status = 'finished';
    for (const task of result.createdTasks.filter(task => task.nodeType === 'subProcess')) await this.spawnChildren(run, task);
    for (const task of result.createdTasks.filter(task => task.nodeType === 'trigger' && task.status === 'waiting')) {
      const config = this.config(run, task.nodeKey)!;
      if (config.triggerConfig?.triggerType === 'updateData' || config.triggerConfig?.triggerType === 'deleteData') {
        run.formData = runtimeTriggerData(config.triggerConfig, run.formData);
        await this.finishTask(run, task, 'approved', '内存运行时已执行字段更新');
      }
    }
  }
  private async materialize(run: Execution, rows: ExpandedTaskRow[], tokens: Map<string, number>) {
    const groups = new Map<string, ExpandedTaskRow[]>();
    for (const row of rows) groups.set(row.nodeKey, [...(groups.get(row.nodeKey) ?? []), row]);
    const created: MemoryTask[] = [];
    for (const [key, members] of groups) {
      const config = this.config(run, key);
      const plan = planRuntimeActivation(members, config);
      const activation: WorkflowNodeActivation = { id: 'memory-round-' + this.nextId++, nodeKey: key, nodeName: members[0].nodeName,
        tokenId: tokens.get(key) ?? null, kind: plan.kind, settlementReason: null, status: tokens.has(key) ? 'active' : 'approved',
        approveMethod: plan.method, approveRatio: plan.ratio, baseTotal: plan.baseTotal, baseRequired: plan.required,
        baseApproved: 0, baseRejected: 0, baseSatisfied: false, slots: [], signGroups: [] };
      run.activations.push(activation);
      for (const row of members) {
        this.budget();
        const identity = runtimeTaskIdentity(row, plan.method); const id = this.nextId++;
        const task: MemoryTask = { id, executionPath: run.path, activationId: activation.id, slotId: identity.kind === 'approval' ? this.nextId++ : null,
          nodeKey: row.nodeKey, nodeName: row.nodeName, nodeType: row.nodeType ?? 'approve', assigneeId: row.assigneeId ?? null,
          status: row.status ?? 'pending', taskKind: identity.taskKind, waitReason: identity.waitReason, delegatedFromId: row.delegatedFromId ?? null,
          dueAt: null, timeoutAt: null };
        if (task.nodeType === 'delay') task.dueAt = runtimeDelayWakeAt(config!, run.formData, new Date(this.now)).getTime();
        if (task.status === 'pending') task.timeoutAt = computeTimeoutAt(config?.timeout, new Date(this.now))?.getTime() ?? null;
        if (task.slotId != null) activation.slots.push({ id: task.slotId, activationId: activation.id, origin: 'base', groupId: null,
          originalAssigneeId: row.delegatedFromId ?? task.assigneeId, currentAssigneeId: task.assigneeId, assigneeName: null,
          status: task.status === 'approved' ? 'approved' : task.status === 'rejected' ? 'rejected' : 'pending',
          order: row.taskOrder ?? null, mandatory: false, currentTaskId: id });
        run.tasks.push(task); created.push(task);
        await this.emit(run, task, task.status === 'approved' ? 'autoApproved' : task.status === 'rejected' ? 'rejected' : task.status === 'skipped' ? 'skipped' : task.status === 'waiting' ? 'waiting' : 'entered', row.comment ?? '节点任务已创建');
      }
    }
    return created;
  }
  private cancel(run: Execution) {
    run.tokens = [];
    for (const activation of run.activations) if (activation.status === 'active') activation.status = 'cancelled';
    for (const task of run.tasks) if (task.status === 'pending' || task.status === 'waiting') task.status = 'skipped';
    for (const child of this.executions.filter(item => item.parentTaskId != null && run.tasks.some(task => task.id === item.parentTaskId))) { if (child.status === 'running') { this.cancel(child); child.status = 'rejected'; } }
  }
  private async reconcile(run: Execution, task: MemoryTask, recordOutcome = true) {
    const index = run.activations.findIndex(a => a.id === task.activationId);
    const activation = run.activations[index];
    if (task.slotId == null) return { completed: task.status === 'approved', failed: task.status === 'rejected' };
    const slot = activation.slots.find(item => item.id === task.slotId)!;
    if (recordOutcome) slot.status = task.status === 'rejected' ? 'rejected' : 'approved';
    const result = evaluateWorkflowApprovalActivation(activation);
    // Successful activation is settled together with the token, as in persistent execution.
    run.activations[index] = { ...result.activation, status: result.failed ? 'rejected' : 'active' };
    for (const member of result.activation.slots) {
      const sibling = run.tasks.find(t => t.id === member.currentTaskId)!;
      if (sibling.status !== 'pending' && sibling.status !== 'waiting') continue;
      if (member.status === 'cancelled') { sibling.status = 'skipped'; sibling.timeoutAt = null; }
      else if (sibling.waitReason !== 'external') {
        const previousStatus = sibling.status;
        sibling.status = result.waitReasons[member.id] ? 'waiting' : 'pending'; sibling.waitReason = result.waitReasons[member.id] ?? null;
        if (sibling.status === 'waiting' && previousStatus === 'pending' && sibling.timeoutAt != null) { sibling.pausedTimeoutMs = sibling.timeoutAt - this.now; sibling.timeoutAt = null; }
        if (sibling.status === 'pending' && sibling.timeoutAt == null) { sibling.timeoutAt = sibling.pausedTimeoutMs != null ? this.now + sibling.pausedTimeoutMs
          : computeTimeoutAt(this.config(run, sibling.nodeKey)?.timeout, new Date(this.now))?.getTime() ?? null; sibling.pausedTimeoutMs = undefined; }
      }
    }
    return result;
  }
  private requirements(run: Execution, task: MemoryTask) {
    if (task.nodeType !== 'approve' && task.nodeType !== 'handler') return [];
    const req = workflowApprovalRequirements(this.config(run, task.nodeKey));
    return [...(req.opinionRequired ? ['审批意见'] : []), ...(req.signaturePolicy !== 'none' ? ['签名'] : []), ...(req.attachmentMode === 'required' ? ['附件'] : [])];
  }
  async command(command: WorkflowSimulationDecision) {
    const checkpoint = structuredClone({ executions: this.executions, timeline: this.timeline, warnings: this.warnings,
      nextId: this.nextId, randomState: this.randomState, now: this.now, operations: this.operations });
    try { await this.applyCommand(command); this.commandCount++; }
    catch (error) {
      this.executions.splice(0, this.executions.length, ...checkpoint.executions);
      this.timeline.splice(0, this.timeline.length, ...checkpoint.timeline);
      this.warnings.splice(0, this.warnings.length, ...checkpoint.warnings);
      this.nextId = checkpoint.nextId; this.randomState = checkpoint.randomState; this.now = checkpoint.now;
      this.operations = checkpoint.operations;
      throw error;
    }
  }
  private async applyCommand(command: WorkflowSimulationDecision) {
    if (this.stepLimit) return;
    this.budget();
    if (command.action === 'advanceTime') { await this.advanceTime(command.minutes ?? 0); return; }
    const run = this.executions.find(item => item.path === (command.executionPath ?? 'root'));
    if (!run) throw new Error('仿真执行路径不存在');
    if (command.action === 'resubmit') {
      if (run.status !== 'returned') throw new Error('只有退回发起人的实例可重新提交');
      run.formData = computeWorkflowDerivedValues(run.fields, { ...run.formData, ...command.formPatch });
      run.roundStart = run.tasks.length; run.status = 'running'; await this.advance(run, { kind: 'seed' }); return;
    }
    if (run.status !== 'running') throw new Error('当前流程已结束，无法继续操作');
    const task = run.tasks.find(item => (command.taskId == null || item.id === command.taskId) && item.nodeKey === command.nodeKey
      && (command.assigneeId == null || item.assigneeId === command.assigneeId) && (item.status === 'pending' || item.status === 'waiting'));
    if (!task) throw new Error('当前节点没有可操作的仿真待办');
    if (command.action === 'wait') { await this.emit(run, task, 'waiting', command.reason ?? '保留当前待办，其他并行路径仍可继续'); return; }
    if (['transfer', 'delegate', 'addSign', 'reduceSign'].includes(command.action)) { await this.collaborate(run, task, command); return; }
    if (['sequence', 'subprocess', 'delay', 'beforeSign', 'afterSign'].includes(task.waitReason ?? '')) throw new Error('当前任务尚未激活，请先完成前置任务或推进虚拟时间');
    const config = this.config(run, task.nodeKey)!;
    if ((command.action === 'approve' || command.action === 'reject') && (task.nodeType === 'approve' || task.nodeType === 'handler') && task.waitReason !== 'external') {
      if (!resolveWorkflowActionButton(config.actionButtons, command.action).enabled) throw new Error('节点未启用该操作');
      if (this.requirements(run, task).length && !command.requirementsConfirmed) throw new Error('请确认模拟满足审批意见、签名和附件要求');
    }
    const patch = sanitizeFormUpdatesByNodePerms(resolveNodeFieldPermissions(run.flow, task.nodeKey), command.formPatch);
    // 先重算派生值（公式 / 合计）再选边：formPatch 可能改的是公式输入，
    // 与随后推进使用同一份 formData，避免模拟选边与推进分支不一致。
    const patchedFormData = computeWorkflowDerivedValues(run.fields, { ...run.formData, ...patch });
    if (command.action === 'approve') {
      for (const next of findNextApproverSelectNodes(run.flow, task.nodeKey, { formData: patchedFormData, starter: run.starter })) {
        const selected = command.selectedNextApprovers?.[next.data.key] ?? run.selected[next.data.key] ?? [];
        const allowed = await this.facts.filterSelected(next.data, selected);
        if (!allowed.length) throw new Error('请选择节点「' + next.data.label + '」的审批人');
        run.selected[next.data.key] = allowed;
      }
    }
    run.formData = patchedFormData;
    if (task.taskKind === 'suggestion') {
      if (run.tasks.some(item => item.id !== task.id && item.activationId === task.activationId && item.assigneeId === task.delegatedFromId && ['pending', 'waiting'].includes(item.status))) throw new Error('原审批人已有本轮活动任务');
      task.status = command.action === 'reject' ? 'rejected' : 'approved';
      task.timeoutAt = null;
      const receipt: MemoryTask = { ...task, id: this.nextId++, taskKind: 'approval', assigneeId: task.delegatedFromId, delegatedFromId: null, status: 'pending', waitReason: null,
        timeoutAt: computeTimeoutAt(config.timeout, new Date(this.now))?.getTime() ?? null };
      run.tasks.push(receipt);
      const slot = run.activations.find(item => item.id === task.activationId)?.slots.find(item => item.id === task.slotId);
      if (slot) { slot.currentAssigneeId = receipt.assigneeId; slot.currentTaskId = receipt.id; }
      await this.emit(run, task, task.status, '受托建议已提交');
      await this.emit(run, receipt, 'entered', '等待原审批人正式确认'); return;
    }
    if (command.outcome === 'failed') { await this.failEffect(run, task, command.reason ?? '模拟外部执行失败'); await this.settleChildren(); return; }
    await this.finishTask(run, task, command.action === 'reject' || command.outcome === 'rejected' ? 'rejected' : 'approved', command.reason ?? (command.action === 'skip' ? '模拟运维跳过' : '模拟审批操作'));
    await this.settleChildren();
  }
  private async finishTask(run: Execution, task: MemoryTask, outcome: 'approved' | 'rejected', reason: string) {
    task.status = outcome; task.timeoutAt = null;
    await this.emit(run, task, outcome, reason);
    const timeline = this.timeline.at(-1)!;
    const completion = await this.reconcile(run, task);
    if (completion.failed) {
      const route = runtimeRejectRoute(run.flow, task.nodeKey, [...run.completed].reverse());
      this.cancel(run);
      if (route.strategy === 'returnStart') run.status = 'returned';
      else if (route.strategy === 'terminate' || !route.targetNodeKey) run.status = 'rejected';
      else { await this.advance(run, { kind: 'enterNode', nodeKey: route.targetNodeKey });
        if (route.currentNodeCfg?.returnMode === 'backToOrigin') for (const reopened of run.tasks.filter(t => t.nodeKey === route.targetNodeKey && t.status === 'pending')) reopened.returnOrigin = task.nodeKey; }
    } else if (completion.completed) {
      run.completed.push(task.nodeKey);
      await this.advance(run, task.returnOrigin ? { kind: 'enterNode', nodeKey: task.returnOrigin, consumeNodeKey: task.nodeKey } : { kind: 'advanceNode', nodeKey: task.nodeKey });
    }
    timeline.nextNodeKeys = run.tokens.map(token => token.nodeKey);
  }
  private async collaborate(run: Execution, task: MemoryTask, command: WorkflowSimulationDecision) {
    const action = command.action as 'transfer' | 'delegate' | 'addSign' | 'reduceSign';
    const config = this.config(run, task.nodeKey)!;
    if (!resolveWorkflowActionButton(config.actionButtons, action).enabled) throw new Error('节点未启用该协作操作');
    const activation = run.activations.find(item => item.id === task.activationId)!;
    const slot = activation.slots.find(item => item.id === task.slotId);
    if (!slot || task.taskKind !== 'approval') throw new Error('当前任务不是正式审批席位');
    if (action !== 'reduceSign' && task.status !== 'pending') throw new Error('当前席位尚未激活');
    if (action === 'reduceSign') {
      const group = activation.signGroups.find(item => item.id === command.groupId);
      if (!group || !['active', 'waiting'].includes(group.status)) throw new Error('加签组已结束或不存在');
      const targets = activation.slots.filter(item => command.targetSlotIds?.includes(item.id) && item.groupId === group.id);
      if (!targets.length || targets.length !== command.targetSlotIds?.length || targets.some(item => item.status !== 'pending')) throw new Error('只能减签尚未形成正式意见的席位');
      for (const target of targets) { target.status = 'cancelled'; const member = run.tasks.find(item => item.id === target.currentTaskId)!; member.status = 'skipped'; member.timeoutAt = null; }
      const result = await this.reconcile(run, task, false);
      if (result.completed) await this.advance(run, { kind: 'advanceNode', nodeKey: task.nodeKey });
      await this.emit(run, task, 'entered', '加签席位已取消'); return;
    }
    const ids = command.targetUserIds ?? [];
    if (!ids.length || new Set(ids).size !== ids.length || ids.includes(task.assigneeId!)) throw new Error('请选择不重复且不同于当前处理人的成员');
    await this.facts.validateUsers?.(ids);
    if (run.tasks.some(item => item.activationId === task.activationId && item.id !== task.id && ['pending', 'waiting'].includes(item.status) && ids.includes(item.assigneeId!))) throw new Error('目标成员已持有本轮活动任务');
    if (action === 'transfer' || action === 'delegate') {
      if (ids.length !== 1 || task.handledBy?.includes(ids[0])) throw new Error('不能将任务转回曾经经手的处理人');
      task.handledBy = [...(task.handledBy ?? []), task.assigneeId!];
      if (action === 'delegate') { task.delegatedFromId ??= task.assigneeId; task.taskKind = 'suggestion'; }
      task.assigneeId = ids[0]; slot.currentAssigneeId = ids[0];
      await this.emit(run, task, 'entered', action === 'delegate' ? '已委派，受托意见将交原审批人确认' : '任务已转办'); return;
    }
    if (slot.origin !== 'base') throw new Error('加签席位不可嵌套加签');
    const groupId = this.nextId++; const position = command.position ?? 'parallel';
    const group: WorkflowNodeActivation['signGroups'][number] = { id: groupId, activationId: activation.id, anchorSlotId: slot.id,
      position, signMode: command.signMode ?? 'and', status: position === 'after' ? 'waiting' : 'active', createdBy: task.assigneeId,
      createdAt: String(this.now), canReduce: true, slots: [] };
    activation.signGroups.push(group);
    for (const id of ids) {
      const taskId = this.nextId++; const slotId = this.nextId++;
      const member: MemoryTask = { ...task, id: taskId, slotId, assigneeId: id, delegatedFromId: null, taskKind: 'approval',
        status: position === 'after' ? 'waiting' : 'pending', waitReason: position === 'after' ? 'afterSign' : null,
        timeoutAt: position === 'after' ? null : computeTimeoutAt(config.timeout, new Date(this.now))?.getTime() ?? null, handledBy: [] };
      const seat: WorkflowNodeActivation['slots'][number] = { id: slotId, activationId: activation.id, origin: 'addSign', groupId,
        originalAssigneeId: id, currentAssigneeId: id, assigneeName: null, status: 'pending', order: null, mandatory: false, currentTaskId: taskId };
      activation.slots.push(seat); group.slots.push(seat); run.tasks.push(member); await this.emit(run, member, member.status === 'pending' ? 'entered' : 'waiting', '已创建独立加签席位');
    }
    await this.reconcile(run, task, false);
  }
  private async spawnChildren(run: Execution, task: MemoryTask) {
    const config = this.config(run, task.nodeKey)!;
    const definition = config.subProcessId ? await this.facts.definition(config.subProcessId) : null;
    if (!definition) { if (task.status === 'waiting') await this.failEffect(run, task, '子流程定义不存在或未发布'); return; }
    const items = config.subProcessMode === 'multi' ? resolveMultiItems(config, run.formData) : [undefined];
    if (!items.length) { if (task.status === 'waiting') await this.finishTask(run, task, 'approved', '子流程集合为空'); return; }
    const initial = config.subProcessMultiExecution === 'serial' && task.status === 'waiting' ? items.slice(0, 1) : items;
    for (let i = 0; i < initial.length; i++) await this.spawnChild(run, task, definition, initial[i], i);
  }
  private async spawnChild(run: Execution, task: MemoryTask, def: MemoryExecutionDefinition, item: unknown, index: number) {
    const config = this.config(run, task.nodeKey)!;
    const form = buildChildFormData(config.subProcessFieldMapping, run.formData, item);
    if (config.subProcessMultiItemKey) form[config.subProcessMultiItemKey] = item;
    const rawUser = config.subProcessInitiator === 'specifiedUser' ? config.subProcessInitiatorUserId
      : config.subProcessInitiator === 'formField' ? run.formData[config.subProcessInitiatorField ?? ''] : run.initiatorId;
    const candidate = Array.isArray(rawUser) ? Number(rawUser[0]) : Number(rawUser);
    const initiatorId = Number.isInteger(candidate) && candidate > 0 ? candidate : run.initiatorId;
    await this.createExecution(def, form, initiatorId, run.path + '/' + task.nodeKey + '-' + task.id + '/' + index, {}, task.id, index);
  }
  async settleChildren() {
    let changed = true;
    while (changed && !this.stepLimit) {
      changed = false;
      for (const run of this.executions) for (const task of run.tasks.filter(t => t.waitReason === 'subprocess' && t.status === 'waiting')) {
        const config = this.config(run, task.nodeKey)!;
        const children = this.executions.filter(child => child.parentTaskId === task.id);
        const settled = children.filter(child => child.status !== 'running' && child.status !== 'returned');
        const items = config.subProcessMode === 'multi' ? resolveMultiItems(config, run.formData) : [undefined];
        const outcome = runtimeSubprocessOutcome(config.subProcessMode === 'multi' ? config : { ...config, subProcessOnChildReject: 'abort' }, settled.map(child => child.status), items.length);
        if (outcome !== 'wait') {
          for (const [parentKey, childKey] of Object.entries(config.subProcessOutputMapping ?? {})) {
            const values = settled.sort((a,b) => (a.childIndex ?? 0) - (b.childIndex ?? 0)).map(child => child.formData[childKey]).filter(value => value !== undefined);
            if (config.subProcessMode === 'multi') run.formData[parentKey] = values;
            else if (values.length) run.formData[parentKey] = values[0];
          }
          run.formData = computeWorkflowDerivedValues(run.fields, run.formData);
          await this.finishTask(run, task, outcome === 'reject' ? 'rejected' : 'approved', outcome === 'reject' ? '子流程拒绝' : '子流程已完成'); changed = true;
        } else if (config.subProcessMultiExecution === 'serial' && settled.length === children.length && children.length < items.length) {
          const def = await this.facts.definition(config.subProcessId!);
          if (def) { await this.spawnChild(run, task, def, items[children.length], children.length); changed = true; }
        }
      }
    }
  }
  private async advanceTime(minutes: number) {
    const targetTime = this.now + minutes * 60000;
    while (!this.stepLimit) {
      const next = this.executions.filter(run => run.status === 'running').flatMap(run => run.tasks)
        .filter(task => (task.status === 'waiting' && task.waitReason === 'delay' && task.dueAt != null && task.dueAt <= targetTime)
          || (task.status === 'pending' && task.timeoutAt != null && task.timeoutAt <= targetTime))
        .sort((a, b) => (a.dueAt ?? a.timeoutAt ?? 0) - (b.dueAt ?? b.timeoutAt ?? 0))[0];
      if (!next) break;
      this.budget();
      this.now = Math.max(this.now, next.status === 'waiting' ? next.dueAt! : next.timeoutAt!);
      const run = this.runFor(next);
      if (next.waitReason === 'delay') { next.dueAt = null; await this.finishTask(run, next, 'approved', '虚拟时钟到达延迟截止时间'); }
      else await this.timeout(run, next);
      await this.settleChildren();
    }
    this.now = targetTime;
  }
  private async timeout(run: Execution, task: MemoryTask) {
    const config = this.config(run, task.nodeKey)!; const timeout = config.timeout!;
    const action = runtimeTimeoutAction(timeout, task.remindCount ?? 0);
    if (action === 'autoApprove' || action === 'autoReject') await this.finishTask(run, task, action === 'autoApprove' ? 'approved' : 'rejected', '虚拟时钟触发节点超时');
    else if (action === 'remind') { task.remindCount = (task.remindCount ?? 0) + 1; task.timeoutAt = computeTimeoutAt(timeout, new Date(this.now))?.getTime() ?? null;
      await this.emit(run, task, 'waiting', '模拟超时提醒 ' + task.remindCount); }
    else if (action === 'transferToManager') {
      const excluded = new Set(task.handledBy);
      for (const sibling of run.tasks) {
        if (sibling.id !== task.id && sibling.activationId === task.activationId && sibling.assigneeId !== null && ['pending', 'waiting'].includes(sibling.status)) {
          excluded.add(sibling.assigneeId);
        }
      }
      const target = await this.facts.timeoutTarget?.(task.assigneeId, timeout.escalateManagerLevel ?? 1, excluded);
      if (target) {
        if (task.assigneeId !== null) task.handledBy = [...(task.handledBy ?? []), task.assigneeId];
        task.assigneeId = target; task.remindCount = 0; task.timeoutAt = computeTimeoutAt(timeout, new Date(this.now))?.getTime() ?? null;
        const activation = run.activations.find(item => item.id === task.activationId)!; const slot = activation.slots.find(item => item.id === task.slotId);
        if (slot) slot.currentAssigneeId = target; await this.emit(run, task, 'entered', '超时升级转交处理人'); }
      else if (timeout.escalateFallbackAction === 'autoApprove' || timeout.escalateFallbackAction === 'autoReject') await this.finishTask(run, task, timeout.escalateFallbackAction === 'autoApprove' ? 'approved' : 'rejected', '超时无人可转，按兜底处理');
      else task.timeoutAt = null;
    } else task.timeoutAt = null;
  }
  private async failEffect(run: Execution, task: MemoryTask, reason: string) {
    const config = this.config(run, task.nodeKey)!; const policy = resolveFailurePolicy(config);
    if (!policy) {
      if (config.externalApproval?.enabled) {
        const fallback = config.externalApproval.fallbackStrategy ?? 'manual';
        if (fallback === 'manual') { await this.emit(run, task, 'waiting', reason + '，等待外部结果或人工确认'); return; }
        await this.finishTask(run, task, fallback === 'autoApprove' ? 'approved' : 'rejected', reason + '，按外部审批兜底策略处理'); return;
      }
      await this.finishTask(run, task, 'rejected', reason); return;
    }
    const disposition = runtimeFailureDisposition(policy, run.flow.nodes.some(node => node.data.key === policy.fallbackNodeKey));
    await this.emit(run, task, 'blocked', reason);
    if (disposition === 'terminate') { task.status = 'rejected'; this.cancel(run); run.status = 'rejected'; }
    else if (disposition === 'continue') await this.finishTask(run, task, 'approved', '按失败策略继续（副作用仅在内存记录）');
    else if (disposition === 'jump') { task.status = 'skipped'; await this.advance(run, { kind: 'enterNode', nodeKey: policy.fallbackNodeKey!, consumeNodeKey: task.nodeKey }); }
    else { const admin = await this.facts.admin(); if (!admin) { this.cancel(run); run.status = 'rejected'; return; }
      task.status = 'pending'; task.taskKind = 'system'; task.slotId = null; task.assigneeId = admin; task.waitReason = null;
      await this.emit(run, task, 'entered', '执行失败，进入管理员修复待办；补偿和通知仅在内存记录'); }
  }
  async replay(commands: WorkflowSimulationDecision[], autoApprove = false) {
    try {
      await this.settleChildren();
      for (const command of commands) await this.command(command);
      if (autoApprove) for (;;) {
        const task = this.executions.flatMap(run => run.status === 'running' ? run.tasks : []).find(item => item.status === 'pending' && item.taskKind !== 'excluded');
        if (!task) break;
        const run = this.runFor(task);
        if (this.requirements(run, task).length || findNextApproverSelectNodes(run.flow, task.nodeKey, { formData: run.formData, starter: run.starter }).length) break;
        await this.command({ nodeKey: task.nodeKey, taskId: task.id, executionPath: task.executionPath, action: 'approve' });
      }
    } catch (error) {
      if (!this.stepLimit) this.warnings.push(error instanceof Error ? error.message : String(error));
    }
    return this;
  }
  async snapshot() {
    const tasks = [];
    for (const run of this.executions.filter(item => item.status === 'running')) for (const task of run.tasks.filter(t => t.status === 'pending' || t.status === 'waiting')) {
      const selectableNext = [];
      for (const next of findNextApproverSelectNodes(run.flow, task.nodeKey, { formData: run.formData, starter: run.starter })) {
        const users = await this.facts.candidates(next.data);
        const names = await this.facts.names(users);
        selectableNext.push({ nodeKey: next.data.key, label: next.data.label, users: users.map(id => ({ id, name: names.get(id) ?? '用户#' + id })) });
      }
      const config = this.config(run, task.nodeKey);
      const seat = run.activations.find(item => item.id === task.activationId)?.slots.find(item => item.id === task.slotId);
      const actions = (['approve', 'reject', 'transfer', 'delegate', 'addSign', 'reduceSign'] as const).filter(action => resolveWorkflowActionButton(config?.actionButtons, action).enabled);
      tasks.push({ id: task.id, executionPath: task.executionPath, nodeKey: task.nodeKey, nodeName: task.nodeName, nodeType: task.nodeType,
        assigneeId: task.assigneeId, status: task.status, waitReason: task.waitReason, slotId: task.slotId, groupId: seat?.groupId ?? null,
        formData: structuredClone(run.formData), editableFields: applyFieldPermissionsToFields(run.fields, config?.fieldPermissions ?? {}),
        actions, requirements: this.requirements(run, task), selectableNext });
    }
    return { now: this.now, commandCount: this.commandCount, tasks, executions: this.executions.map(run => ({ path: run.path, status: run.status, formData: run.formData })) };
  }
  nodeStates(): Record<string, WorkflowSimulationNodeState> {
    const states: Record<string, WorkflowSimulationNodeState> = {};
    const root = this.executions[0];
    for (const node of root.flow.nodes) {
      const active = root.tasks.some(task => task.nodeKey === node.data.key && (task.status === 'pending' || task.status === 'waiting'));
      const latest = root.activations.filter(a => a.nodeKey === node.data.key).at(-1);
      states[node.data.key] = { status: node.data.type === 'end' && root.status === 'finished' ? 'done' : active ? 'active' : latest?.status === 'rejected' ? 'error' : latest?.status === 'cancelled' ? 'skipped' : latest ? 'done' : node.data.type === 'start' ? 'done' : 'skipped' };
    }
    return states;
  }
}
