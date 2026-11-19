import type { WorkflowFlowData } from '@zenith/shared/workflow';
import { findReturnPrevTarget } from '../../../lib/workflow-engine';

/** Persistent and memory runtimes choose the same rejection destination. */
export function runtimeRejectRoute(flow: WorkflowFlowData | null | undefined, nodeKey: string, approvedKeys: string[]) {
  const currentNodeCfg = flow?.nodes.find(node => node.data.key === nodeKey)?.data;
  const jump = currentNodeCfg?.actionButtons?.reject?.jumpToNodeKey;
  const strategy = jump ? 'returnToNode' : currentNodeCfg?.rejectStrategy ?? 'terminate';
  const target = jump ?? currentNodeCfg?.rejectToNodeKey;
  const targetNodeKey = strategy === 'returnStart' ? '__start__'
    : strategy === 'returnToNode' ? (target && flow?.nodes.some(node => node.data.key === target) ? target : null)
      : strategy === 'returnPrev' && flow ? findReturnPrevTarget(flow, nodeKey, approvedKeys) : null;
  return { strategy, targetNodeKey, currentNodeCfg };
}
