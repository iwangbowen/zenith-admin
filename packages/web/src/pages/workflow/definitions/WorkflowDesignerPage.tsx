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
  type EdgeProps,
  BaseEdge,
  getSmoothStepPath,
  EdgeLabelRenderer,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Button,
  Dropdown,
  Form,
  Modal,
  Spin,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { ArrowLeft, Copy, Diamond, GitFork, Plus, Save, Trash2 } from 'lucide-react';
import type { WorkflowDefinition, WorkflowNodeConfig, WorkflowEdgeCondition, WorkflowConditionOperator } from '@zenith/shared';
import { WORKFLOW_CONDITION_OPERATORS } from '@zenith/shared';
import { request } from '@/utils/request';

// ─── Custom Node Component ────────────────────────────────────────────────────

interface WorkflowNodeData extends WorkflowNodeConfig {
  [key: string]: unknown;
}

type WorkflowNode = Node<WorkflowNodeData>;

const NODE_STYLE_MAP: Record<string, React.CSSProperties> = {
  start: { background: '#fff', color: '#333', border: '1px solid #d9d9d9', borderRadius: 24 },
  approve: { background: '#fff', color: '#333', border: '1px solid #d9d9d9' },
  end: { background: '#fff', color: '#333', border: '1px solid #d9d9d9', borderRadius: 24 },
  exclusiveGateway: { background: '#fff', color: '#333', border: '1px solid #d9d9d9', transform: 'rotate(45deg)', width: 48, height: 48 },
  parallelGateway: { background: '#fff', color: '#333', border: '1px solid #d9d9d9', transform: 'rotate(45deg)', width: 48, height: 48 },
  ccNode: { background: '#fff', color: '#333', border: '1px solid #d9d9d9' },
};

const NODE_ACCENT_MAP: Record<string, string> = {
  start: '#52c41a',
  approve: '#1677ff',
  end: '#999',
  exclusiveGateway: '#faad14',
  parallelGateway: '#722ed1',
  ccNode: '#13c2c2',
};

function WorkflowNodeComponent({ data }: NodeProps) {
  const nodeData = data as WorkflowNodeData;
  const typeStyle = NODE_STYLE_MAP[nodeData.type] || {};
  const accent = NODE_ACCENT_MAP[nodeData.type] || '#999';
  const isGateway = nodeData.type === 'exclusiveGateway' || nodeData.type === 'parallelGateway';

  if (isGateway) {
    return (
      <div style={{
        width: 48, height: 48,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'default',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        ...typeStyle,
      }}>
        <Handle type="target" position={Position.Left} style={{ transform: 'rotate(-45deg)', left: -6 }} />
        <div style={{ transform: 'rotate(-45deg)', fontSize: 18, fontWeight: 700, color: accent }}>
          {nodeData.type === 'exclusiveGateway' ? '×' : '+'}
        </div>
        <Handle type="source" position={Position.Right} style={{ transform: 'rotate(-45deg)', right: -6 }} />
      </div>
    );
  }

  const style: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: typeStyle.borderRadius ?? 6,
    minWidth: 120,
    textAlign: 'center',
    cursor: 'default',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    borderLeft: `3px solid ${accent}`,
    ...typeStyle,
  };

  return (
    <div style={style}>
      {nodeData.type !== 'start' && (
        <Handle type="target" position={Position.Left} />
      )}
      <div style={{ fontWeight: 600, fontSize: 13 }}>{nodeData.label}</div>
      {nodeData.type === 'approve' && nodeData.assigneeName && (
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>{nodeData.assigneeName}</div>
      )}
      {nodeData.type === 'ccNode' && nodeData.assigneeNames?.length && (
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>{nodeData.assigneeNames.join(', ')}</div>
      )}
      {nodeData.type !== 'end' && (
        <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
}

// ─── Custom Edge with Condition Label ─────────────────────────────────────────

interface ConditionEdgeData {
  condition?: WorkflowEdgeCondition | null;
  label?: string;
  [key: string]: unknown;
}

function ConditionEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, style: edgeStyle }: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const edgeData = data as ConditionEdgeData | undefined;
  const condLabel = edgeData?.condition
    ? `${edgeData.condition.field} ${edgeData.condition.operator} ${edgeData.condition.value}`
    : edgeData?.label ?? '';

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={edgeStyle} />
      {condLabel && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              background: 'rgba(255,255,255,0.9)',
              padding: '2px 6px',
              borderRadius: 4,
              fontSize: 11,
              color: '#555',
              border: '1px solid #ddd',
              pointerEvents: 'none',
            }}
          >
            {condLabel}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { workflowNode: WorkflowNodeComponent };
const edgeTypes = { conditionEdge: ConditionEdge };

const OPERATOR_LABELS: Record<string, string> = {
  eq: '等于', neq: '不等于', gt: '大于', gte: '大于等于',
  lt: '小于', lte: '小于等于', 'in': '包含在', contains: '包含',
};

function buildUpdatedNode(
  n: WorkflowNode,
  nodeData: WorkflowNodeData,
  values: Record<string, unknown>,
  userList: UserOption[],
): WorkflowNode {
  if (nodeData.type === 'approve') {
    const matched = userList.find(u => u.id === values.assigneeId);
    return {
      ...n,
      data: {
        ...n.data,
        label: values.label as string,
        assigneeId: values.assigneeId as number | null ?? null,
        assigneeName: matched?.nickname ?? null,
      },
    };
  }

  if (nodeData.type === 'ccNode') {
    const selectedIds = (values.assigneeIds as number[]) ?? [];
    const names = selectedIds
      .map(uid => userList.find(u => u.id === uid)?.nickname ?? '')
      .filter(Boolean);
    return {
      ...n,
      data: {
        ...n.data,
        label: values.label as string,
        assigneeIds: selectedIds,
        assigneeNames: names,
      },
    };
  }

  return { ...n, data: { ...n.data, label: values.label as string } };
}

// ─── 默认初始流程模板 ─────────────────────────────────────────────────────────

function getDefaultNodes(): WorkflowNode[] {
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
  const condFormApi = useRef<FormApi | null>(null);

  const [pageLoading, setPageLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(getDefaultNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState(getDefaultEdges());
  const [metaModalVisible, setMetaModalVisible] = useState(false);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [nodeEditVisible, setNodeEditVisible] = useState(false);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const [edgeEditVisible, setEdgeEditVisible] = useState(false);
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
            setNodes(fd.nodes.map(n => ({ ...n, type: 'workflowNode' } as WorkflowNode)));
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
    setEdges(eds => addEdge({ ...params, type: 'conditionEdge' }, eds));
  }, [setEdges]);

  // 添加新审批节点
  const addApproveNode = () => {
    const newKey = `approve-${Date.now()}`;
    const newNode: WorkflowNode = {
      id: `node-${newKey}`,
      type: 'workflowNode',
      position: { x: Math.random() * 300 + 200, y: Math.random() * 100 + 100 },
      data: { key: newKey, type: 'approve', label: '审批节点', assigneeId: null, assigneeName: null },
    };
    setNodes(nds => [...nds, newNode]);
  };

  // 添加排他网关
  const addExclusiveGateway = () => {
    const newKey = `xgw-${Date.now()}`;
    const newNode: WorkflowNode = {
      id: `node-${newKey}`,
      type: 'workflowNode',
      position: { x: Math.random() * 300 + 200, y: Math.random() * 100 + 100 },
      data: { key: newKey, type: 'exclusiveGateway', label: '条件判断' },
    };
    setNodes(nds => [...nds, newNode]);
  };

  // 添加并行网关
  const addParallelGateway = () => {
    const newKey = `pgw-${Date.now()}`;
    const newNode: WorkflowNode = {
      id: `node-${newKey}`,
      type: 'workflowNode',
      position: { x: Math.random() * 300 + 200, y: Math.random() * 100 + 100 },
      data: { key: newKey, type: 'parallelGateway', label: '并行网关' },
    };
    setNodes(nds => [...nds, newNode]);
  };

  // 添加抄送节点
  const addCcNode = () => {
    const newKey = `cc-${Date.now()}`;
    const newNode: WorkflowNode = {
      id: `node-${newKey}`,
      type: 'workflowNode',
      position: { x: Math.random() * 300 + 200, y: Math.random() * 100 + 100 },
      data: { key: newKey, type: 'ccNode', label: '抄送', assigneeIds: [], assigneeNames: [] },
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
    const nodeData = selectedNode.data as WorkflowNodeData;

    setNodes(nds => nds.map(n => {
      if (n.id !== selectedNode.id) return n;
      return buildUpdatedNode(n, nodeData, values, users);
    }));
    setNodeEditVisible(false);
  };

  // 保存连线条件
  const handleSaveEdgeCondition = (values: Record<string, unknown>) => {
    if (!selectedEdge) return;
    setEdges(eds => eds.map(e => {
      if (e.id !== selectedEdge.id) return e;
      const hasCondition = values.field && values.operator;
      return {
        ...e,
        data: {
          ...((e.data ?? {}) as ConditionEdgeData),
          condition: hasCondition ? {
            field: values.field as string,
            operator: values.operator as WorkflowConditionOperator,
            value: values.value as string | number,
          } : null,
        },
      };
    }));
    setEdgeEditVisible(false);
  };

  // 边点击 — 编辑条件
  const handleEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    // 只允许排他网关出边编辑条件
    const sourceNode = nodes.find(n => n.id === edge.source);
    if (sourceNode?.data.type === 'exclusiveGateway') {
      setSelectedEdge(edge);
      setEdgeEditVisible(true);
    }
  }, [nodes]);

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

  const isEditable = definition?.status !== 'published';
  const selectedNodeData = selectedNode?.data as WorkflowNodeData | undefined;
  const selectedEdgeData = selectedEdge?.data as ConditionEdgeData | undefined;

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
            <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--semi-color-success)', fontWeight: 400 }}>（已发布）</span>
          )}
        </Typography.Title>

        <Dropdown
          trigger="click"
          render={
            <Dropdown.Menu>
              <Dropdown.Item icon={<Plus size={14} />} onClick={addApproveNode}>审批节点</Dropdown.Item>
              <Dropdown.Item icon={<Diamond size={14} />} onClick={addExclusiveGateway}>排他网关 (XOR)</Dropdown.Item>
              <Dropdown.Item icon={<GitFork size={14} />} onClick={addParallelGateway}>并行网关 (AND)</Dropdown.Item>
              <Dropdown.Item icon={<Copy size={14} />} onClick={addCcNode}>抄送节点</Dropdown.Item>
            </Dropdown.Menu>
          }
        >
          <Button
            icon={<Plus size={14} />}
            type="secondary"
            disabled={!isEditable}
          >
            添加节点
          </Button>
        </Dropdown>

        {selectedNode && !['start', 'end'].includes((selectedNode.data as WorkflowNodeData).type) && (
          <Button
            icon={<Trash2 size={14} />}
            type="danger"
            onClick={deleteSelectedNode}
            disabled={!isEditable}
          >
            删除选中节点
          </Button>
        )}
        <Button
          icon={<Save size={14} />}
          type="primary"
          loading={saving}
          onClick={() => void handleSave()}
          disabled={!isEditable}
        >
          保存
        </Button>
      </div>

      {/* React Flow 画布 */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={isEditable ? onNodesChange : undefined}
          onEdgesChange={isEditable ? onEdgesChange : undefined}
          onConnect={isEditable ? onConnect : undefined}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          defaultEdgeOptions={{ type: 'conditionEdge', animated: true }}
          nodesDraggable={isEditable}
          nodesConnectable={isEditable}
          edgesReconnectable={isEditable}
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
            assigneeIds: selectedNodeData?.assigneeIds ?? [],
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
          {selectedNodeData?.type === 'ccNode' && (
            <Form.Select
              field="assigneeIds"
              label="抄送人"
              placeholder="请选择抄送人（可多选）"
              optionList={users.map(u => ({ value: u.id, label: u.nickname }))}
              multiple
              filter
            />
          )}
          {(selectedNodeData?.type === 'exclusiveGateway' || selectedNodeData?.type === 'parallelGateway') && (
            <div style={{ color: 'var(--semi-color-text-2)', fontSize: 13 }}>
              {selectedNodeData.type === 'exclusiveGateway'
                ? '排他网关：根据条件分支走不同路径。点击从此网关出发的连线可编辑条件。'
                : '并行网关：所有分支同时执行，全部完成后汇聚继续。需配合成对使用（fork + join）。'}
            </div>
          )}
        </Form>
      </Modal>

      {/* 连线条件编辑弹窗 */}
      <Modal
        title="编辑分支条件"
        visible={edgeEditVisible}
        onCancel={() => setEdgeEditVisible(false)}
        onOk={() => {
          condFormApi.current?.validate().then((values: Record<string, unknown>) => {
            handleSaveEdgeCondition(values);
          }).catch(() => undefined);
        }}
        style={{ width: 480 }}
      >
        <Form
          getFormApi={api => { condFormApi.current = api; }}
          initValues={{
            field: selectedEdgeData?.condition?.field ?? '',
            operator: selectedEdgeData?.condition?.operator ?? 'eq',
            value: selectedEdgeData?.condition?.value ?? '',
          }}
        >
          <Form.Input
            field="field"
            label="表单字段 Key"
            placeholder="如 amount, type, department"
            rules={[{ required: true, message: '请输入字段名' }]}
          />
          <Form.Select
            field="operator"
            label="运算符"
            optionList={WORKFLOW_CONDITION_OPERATORS.map(op => ({
              value: op,
              label: `${OPERATOR_LABELS[op] ?? op} (${op})`,
            }))}
          />
          <Form.Input
            field="value"
            label="比较值"
            placeholder="如 1000, leave, 技术部"
            rules={[{ required: true, message: '请输入比较值' }]}
          />
          <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12, marginTop: 4 }}>
            <p>条件不满足时将走无条件（默认）分支。</p>
            <p>若要清除条件，将字段名留空后保存。</p>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
