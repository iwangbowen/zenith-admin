/**
 * 流程实例详情整页（多页签打开）
 *
 * 复用 WorkflowInstanceDetailPanel：设计器表单走内置渲染、自定义业务表单走 BusinessFormHost(view)。
 * 作为系统多页签打开时，标题取实例标题、图标取自定义表单图标 → 分类图标 → 默认。
 */
import { useParams, useNavigate } from 'react-router-dom';
import { Spin, Empty } from '@douyinfe/semi-ui';
import WorkflowInstanceDetailPanel from '@/components/workflow/WorkflowInstanceDetailPanel';
import { useTabMeta } from '@/hooks/useTabMeta';
import { useWorkflowInstanceWithDefinition } from '@/hooks/queries/workflow-shared';

export default function WorkflowInstancePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const instanceId = Number(id);
  const detailQuery = useWorkflowInstanceWithDefinition(Number.isFinite(instanceId) ? instanceId : null);
  const data = detailQuery.data?.instance ?? null;
  const definition = detailQuery.data?.definition ?? null;
  const loading = detailQuery.isFetching;

  useTabMeta({
    title: data?.title ?? '流程详情',
    icon: data?.definitionSnapshot?.customForm?.icon ?? definition?.customForm?.icon ?? definition?.categoryIcon ?? 'FileText',
  });

  if (loading && !data) {
    return <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>;
  }
  if (!Number.isFinite(instanceId) || (!loading && !data)) {
    return <Empty title="流程实例不存在" style={{ padding: 60 }} />;
  }

  return (
    <div className="page-container page-container--stretch">
      <div style={{ flex: 1, minHeight: 0 }}>
        <WorkflowInstanceDetailPanel
          instance={data}
          definition={definition}
          loading={loading}
          onOpenInstance={(nextId) => navigate(`/workflow/instance/${nextId}`)}
          onRecalled={() => void detailQuery.refetch()}
        />
      </div>
    </div>
  );
}
