import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, Spin, Tag, Typography, Space, Button } from '@douyinfe/semi-ui';
import { Background, Controls, type Edge, type Node, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import AppModal from '@/components/AppModal';
import type { ReportDataset } from '@zenith/shared';
import { useReportDatasetRefs } from '@/hooks/queries/report-datasets';

interface Props {
  dataset: ReportDataset | null;
  onClose: () => void;
}

const X_BY_TYPE: Record<string, number> = {
  datasource: 0,
  dataset: 220,
  dashboard: 460,
  widget: 740,
  filter: 740,
  print: 740,
  alert: 740,
  subscription: 980,
  share: 980,
  embed: 980,
};

function buildPath(node: NonNullable<NonNullable<ReturnType<typeof useReportDatasetRefs>['data']>['nodes']>[number]) {
  switch (node.type) {
    case 'datasource': return node.refId ? '/report/datasources' : null;
    case 'dataset': return node.refId ? '/report/datasets' : null;
    case 'dashboard': return node.refId ? `/report/dashboards/${node.refId}/view` : null;
    case 'print': return '/report/print';
    case 'alert': return '/report/alerts';
    case 'subscription': return '/report/subscriptions';
    case 'share':
    case 'embed': {
      const dashboardId = Number(node.meta?.dashboardId ?? 0);
      return dashboardId > 0 ? `/report/dashboards/${dashboardId}/view` : '/report/dashboards';
    }
    default: return null;
  }
}

export function DatasetRefsModal({ dataset, onClose }: Readonly<Props>) {
  const navigate = useNavigate();
  const refsQuery = useReportDatasetRefs(dataset?.id, !!dataset);
  const refs = refsQuery.data ?? null;
  const nodesData = useMemo(() => refs?.nodes ?? [], [refs]);
  const edgesData = useMemo(() => refs?.edges ?? [], [refs]);
  const empty = refs && nodesData.length <= 2;

  const graph = useMemo(() => {
    const typeIndex = new Map<string, number>();
    const nodes: Node[] = nodesData.map((node) => {
      const index = typeIndex.get(node.type) ?? 0;
      typeIndex.set(node.type, index + 1);
      return {
        id: node.id,
        position: { x: X_BY_TYPE[node.type] ?? 1120, y: 40 + (index * 110) },
        data: {
          label: (
            <div style={{ minWidth: 120 }}>
              <Typography.Text strong>{node.label}</Typography.Text>
              <div><Tag size="small">{node.type}</Tag></div>
            </div>
          ),
        },
        style: { borderRadius: 'var(--semi-border-radius-large)', border: '1px solid var(--semi-color-border)', padding: 8, background: 'var(--semi-color-bg-1)' },
      };
    });
    const edges: Edge[] = edgesData.map((edge) => ({ ...edge, animated: edge.source.startsWith('dataset:') || edge.source.startsWith('dashboard:') }));
    return { nodes, edges };
  }, [edgesData, nodesData]);

  return (
    <AppModal title={`血缘分析 · ${dataset?.name ?? ''}`} visible={!!dataset} onCancel={onClose} onOk={onClose} okText="关闭" width={1080} fullscreenable={false}>
      {refsQuery.isFetching && !refs ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spin /></div>
      ) : empty ? (
        <Empty description="暂无下游引用，删除该数据集不会影响其它资源" style={{ padding: '24px 0' }} />
      ) : (
        <Space vertical align="start" spacing={16} style={{ width: '100%' }}>
          <div style={{ width: '100%', height: 460, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-large)', overflow: 'hidden' }}>
            <ReactFlow
              fitView
              nodes={graph.nodes}
              edges={graph.edges}
              onNodeClick={(_, node) => {
                const ref = nodesData.find((item) => item.id === node.id);
                if (!ref) return;
                const path = buildPath(ref);
                if (path) navigate(path);
              }}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          <div style={{ width: '100%' }}>
            <Typography.Title heading={6} style={{ margin: '0 0 8px' }}>可访问列表</Typography.Title>
            <Space vertical align="start" spacing={8} style={{ width: '100%' }}>
              {nodesData.map((node) => {
                const path = buildPath(node);
                return (
                  <div key={node.id} style={{ display: 'flex', width: '100%', justifyContent: 'space-between', gap: 12 }}>
                    <Space>
                      <Tag size="small">{node.type}</Tag>
                      <Typography.Text>{node.label}</Typography.Text>
                    </Space>
                    {path ? <Button theme="borderless" size="small" onClick={() => navigate(path)}>打开</Button> : null}
                  </div>
                );
              })}
            </Space>
          </div>
        </Space>
      )}
    </AppModal>
  );
}

export default DatasetRefsModal;
