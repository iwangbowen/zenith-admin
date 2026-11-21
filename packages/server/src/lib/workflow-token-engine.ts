/**
 * 工作流显式执行 Token 引擎（纯函数）
 *
 * 以 Token 作为活动路径与网关汇聚（join）的权威来源，不扫已完成任务行重算 BFS：
 * 的权威来源。每条活动执行路径 = 一个 token；fork 沿 branchPath 压入一帧分支栈并产生
 * 多条兄弟 token；join 在同组分支全部 parked 后消费它们并产出 1 条续接 token（弹出栈顶帧）。
 *
 * 节点路由规则与 workflow-engine.ts 的 advanceFlow 完全一致（复用其图工具/条件求值），
 * 唯一差异：join 判定改为基于 token（branchPath 分支栈），从而天然解决回边死锁、
 * 包容网关部分 fork、空分支直连、嵌套并行、重复经过等隐式模型的脆弱点。
 *
 * 引擎为纯函数：读入当前 active token 快照 + 一个触发，产出 { 待创建任务, token 操作,
 * finished, rejected }，由 service 层落库（见 workflow-instances.service.ts）。
 */
import { createHash, randomUUID } from 'node:crypto';
import type { WorkflowFlowData, WorkflowStarterContext } from '@zenith/shared/workflow';
import { classifyWorkflowNode } from '@zenith/shared/workflow';
import {
  buildAdjacency,
  edgeMatchesCondition,
  edgeHasCondition,
  isDefaultEdge,
  type FlowNode,
  type TaskAction,
} from './workflow-engine';

/** 分支栈帧：一次 fork 产生的分支组身份 */
export interface BranchFrame {
  /** 分支组 id（同一 fork 的兄弟共享） */
  id: string;
  /** 组内序号（0-based） */
  index: number;
  /** 组内分支总数（join 汇聚判定用） */
  total: number;
}

export type BranchPath = BranchFrame[];

/** 现存 active token 的引擎视图 */
export interface TokenSnapshot {
  id: number;
  nodeKey: string;
  branchPath: BranchPath;
}

/** 待新建 token */
export interface NewTokenSpec {
  /** 引擎本地句柄（落库前用于内部引用） */
  tempId: string;
  nodeKey: string;
  branchPath: BranchPath;
  /** 血缘：fork/推进时被消费的前驱 token id（best-effort，可空） */
  parentTokenId: number | null;
}

export interface TokenOps {
  /** 现存 token id → consumed（推进越过 / join 汇聚消费） */
  consume: number[];
  /** 新建 active token（frontier 人工/等待节点，或 parked 的 join 节点） */
  create: NewTokenSpec[];
}

export type AdvanceTrigger =
  /** 实例发起：从 start 出边播种 */
  | { type: 'seed' }
  /** 某 frontier token 的节点已完成：消费它并从其出边推进 */
  | { type: 'advance'; tokenId: number; nodeKey: string; branchPath: BranchPath }
  /** 从某节点出边继续推进（不消费 token；用于 expand 自动通过节点的续接） */
  | { type: 'continue'; nodeKey: string; branchPath: BranchPath; parentTokenId?: number | null }
  /** 直接进入某节点（强制跳转 / 退回 / 异常捕获 / 续接）：处理该节点本身 */
  | { type: 'enter'; nodeKey: string; branchPath?: BranchPath; parentTokenId?: number | null }
  /** 决策网关已完成求值并持久化：回到网关按出边条件继续 */
  | { type: 'resumeDecision'; decisionId: string; nodeKey: string; branchPath: BranchPath; parentTokenId?: number | null };

/** 到达决策网关但尚未求值：由调用方求值、持久化后再 resume。 */
export interface PendingDecision {
  decisionId: string;
  nodeKey: string;
  branchPath: BranchPath;
  parentTokenId: number | null;
}

export interface AdvanceTokensInput {
  now?: number;
  flowData: WorkflowFlowData;
  formData?: Record<string, unknown>;
  starter?: WorkflowStarterContext;
  /** 本实例当前全部 active token（含 parked join token） */
  liveTokens: TokenSnapshot[];
  trigger: AdvanceTrigger;
  /** 真实实例 ID；用于决策幂等键。仿真 / 纯函数测试可省略。 */
  instanceId?: number;
  /** 仅供 ccNode onlyOnApprove 判定（上游是否已有完成的审批/办理节点） */
  completedNodeKeys?: Set<string>;
  /** 分支组 id 生成器（默认随机；测试可注入确定性序列） */
  genBranchId?: () => string;
}

export interface AdvanceTokensResult {
  /** 待创建任务（喂给 expandTasksToRows，与旧 AdvanceResult.tasksToCreate 同构） */
  tasksToCreate: TaskAction[];
  ops: TokenOps;
  finished: boolean;
  rejected: boolean;
  /** 活动 frontier 节点 key（用于 currentNodeKey 展示） */
  activeNodeKeys: string[];
  /** 到达但未求值的决策网关；调用方需逐个求值后以 resumeDecision 继续。 */
  pendingDecisions: PendingDecision[];
}

interface Arrival {
  nodeId: string;
  branchPath: BranchPath;
  parentTokenId: number | null;
  /** resumeDecision 回到网关时跳过 pending 阶段，直接按已持久化的 formData 选边。 */
  resolved?: boolean;
}

/** 内部追踪的 parked token（现存或本次新建） */
interface ParkedToken {
  ref: number | string; // 现存为真实 id（number），新建为 tempId（string）
  nodeKey: string;
  branchPath: BranchPath;
  isNew: boolean;
}

function pathKey(path: BranchPath): string {
  return path.map((f) => `${f.id}.${f.index}/${f.total}`).join('>');
}

/** join 汇聚分组键：父栈 + 栈顶帧 id + total（同组兄弟仅 index 不同） */
function groupKey(path: BranchPath): string | null {
  if (path.length === 0) return null;
  const top = path[path.length - 1];
  const parent = path.slice(0, -1);
  return `${pathKey(parent)}|${top.id}|${top.total}`;
}

/**
 * 推进 token。纯函数：不触库，返回待落库的任务与 token 操作。
 */
function decisionIdFor(instanceId: number | undefined, nodeKey: string, path: BranchPath, parentTokenId: number | null): string {
  return createHash('sha256')
    .update(`${instanceId ?? 'sim'}:${nodeKey}:${pathKey(path)}:${parentTokenId ?? 0}`)
    .digest('hex')
    .slice(0, 32);
}

export function advanceTokens(input: AdvanceTokensInput): AdvanceTokensResult {
  const { flowData, formData = {}, starter, liveTokens, trigger } = input;
  const completedNodeKeys = input.completedNodeKeys ?? new Set<string>();
  const genBranchId = input.genBranchId ?? (() => randomUUID().slice(0, 8));

  const { nodeMap, outEdges, inEdges } = buildAdjacency(flowData);
  const nodeByKey = new Map<string, FlowNode>();
  for (const [, node] of nodeMap) nodeByKey.set(node.data.key, node);

  const tasksToCreate: TaskAction[] = [];
  const consume: number[] = [];
  const create: NewTokenSpec[] = [];
  const activeNodeKeys: string[] = [];
  const pendingDecisions: PendingDecision[] = [];
  let finished = false;
  let rejected = false;

  const result = (): AdvanceTokensResult => ({
    tasksToCreate, ops: { consume, create }, finished, rejected, activeNodeKeys, pendingDecisions,
  });

  let tempSeq = 0;
  const nextTempId = () => `t${tempSeq++}`;

  // parked token 工作集：现存停在 join 节点的 token + 本次 park 的
  const parked: ParkedToken[] = [];
  for (const tk of liveTokens) {
    const node = nodeByKey.get(tk.nodeKey);
    if (node && (node.data.type === 'parallelGateway' || node.data.type === 'inclusiveGateway')) {
      parked.push({ ref: tk.id, nodeKey: tk.nodeKey, branchPath: tk.branchPath, isNew: false });
    }
  }

  /** 落库一个新 active token（frontier 或 parked join） */
  function emitToken(nodeKey: string, branchPath: BranchPath, parentTokenId: number | null): string {
    const tempId = nextTempId();
    create.push({ tempId, nodeKey, branchPath, parentTokenId });
    return tempId;
  }

  const queue: Arrival[] = [];
  const visited = new Set<string>();

  // 起点：根据 trigger 计算初始 arrivals
  if (trigger.type === 'seed') {
    const startNode = flowData.nodes.find((n) => n.data.type === 'start');
    if (!startNode) return result();
    for (const { target } of outEdges.get(startNode.id) ?? []) {
      queue.push({ nodeId: target, branchPath: [], parentTokenId: null });
    }
  } else if (trigger.type === 'advance') {
    consume.push(trigger.tokenId);
    const fromNode = nodeByKey.get(trigger.nodeKey);
    if (!fromNode) return result();
    for (const { target } of outEdges.get(fromNode.id) ?? []) {
      queue.push({ nodeId: target, branchPath: trigger.branchPath, parentTokenId: trigger.tokenId });
    }
  } else if (trigger.type === 'continue') {
    const fromNode = nodeByKey.get(trigger.nodeKey);
    if (!fromNode) return result();
    for (const { target } of outEdges.get(fromNode.id) ?? []) {
      queue.push({ nodeId: target, branchPath: trigger.branchPath, parentTokenId: trigger.parentTokenId ?? null });
    }
  } else if (trigger.type === 'resumeDecision') {
    const node = nodeByKey.get(trigger.nodeKey);
    if (!node) return result();
    queue.push({ nodeId: node.id, branchPath: trigger.branchPath, parentTokenId: trigger.parentTokenId ?? null, resolved: true });
  } else {
    // enter：处理目标节点本身
    const node = nodeByKey.get(trigger.nodeKey);
    if (!node) return result();
    queue.push({ nodeId: node.id, branchPath: trigger.branchPath ?? [], parentTokenId: trigger.parentTokenId ?? null });
  }

  while (queue.length > 0 && !rejected) {
    const arrival = queue.shift();
    if (!arrival) continue;
    const vkey = `${arrival.nodeId}#${pathKey(arrival.branchPath)}`;
    if (visited.has(vkey)) continue;
    visited.add(vkey);

    const node = nodeMap.get(arrival.nodeId);
    if (!node) continue;
    const type = node.data.type;
    const outs = outEdges.get(arrival.nodeId) ?? [];

    if (type === 'approve' || type === 'handler') {
      if (node.data.approvalType === 'autoReject') {
        tasksToCreate.push(makeTaskAction(node, null, 'rejected'));
        rejected = true;
        break;
      }
      if (node.data.approvalType === 'autoApprove' || node.data.approveMethod === 'auto') {
        // 自动通过：建一条 approved 任务并就地继续推进
        tasksToCreate.push(makeTaskAction(node, null, 'approved'));
        for (const { target } of outs) {
          queue.push({ nodeId: target, branchPath: arrival.branchPath, parentTokenId: arrival.parentTokenId });
        }
        continue;
      }
      // frontier：人工节点，建 pending 任务 + active token，分支在此停止
      tasksToCreate.push(makeTaskAction(node, node.data.assigneeId ?? null));
      emitToken(node.data.key, arrival.branchPath, arrival.parentTokenId);
      activeNodeKeys.push(node.data.key);
      continue;
    }

    if (type === 'end') {
      finished = true;
      continue;
    }

    if (outs.length === 0) continue;

    if (type === 'exclusiveGateway' || type === 'routeGateway') {
      if (type === 'routeGateway' && node.data.decisionRuleKey && !arrival.resolved) {
        pendingDecisions.push({
          decisionId: decisionIdFor(input.instanceId, node.data.key, arrival.branchPath, arrival.parentTokenId),
          nodeKey: node.data.key,
          branchPath: arrival.branchPath,
          parentTokenId: arrival.parentTokenId,
        });
        continue;
      }
      let chosen: string | null = null;
      let fallback: string | null = null;
      for (const { target, edge } of outs) {
        const tgt = nodeMap.get(target);
        if (!tgt) continue;
        if (edgeHasCondition(edge)) {
          if (edgeMatchesCondition(edge, formData, starter, input.now)) { chosen = target; break; }
        } else if (isDefaultEdge(edge, tgt) && !fallback) {
          fallback = target;
        }
      }
      const next = chosen ?? fallback;
      if (next) queue.push({ nodeId: next, branchPath: arrival.branchPath, parentTokenId: arrival.parentTokenId });
      continue;
    }

    if (type === 'parallelGateway' || type === 'inclusiveGateway') {
      const inCount = (inEdges.get(arrival.nodeId) ?? []).length;
      const outCount = outs.length;
      // fork 判定与 advanceFlow 一致："多出即 fork"，避免回边导致 join 永久死锁
      const isFork = outCount > 1 || (outCount === 1 && inCount <= 1);

      if (isFork) {
        // 收集激活分支目标
        const targets: string[] = [];
        if (type === 'inclusiveGateway') {
          let defaultTarget: string | null = null;
          for (const { target, edge } of outs) {
            const tgt = nodeMap.get(target);
            if (!tgt) continue;
            if (edgeHasCondition(edge)) {
              if (edgeMatchesCondition(edge, formData, starter, input.now)) targets.push(target);
            } else if (isDefaultEdge(edge, tgt) || !defaultTarget) {
              defaultTarget = target;
            }
          }
          if (targets.length === 0 && defaultTarget) targets.push(defaultTarget);
        } else {
          for (const { target } of outs) targets.push(target);
        }
        if (targets.length === 0) continue;
        // 压入一帧分支栈，产生兄弟分支
        const branchGroupId = genBranchId();
        const total = targets.length;
        targets.forEach((target, index) => {
          const childPath: BranchPath = [...arrival.branchPath, { id: branchGroupId, index, total }];
          queue.push({ nodeId: target, branchPath: childPath, parentTokenId: arrival.parentTokenId });
        });
        continue;
      }

      // join：到达的分支在此 park，凑齐同组全部分支后弹栈续接
      const gkey = groupKey(arrival.branchPath);
      if (gkey === null) {
        // 主路径到达 join（无配对 fork）：直接放行，弹无可弹则保持空栈
        for (const { target } of outs) {
          queue.push({ nodeId: target, branchPath: arrival.branchPath, parentTokenId: arrival.parentTokenId });
        }
        continue;
      }
      // park 当前到达分支
      const newTempId = nextTempId();
      parked.push({ ref: newTempId, nodeKey: node.data.key, branchPath: arrival.branchPath, isNew: true });
      const top = arrival.branchPath[arrival.branchPath.length - 1];
      // 同 join、同组、已 park 的分支
      const sameGroup = parked.filter((p) => p.nodeKey === node.data.key && groupKey(p.branchPath) === gkey);
      const arrivedIndices = new Set(sameGroup.map((p) => p.branchPath[p.branchPath.length - 1].index));
      if (arrivedIndices.size >= top.total) {
        // 汇聚达成：消费该组全部 parked token（现存 → ops.consume；本次新建 → 丢弃）
        for (const p of sameGroup) {
          if (!p.isNew && typeof p.ref === 'number') consume.push(p.ref);
        }
        // 从工作集移除已消费的该组 parked
        for (let i = parked.length - 1; i >= 0; i--) {
          const p = parked[i];
          if (p.nodeKey === node.data.key && groupKey(p.branchPath) === gkey) parked.splice(i, 1);
        }
        // 弹栈续接
        const parentPath = arrival.branchPath.slice(0, -1);
        for (const { target } of outs) {
          queue.push({ nodeId: target, branchPath: parentPath, parentTokenId: arrival.parentTokenId });
        }
      } else {
        // 等待其他分支：新建的 parked 落库为 active token（join 节点不计入 activeNodeKeys，无任务行）
        create.push({ tempId: newTempId, nodeKey: node.data.key, branchPath: arrival.branchPath, parentTokenId: arrival.parentTokenId });
      }
      continue;
    }

    if (type === 'ccNode') {
      let shouldCreate = true;
      if (node.data.onlyOnApprove) {
        shouldCreate = hasCompletedUpstreamApprove(node, inEdges, nodeMap, completedNodeKeys);
      }
      if (shouldCreate) {
        tasksToCreate.push(makeTaskAction(node, null));
      }
      for (const { target } of outs) {
        queue.push({ nodeId: target, branchPath: arrival.branchPath, parentTokenId: arrival.parentTokenId });
      }
      continue;
    }

    if (type === 'delay') {
      tasksToCreate.push(makeTaskAction(node, null));
      emitToken(node.data.key, arrival.branchPath, arrival.parentTokenId);
      activeNodeKeys.push(node.data.key);
      continue;
    }

    if (type === 'trigger') {
      tasksToCreate.push(makeTaskAction(node, null));
      // 门控触发器（callback/block/数据变更）：token 停在节点，由作业完成或外部回调推进；
      // 其余为 fire-and-forget，token 直接越过（与 materialize 任务展开、trigger-dispatch 推进判定保持一致）
      if (classifyWorkflowNode(node.data).blocks) {
        emitToken(node.data.key, arrival.branchPath, arrival.parentTokenId);
        activeNodeKeys.push(node.data.key);
      } else {
        for (const { target } of outs) {
          queue.push({ nodeId: target, branchPath: arrival.branchPath, parentTokenId: arrival.parentTokenId });
        }
      }
      continue;
    }

    if (type === 'subProcess') {
      tasksToCreate.push(makeTaskAction(node, null));
      const waitChild = classifyWorkflowNode(node.data).blocks;
      if (waitChild) {
        emitToken(node.data.key, arrival.branchPath, arrival.parentTokenId);
        activeNodeKeys.push(node.data.key);
      } else {
        for (const { target } of outs) {
          queue.push({ nodeId: target, branchPath: arrival.branchPath, parentTokenId: arrival.parentTokenId });
        }
      }
      continue;
    }

    // start / catchNode / 其他：透传继续
    for (const { target } of outs) {
      queue.push({ nodeId: target, branchPath: arrival.branchPath, parentTokenId: arrival.parentTokenId });
    }
  }

  return result();
}

function makeTaskAction(node: FlowNode, assigneeId: number | null, autoStatus?: 'approved' | 'rejected'): TaskAction {
  return {
    nodeKey: node.data.key,
    nodeName: node.data.label,
    nodeType: node.data.type,
    assigneeId,
    nodeConfig: node.data,
    ...(autoStatus ? { autoStatus } : {}),
  };
}

/** ccNode onlyOnApprove：沿入边反向 BFS，判断上游是否存在已完成的审批/办理节点 */
function hasCompletedUpstreamApprove(
  node: FlowNode,
  inEdges: Map<string, string[]>,
  nodeMap: Map<string, FlowNode>,
  completedNodeKeys: Set<string>,
): boolean {
  const visited = new Set<string>();
  const stack: string[] = [...(inEdges.get(node.id) ?? [])];
  while (stack.length > 0) {
    const srcId = stack.pop();
    if (!srcId || visited.has(srcId)) continue;
    visited.add(srcId);
    const srcNode = nodeMap.get(srcId);
    if (!srcNode) continue;
    const srcType = srcNode.data.type;
    if ((srcType === 'approve' || srcType === 'handler') && completedNodeKeys.has(srcNode.data.key)) {
      return true;
    }
    if (srcType !== 'approve' && srcType !== 'handler') {
      for (const p of inEdges.get(srcId) ?? []) stack.push(p);
    }
  }
  return false;
}
