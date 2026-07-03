import { useEffect, useState } from 'react';
import { Spin } from '@douyinfe/semi-ui';
import WorkflowInstanceDetailPanel from '@/components/workflow/WorkflowInstanceDetailPanel';
import WorkflowSideSheet from '@/components/workflow/WorkflowSideSheet';
import { useWorkflowInstanceWithDefinition } from '@/hooks/queries/workflow-shared';

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
  const [viewId, setViewId] = useState<number | null>(instanceId);
  const detailQuery = useWorkflowInstanceWithDefinition(viewId, visible);
  const loading = detailQuery.isFetching;
  const data = detailQuery.data?.instance ?? null;
  const definition = detailQuery.data?.definition ?? null;

  useEffect(() => {
    if (visible) setViewId(instanceId);
  }, [visible, instanceId]);

  return (
    <WorkflowSideSheet
      title={title}
      visible={visible}
      onCancel={onClose}
      variant="split"
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
    </WorkflowSideSheet>
  );
}
