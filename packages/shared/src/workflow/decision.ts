import type { WorkflowEdge, WorkflowNodeConfig } from './types';
import {
  workflowEdgeConditionState,
  workflowEdgeHasCondition,
  type WorkflowConditionResult,
  type WorkflowConditionStateContext,
} from './conditions';

/**
 * 审批链路唯一的“节点能力 + 网关选边”语义。
 *
 * 运行时的 token 引擎、链路预测、上一节点选人校验、批量/列表预检与仿真都必须消费这里的结果，
 * 不允许各自维护节点类型白名单或默认分支判断。
 */

export type WorkflowNodeKind = 'human' | 'automatic' | 'pass' | 'gateway' | 'wait' | 'terminal';

export type WorkflowWaitReason = 'external' | 'delay' | 'subprocess' | 'trigger';

export interface WorkflowNodeBehavior {
  kind: WorkflowNodeKind;
  /** true = token 停在该节点等待（人工任务 / 延时 / 门控触发器 / 等待型子流程） */
  blocks: boolean;
  /** 是否会创建待办/作业行（抄送、自动节点、等待节点与人工节点不同） */
  createsTask: boolean;
  /** 是否由上一节点审批人为该节点选人（仅人工且 assigneeType=approverSelect） */
  requiresApproverSelection: boolean;
  waitReason?: WorkflowWaitReason;
}

const HUMAN_TYPES = new Set<WorkflowNodeConfig['type']>(['approve', 'handler']);
const GATEWAY_TYPES = new Set<WorkflowNodeConfig['type']>([
  'exclusiveGateway',
  'parallelGateway',
  'inclusiveGateway',
  'routeGateway',
]);

/** 触发器是否为“门控”语义：token 停在节点，等异步作业/外部回调完成才继续 */
export function isGatedTrigger(cfg: { triggerType?: string; onFailure?: string } | null | undefined): boolean {
  if (!cfg) return false;
  return cfg.triggerType === 'callback'
    || cfg.onFailure === 'block'
    || cfg.triggerType === 'updateData'
    || cfg.triggerType === 'deleteData';
}

function isAutomaticNode(node: WorkflowNodeConfig): boolean {
  return node.approvalType === 'autoApprove'
    || node.approvalType === 'autoReject'
    || node.approveMethod === 'auto';
}

export function classifyWorkflowNode(node: WorkflowNodeConfig): WorkflowNodeBehavior {
  if (HUMAN_TYPES.has(node.type)) {
    if (isAutomaticNode(node)) {
      // 自动通过：不产生待办，继续推进；自动拒绝：流程在此终止，不再向下游查找
      return {
        kind: 'automatic',
        blocks: node.approvalType === 'autoReject',
        createsTask: false,
        requiresApproverSelection: false,
      };
    }
    return {
      kind: 'human',
      blocks: true,
      createsTask: true,
      requiresApproverSelection: node.assigneeType === 'approverSelect',
    };
  }
  if (node.type === 'trigger') {
    const blocks = isGatedTrigger(node.triggerConfig);
    return { kind: 'wait', blocks, createsTask: blocks, requiresApproverSelection: false, waitReason: 'trigger' };
  }
  if (node.type === 'delay') {
    return { kind: 'wait', blocks: true, createsTask: true, requiresApproverSelection: false, waitReason: 'delay' };
  }
  if (node.type === 'subProcess') {
    const blocks = node.subProcessWaitChild !== false;
    return { kind: 'wait', blocks, createsTask: true, requiresApproverSelection: false, waitReason: 'subprocess' };
  }
  if (GATEWAY_TYPES.has(node.type)) {
    return { kind: 'gateway', blocks: false, createsTask: false, requiresApproverSelection: false };
  }
  if (node.type === 'end' || node.type === 'catchNode') {
    return { kind: 'terminal', blocks: true, createsTask: false, requiresApproverSelection: false };
  }
  // start / ccNode 等：不阻断，继续向下游查找
  return { kind: 'pass', blocks: false, createsTask: node.type === 'ccNode', requiresApproverSelection: false };
}

/** Gateway selection preserves the runtime edge order (branch priority) and normal-edge fallback semantics. */
export function selectWorkflowPathBranches(
  node: WorkflowNodeConfig,
  edges: readonly WorkflowEdge[],
  context: WorkflowConditionStateContext,
): WorkflowConditionResult[] {
  const condition = (edge: WorkflowEdge) => workflowEdgeConditionState(edge, context);
  if (node.type === 'exclusiveGateway' || node.type === 'routeGateway') {
    // 汇聚网关通常只有一个出口：不是“条件默认分支”，避免把「所有条件均不成立」错误地挂到汇聚后的主线
    if (edges.length <= 1) return edges.map(() => ({ status: 'matched' as const, reason: '正常后续路径' }));
    let earlierUnknown = false, certainCandidate = false;
    const firstDefault = edges.findIndex(edge => !workflowEdgeHasCondition(edge));
    const selected = edges.map(edge => {
      if (!workflowEdgeHasCondition(edge)) return { status: 'excluded' as const, reason: '未使用的默认分支' };
      if (certainCandidate) return { status: 'excluded' as const, reason: '前面已有成立的优先分支' };
      const result = condition(edge);
      if (result.status === 'excluded') return result;
      if (result.status === 'unknown') { earlierUnknown = true; return result; }
      certainCandidate = true;
      return earlierUnknown ? { status: 'unknown' as const, reason: '前面的优先分支尚不确定' } : result;
    });
    if (firstDefault >= 0) selected[firstDefault] = certainCandidate
      ? { status: 'excluded', reason: '已有成立的条件分支' }
      : earlierUnknown ? { status: 'unknown', reason: '条件尚不确定，暂不能确定默认分支' }
        : { status: 'matched', reason: '所有条件均不成立，使用默认分支' };
    return selected;
  }
  if (node.type === 'inclusiveGateway' && edges.length > 1) {
    const selected = edges.map(edge => workflowEdgeHasCondition(edge) ? condition(edge) : { status: 'excluded' as const, reason: '未使用的默认分支' });
    const conditional = selected.filter((_, index) => workflowEdgeHasCondition(edges[index]));
    // The existing inclusive engine takes the last unconditional fallback; valid designer graphs have one.
    const fallback = edges.reduce((last, edge, index) => !workflowEdgeHasCondition(edge) ? index : last, -1);
    if (fallback >= 0) selected[fallback] = conditional.some(result => result.status === 'matched')
      ? { status: 'excluded', reason: '已有成立的条件分支' }
      : conditional.some(result => result.status === 'unknown') ? { status: 'unknown', reason: '条件尚不确定，暂不能确定默认分支' }
        : { status: 'matched', reason: '所有条件均不成立，使用默认分支' };
    return selected;
  }
  return edges.map(() => ({ status: 'matched', reason: node.type === 'parallelGateway' ? '并行分支均需经过' : '正常后续路径' }));
}
