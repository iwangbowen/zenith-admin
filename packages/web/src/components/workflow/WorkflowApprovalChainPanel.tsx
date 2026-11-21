/**
 * 发起态审批链路面板（预测态）
 *
 * 合并原 WorkflowApproverPreview（链路预览）+ WorkflowInitiatorApproverFields（自选审批人）：
 * - 仅调用一次 `/preview`，按流转顺序渲染时间线（发起申请 → 审批节点 → 流程结束）。
 * - 对「自选审批人」节点（selectionRequired），直接在该时间线节点内内联渲染多选 Select，
 *   不再放在表单外的独立区块。
 * - 通过 `reloadKey` 受控刷新：发起页表单变更（防抖）或点击表头「刷新」时重新预测
 *   （条件分支展开 / 重新解析候选人），刷新期间保留旧链路避免闪烁。
 */
/* eslint-disable react-refresh/only-export-components */
import { uniquePositiveInts } from '@zenith/shared/core';
import { useEffect, useId, useMemo, useState } from 'react';
import { Button, Empty, Select, Space, Spin, Tag, Timeline, Typography } from '@douyinfe/semi-ui';
import { Clock, Flag, GitBranch, Mail, Send, UserPlus, type LucideIcon } from 'lucide-react';
import { WORKFLOW_APPROVE_METHOD_LABELS as METHOD_LABEL, WORKFLOW_PATH_STATUS_LABELS } from '@zenith/shared/workflow';
import type { WorkflowApproverPreviewNode } from '@zenith/shared/workflow';
import { UserAvatar } from '@/components/UserAvatar';
import { timelineDot } from '@/components/workflow/timeline-dot';
import { branchChainText, groupUnknownBranches, type PreviewBranchGroup } from '@/components/workflow/approval-chain-groups';
import { useWorkflowApprovalPreview } from '@/hooks/queries/workflow-shared';

export type SelectedInitiatorApprovers = Record<string, number[]>;

export interface InitiatorApproverSelectNode {
  nodeKey: string;
  nodeName: string;
  selectableApprovers: Array<{ id: number; name: string }>;
  selectionRequired: boolean;
}

type TagColor = 'blue' | 'orange' | 'purple' | 'grey';

const EMPTY_NODES: WorkflowApproverPreviewNode[] = [];

/** 预测态各节点类型的圆点图标/颜色 + 状态标签（运行前，统一显示"待…"） */
const NODE_META: Record<string, { icon: LucideIcon; color: string; status: string; statusColor: TagColor }> = {
  approve:    { icon: Clock, color: 'var(--semi-color-primary)', status: '待审批', statusColor: 'blue' },
  handler:    { icon: Clock, color: 'var(--semi-color-primary)', status: '待办理', statusColor: 'blue' },
  ccNode:     { icon: Mail,  color: 'var(--semi-color-warning)', status: '抄送',   statusColor: 'orange' },
  subProcess: { icon: Clock, color: 'var(--semi-color-primary)', status: '子流程', statusColor: 'purple' },
  delay:      { icon: Clock, color: 'var(--semi-color-warning)', status: '延时',   statusColor: 'orange' },
  trigger:    { icon: Clock, color: 'var(--semi-color-warning)', status: '等待',   statusColor: 'orange' },
};

function normalizeSelectedIds(value: unknown): number[] {
  const list = Array.isArray(value) ? value : [value];
  return uniquePositiveInts(list);
}

function pickSelected(value: SelectedInitiatorApprovers, nodeKey: string): number[] {
  return normalizeSelectedIds(value[nodeKey]);
}

/**
 * 同因折叠：条件未定时，同一个原因（如「预估金额」尚未填写）会落在全部下游节点上。
 * 返回「首个展示该原因的节点 key → 同因步数」，其余同因节点不再重复渲染原因文本。
 */
function collapseRepeatedReasons(nodes: WorkflowApproverPreviewNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const n of nodes) if (n.reason) counts.set(n.reason, (counts.get(n.reason) ?? 0) + 1);
  const owners = new Map<string, number>();
  const seen = new Set<string>();
  for (const n of nodes) {
    if (!n.reason || seen.has(n.reason)) continue;
    seen.add(n.reason);
    owners.set(n.nodeKey, counts.get(n.reason) ?? 1);
  }
  return owners;
}

/** 提交前，剔除非自选节点 / 空选择，得到提交用的精简结构 */
export function compactSelectedInitiatorApprovers(
  value: SelectedInitiatorApprovers,
  nodes: InitiatorApproverSelectNode[],
): SelectedInitiatorApprovers | undefined {
  const allowedKeys = new Set(nodes.map((node) => node.nodeKey));
  const out: SelectedInitiatorApprovers = {};
  for (const [key, ids] of Object.entries(value)) {
    if (!allowedKeys.has(key)) continue;
    const normalized = normalizeSelectedIds(ids);
    if (normalized.length === 0) continue;
    out[key] = normalized;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 返回第一个「必填但未选」的自选节点（提交校验用） */
export function firstMissingInitiatorApproverNode(
  value: SelectedInitiatorApprovers,
  nodes: InitiatorApproverSelectNode[],
): InitiatorApproverSelectNode | null {
  return nodes.find((node) => node.selectionRequired && pickSelected(value, node.nodeKey).length === 0) ?? null;
}

interface Props {
  definitionId: number | null;
  getFormData?: () => Record<string, unknown>;
  /** 交互式：在 selectionRequired 节点内联渲染自选 Select（发起态） */
  selectable?: boolean;
  value?: SelectedInitiatorApprovers;
  onChange?: (value: SelectedInitiatorApprovers) => void;
  onNodesChange?: (nodes: InitiatorApproverSelectNode[]) => void;
  /** 提交校验失败后，高亮「必填未选」节点 */
  highlightMissing?: boolean;
  /** 受控刷新信号：变化时按当前表单重新预测链路（发起页防抖 / 手动刷新） */
  reloadKey?: number;
  /** 业务表单尚未准备好时跳过通用预览请求，由业务表单展示自己的未就绪状态。 */
  previewEnabled?: boolean;
}

export default function WorkflowApprovalChainPanel({
  definitionId,
  getFormData,
  reloadKey,
  previewEnabled = true,
  ...props
}: Readonly<Props>) {
  const previewQuery = useWorkflowApprovalPreview(definitionId, reloadKey, getFormData, previewEnabled);
  if (!definitionId) return null;
  return <WorkflowApprovalChain {...props} nodes={previewQuery.data ?? EMPTY_NODES}
    loading={previewQuery.isLoading} error={previewQuery.error?.message ?? false}
    onRetry={() => void previewQuery.refetch()} />;
}

/** 纯展示：普通发起页与业务域预览共用，各自的权限与取数由调用方负责。 */
export function WorkflowApprovalChain({
  nodes,
  loading = false,
  error = false,
  onRetry,
  selectable = false,
  value = {},
  onChange,
  onNodesChange,
  highlightMissing = false,
}: Readonly<Omit<Props, 'definitionId' | 'getFormData' | 'reloadKey'> & {
  nodes: WorkflowApproverPreviewNode[];
  loading?: boolean;
  error?: boolean | string;
  onRetry?: () => void;
}>) {
  const [showAllBranches, setShowAllBranches] = useState(false);
  const nodeLabelId = useId();
  const selectNodes = useMemo<InitiatorApproverSelectNode[]>(
    () => nodes
      .filter((node) => node.status !== 'excluded' && node.selectionRequired)
      .map((node) => ({
        nodeKey: node.nodeKey,
        nodeName: node.nodeName,
        selectableApprovers: node.selectableApprovers ?? [],
        selectionRequired: node.selectionRequired ?? false,
      })),
    [nodes],
  );

  useEffect(() => {
    onNodesChange?.(selectNodes);
  }, [onNodesChange, selectNodes]);

  // 发起人（开始节点）与审批节点拆分
  const startNode = nodes.find((n) => n.nodeType === 'start');
  const structureNodes = nodes.filter((n) => n.nodeType !== 'start');
  const flowNodes = structureNodes.filter((n) => n.status !== 'excluded');
  const hasExcludedBranches = structureNodes.length !== flowNodes.length;
  const hasBranchStructure = structureNodes.some((n) => (n.branchPath?.length ?? 0) > 0);
  // 条件未定的多条分支聚合成一个步骤；展开「全部结构」时回到逐节点视图
  const branchGrouping = useMemo(() => groupUnknownBranches(flowNodes), [flowNodes]);
  const grouped = showAllBranches ? null : branchGrouping;
  const renderedNodes = grouped ? flowNodes.filter((n) => !grouped.hiddenNodeKeys.has(n.nodeKey)) : flowNodes;
  const initiatorName = startNode?.approvers[0]?.name ?? '发起人';
  // 原因只在首个同因节点展开，避免 5 个下游节点整屏重复同一句提示
  const reasonOwners = collapseRepeatedReasons(renderedNodes);

  // 链路摘要：审批步数 + 去重审批人数（自选节点单列标注）；条件分支按可能步数区间展示
  const approvalNodes = renderedNodes.filter((n) => !n.automaticAction && (n.nodeType === 'approve' || n.nodeType === 'handler'));
  const approverIdSet = new Set<number>();
  approvalNodes.forEach((n) => n.approvers.forEach((a) => approverIdSet.add(a.id)));
  const hasSelectNode = approvalNodes.some((n) => n.selectionRequired || n.requiresApproverSelection)
    || (grouped?.groups.some((group) => group.rows.some((row) => row.nodes.some((n) => n.selectionRequired || n.requiresApproverSelection))) ?? false);
  const groupMinSteps = grouped?.groups.reduce((sum, group) => sum + group.minHumanSteps, 0) ?? 0;
  const groupMaxSteps = grouped?.groups.reduce((sum, group) => sum + group.maxHumanSteps, 0) ?? 0;
  // 只统计已确定路径上的等待；条件分支内的等待用分支行标注（“等待子流程”），不在摘要里断言
  const waitCount = renderedNodes.filter((n) => n.blocking).length;
  const unknownStepCount = approvalNodes.filter((n) => n.status === 'unknown').length;
  const summaryText = grouped && grouped.groups.length > 0
    ? [
      `预计 ${approvalNodes.length + groupMinSteps}–${approvalNodes.length + groupMaxSteps} 步`,
      `${grouped.groups.length} 处条件分支待确认`,
      waitCount > 0 ? `含 ${waitCount} 步等待` : null,
      approverIdSet.size > 0 ? `约 ${approverIdSet.size} 人审批` : null,
      hasSelectNode ? '含自选' : null,
    ].filter(Boolean).join(' · ')
    : [
      `${unknownStepCount ? '预计' : '共'} ${approvalNodes.length} 步`,
      unknownStepCount ? `${unknownStepCount} 步待条件确认` : null,
      waitCount > 0 ? `含 ${waitCount} 步等待` : null,
      approverIdSet.size > 0 ? `约 ${approverIdSet.size} 人审批` : null,
      hasSelectNode ? '含自选' : null,
    ].filter(Boolean).join(' · ');

  const handleSelect = (nodeKey: string, next: unknown) => {
    const ids = normalizeSelectedIds(next);
    onChange?.({ ...value, [nodeKey]: ids });
  };

  type TimelineEntry =
    | { kind: 'node'; node: WorkflowApproverPreviewNode; index: number; collapseGroup?: PreviewBranchGroup; inExpandedGroup?: boolean }
    | { kind: 'group'; group: PreviewBranchGroup }
    | { kind: 'groupHeader'; group: PreviewBranchGroup };
  const collapseByLastIndex = new Map(
    (showAllBranches ? branchGrouping.groups : []).map((group) => [group.lastIndex, group]),
  );
  const indexByNodeKey = new Map(flowNodes.map((node, index) => [node.nodeKey, index]));
  const timelineEntries: TimelineEntry[] = [];

  if (showAllBranches && branchGrouping.groups.length > 0) {
    // 展开后按分支归拢：同一分支的节点连续排列，并带分支标签，避免交错后看不出原本是一个聚合
    const groupByFirstIndex = new Map(branchGrouping.groups.map((group) => [group.firstIndex, group]));
    const emitted = new Set<string>();
    flowNodes.forEach((node, index) => {
      const group = groupByFirstIndex.get(index);
      if (group) {
        timelineEntries.push({ kind: 'groupHeader', group });
        const branchNodes = group.rows.flatMap((row) => row.nodes);
        branchNodes.forEach((branchNode, position) => {
          timelineEntries.push({
            kind: 'node',
            node: branchNode,
            index: indexByNodeKey.get(branchNode.nodeKey) ?? index,
            collapseGroup: position === branchNodes.length - 1 ? group : undefined,
            inExpandedGroup: true,
          });
          emitted.add(branchNode.nodeKey);
        });
      }
      if (emitted.has(node.nodeKey)) return;
      timelineEntries.push({ kind: 'node', node, index });
    });
  } else {
    flowNodes.forEach((node, index) => {
      const group = grouped?.groupByFirstIndex.get(index);
      if (group) timelineEntries.push({ kind: 'group', group });
      if (!grouped?.hiddenNodeKeys.has(node.nodeKey)) {
        timelineEntries.push({ kind: 'node', node, index, collapseGroup: collapseByLastIndex.get(index) });
      }
    });
  }
  const firstGroupIndex = (grouped ?? branchGrouping).groups[0]?.firstIndex ?? Number.POSITIVE_INFINITY;

  const renderApprovers = (n: WorkflowApproverPreviewNode) => {
    if (n.status === 'excluded') return null;
    const isSelectableNode = selectable && n.selectionRequired;
    if (isSelectableNode) {
      const selected = pickSelected(value, n.nodeKey);
      const missing = highlightMissing && selected.length === 0;
      return (
        <div style={{ marginTop: 2 }}>
          {n.status === 'unknown' && (
            <Typography.Text type="warning" size="small" style={{ display: 'block', marginBottom: 4 }}>
              条件未定，请预选可能需要的审批人
            </Typography.Text>
          )}
          <Select
            aria-labelledby={`${nodeLabelId}-${n.nodeKey}`}
            multiple
            filter
            showClear
            size="small"
            style={{
              width: '100%',
              ...(missing ? { boxShadow: '0 0 0 1px var(--semi-color-danger)', borderRadius: 'var(--semi-border-radius-medium)' } : null),
            }}
            placeholder={n.status === 'unknown' ? '请预选审批人' : '请选择审批人'}
            emptyContent="暂无可选审批人"
            maxTagCount={2} showRestTagsPopover
            optionList={(n.selectableApprovers ?? []).map((u) => ({ value: u.id, label: u.name }))}
            value={selected}
            onChange={(v) => handleSelect(n.nodeKey, v)}
          />
          {missing && (
            <Typography.Text type="danger" size="small" style={{ display: 'block', marginTop: 4 }}>
              请选择该节点的审批人
            </Typography.Text>
          )}
        </div>
      );
    }
    if (n.nodeType === 'subProcess') {
      return <Typography.Text size="small" type="tertiary">子流程</Typography.Text>;
    }
    if (n.approvers.length > 0) {
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {n.approvers.map((a) => (
            <Space key={a.id} spacing={4}>
              <UserAvatar name={a.name} semiSize="extra-extra-small" size={20} />
              <Typography.Text size="small" type="tertiary">{a.name}</Typography.Text>
            </Space>
          ))}
        </div>
      );
    }
    return (
      <Typography.Text size="small" type="warning">
        {n.approverReason ?? (n.approverState === 'empty' ? '无人可派，将按空审批人策略处理' : n.approverState === 'unknown' ? '节点到达时确定' : '—')}
      </Typography.Text>
    );
  };

  return (
    <div>
      {loading && nodes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Typography.Text type="tertiary" style={{ display: 'block', marginBottom: 8 }}>
            {typeof error === 'string' ? error : '审批链路预测失败'}
          </Typography.Text>
          <Button size="small" onClick={onRetry}>重试</Button>
        </div>
      ) : structureNodes.length === 0 ? (
        <Empty description="该流程无需审批，提交后自动通过" style={{ padding: 24 }} />
      ) : (
        <>
          {(hasExcludedBranches || hasBranchStructure) && (
            <Button size="small" theme="borderless" aria-pressed={showAllBranches}
              onClick={() => setShowAllBranches((current) => !current)}>
              {showAllBranches ? '预计路径' : '全部结构'}
            </Button>
          )}
          {flowNodes.length === 0 && (
            <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 8 }}>
              按当前条件无需审批，提交后自动通过
            </Typography.Text>
          )}
          {approvalNodes.length > 0 && (
            <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
              {summaryText}
            </div>
          )}
          <Timeline className="wf-approval-timeline" style={{ paddingLeft: 4 }}>
          {/* 开始：发起申请 */}
          <Timeline.Item dot={timelineDot(Send, 'var(--semi-color-primary)')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Typography.Text strong style={{ fontSize: 13 }}>发起申请</Typography.Text>
              <Tag color="blue" size="small">发起人</Tag>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <UserAvatar name={initiatorName} semiSize="extra-extra-small" size={20} />
              <Typography.Text size="small" type="tertiary">{initiatorName}</Typography.Text>
            </div>
          </Timeline.Item>

          {/* 审批节点（提交前预测态）。条件未定的多条互斥分支聚合为一个步骤，展开后回到逐节点视图 */}
          {timelineEntries.map((entry) => {
            if (entry.kind === 'groupHeader') {
              const group = entry.group;
              return (
                <Timeline.Item key={`group-head-${group.gatewayKey}`} dot={timelineDot(GitBranch, '#8b5cf6')}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <Typography.Text strong style={{ fontSize: 13 }}>{group.gatewayLabel}</Typography.Text>
                    <Tag color="violet" size="small">已展开</Tag>
                    <Typography.Text size="small" type="tertiary">{group.rows.length} 条可能路径</Typography.Text>
                  </div>
                  {group.reason && (
                    <Typography.Text size="small" type="tertiary" style={{ display: 'block' }}>
                      {group.reason}
                    </Typography.Text>
                  )}
                </Timeline.Item>
              );
            }
            if (entry.kind === 'group') {
              const group = entry.group;
              return (
                <Timeline.Item key={`group-${group.gatewayKey}`} dot={timelineDot(GitBranch, '#8b5cf6')}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <Typography.Text strong style={{ fontSize: 13 }}>{group.gatewayLabel}</Typography.Text>
                    <Tag color="orange" size="small">待条件确认</Tag>
                    <Typography.Text size="small" type="tertiary">{group.rows.length} 条可能路径</Typography.Text>
                  </div>
                  {group.reason && (
                    <Typography.Text size="small" type="tertiary" style={{ display: 'block', marginBottom: 4 }}>
                      {group.reason}
                    </Typography.Text>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {group.rows.map((row) => (
                      <div key={row.branchKey} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12, lineHeight: '20px', minWidth: 0 }}>
                        <span style={{ flex: '0 0 auto', color: row.label === '默认' ? 'var(--semi-color-text-2)' : '#8b5cf6' }}>
                          {row.label}
                        </span>
                        <span style={{ color: 'var(--semi-color-text-3)' }}>→</span>
                        <span style={{ color: 'var(--semi-color-text-0)', minWidth: 0 }}>{branchChainText(row.nodes)}</span>
                      </div>
                    ))}
                  </div>
                  <Button size="small" theme="borderless" style={{ paddingLeft: 0, marginTop: 4 }}
                    onClick={() => setShowAllBranches(true)}>
                    查看完整链路
                  </Button>
                </Timeline.Item>
              );
            }
            const n = entry.node;
            const meta = NODE_META[n.nodeType] ?? NODE_META.approve;
            const isExcluded = n.status === 'excluded';
            const isSelectableNode = !isExcluded && selectable && n.selectionRequired;
            const dotIcon = isSelectableNode ? UserPlus : meta.icon;
            const dotColor = isExcluded ? 'var(--semi-color-tertiary)' : isSelectableNode ? 'var(--semi-color-warning)' : meta.color;
            const sameReasonSteps = reasonOwners.get(n.nodeKey);
            const waitLabel = n.blocking
              ? (n.waitReason === 'delay' ? '等待延时' : n.waitReason === 'subprocess' ? '等待子流程' : '等待回调')
              : null;
            // 汇总分支之后的公共节点：预测原因是某一条分支的（如默认分支）会误导，交给分支汇总项表达
            const suppressReason = Boolean(entry.inExpandedGroup)
              || (n.status === 'unknown' && !(n.branchPath?.length) && entry.index > firstGroupIndex);
            return (
              <Timeline.Item key={n.nodeKey} dot={timelineDot(dotIcon, dotColor)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <Typography.Text id={`${nodeLabelId}-${n.nodeKey}`} strong type={isExcluded ? 'tertiary' : undefined} style={{ fontSize: 13 }}>{n.nodeName}</Typography.Text>
                  {isSelectableNode ? (
                    <Tag color="orange" size="small">
                      自选审批人{n.selectionRequired ? ' *' : ''}
                    </Tag>
                  ) : waitLabel ? (
                    <Tag color="orange" size="small">{waitLabel}</Tag>
                  ) : !isExcluded && (
                    <Tag color={meta.statusColor} size="small">{n.automaticAction === 'reject' ? '自动拒绝' : n.automaticAction === 'approve' ? '自动通过' : meta.status}</Tag>
                  )}
                  {!isExcluded && n.requiresApproverSelection && (
                    <Tag color="violet" size="small">上一节点选人</Tag>
                  )}
                  {!isExcluded && !n.automaticAction && n.approveMethod && METHOD_LABEL[n.approveMethod] && (
                    <Tag color="light-blue" size="small">{METHOD_LABEL[n.approveMethod]}</Tag>
                  )}
                  {n.status && (
                    <Tag color={isExcluded ? 'grey' : n.status === 'unknown' ? 'orange' : 'blue'} size="small">{WORKFLOW_PATH_STATUS_LABELS[n.status]}</Tag>
                  )}
                  {n.branchLabel && <Tag color="violet" size="small">{n.branchLabel}</Tag>}
                </div>
                {sameReasonSteps != null && !suppressReason && (
                  <Typography.Text size="small" type="tertiary" style={{ display: 'block', marginBottom: 4 }}>
                    {n.reason}{sameReasonSteps > 1 ? `（另有 ${sameReasonSteps - 1} 步同因）` : null}
                  </Typography.Text>
                )}
                {renderApprovers(n)}
                {!isExcluded && n.approverReason && (isSelectableNode || n.approvers.length > 0) && (
                  <Typography.Text size="small" type="tertiary" style={{ display: 'block', marginTop: 4 }}>{n.approverReason}</Typography.Text>
                )}
                {entry.collapseGroup && (
                  <Button size="small" theme="borderless" style={{ paddingLeft: 0, marginTop: 4 }}
                    onClick={() => setShowAllBranches(false)}>
                    收起分支
                  </Button>
                )}
              </Timeline.Item>
            );
          })}

          {/* 结束：流程结束 */}
          <Timeline.Item dot={timelineDot(Flag, 'var(--semi-color-tertiary)')}>
            <Typography.Text strong style={{ fontSize: 13 }}>流程结束</Typography.Text>
          </Timeline.Item>
        </Timeline>
        </>
      )}
    </div>
  );
}
