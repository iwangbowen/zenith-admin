/**
 * 发起态审批链路面板（预测态）
 *
 * 合并原 WorkflowApproverPreview（链路预览）+ WorkflowInitiatorApproverFields（自选审批人）：
 * - 仅调用一次 `/preview`，按流转顺序渲染时间线（发起申请 → 审批节点 → 流程结束）。
 * - 对「自选审批人」节点（selectionRequired），直接在该时间线节点内内联渲染多选 Select，
 *   不再放在表单外的独立区块。
 * - 保留「按当前表单刷新」，用当前表单数据重新预测（条件分支展开 / 重新解析候选人）。
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Select, Spin, Tag, Timeline, Typography } from '@douyinfe/semi-ui';
import { Clock, Flag, Mail, RefreshCw, Send, UserPlus, type LucideIcon } from 'lucide-react';
import type { WorkflowApproverPreviewNode } from '@zenith/shared';
import { request } from '@/utils/request';
import { UserAvatar } from '@/components/UserAvatar';
import { timelineDot } from '@/components/workflow/timeline-dot';

export type SelectedInitiatorApprovers = Record<string, number[]>;

export interface InitiatorApproverSelectNode {
  nodeKey: string;
  nodeName: string;
  selectableApprovers: Array<{ id: number; name: string }>;
  selectionRequired: boolean;
}

type TagColor = 'blue' | 'orange' | 'purple' | 'grey';

const METHOD_LABEL: Record<string, string> = { and: '会签', or: '或签', sequential: '顺序会签', ratio: '比例会签' };

/** 预测态各节点类型的圆点图标/颜色 + 状态标签（运行前，统一显示"待…"） */
const NODE_META: Record<string, { icon: LucideIcon; color: string; status: string; statusColor: TagColor }> = {
  approve:    { icon: Clock, color: 'var(--semi-color-primary)', status: '待审批', statusColor: 'blue' },
  handler:    { icon: Clock, color: 'var(--semi-color-primary)', status: '待办理', statusColor: 'blue' },
  ccNode:     { icon: Mail,  color: 'var(--semi-color-warning)', status: '抄送',   statusColor: 'orange' },
  subProcess: { icon: Clock, color: 'var(--semi-color-primary)', status: '子流程', statusColor: 'purple' },
};

function normalizeSelectedIds(value: unknown): number[] {
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(list.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
}

function pickSelected(value: SelectedInitiatorApprovers, nodeKey: string): number[] {
  return normalizeSelectedIds(value[nodeKey]);
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
}

export default function WorkflowApprovalChainPanel({
  definitionId,
  getFormData,
  selectable = false,
  value = {},
  onChange,
  onNodesChange,
  highlightMissing = false,
}: Readonly<Props>) {
  const [loading, setLoading] = useState(false);
  const [nodes, setNodes] = useState<WorkflowApproverPreviewNode[]>([]);

  const load = useCallback(async () => {
    if (!definitionId) {
      setNodes([]);
      onNodesChange?.([]);
      return;
    }
    setLoading(true);
    try {
      const res = await request.post<WorkflowApproverPreviewNode[]>(
        `/api/workflows/definitions/${definitionId}/preview`,
        { formData: getFormData ? getFormData() : null },
        { silent: true },
      );
      const data = res.code === 0 ? res.data ?? [] : [];
      setNodes(data);
      const selectNodes: InitiatorApproverSelectNode[] = data
        .filter((node) => node.selectionRequired)
        .map((node) => ({
          nodeKey: node.nodeKey,
          nodeName: node.nodeName,
          selectableApprovers: node.selectableApprovers ?? [],
          selectionRequired: node.selectionRequired ?? false,
        }));
      onNodesChange?.(selectNodes);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitionId]);

  useEffect(() => {
    setNodes([]);
    void load();
    // 仅在 definitionId 变化时自动加载；表单数据变化由「按当前表单刷新」触发
  }, [load]);

  if (!definitionId) return null;

  // 发起人（开始节点）与审批节点拆分
  const startNode = nodes.find((n) => n.nodeType === 'start');
  const flowNodes = nodes.filter((n) => n.nodeType !== 'start');
  const initiatorName = startNode?.approvers[0]?.name ?? '发起人';

  const handleSelect = (nodeKey: string, next: unknown) => {
    const ids = normalizeSelectedIds(next);
    onChange?.({ ...value, [nodeKey]: ids });
  };

  const renderApprovers = (n: WorkflowApproverPreviewNode) => {
    const isSelectableNode = selectable && n.selectionRequired;
    if (isSelectableNode) {
      const selected = pickSelected(value, n.nodeKey);
      const missing = highlightMissing && selected.length === 0;
      return (
        <div style={{ marginTop: 2 }}>
          <Select
            multiple
            filter
            showClear
            size="small"
            style={{
              width: '100%',
              ...(missing ? { boxShadow: '0 0 0 1px var(--semi-color-danger)', borderRadius: 6 } : null),
            }}
            placeholder="请选择审批人"
            emptyContent="暂无可选审批人"
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
            <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <UserAvatar name={a.name} semiSize="extra-extra-small" size={20} />
              <Typography.Text size="small" type="tertiary">{a.name}</Typography.Text>
            </span>
          ))}
        </div>
      );
    }
    return (
      <Typography.Text size="small" type="warning">
        {n.empty ? '审批人将在运行时确定（自选/上级/空处理）' : '—'}
      </Typography.Text>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <Button size="small" theme="borderless" icon={<RefreshCw size={13} />} onClick={() => void load()}>
          按当前表单刷新
        </Button>
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
      ) : flowNodes.length === 0 ? (
        <Empty description="该流程无需审批，提交后自动通过" style={{ padding: 24 }} />
      ) : (
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

          {/* 审批节点（提交前预测态） */}
          {flowNodes.map((n, idx) => {
            const meta = NODE_META[n.nodeType] ?? NODE_META.approve;
            const isSelectableNode = selectable && n.selectionRequired;
            const dotIcon = isSelectableNode ? UserPlus : meta.icon;
            const dotColor = isSelectableNode ? 'var(--semi-color-warning)' : meta.color;
            return (
              <Timeline.Item key={`${n.nodeKey}-${idx}`} dot={timelineDot(dotIcon, dotColor)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <Typography.Text strong style={{ fontSize: 13 }}>{n.nodeName}</Typography.Text>
                  {isSelectableNode ? (
                    <Tag color="orange" size="small">
                      自选审批人{n.selectionRequired ? ' *' : ''}
                    </Tag>
                  ) : (
                    <Tag color={meta.statusColor} size="small">{meta.status}</Tag>
                  )}
                  {n.approveMethod && METHOD_LABEL[n.approveMethod] && (
                    <Tag color="light-blue" size="small">{METHOD_LABEL[n.approveMethod]}</Tag>
                  )}
                  {n.branchLabel && <Tag color="violet" size="small">{n.branchLabel}</Tag>}
                </div>
                {renderApprovers(n)}
              </Timeline.Item>
            );
          })}

          {/* 结束：流程结束 */}
          <Timeline.Item dot={timelineDot(Flag, 'var(--semi-color-tertiary)')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Typography.Text strong style={{ fontSize: 13 }}>流程结束</Typography.Text>
              <Tag color="grey" size="small">预计</Tag>
            </div>
          </Timeline.Item>
        </Timeline>
      )}
    </div>
  );
}
