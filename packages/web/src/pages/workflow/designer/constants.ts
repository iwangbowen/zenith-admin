/**
 * 钉钉/飞书风格流程设计器 — 节点类型注册表 & 常量
 */
import {
  UserCheck,
  ClipboardCheck,
  Send,
  GitBranch,
  GitMerge,
  Diamond,
  Clock,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { FlowNodeType, BranchNodeType } from './types';

// ─── 节点类型注册信息 ────────────────────────────────────────────────

export interface NodeTypeInfo {
  type: FlowNodeType;
  label: string;
  icon: LucideIcon;
  color: string;          // 主题色（标题栏背景）
  description?: string;
}

/** 可通过 "+" 按钮添加的节点类型 */
export const ADDABLE_NODE_TYPES: NodeTypeInfo[] = [
  { type: 'approver',        label: '审批人', icon: UserCheck,      color: '#ff943e', description: '需要审批通过才能继续' },
  { type: 'handler',         label: '办理人', icon: ClipboardCheck, color: '#3296fa', description: '任务执行人，处理完成后继续' },
  { type: 'cc',              label: '抄送',   icon: Send,           color: '#40a9ff', description: '通知相关人员，不阻塞流程' },
  { type: 'conditionBranch', label: '条件分支', icon: GitBranch,    color: '#ff943e', description: '根据条件分支走不同路径' },
  { type: 'parallelBranch',  label: '并行分支', icon: GitMerge,     color: '#718dff', description: '所有分支同时执行' },
  { type: 'inclusiveBranch', label: '包容分支', icon: Diamond,      color: '#13c2c2', description: '满足条件的分支均执行' },
  { type: 'delay',           label: '延迟器',   icon: Clock,        color: '#999',    description: '等待指定时间后继续' },
  { type: 'routeBranch',     label: '路由分支', icon: Workflow,      color: '#f5222d', description: '动态路由分支' },
  { type: 'trigger',         label: '触发器',   icon: Zap,          color: '#722ed1', description: '等待外部事件触发' },
  { type: 'subProcess',      label: '子流程',   icon: Workflow,      color: '#8c6e36', description: '调用其他流程定义' },
];

/** 节点类型 → 颜色映射（含发起人） */
export const NODE_COLOR_MAP: Record<FlowNodeType, string> = {
  initiator:       '#ff943e',
  approver:        '#ff943e',
  handler:         '#3296fa',
  cc:              '#40a9ff',
  conditionBranch: '#ff943e',
  parallelBranch:  '#718dff',
  inclusiveBranch: '#13c2c2',
  routeBranch:     '#f5222d',
  delay:           '#999',
  trigger:         '#722ed1',
  subProcess:      '#8c6e36',
};

/** 分支节点默认子分支数量 */
export const DEFAULT_BRANCH_COUNT: Record<BranchNodeType, number> = {
  conditionBranch: 2,
  parallelBranch:  2,
  inclusiveBranch: 2,
  routeBranch:     2,
};

/** 分支节点的"添加分支"按钮文字 */
export const BRANCH_ADD_LABEL: Record<BranchNodeType, string> = {
  conditionBranch: '添加条件',
  parallelBranch:  '添加分支',
  inclusiveBranch: '添加分支',
  routeBranch:     '添加分支',
};

/** 条件分支—条件运算符标签 */
export const OPERATOR_LABELS: Record<string, string> = {
  eq: '等于',
  neq: '不等于',
  gt: '大于',
  gte: '大于等于',
  lt: '小于',
  lte: '小于等于',
  in: '包含在',
  contains: '包含',
};
