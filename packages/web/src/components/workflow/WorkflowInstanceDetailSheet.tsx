import { useEffect, useRef, useState } from 'react';
import { SideSheet, Spin } from '@douyinfe/semi-ui';
import type { WorkflowInstance, WorkflowDefinition } from '@zenith/shared';
import { request } from '@/utils/request';
import WorkflowInstanceDetailPanel from '@/components/workflow/WorkflowInstanceDetailPanel';

/**
 * 只读流程实例详情抽屉（抄送我的 / 我已办 等场景复用）。
 * 自管理实例与定义的拉取，支持父/子流程跳转。
 */
export default function WorkflowInstanceDetailSheet({
  instanceId,
  visible,
  onClose,
  title = '流程详情',
}: Readonly<{
  instanceId: number | null;
  visible: boolean;
  onClose: () => void;
  title?: string;
}>) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<WorkflowInstance | null>(null);
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [viewId, setViewId] = useState<number | null>(instanceId);
  const requestSeq = useRef(0);

  useEffect(() => {
    if (visible) setViewId(instanceId);
  }, [visible, instanceId]);

  useEffect(() => {
    if (!visible || !viewId) return;
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    const controller = new AbortController();
    setLoading(true);
    setDefinition(null);
    const p = request.get<WorkflowInstance>(`/api/workflows/instances/${viewId}`, { signal: controller.signal, silent: true })
      .then((res) => {
        if (requestSeq.current !== seq) return null;
        if (res.code === 0) {
          setData(res.data);
          if (res.data.definitionSnapshot) return null;
          return request.get<WorkflowDefinition>(`/api/workflows/definitions/${res.data.definitionId}`, { silent: true, signal: controller.signal });
        }
        return null;
      })
      .then((defRes) => { if (requestSeq.current === seq && defRes?.code === 0) setDefinition(defRes.data); })
      .finally(() => { if (requestSeq.current === seq) setLoading(false); });
    p.catch(() => undefined);
    return () => controller.abort();
  }, [visible, viewId]);

  return (
    <SideSheet
      title={title}
      visible={visible}
      onCancel={onClose}
      width={760}
      bodyStyle={{ padding: 16 }}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : (
        <WorkflowInstanceDetailPanel
          instance={data}
          definition={definition}
          loading={loading}
          onOpenInstance={(id) => setViewId(id)}
        />
      )}
    </SideSheet>
  );
}
