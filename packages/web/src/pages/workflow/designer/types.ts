/**
 * 钉钉/飞书风格流程设计器 — 数据模型
 *
 * 流程节点采用嵌套树结构（链表 + 分支），
 * 保存到后端时转换为扁平 nodes + edges 格式。
 */

// ─── 节点类型 ────────────────────────────────────────────────────────

export type FlowNodeType =
  | 'initiator'
  | 'approver'
  | 'handler'
  | 'cc'
  | 'delay'
  | 'trigger'
  | 'subProcess'
  | 'conditionBranch'
  | 'parallelBranch'
  | 'inclusiveBranch'
  | 'routeBranch';

// ─── 条件 ────────────────────────────────────────────────────────────

export type ConditionOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';

export interface ConditionRule {
  field: string;
  operator: ConditionOperator;
  value: string | number | boolean;
}

export interface ConditionGroup {
  type: 'and' | 'or';
  rules: ConditionRule[];
}

// ─── 分支 ────────────────────────────────────────────────────────────

export interface FlowBranch {
  id: string;
  name: string;
  priority?: number;
  conditions?: ConditionGroup[];
  isDefault?: boolean;
  children?: FlowNode;
}

// ─── 节点 ────────────────────────────────────────────────────────────

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  name: string;
  props: Record<string, unknown>;
  children?: FlowNode;        // 下一个节点（链表）
  branches?: FlowBranch[];    // 分支节点专用
}

// ─── 流程定义顶层 ────────────────────────────────────────────────────

export interface FlowProcess {
  initiator: FlowNode;  // 根节点（发起人）
}

// ─── 用于渲染的辅助类型 ─────────────────────────────────────────────

export type BranchNodeType = 'conditionBranch' | 'parallelBranch' | 'inclusiveBranch' | 'routeBranch';

export function isBranchNode(type: FlowNodeType): type is BranchNodeType {
  return ['conditionBranch', 'parallelBranch', 'inclusiveBranch', 'routeBranch'].includes(type);
}
