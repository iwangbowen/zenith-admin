import { evaluateWorkflowApprovalActivation } from '@zenith/shared/workflow';
import type { WorkflowApprovalSlot, WorkflowInstance, WorkflowNodeActivation, WorkflowNodeConfig, WorkflowSignGroup, WorkflowTask } from '@zenith/shared/workflow';
import { mockDateTime } from './date';

type State = { instanceId: number; activation: WorkflowNodeActivation; tasks: Map<number, WorkflowTask> };
type Binding = { state: State; slotId: number };
type GroupOptions = { position: WorkflowSignGroup['position']; signMode?: WorkflowSignGroup['signMode']; actorId?: number; now?: string };
const states = new Map<string, State>();
const bindings = new Map<number, Binding>();
let nextActivationId = 1, nextSlotId = 1, nextGroupId = 1;

function taskBinding(task: WorkflowTask): Binding {
  const binding = bindings.get(task.id);
  if (!binding || binding.state.instanceId !== task.instanceId) throw new Error('任务未关联正式审批席位');
  binding.state.tasks.set(task.id, task);
  return binding;
}
function taskSlot(task: WorkflowTask): WorkflowApprovalSlot {
  const binding = taskBinding(task);
  const slot = binding.state.activation.slots.find(slot => slot.id === binding.slotId);
  if (!slot) throw new Error('审批席位不存在');
  return slot;
}
function currentTask(task: WorkflowTask): Binding {
  const binding = taskBinding(task), slot = taskSlot(task);
  if (binding.state.activation.status !== 'active' || slot.status !== 'pending' || slot.currentTaskId !== task.id || task.status !== 'pending') {
    throw new Error('任务尚未激活或已处理');
  }
  return binding;
}
function attach(state: State, task: WorkflowTask, slot: WorkflowApprovalSlot, taskKind: WorkflowTask['taskKind'] = 'approval'): void {
  task.activationId = state.activation.id;
  task.slotId = slot.id;
  task.taskKind = taskKind;
  task.waitReason = null;
  task.activatedAt = null;
  task.signPosition = slot.groupId == null ? null : state.activation.signGroups.find(group => group.id === slot.groupId)?.position ?? null;
  state.tasks.set(task.id, task); bindings.set(task.id, { state, slotId: slot.id });
  slot.currentTaskId = task.id;
}
function cancelOpenSeats(state: State, now: string, reason: string): void {
  for (const slot of state.activation.slots) if (slot.status === 'pending') slot.status = 'cancelled';
  for (const group of state.activation.signGroups) if (group.status === 'active' || group.status === 'waiting') group.status = 'cancelled';
  for (const task of state.tasks.values()) if (task.status === 'pending' || task.status === 'waiting') {
    task.status = 'skipped'; task.waitReason = null; task.actionAt = now; task.comment = reason;
  }
}

/** Mutates only attached mock rows. Vote/group decisions always come from the shared pure evaluator. */
export function reconcileMockActivation(instanceId: number, activationId: string, now = mockDateTime()) {
  const state = states.get(activationId);
  if (!state || state.instanceId !== instanceId) throw new Error('审批轮次不存在');
  const evaluated = evaluateWorkflowApprovalActivation(state.activation);
  state.activation = evaluated.activation;
  if (evaluated.failed) cancelOpenSeats(state, now, '[流程驳回] 本轮未办席位已取消');
  for (const slot of state.activation.slots) {
    const task = slot.currentTaskId == null ? undefined : state.tasks.get(slot.currentTaskId);
    if (!task) continue;
    task.signPosition = slot.groupId == null ? null : state.activation.signGroups.find(group => group.id === slot.groupId)?.position ?? null;
    if (slot.status === 'cancelled') {
      if (task.status === 'pending' || task.status === 'waiting') { task.status = 'skipped'; task.actionAt = now; }
      task.waitReason = null;
    } else if (slot.status === 'pending') {
      const waitReason = evaluated.waitReasons[slot.id] ?? null;
      if (waitReason) { task.status = 'waiting'; task.waitReason = waitReason; }
      else {
        if (task.status !== 'pending' || task.activatedAt == null) task.activatedAt = now;
        task.status = 'pending'; task.waitReason = null;
      }
    }
  }
  for (const group of state.activation.signGroups) {
    group.slots = state.activation.slots.filter(slot => slot.groupId === group.id);
    group.canReduce = state.activation.status === 'active' && ['waiting', 'active'].includes(group.status);
  }
  return { ...evaluated, activation: state.activation };
}

/** Snapshot initialization only; later counts/threshold satisfaction are never inferred from task rows. */
export function createMockActivation(
  instance: Pick<WorkflowInstance, 'id'>,
  node: WorkflowNodeConfig,
  baseTasks: WorkflowTask[],
  options: { now?: string; activationId?: string; baseRequired?: number } = {},
): WorkflowNodeActivation {
  if (!baseTasks.length) throw new Error('正式审批轮次至少需要一个基础席位');
  if (baseTasks.some(task => task.instanceId !== instance.id || task.nodeKey !== node.key || bindings.has(task.id))) throw new Error('基础任务不属于新节点轮次');
  const method = node.approveMethod === 'ratio' || node.approveMethod === 'and' || node.approveMethod === 'sequential' ? node.approveMethod : 'or';
  const baseRequired = options.baseRequired ?? (method === 'ratio' ? Math.ceil(baseTasks.length * (node.approveRatio ?? 100) / 100) : method === 'or' ? 1 : baseTasks.length);
  const activation: WorkflowNodeActivation = { id: options.activationId ?? `demo-activation-${nextActivationId++}`, nodeKey: node.key, nodeName: node.label,
    tokenId: null, status: 'active', approveMethod: method, approveRatio: method === 'ratio' ? node.approveRatio ?? 100 : null,
    baseTotal: baseTasks.length, baseRequired, baseApproved: 0, baseRejected: 0, baseSatisfied: false, slots: [], signGroups: [] };
  if (states.has(activation.id)) throw new Error('审批轮次已存在');
  const state: State = { instanceId: instance.id, activation, tasks: new Map() }; states.set(activation.id, state);
  baseTasks.forEach((task, order) => {
    const slot: WorkflowApprovalSlot = { id: nextSlotId++, activationId: activation.id, origin: 'base', groupId: null,
      originalAssigneeId: task.originalAssigneeId ?? task.assigneeId, currentAssigneeId: task.assigneeId, assigneeName: task.assigneeName ?? null,
      status: task.status === 'approved' || task.status === 'rejected' ? task.status : task.status === 'skipped' ? 'cancelled' : 'pending',
      order, mandatory: false, currentTaskId: task.id };
    activation.slots.push(slot); attach(state, task, slot);
  });
  return reconcileMockActivation(instance.id, activation.id, options.now ?? baseTasks[0].createdAt).activation;
}

/** Callers allocate task IDs and attachments; this adapter only attaches new rows to a supplemental group. */
export function addMockSignGroup(anchorTask: WorkflowTask, created: WorkflowTask[], options: GroupOptions) {
  const { state } = currentTask(anchorTask), anchor = taskSlot(anchorTask);
  if (anchor.origin !== 'base' || anchorTask.taskKind !== 'approval') throw new Error('仅本轮基础正式席位可加签，不支持嵌套加签');
  if (!created.length || created.some(task => task.instanceId !== state.instanceId || task.nodeKey !== state.activation.nodeKey || bindings.has(task.id))) throw new Error('加签任务不属于当前轮次');
  const users = created.map(task => task.assigneeId);
  if (new Set(users).size !== users.length || users.some(userId => state.activation.slots.some(slot => slot.status === 'pending' && slot.currentAssigneeId === userId))) throw new Error('加签人已持有本轮活动席位');
  const now = options.now ?? mockDateTime();
  const group: WorkflowSignGroup = { id: nextGroupId++, activationId: state.activation.id, anchorSlotId: anchor.id, position: options.position,
    signMode: options.signMode ?? 'and', status: options.position === 'after' ? 'waiting' : 'active', createdBy: options.actorId ?? anchorTask.assigneeId,
    createdAt: now, canReduce: true, slots: [] };
  state.activation.signGroups.push(group);
  for (const task of created) {
    const slot: WorkflowApprovalSlot = { id: nextSlotId++, activationId: state.activation.id, origin: 'addSign', groupId: group.id,
      originalAssigneeId: task.assigneeId, currentAssigneeId: task.assigneeId, assigneeName: task.assigneeName ?? null, status: 'pending', order: null,
      mandatory: false, currentTaskId: task.id };
    state.activation.slots.push(slot); attach(state, task, slot);
  }
  const result = reconcileMockActivation(state.instanceId, state.activation.id, now);
  return { group: result.activation.signGroups.find(entry => entry.id === group.id)!, created, ...result };
}

/** Group identity survives a waiting or already handled anchor; reduction targets formal slot IDs. */
export function reduceMockSignGroup(groupId: number, targetSlotIds: readonly number[], options: { actorId?: number; canManage?: boolean; now?: string; comment?: string } = {}) {
  const state = [...states.values()].find(state => state.activation.signGroups.some(group => group.id === groupId));
  const group = state?.activation.signGroups.find(group => group.id === groupId);
  if (!state || !group) throw new Error('加签组不存在');
  if (state.activation.status !== 'active' || !['waiting', 'active'].includes(group.status)) throw new Error('加签组已结束');
  const anchor = state.activation.slots.find(slot => slot.id === group.anchorSlotId)!;
  if (options.actorId != null && !options.canManage && ![group.createdBy, anchor.originalAssigneeId, anchor.currentAssigneeId].includes(options.actorId)) throw new Error('无权管理此加签组');
  if (!targetSlotIds.length || new Set(targetSlotIds).size !== targetSlotIds.length) throw new Error('请选择未办加签席位');
  const slots = targetSlotIds.map(id => state.activation.slots.find(slot => slot.id === id));
  if (slots.some(slot => !slot || slot.groupId !== groupId || slot.origin !== 'addSign' || slot.status !== 'pending')) throw new Error('仅可移除本组未办加签席位');
  const now = options.now ?? mockDateTime(), removed: WorkflowTask[] = [];
  for (const slot of slots as WorkflowApprovalSlot[]) {
    slot.status = 'cancelled';
    const task = slot.currentTaskId == null ? undefined : state.tasks.get(slot.currentTaskId);
    if (task) { task.status = 'skipped'; task.actionAt = now; task.waitReason = null; task.comment = `[减签] ${options.comment ?? ''}`; removed.push(task); }
  }
  const result = reconcileMockActivation(state.instanceId, state.activation.id, now);
  return { group: result.activation.signGroups.find(entry => entry.id === group.id)!, removed, ...result };
}

/** A suggestion closes only its task and creates a receipt on the same pending formal slot. */
export function settleMockApprovalSeat(task: WorkflowTask, decision: 'approved' | 'rejected', options: { now?: string; receiptTask?: WorkflowTask } = {}) {
  const { state } = currentTask(task), slot = taskSlot(task), now = options.now ?? mockDateTime();
  if (task.taskKind === 'suggestion' && !options.receiptTask) throw new Error('建议委派需创建同席位回执任务');
  if (options.receiptTask && (bindings.has(options.receiptTask.id) || options.receiptTask.instanceId !== state.instanceId || options.receiptTask.nodeKey !== state.activation.nodeKey)) throw new Error('回执任务无效');
  task.status = decision; task.actionAt = now; task.waitReason = null;
  if (task.taskKind === 'suggestion') {
    const receipt = options.receiptTask!;
    receipt.assigneeId = task.delegatedFromId ?? slot.originalAssigneeId;
    receipt.delegatedFromId = null; receipt.delegationMode = null;
    slot.currentAssigneeId = receipt.assigneeId; slot.assigneeName = receipt.assigneeName ?? null;
    attach(state, receipt, slot);
    return { ...reconcileMockActivation(state.instanceId, state.activation.id, now), receiptTask: receipt, suggestion: true };
  }
  slot.status = decision;
  return { ...reconcileMockActivation(state.instanceId, state.activation.id, now), receiptTask: null, suggestion: false };
}

/** Transfer or suggestion delegation changes the current task/assignee, never the formal seat identity. */
export function transferMockApprovalSeat(task: WorkflowTask, targetUserId: number, options: { now?: string; targetName?: string; allowWaiting?: boolean } = {}) {
  const binding = options.allowWaiting ? taskBinding(task) : currentTask(task), state = binding.state, slot = taskSlot(task);
  if (state.activation.status !== 'active' || slot.status !== 'pending' || slot.currentTaskId !== task.id || !['pending', 'waiting'].includes(task.status)) throw new Error('席位已结束，不能改派');
  if (targetUserId === task.assigneeId) throw new Error('目标不能是当前处理人');
  task.originalAssigneeId ??= slot.originalAssigneeId;
  task.assigneeId = targetUserId; task.assigneeName = options.targetName ?? `用户${targetUserId}`;
  if (task.status === 'pending') task.activatedAt = options.now ?? mockDateTime();
  slot.currentAssigneeId = targetUserId; slot.assigneeName = task.assigneeName;
  return { ...reconcileMockActivation(state.instanceId, state.activation.id, options.now), task };
}
export function delegateMockApprovalSeat(task: WorkflowTask, suggestionTask: WorkflowTask, targetUserId: number, options: { now?: string; targetName?: string } = {}) {
  const { state } = currentTask(task), slot = taskSlot(task), now = options.now ?? mockDateTime();
  if (targetUserId === task.assigneeId || bindings.has(suggestionTask.id) || suggestionTask.instanceId !== state.instanceId) throw new Error('委派目标或建议任务无效');
  const principal = task.delegatedFromId ?? task.assigneeId;
  task.status = 'skipped'; task.actionAt = now; task.waitReason = null;
  suggestionTask.assigneeId = targetUserId; suggestionTask.assigneeName = options.targetName ?? `用户${targetUserId}`;
  suggestionTask.delegatedFromId = principal; suggestionTask.delegationMode = 'suggest';
  slot.currentAssigneeId = targetUserId; slot.assigneeName = suggestionTask.assigneeName;
  attach(state, suggestionTask, slot, 'suggestion');
  return { ...reconcileMockActivation(state.instanceId, state.activation.id, now), task: suggestionTask };
}

/** Terminal/return cleanup includes waiting groups and suggestion tasks; history and activation timestamps remain. */
export function cancelMockApprovalActivations(instanceId: number, now = mockDateTime(), reason = '[流程结束] 未办审批已取消'): void {
  for (const state of states.values()) if (state.instanceId === instanceId && state.activation.status === 'active') {
    cancelOpenSeats(state, now, reason); state.activation.status = 'cancelled';
    for (const group of state.activation.signGroups) group.slots = state.activation.slots.filter(slot => slot.groupId === group.id);
  }
}
export function getMockApprovalActivations(instanceId: number, actorId?: number): WorkflowNodeActivation[] {
  return [...states.values()].filter(state => state.instanceId === instanceId).map(state => ({ ...state.activation,
    slots: state.activation.slots.map(slot => ({ ...slot })), signGroups: state.activation.signGroups.map(group => {
      const anchor = state.activation.slots.find(slot => slot.id === group.anchorSlotId);
      return { ...group, slots: group.slots.map(slot => ({ ...slot })), canReduce: state.activation.status === 'active' && ['waiting', 'active'].includes(group.status)
        && (actorId == null || [group.createdBy, anchor?.originalAssigneeId, anchor?.currentAssigneeId].includes(actorId)) };
    }) }));
}
export function resetMockApprovalState(): void { states.clear(); bindings.clear(); nextActivationId = 1; nextSlotId = 1; nextGroupId = 1; }

/** Rebind fixture rows after store snapshots are restored; task rows are never used to settle votes. */
export function synchronizeMockApprovalTaskRefs(instanceId: number, tasks: WorkflowTask[]): boolean {
  const owned = [...states.values()].filter(state => state.instanceId === instanceId);
  if (!owned.length) return false;
  const byId = new Map(tasks.map(task => [task.id, task]));
  for (const task of tasks.filter(task => task.nodeType === 'approve' || task.nodeType === 'handler')) {
    const binding = bindings.get(task.id);
    if (!binding || binding.state.instanceId !== instanceId || binding.slotId !== task.slotId) return false;
  }
  for (const state of owned) for (const slot of state.activation.slots) {
    const current = slot.currentTaskId == null ? undefined : byId.get(slot.currentTaskId);
    if (!current) return false;
    if (current.taskKind !== 'suggestion') {
      if ((current.status === 'pending' || current.status === 'waiting') && slot.status !== 'pending') return false;
      const returned = current.decision?.action === 'returnInitiator' || current.decision?.action === 'returnNode';
      if ((current.status === 'approved' || current.status === 'rejected') && slot.status !== current.status && !(returned && slot.status === 'cancelled')) return false;
      if (current.status === 'skipped' && slot.status !== 'cancelled') return false;
    }
    slot.currentAssigneeId = current.assigneeId; slot.assigneeName = current.assigneeName ?? null;
  }
  for (const task of tasks) { const binding = bindings.get(task.id); if (binding?.state.instanceId === instanceId) binding.state.tasks.set(task.id, task); }
  return true;
}
export function resetMockApprovalInstance(instanceId: number): void {
  for (const [id, state] of states) if (state.instanceId === instanceId) states.delete(id);
  for (const [id, binding] of bindings) if (binding.state.instanceId === instanceId) bindings.delete(id);
}
