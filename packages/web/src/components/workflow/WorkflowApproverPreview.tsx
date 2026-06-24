import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import { ArrowDown, RefreshCw } from 'lucide-react';
import type { WorkflowApproverPreviewNode } from '@zenith/shared';
import { request } from '@/utils/request';

const METHOD_LABEL: Record<string, string> = { and: '会签', or: '或签', sequential: '顺序会签', ratio: '比例会签' };
const TYPE_LABEL: Record<string, string> = { start: '发起人', approve: '审批', handler: '办理', ccNode: '抄送', subProcess: '子流程' };
const TYPE_COLOR: Record<string, 'green' | 'blue' | 'cyan' | 'orange' | 'purple'> = { start: 'green', approve: 'blue', handler: 'cyan', ccNode: 'orange', subProcess: 'purple' };

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

  // 仅含发起人节点（无任何审批/抄送节点）时，视作无需审批
  const hasFlowNodes = nodes.some((n) => n.nodeType !== 'start');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <Button size="small" theme="borderless" icon={<RefreshCw size={13} />} onClick={() => void load()}>
          按当前表单刷新
        </Button>
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
      ) : (nodes.length === 0 || !hasFlowNodes) ? (
        <Empty description="该流程无需审批，提交后自动通过" style={{ padding: 24 }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
          {nodes.map((n, idx) => (
            <div key={`${n.nodeKey}-${idx}`}>
              {idx > 0 && (
                <div style={{ textAlign: 'center', color: 'var(--semi-color-text-2)', lineHeight: '18px' }}>
                  <ArrowDown size={14} />
                </div>
              )}
              <div
                style={{
                  border: '1px solid var(--semi-color-border)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  background: 'var(--semi-color-bg-2)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Tag color={TYPE_COLOR[n.nodeType] ?? 'grey'} size="small">{TYPE_LABEL[n.nodeType] ?? n.nodeType}</Tag>
                  {n.nodeType !== 'start' && <Typography.Text strong>{n.nodeName}</Typography.Text>}
                  {n.approveMethod && METHOD_LABEL[n.approveMethod] && (
                    <Tag color="light-blue" size="small">{METHOD_LABEL[n.approveMethod]}</Tag>
                  )}
                  {n.branchLabel && <Tag color="violet" size="small">{n.branchLabel}</Tag>}
                </div>
                <div style={{ marginTop: 6, fontSize: 13, color: 'var(--semi-color-text-1)' }}>
                  {n.nodeType === 'subProcess' ? (
                    <Typography.Text type="tertiary">子流程</Typography.Text>
                  ) : n.approvers.length > 0 ? (
                    n.approvers.map((a) => a.name).join('、')
                  ) : (
                    <Typography.Text type="warning">{n.empty ? '审批人将在运行时确定（自选/上级/空处理）' : '—'}</Typography.Text>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
