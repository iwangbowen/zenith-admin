import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Spin, Tag, Timeline, Typography } from '@douyinfe/semi-ui';
import { Clock, Flag, Mail, RefreshCw, Send, type LucideIcon } from 'lucide-react';
import type { WorkflowApproverPreviewNode } from '@zenith/shared';
import { request } from '@/utils/request';
import { UserAvatar } from '@/components/UserAvatar';
import { timelineDot } from '@/components/workflow/timeline-dot';

type TagColor = 'blue' | 'orange' | 'purple' | 'grey';

const METHOD_LABEL: Record<string, string> = { and: '会签', or: '或签', sequential: '顺序会签', ratio: '比例会签' };

/** 预测态各节点类型的圆点图标/颜色 + 状态标签（运行前，统一显示"待…"） */
const NODE_META: Record<string, { icon: LucideIcon; color: string; status: string; statusColor: TagColor }> = {
  approve:    { icon: Clock, color: 'var(--semi-color-primary)', status: '待审批', statusColor: 'blue' },
  handler:    { icon: Clock, color: 'var(--semi-color-primary)', status: '待办理', statusColor: 'blue' },
  ccNode:     { icon: Mail,  color: 'var(--semi-color-warning)', status: '抄送',   statusColor: 'orange' },
  subProcess: { icon: Clock, color: 'var(--semi-color-primary)', status: '子流程', statusColor: 'purple' },
};

/**
 * 提交前审批链路预览（T1-1）。按 definitionId 拉取已解析审批人的链路，
 * 支持点击「刷新」用当前表单数据重新预测（条件分支会展开标注）。
 */
export default function WorkflowApproverPreview({
  definitionId,
  getFormData,
}: Readonly<{
  definitionId: number | null;
  getFormData?: () => Record<string, unknown>;
}>) {
  const [loading, setLoading] = useState(false);
  const [nodes, setNodes] = useState<WorkflowApproverPreviewNode[]>([]);

  const load = useCallback(async () => {
    if (!definitionId) return;
    setLoading(true);
    try {
      const res = await request.post<WorkflowApproverPreviewNode[]>(
        `/api/workflows/definitions/${definitionId}/preview`,
        { formData: getFormData ? getFormData() : null },
      );
      if (res.code === 0) setNodes(res.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [definitionId, getFormData]);

  useEffect(() => {
    setNodes([]);
    void load();
    // 仅在 definitionId 变化时自动加载；表单数据变化由「刷新」按钮触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitionId]);

  if (!definitionId) return null;

  // 发起人（开始节点）与审批节点拆分；仅含发起人时视作无需审批
  const startNode = nodes.find((n) => n.nodeType === 'start');
  const flowNodes = nodes.filter((n) => n.nodeType !== 'start');
  const initiatorName = startNode?.approvers[0]?.name ?? '发起人';

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
        <Timeline style={{ paddingLeft: 4 }}>
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
            return (
              <Timeline.Item key={`${n.nodeKey}-${idx}`} dot={timelineDot(meta.icon, meta.color)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <Typography.Text strong style={{ fontSize: 13 }}>{n.nodeName}</Typography.Text>
                  <Tag color={meta.statusColor} size="small">{meta.status}</Tag>
                  {n.approveMethod && METHOD_LABEL[n.approveMethod] && (
                    <Tag color="light-blue" size="small">{METHOD_LABEL[n.approveMethod]}</Tag>
                  )}
                  {n.branchLabel && <Tag color="violet" size="small">{n.branchLabel}</Tag>}
                </div>
                {n.nodeType === 'subProcess' ? (
                  <Typography.Text size="small" type="tertiary">子流程</Typography.Text>
                ) : n.approvers.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {n.approvers.map((a) => (
                      <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <UserAvatar name={a.name} semiSize="extra-extra-small" size={20} />
                        <Typography.Text size="small" type="tertiary">{a.name}</Typography.Text>
                      </span>
                    ))}
                  </div>
                ) : (
                  <Typography.Text size="small" type="warning">
                    {n.empty ? '审批人将在运行时确定（自选/上级/空处理）' : '—'}
                  </Typography.Text>
                )}
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
