/**
 * 流程实例详情整页（多页签打开）
 *
 * 复用 WorkflowInstanceDetailPanel：设计器表单走内置渲染、自定义业务表单走 BusinessFormHost(view)。
 * 作为系统多页签打开时，标题取实例标题、图标取自定义表单图标 → 分类图标 → 默认。
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Spin, Empty } from '@douyinfe/semi-ui';
import type { WorkflowInstance, WorkflowDefinition } from '@zenith/shared';
import { request } from '@/utils/request';
import WorkflowInstanceDetailPanel from '@/components/workflow/WorkflowInstanceDetailPanel';
import { useTabMeta } from '@/hooks/useTabMeta';

export default function WorkflowInstancePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const instanceId = Number(id);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<WorkflowInstance | null>(null);
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);

  const load = useCallback(() => {
    if (!Number.isFinite(instanceId)) return;
    setLoading(true);
    setDefinition(null);
    request.get<WorkflowInstance>(`/api/workflows/instances/${instanceId}`)
      .then((res) => {
        if (res.code === 0) {
          setData(res.data);
          if (res.data.definitionSnapshot) return null;
          return request.get<WorkflowDefinition>(`/api/workflows/definitions/${res.data.definitionId}`, { silent: true });
        }
        return null;
      })
      .then((defRes) => { if (defRes?.code === 0) setDefinition(defRes.data); })
      .finally(() => setLoading(false));
  }, [instanceId]);

  useEffect(() => { load(); }, [load]);

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
          onRecalled={load}
        />
      </div>
    </div>
  );
}
