/**
 * 工作流设计器页面 — 钉钉/飞书风格垂直流程设计器
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Form, Modal, Spin, Toast, Typography } from '@douyinfe/semi-ui';
import { ArrowLeft, Download, Minus, Plus, RotateCcw, Save, Upload } from 'lucide-react';
import type { WorkflowDefinition, WorkflowFormField } from '@zenith/shared';
import { request } from '@/utils/request';

import type { FlowNode, FlowBranch, FlowNodeType, FlowProcess, BranchNodeType, ConditionGroup } from './types';
import {
  createDefaultProcess,
  createNode,
  createBranch,
  insertNodeAfter,
  insertNodeInBranch,
  removeNode,
  updateNode,
  updateBranch,
  addBranch as addBranchToProcess,
  removeBranch as removeBranchFromProcess,
  treeToFlat,
  deepClone,
} from './utils';
import FlowRenderer from './components/FlowRenderer';
import NodeConfigDrawer from './components/NodeConfigDrawer';
import ConditionEditor from './components/ConditionEditor';
import './styles/flow-designer.css';

// ─── 选项数据类型 ─────────────────────────────────────────────────────

interface UserOption { id: number; nickname: string; }
interface RoleOption { id: number; name: string; }

// ─── 主组件 ───────────────────────────────────────────────────────────

export default function WorkflowDesignerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const [pageLoading, setPageLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [process, setProcess] = useState<FlowProcess>(createDefaultProcess());
  const [metaModalVisible, setMetaModalVisible] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);

  // 节点编辑抽屉
  const [editingNode, setEditingNode] = useState<FlowNode | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);

  // 分支条件编辑
  const [editingBranch, setEditingBranch] = useState<FlowBranch | null>(null);
  const [conditionEditorVisible, setConditionEditorVisible] = useState(false);

  // 缩放
  const [zoom, setZoom] = useState(100);

  // 表单字段（从定义中获取）
  const formFields: Array<{ key: string; label: string; type: WorkflowFormField['type']; options?: string[] }> =
    definition?.formFields?.map(f => ({ key: f.key, label: f.label, type: f.type, options: f.options ?? undefined })) ?? [];

  // ─── 加载数据 ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!isNew && id) {
      setPageLoading(true);
      request.get<WorkflowDefinition>(`/api/workflows/definitions/${id}`).then(res => {
        if (res.code === 0 && res.data) {
          setDefinition(res.data);
          const fd = res.data.flowData;
          if (fd && 'process' in fd && (fd as unknown as Record<string, unknown>).process) {
            setProcess((fd as unknown as Record<string, unknown>).process as FlowProcess);
          }
        }
      }).finally(() => setPageLoading(false));
    }
  }, [id, isNew]);

  useEffect(() => {
    request.get<{ list: UserOption[] }>('/api/users?page=1&pageSize=200').then(res => {
      if (res.code === 0 && res.data?.list) {
        setUsers(res.data.list);
      }
    });
    request.get<{ list: RoleOption[] }>('/api/roles?page=1&pageSize=200').then(res => {
      if (res.code === 0 && res.data?.list) {
        setRoles(res.data.list);
      }
    });
  }, []);

  // ─── 节点操作 ─────────────────────────────────────────────────────

  const handleAddNodeAfter = useCallback((parentId: string, nodeType: FlowNodeType) => {
    const newNode = createNode(nodeType, getDefaultName(nodeType));
    setProcess(prev => insertNodeAfter(prev, parentId, newNode));
  }, []);

  const handleAddNodeInBranch = useCallback((branchNodeId: string, branchId: string, nodeType: FlowNodeType) => {
    const newNode = createNode(nodeType, getDefaultName(nodeType));
    setProcess(prev => insertNodeInBranch(prev, branchNodeId, branchId, newNode));
  }, []);

  const handleDeleteNode = useCallback((nodeId: string) => {
    setProcess(prev => removeNode(prev, nodeId));
  }, []);

  const handleEditNode = useCallback((node: FlowNode) => {
    setEditingNode(deepClone(node));
    setDrawerVisible(true);
  }, []);

  const handleSaveNode = useCallback((nodeId: string, updates: { name?: string; props?: Record<string, unknown> }) => {
    setProcess(prev => updateNode(prev, nodeId, updates));
    setDrawerVisible(false);
    setEditingNode(null);
  }, []);

  // ─── 分支操作 ─────────────────────────────────────────────────────

  const handleAddBranch = useCallback((branchNodeId: string) => {
    setProcess(prev => {
      const cloned = deepClone(prev);
      const findNode = (n: FlowNode | undefined): FlowNode | undefined => {
        if (!n) return undefined;
        if (n.id === branchNodeId) return n;
        if (n.children) {
          const found = findNode(n.children);
          if (found) return found;
        }
        if (n.branches) {
          for (const b of n.branches) {
            if (b.children) {
              const found = findNode(b.children);
              if (found) return found;
            }
          }
        }
        return undefined;
      };
      const branchNode = findNode(cloned.initiator);
      const count = branchNode?.branches?.length ?? 0;
      const newBranch = createBranch(branchNode?.type as BranchNodeType ?? 'conditionBranch', count + 1);
      return addBranchToProcess(prev, branchNodeId, newBranch);
    });
  }, []);

  const handleRemoveBranch = useCallback((branchNodeId: string, branchId: string) => {
    setProcess(prev => removeBranchFromProcess(prev, branchNodeId, branchId));
  }, []);

  const handleEditBranch = useCallback((branch: FlowBranch, _branchNodeId: string) => {
    setEditingBranch(deepClone(branch));
    setConditionEditorVisible(true);
  }, []);

  const handleSaveBranchConditions = useCallback((branchId: string, conditions: ConditionGroup[]) => {
    setProcess(prev => updateBranch(prev, branchId, { conditions }));
    setConditionEditorVisible(false);
    setEditingBranch(null);
  }, []);

  // ─── 导入导出 ─────────────────────────────────────────────────────

  const handleExport = useCallback(() => {
    const jsonStr = JSON.stringify(process, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flow-${definition?.name ?? 'untitled'}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [process, definition]);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text) as FlowProcess;
        if (data?.initiator) {
          setProcess(data);
          Toast.success('导入成功');
        } else {
          Toast.error('无效的流程数据');
        }
      } catch {
        Toast.error('JSON 解析失败');
      }
    };
    input.click();
  }, []);

  // ─── 保存 ─────────────────────────────────────────────────────────

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
      const flat = treeToFlat(process);
      const flowData = { ...flat, process };
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

  // ─── 缩放 ─────────────────────────────────────────────────────────

  const handleZoomIn = () => setZoom(z => Math.min(z + 10, 200));
  const handleZoomOut = () => setZoom(z => Math.max(z - 10, 50));
  const handleZoomReset = () => setZoom(100);

  // ─── 渲染 ─────────────────────────────────────────────────────────

  const isEditable = definition?.status !== 'published';

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
      <div className="fd-toolbar">
        <Button
          icon={<ArrowLeft size={14} />}
          type="tertiary"
          theme="borderless"
          onClick={() => navigate('/workflow/definitions')}
        >
          返回列表
        </Button>

        <div className="fd-toolbar__title">
          <Typography.Title heading={6} style={{ margin: 0 }}>
            {isNew ? '新建流程' : `设计流程：${definition?.name ?? ''}`}
          </Typography.Title>
          {definition?.status === 'published' && (
            <span style={{ fontSize: 12, color: 'var(--semi-color-success)', fontWeight: 400 }}>（已发布）</span>
          )}
        </div>

        <Button icon={<Download size={14} />} type="tertiary" theme="borderless" onClick={handleExport}>
          导出
        </Button>
        <Button icon={<Upload size={14} />} type="tertiary" theme="borderless" onClick={handleImport} disabled={!isEditable}>
          导入
        </Button>

        <div className="fd-toolbar__zoom">
          <Button icon={<Minus size={14} />} type="tertiary" theme="borderless" size="small" onClick={handleZoomOut} />
          <span>{zoom}%</span>
          <Button icon={<Plus size={14} />} type="tertiary" theme="borderless" size="small" onClick={handleZoomIn} />
          <Button icon={<RotateCcw size={12} />} type="tertiary" theme="borderless" size="small" onClick={handleZoomReset} />
        </div>

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

      {/* 画布 */}
      <div className="fd-canvas">
        <div style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}>
          <FlowRenderer
            process={process}
            onEditNode={handleEditNode}
            onDeleteNode={handleDeleteNode}
            onAddNodeAfter={handleAddNodeAfter}
            onAddNodeInBranch={handleAddNodeInBranch}
            onAddBranch={handleAddBranch}
            onRemoveBranch={handleRemoveBranch}
            onEditBranch={handleEditBranch}
          />
        </div>
      </div>

      {/* 节点配置抽屉 */}
      <NodeConfigDrawer
        visible={drawerVisible}
        node={editingNode}
        users={users}
        roles={roles}
        formFields={formFields}
        onSave={handleSaveNode}
        onCancel={() => { setDrawerVisible(false); setEditingNode(null); }}
      />

      {/* 条件规则编辑器 */}
      <ConditionEditor
        visible={conditionEditorVisible}
        branch={editingBranch}
        formFields={formFields}
        onSave={handleSaveBranchConditions}
        onCancel={() => { setConditionEditorVisible(false); setEditingBranch(null); }}
      />

      {/* 流程元信息弹窗（新建时填写名称） */}
      <Modal
        title="填写流程信息"
        visible={metaModalVisible}
        onCancel={() => setMetaModalVisible(false)}
        onOk={() => {
          const formEl = document.querySelector('#fd-meta-form') as HTMLFormElement | null;
          if (formEl) {
            // 使用 Semi Form 的 ref 方式
          }
        }}
        okButtonProps={{ loading: saving }}
      >
        <MetaForm onSubmit={(meta) => void doSave(meta)} saving={saving} onCancel={() => setMetaModalVisible(false)} />
      </Modal>
    </div>
  );
}

// ─── 辅助组件 ─────────────────────────────────────────────────────────

function getDefaultName(type: FlowNodeType): string {
  const map: Partial<Record<FlowNodeType, string>> = {
    approver: '审批人',
    handler: '办理人',
    cc: '抄送',
    delay: '延迟器',
    trigger: '触发器',
    subProcess: '子流程',
    conditionBranch: '条件分支',
    parallelBranch: '并行分支',
    inclusiveBranch: '包容分支',
    routeBranch: '路由分支',
  };
  return map[type] ?? '节点';
}

interface MetaFormProps {
  onSubmit: (meta: { name: string; description?: string | null }) => void;
  saving: boolean;
  onCancel: () => void;
}

function MetaForm({ onSubmit }: Readonly<MetaFormProps>) {
  return (
    <Form
      onSubmit={(values: Record<string, unknown>) => {
        onSubmit({ name: values.name as string, description: values.description as string | null });
      }}
    >
      <Form.Input field="name" label="流程名称" rules={[{ required: true, message: '请输入流程名称' }]} />
      <Form.TextArea field="description" label="描述" />
      <Button htmlType="submit" type="primary" style={{ display: 'none' }}>提交</Button>
    </Form>
  );
}
