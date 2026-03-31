import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  BackgroundVariant,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Button,
  Form,
  Modal,
  Spin,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react';
import type { WorkflowDefinition, WorkflowNodeConfig } from '@zenith/shared';
import { request } from '@/utils/request';

// ─── Custom Node Component ────────────────────────────────────────────────────

interface WorkflowNodeData extends WorkflowNodeConfig {
  [key: string]: unknown;
}

const NODE_STYLE_MAP: Record<string, React.CSSProperties> = {
  start: { background: '#3CB371', color: '#fff', border: '2px solid #2e8b57' },
  approve: { background: '#1e90ff', color: '#fff', border: '2px solid #1565c0' },
  end: { background: '#e53e3e', color: '#fff', border: '2px solid #c53030' },
};


function WorkflowNodeComponent({ data }: NodeProps) {
  const nodeData = data as WorkflowNodeData;
  const typeStyle = NODE_STYLE_MAP[nodeData.type] || {};
  const style: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: 6,
    minWidth: 120,
    textAlign: 'center',
    cursor: 'default',
    boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
    ...typeStyle,
  };
  return (
    <div style={style}>
      {nodeData.type !== 'start' && (
        <Handle type="target" position={Position.Left} />
      )}
      <div style={{ fontWeight: 600, fontSize: 13 }}>{nodeData.label}</div>
      {nodeData.type === 'approve' && nodeData.assigneeName && (
        <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{nodeData.assigneeName}</div>
      )}
      {nodeData.type !== 'end' && (
        <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
}

const nodeTypes = { workflowNode: WorkflowNodeComponent };

// ─── 默认初始流程模板 ─────────────────────────────────────────────────────────

function getDefaultNodes(): Node[] {
  return [
    {
      id: 'node-start',
      type: 'workflowNode',
      position: { x: 50, y: 150 },
      data: { key: 'start', type: 'start', label: '发起', assigneeId: null, assigneeName: null },
    },
    {
      id: 'node-approve-1',
      type: 'workflowNode',
      position: { x: 280, y: 150 },
      data: { key: 'approve-1', type: 'approve', label: '审批', assigneeId: null, assigneeName: null },
    },
    {
      id: 'node-end',
      type: 'workflowNode',
      position: { x: 510, y: 150 },
      data: { key: 'end', type: 'end', label: '结束', assigneeId: null, assigneeName: null },
    },
  ];
}

function getDefaultEdges(): Edge[] {
  return [
    { id: 'e-start-approve1', source: 'node-start', target: 'node-approve-1', type: 'smoothstep' },
    { id: 'e-approve1-end', source: 'node-approve-1', target: 'node-end', type: 'smoothstep' },
  ];
}

// ─── 主设计器组件 ─────────────────────────────────────────────────────────────

interface UserOption { id: number; nickname: string; }

export default function WorkflowDesignerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';
  const formApi = useRef<FormApi | null>(null);
  const editFormApi = useRef<FormApi | null>(null);

  const [pageLoading, setPageLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(getDefaultNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState(getDefaultEdges());
  const [metaModalVisible, setMetaModalVisible] = useState(false);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [nodeEditVisible, setNodeEditVisible] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);

  // 加载现有流程定义
  useEffect(() => {
    if (!isNew && id) {
      setPageLoading(true);
      request.get<WorkflowDefinition>(`/api/workflows/definitions/${id}`).then(res => {
        if (res.code === 0 && res.data) {
          setDefinition(res.data);
          const fd = res.data.flowData;
          if (fd?.nodes?.length) {
            setNodes(fd.nodes.map(n => ({ ...n, type: 'workflowNode' })));
            setEdges(fd.edges ?? []);
          }
        }
      }).finally(() => setPageLoading(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew]);

  // 加载用户列表（用于审批人选择）
  useEffect(() => {
    request.get<{ list: UserOption[] }>('/api/users?page=1&pageSize=200').then(res => {
      if (res.code === 0 && res.data?.list) {
        setUsers(res.data.list);
      }
    });
  }, []);

  const onConnect = useCallback((params: Connection) => {
    setEdges(eds => addEdge({ ...params, type: 'smoothstep' }, eds));
  }, [setEdges]);

  // 添加新审批节点
  const addApproveNode = () => {
    const newKey = `approve-${Date.now()}`;
    const newNode: Node = {
      id: `node-${newKey}`,
      type: 'workflowNode',
      position: { x: Math.random() * 300 + 200, y: Math.random() * 100 + 100 },
      data: { key: newKey, type: 'approve', label: '审批节点', assigneeId: null, assigneeName: null },
    };
    setNodes(nds => [...nds, newNode]);
  };

  // 删除选中节点（不能删除 start / end）
  const deleteSelectedNode = () => {
    if (!selectedNode) return;
    const nodeData = selectedNode.data as WorkflowNodeData;
    if (nodeData.type === 'start' || nodeData.type === 'end') {
      Toast.warning('开始节点和结束节点不可删除');
      return;
    }
    setNodes(nds => nds.filter(n => n.id !== selectedNode.id));
    setEdges(eds => eds.filter(e => e.source !== selectedNode.id && e.target !== selectedNode.id));
    setSelectedNode(null);
  };

  // 打开节点属性编辑
  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    setNodeEditVisible(true);
  }, []);

  // 保存节点属性
  const handleSaveNodeProps = (values: Record<string, unknown>) => {
    if (!selectedNode) return;
    const user = users.find(u => u.id === values.assigneeId);
    setNodes(nds => nds.map(n => {
      if (n.id !== selectedNode.id) return n;
      return {
        ...n,
        data: {
          ...n.data,
          label: values.label as string,
          assigneeId: values.assigneeId as number | null ?? null,
          assigneeName: user?.nickname ?? null,
        },
      };
    }));
    setNodeEditVisible(false);
  };

  // 保存整个流程定义
  const handleSave = async () => {
    if (isNew) {
      setMetaModalVisible(true);
      return;
    }
    await doSave({
      name: definition?.name ?? '未命名流程',
      description: definition?.description ?? '',
    });
  };

  const doSave = async (meta: { name: string; description?: string | null }) => {
    setSaving(true);
    try {
      const flowData = { nodes, edges };
      const payload = {
        name: meta.name,
        description: meta.description ?? null,
        flowData,
      };

      let res;
      if (isNew) {
        res = await request.post<WorkflowDefinition>('/api/workflows/definitions', payload);
      } else {
        res = await request.put<WorkflowDefinition>(`/api/workflows/definitions/${id}`, payload);
      }

      if (res.code === 0) {
        Toast.success('保存成功');
        if (isNew && res.data) {
          navigate(`/workflow/designer/${res.data.id}`, { replace: true });
        }
        setMetaModalVisible(false);
        setDefinition(res.data ?? null);
      }
    } finally {
      setSaving(false);
    }
  };

  const selectedNodeData = selectedNode?.data as WorkflowNodeData | undefined;

  if (pageLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部工具栏 */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--semi-color-border)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: 'var(--semi-color-bg-1)',
      }}>
        <Button
          icon={<ArrowLeft size={14} />}
          type="tertiary"
          theme="borderless"
          onClick={() => navigate('/workflow/definitions')}
        >
          返回列表
        </Button>
        <Typography.Title heading={6} style={{ margin: 0, flex: 1 }}>
          {isNew ? '新建流程' : `设计流程：${definition?.name ?? ''}`}
          {definition?.status === 'published' && (
            <span style={{ marginLeft: 8, fontSize: 12, color: '#3CB371', fontWeight: 400 }}>（已发布）</span>
          )}
        </Typography.Title>
        <Button
          icon={<Plus size={14} />}
          type="secondary"
          onClick={addApproveNode}
          disabled={definition?.status === 'published'}
        >
          添加审批节点
        </Button>
        {selectedNode && (selectedNode.data as WorkflowNodeData).type === 'approve' && (
          <Button
            icon={<Trash2 size={14} />}
            type="danger"
            onClick={deleteSelectedNode}
            disabled={definition?.status === 'published'}
          >
            删除选中节点
          </Button>
        )}
        <Button
          icon={<Save size={14} />}
          type="primary"
          loading={saving}
          onClick={() => void handleSave()}
          disabled={definition?.status === 'published'}
        >
          保存
        </Button>
      </div>

      {/* React Flow 画布 */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={definition?.status === 'published' ? undefined : onNodesChange}
          onEdgesChange={definition?.status === 'published' ? undefined : onEdgesChange}
          onConnect={definition?.status === 'published' ? undefined : onConnect}
          onNodeClick={handleNodeClick}
          nodeTypes={nodeTypes}
          fitView
          defaultEdgeOptions={{ type: 'smoothstep', animated: true }}
          nodesDraggable={definition?.status !== 'published'}
          nodesConnectable={definition?.status !== 'published'}
          edgesReconnectable={definition?.status !== 'published'}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls />
        </ReactFlow>
      </div>

      {/* 流程元信息弹窗（新建时填写名称） */}
      <Modal
        title="填写流程信息"
        visible={metaModalVisible}
        onCancel={() => setMetaModalVisible(false)}
        onOk={() => {
          editFormApi.current?.validate().then((values: Record<string, unknown>) => {
            void doSave({ name: values.name as string, description: values.description as string | null });
          }).catch(() => undefined);
        }}
        okButtonProps={{ loading: saving }}
      >
        <Form getFormApi={api => { editFormApi.current = api; }}>
          <Form.Input field="name" label="流程名称" rules={[{ required: true, message: '请输入流程名称' }]} />
          <Form.TextArea field="description" label="描述" />
        </Form>
      </Modal>

      {/* 节点属性编辑弹窗 */}
      <Modal
        title="编辑节点属性"
        visible={nodeEditVisible}
        onCancel={() => setNodeEditVisible(false)}
        onOk={() => {
          formApi.current?.validate().then((values: Record<string, unknown>) => {
            handleSaveNodeProps(values);
          }).catch(() => undefined);
        }}
        style={{ width: 480 }}
      >
        <Form
          getFormApi={api => { formApi.current = api; }}
          initValues={{
            label: selectedNodeData?.label ?? '',
            assigneeId: selectedNodeData?.assigneeId ?? undefined,
          }}
        >
          <Form.Input
            field="label"
            label="节点名称"
            rules={[{ required: true, message: '请输入节点名称' }]}
          />
          {selectedNodeData?.type === 'approve' && (
            <Form.Select
              field="assigneeId"
              label="审批人"
              placeholder="请选择审批人"
              optionList={users.map(u => ({ value: u.id, label: u.nickname }))}
              showClear
              filter
            />
          )}
        </Form>
      </Modal>
    </div>
  );
}
