/**
 * 流程图只读预览
 * 复用设计器的 FlowRenderer，强制 readOnly。
 * 当传入 tasks 时，会自动识别"驳回 → 回退到目标节点 → 重新推进"轨迹，
 * 在图顶部展示 Banner，并通过 data-fd-node-id 给相关节点卡片注入高亮样式。
 */
import { useId, useMemo } from 'react';
import { Banner, Typography } from '@douyinfe/semi-ui';
import { CornerUpLeft } from 'lucide-react';
import type { WorkflowTask } from '@zenith/shared';
import FlowRenderer from '@/pages/workflow/designer/components/FlowRenderer';
import type { FlowProcess, FlowNode } from '@/pages/workflow/designer/types';
import { buildNodeRuntimeMap } from './workflow-runtime';
import '@/pages/workflow/designer/styles/flow-designer.css';

interface Props {
  flowData: { process?: unknown } | null | undefined;
  tasks?: WorkflowTask[];
  height?: number | string;
  /** 实例状态（用于 start/end 节点运行态标识） */
  instanceStatus?: string;
}

interface ReturnTrack {
  fromNodeId: string;
  fromNodeName: string;
  toNodeId: string;
  toNodeName: string;
}

function flattenNodes(process: FlowProcess): Map<string, { id: string; name: string }> {
  const map = new Map<string, { id: string; name: string }>();
  const visit = (node: FlowNode | undefined) => {
    if (!node) return;
    map.set(node.id, { id: node.id, name: node.name });
    node.branches?.forEach(b => visit(b.children));
    visit(node.children);
  };
  visit(process.initiator);
  return map;
}

function computeReturnTracks(
  tasks: WorkflowTask[],
  nodeIndex: Map<string, { id: string; name: string }>,
): ReturnTrack[] {
  const sorted = [...tasks].sort((a, b) => a.id - b.id);
  const tracks: ReturnTrack[] = [];
  for (const t of sorted) {
    if (t.status !== 'rejected') continue;
    const next = sorted.find(n => n.id > t.id && n.nodeType !== 'ccNode' && n.nodeKey !== t.nodeKey);
    if (!next) continue;
    const from = nodeIndex.get(t.nodeKey);
    const to = nodeIndex.get(next.nodeKey);
    if (!from || !to) continue;
    tracks.push({
      fromNodeId: from.id,
      fromNodeName: from.name || t.nodeName,
      toNodeId: to.id,
      toNodeName: to.name || next.nodeName,
    });
  }
  return tracks;
}

/** 按 nodeKey 聚合 tasks → 节点运行态（状态 + 处理人列表）见 workflow-runtime.ts */

/** 收集某节点子链上所有节点的运行态匹配键（node.key ?? node.id） */
function collectDescendantKeys(node: FlowNode | undefined, acc: Set<string>): void {
  if (!node) return;
  acc.add(node.key ?? node.id);
  node.branches?.forEach(b => collectDescendantKeys(b.children, acc));
  collectDescendantKeys(node.children, acc);
}

/** 计算未被实际命中（无任务）的分支 id —— 仅当同级已有分支被命中时才置灰 */
function computeDimmedBranches(process: FlowProcess, taskNodeKeys: Set<string>): Set<string> {
  const dimmed = new Set<string>();
  const visit = (node: FlowNode | undefined) => {
    if (!node) return;
    if (node.branches && node.branches.length > 0) {
      const taken = node.branches.map(b => {
        const keys = new Set<string>();
        collectDescendantKeys(b.children, keys);
        return [...keys].some(k => taskNodeKeys.has(k));
      });
      if (taken.some(Boolean)) {
        node.branches.forEach((b, i) => { if (!taken[i]) dimmed.add(b.id); });
      }
      node.branches.forEach(b => visit(b.children));
    }
    visit(node.children);
  };
  visit(process.initiator);
  return dimmed;
}

export default function WorkflowGraphView({ flowData, tasks, height = 480, instanceStatus }: Readonly<Props>) {
  const scopeId = useId().replaceAll(':', '');
  const scopeClass = `fd-graph-scope-${scopeId}`;
  const process = flowData?.process as FlowProcess | undefined;

  const { tracks, css } = useMemo(() => {
    if (!process?.initiator || !tasks?.length) {
      return { tracks: [] as ReturnTrack[], css: '' };
    }
    const nodeIndex = flattenNodes(process);
    const computed = computeReturnTracks(tasks, nodeIndex);
    const fromIds = new Set(computed.map(t => t.fromNodeId));
    const toIds = new Set(computed.map(t => t.toNodeId));
    const rules: string[] = [];
    for (const id of fromIds) {
      rules.push(`.${scopeClass} [data-fd-node-id="${id}"]{box-shadow:0 0 0 2px var(--semi-color-danger);border-radius:8px;}`);
    }
    for (const id of toIds) {
      rules.push(`.${scopeClass} [data-fd-node-id="${id}"]{box-shadow:0 0 0 2px var(--semi-color-warning);border-radius:8px;}`);
    }
    return { tracks: computed, css: rules.join('\n') };
  }, [process, tasks, scopeClass]);

  const { runtimeMap, dimmedBranches } = useMemo(() => {
    if (!process?.initiator || !tasks?.length) {
      return { runtimeMap: undefined, dimmedBranches: undefined };
    }
    return {
      runtimeMap: buildNodeRuntimeMap(tasks),
      dimmedBranches: computeDimmedBranches(process, new Set(tasks.map(t => t.nodeKey))),
    };
  }, [process, tasks]);

  if (!process?.initiator) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--semi-color-text-2)' }}>
        无流程图数据
      </div>
    );
  }

  const hasReturns = tracks.length > 0;

  return (
    <div>
      {hasReturns && (
        <>
          <Banner
            type="warning"
            fullMode={false}
            closeIcon={null}
            style={{ marginBottom: 12 }}
            description={
              <div>
                <Typography.Text strong style={{ fontSize: 13 }}>
                  本流程曾发生 {tracks.length} 次驳回回退
                </Typography.Text>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--semi-color-text-1)' }}>
                  {tracks.map((t, idx) => (
                    <li key={`${t.fromNodeId}-${t.toNodeId}-${idx}`} style={{ marginBottom: 2 }}>
                      <span style={{ color: 'var(--semi-color-danger)' }}>{t.fromNodeName}</span>
                      <CornerUpLeft size={11} style={{ margin: '0 6px', verticalAlign: 'middle' }} />
                      <span style={{ color: 'var(--semi-color-warning)' }}>{t.toNodeName}</span>
                    </li>
                  ))}
                </ul>
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--semi-color-text-2)', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--semi-color-danger)', borderRadius: 2 }}>{''}</span>驳回节点
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--semi-color-warning)', borderRadius: 2 }}>{''}</span>回退目标
                  </span>
                </div>
              </div>
            }
          />
          <style>{css}</style>
        </>
      )}
      <div
        className={scopeClass}
        style={{
          maxHeight: typeof height === 'number' ? `${height}px` : height,
          overflow: 'auto',
          padding: 16,
          background: 'var(--semi-color-fill-0)',
          borderRadius: 8,
        }}
      >
        <FlowRenderer process={process} readOnly nodeRuntime={runtimeMap} dimmedBranchIds={dimmedBranches} instanceStatus={instanceStatus} />
      </div>
    </div>
  );
}
