/**
 * 工作流前后端共享的纯函数工具（无副作用、无 DB 依赖）。
 *
 * 放在 shared 是为了让「前端审批弹窗 / 后端校验 / MSW Mock」三处对
 * 「下一节点审批人自选」的判定保持**完全一致**，避免各自实现产生偏差。
 */
import type { WorkflowFlowData } from './types';

type WorkflowFlowNode = WorkflowFlowData['nodes'][number];

/** 人工审批节点类型（会创建待办、阻断流转，遍历到此即停止） */
const HUMAN_TASK_TYPES = new Set(['approve', 'handler']);
/**
 * 「穿透型」节点类型：本身不创建待办、不阻断流转，引擎会越过它们继续推进到下一批人工任务。
 * 仅这些类型允许在查找「紧邻的下一审批节点」时被穿过。
 */
const PASSTHROUGH_TYPES = new Set([
  'start',
  'exclusiveGateway',
  'parallelGateway',
  'inclusiveGateway',
  'routeGateway',
  'ccNode',
]);

/**
 * 从指定节点出发，沿正常出边（排除异常边 / catch 节点）穿过网关、抄送等「穿透型」节点，
 * 在遇到第一个**人工审批节点**（approve / handler）即停止（不再越过），
 * 收集其中 `assigneeType === 'approverSelect'` 的「紧邻下一审批节点」。
 *
 * 与审批引擎 `advanceTokens` 推进到「下一批人工任务」的语义保持一致：
 * - 多跳：`A → B(普通审批) → C(approverSelect)`，从 A 出发会停在 B，**不会**误纳 C；
 *   C 由 B 审批时才作为「紧邻下一节点」被提示。
 * - 并行：`A → 网关 → [B, C]` 两个 approverSelect，二者都会被收集（各自独立选人）。
 * - 阻断：遇到 delay / trigger / subProcess 等会暂停流转的节点即停止，不穿透。
 *
 * @param flowData    流程图数据（节点 + 连线）
 * @param fromNodeKey 当前审批节点的 key
 * @returns 紧邻下一审批节点中、需由当前审批人选人的 approverSelect 节点列表（按 key 去重）
 */
export function findNextApproverSelectNodes(
  flowData: WorkflowFlowData,
  fromNodeKey: string,
): WorkflowFlowNode[] {
  const startNode = flowData.nodes.find((n) => n.data.key === fromNodeKey);
  if (!startNode) return [];

  const nodeById = new Map(flowData.nodes.map((n) => [n.id, n]));
  const result: WorkflowFlowNode[] = [];
  const seenKeys = new Set<string>();
  const visited = new Set<string>([startNode.id]);
  const queue: string[] = [startNode.id];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const edge of flowData.edges ?? []) {
      if (edge.source !== currentId || edge.isException || visited.has(edge.target)) continue;
      const target = nodeById.get(edge.target);
      if (!target || target.data.type === 'catchNode') continue;
      visited.add(edge.target);

      if (HUMAN_TASK_TYPES.has(target.data.type)) {
        // 紧邻的下一人工审批节点：是 approverSelect 则收集；无论是否收集都不再越过它
        if (target.data.assigneeType === 'approverSelect' && !seenKeys.has(target.data.key)) {
          seenKeys.add(target.data.key);
          result.push(target);
        }
        continue;
      }

      // 仅穿透型节点（网关 / 抄送 / start）允许继续向后查找；其余阻断型节点（delay/trigger/subProcess/end）停止
      if (PASSTHROUGH_TYPES.has(target.data.type)) {
        queue.push(edge.target);
      }
    }
  }

  return result;
}
