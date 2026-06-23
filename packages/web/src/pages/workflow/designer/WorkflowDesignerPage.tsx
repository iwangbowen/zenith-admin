/**
 * 工作流设计器页面 — 钉钉/飞书风格垂直流程设计器
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, RadioGroup, Radio, Spin, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import { ArrowLeft, Download, Eye, History, Minus, Plus, Redo2, RotateCcw, Save, Send, Undo2, Upload } from 'lucide-react';
import type { WorkflowDefinition, WorkflowFormField, WorkflowFormType, WorkflowCustomFormConfig } from '@zenith/shared';
import { WORKFLOW_FORM_TYPES, WORKFLOW_FORM_TYPE_LABELS } from '@zenith/shared';
import { request } from '@/utils/request';

import WorkflowVersionsModal from '../components/WorkflowVersionsModal';

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
  moveBranch as moveBranchInProcess,
  resetRouteCaseValues,
  validateRouteBranches,
  validateConditionBranches,
  validateBranchChildren,
  treeToFlat,
  deepClone,
  collectAllNodes,
  findAncestorApproverNodes,
  duplicateNode,
} from './utils';
import { useHistoryState } from './hooks/useHistoryState';
import FlowRenderer from './components/FlowRenderer';
import NodeConfigDrawer from './components/NodeConfigDrawer';
import ConditionEditor from './components/ConditionEditor';
import RouteBranchEditor, { type RouteBranchEditorUpdates } from './components/RouteBranchEditor';
import FormSelectorPanel from './components/FormSelectorPanel';
import CustomFormConfigPanel from './components/CustomFormConfigPanel';
import FormPreview from './components/FormPreview';
import BasicInfoPanel from './components/BasicInfoPanel';
import AdvancedSettingsPanel from './components/AdvancedSettingsPanel';
import type { AdvancedSettingsData } from './components/AdvancedSettingsPanel';
import { DEFAULT_ADVANCED_SETTINGS } from './components/advanced-settings';
import './styles/flow-designer.css';

// ─── 选项数据类型 ─────────────────────────────────────────────────────

interface UserOption { id: number; nickname: string; }
interface RoleOption { id: number; name: string; }
interface DepartmentOption { id: number; name: string; parentId: number | null; }

// ─── 主组件 ───────────────────────────────────────────────────────────

export default function WorkflowDesignerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const [pageLoading, setPageLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [process, setProcess, history] = useHistoryState<FlowProcess>(createDefaultProcess());
  const [users, setUsers] = useState<UserOption[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [userGroups, setUserGroups] = useState<Array<{ id: number; name: string }>>([]);
  const [positions, setPositions] = useState<Array<{ id: number; name: string }>>([]);
  const [subProcessOptions, setSubProcessOptions] = useState<Array<{ value: number; label: string; fields?: Array<{ key: string; label: string; type?: string }> }>>([]);

  // 节点编辑抽屉
  const [editingNode, setEditingNode] = useState<FlowNode | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);

  // 分支条件编辑
  const [editingBranch, setEditingBranch] = useState<FlowBranch | null>(null);
  const [editingBranchParent, setEditingBranchParent] = useState<FlowNode | null>(null);
  const [conditionEditorVisible, setConditionEditorVisible] = useState(false);
  const [routeEditorVisible, setRouteEditorVisible] = useState(false);

  // 缩放
  const [zoom, setZoom] = useState(100);

  // 步骤导航：① 基础信息 → ② 表单设计 → ③ 流程设计 → ④ 更多设置
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);

  // 表单字段（由所选表单派生，供下游节点配置/条件/权限使用）
  const [localFormFields, setLocalFormFields] = useState<WorkflowFormField[]>([]);
  // 绑定的表单库表单 id
  const [formId, setFormId] = useState<number | null>(null);
  // 表单类型：designer=表单库，custom=自定义业务页面
  const [formType, setFormType] = useState<WorkflowFormType>('designer');
  // 自定义业务表单配置
  const [customForm, setCustomForm] = useState<WorkflowCustomFormConfig | null>(null);

  // 预览
  const [previewVisible, setPreviewVisible] = useState(false);

  // 历史版本
  const [historyModalVisible, setHistoryModalVisible] = useState(false);

  // 更多设置
  const [advancedSettings, setAdvancedSettings] = useState<AdvancedSettingsData>(DEFAULT_ADVANCED_SETTINGS);

  // 基础信息（内联编辑）
  const [metaName, setMetaName] = useState('');
  const [metaDesc, setMetaDesc] = useState('');
  const [metaInitiatorScopeType, setMetaInitiatorScopeType] = useState<'all' | 'users' | 'departments' | 'roles'>('all');
  const [metaInitiatorScopeIds, setMetaInitiatorScopeIds] = useState<number[]>([]);
  const [searchParams] = useSearchParams();
  const initialCategoryId = (() => {
    const v = searchParams.get('categoryId');
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  })();
  const [metaCategoryId, setMetaCategoryId] = useState<number | null>(initialCategoryId);

  // 同步表单字段到视图：设计器表单取所选表单字段；自定义表单取声明的流程变量
  const VARIABLE_TYPE_TO_FIELD: Record<string, WorkflowFormField['type']> = {
    string: 'text', number: 'number', boolean: 'switch', date: 'date', user: 'userSelect', dept: 'deptSelect',
  };
  const formFields = useMemo<Array<{ key: string; label: string; type: WorkflowFormField['type']; options?: string[] }>>(() => {
    if (formType === 'custom' || formType === 'external') {
      return (customForm?.variables ?? [])
        .filter(v => v.key)
        .map(v => ({ key: v.key, label: v.label || v.key, type: VARIABLE_TYPE_TO_FIELD[v.type] ?? 'text' }));
    }
    return localFormFields.map(f => ({ key: f.key, label: f.label, type: f.type, options: f.options ?? undefined }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formType, customForm, localFormFields]);

  // ─── 加载数据 ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!isNew && id) {
      setPageLoading(true);
      request.get<WorkflowDefinition>(`/api/workflows/definitions/${id}`).then(res => {
        if (res.code === 0 && res.data) {
          setDefinition(res.data);
          setMetaName(res.data.name);
          setMetaDesc(res.data.description ?? '');
          setMetaCategoryId(res.data.categoryId ?? null);
          setMetaInitiatorScopeType(res.data.initiatorScopeType ?? 'all');
          setMetaInitiatorScopeIds(res.data.initiatorScopeIds ?? []);
          setFormId(res.data.formId ?? null);
          setFormType(res.data.formType ?? 'designer');
          setCustomForm(res.data.customForm ?? null);
          if (res.data.formFields) setLocalFormFields(res.data.formFields);
          const fd = res.data.flowData;
          if (fd && 'process' in fd && (fd as unknown as Record<string, unknown>).process) {
            history.reset((fd as unknown as Record<string, unknown>).process);
          }
          if (fd && 'settings' in fd && (fd as unknown as Record<string, unknown>).settings) {
            setAdvancedSettings({
              ...DEFAULT_ADVANCED_SETTINGS,
              ...((fd as unknown as Record<string, unknown>).settings as Partial<AdvancedSettingsData>),
            });
          }
        }
      }).finally(() => setPageLoading(false));
    }
    // history.reset 是稳定的 useCallback，不需要追踪；
    // 不能将 history 对象本身加入依赖，否则每次添加节点（pastLen 变化）都会重新触发数据加载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew]);

  useEffect(() => {
    request.get<UserOption[]>('/api/users/all').then(res => {
      if (res.code === 0 && res.data) {
        setUsers(res.data);
      }
    });
    request.get<RoleOption[]>('/api/roles/all').then(res => {
      if (res.code === 0 && res.data) {
        setRoles(res.data);
      }
    });
    request.get<DepartmentOption[]>('/api/departments/flat').then((res) => {
      if (res.code === 0 && res.data) {
        setDepartments(res.data.map((d) => ({ id: d.id, name: d.name, parentId: d.parentId ?? null })));
      }
    });
    request.get<Array<{ id: number; name: string }>>('/api/user-groups/all').then(res => {
      if (res.code === 0 && res.data) {
        setUserGroups(res.data.map(g => ({ id: g.id, name: g.name })));
      }
    });
    request.get<Array<{ id: number; name: string }>>('/api/positions/all').then(res => {
      if (res.code === 0 && res.data) {
        setPositions(res.data.map(p => ({ id: p.id, name: p.name })));
      }
    });
    request.get<WorkflowDefinition[]>('/api/workflows/definitions/published').then((res) => {
      if (res.code === 0 && Array.isArray(res.data)) {
        const currentId = id && id !== 'new' ? Number(id) : null;
        setSubProcessOptions(
          res.data
            .filter((d) => d.id !== currentId)
            .map((d) => ({
              value: d.id,
              label: d.name,
              fields: Array.isArray(d.formFields)
                ? (d.formFields as Array<{ key?: string; label?: string; type?: string }>)
                    .filter((f) => f && typeof f.key === 'string' && f.key)
                    .map((f) => ({ key: f.key as string, label: f.label ?? (f.key as string), type: f.type }))
                : [],
            })),
        );
      }
    });
  }, [id]);

  // ─── 节点操作 ─────────────────────────────────────────────────────

  const handleAddNodeAfter = useCallback((parentId: string, nodeType: FlowNodeType) => {
    const newNode = createNode(nodeType, getDefaultName(nodeType));
    setProcess(prev => insertNodeAfter(prev, parentId, newNode));
  }, [setProcess]);

  const handleAddNodeInBranch = useCallback((branchNodeId: string, branchId: string, nodeType: FlowNodeType) => {
    const newNode = createNode(nodeType, getDefaultName(nodeType));
    setProcess(prev => insertNodeInBranch(prev, branchNodeId, branchId, newNode));
  }, [setProcess]);

  const handleDeleteNode = useCallback((nodeId: string) => {
    setProcess(prev => removeNode(prev, nodeId));
  }, [setProcess]);

  const handleDuplicateNode = useCallback((nodeId: string) => {
    setProcess(prev => duplicateNode(prev, nodeId));
    Toast.success({ content: '节点已复制', duration: 2 });
  }, [setProcess]);

  const handleEditNode = useCallback((node: FlowNode) => {
    setEditingNode(deepClone(node));
    setDrawerVisible(true);
  }, []);

  const handleSaveNode = useCallback((nodeId: string, updates: { name?: string; key?: string; props?: Record<string, unknown> }) => {
    setProcess(prev => {
      // 检测路由分支节点的 routeFieldKey 变更，若变更则清空子分支的 caseValue
      const findNode = (n: FlowNode | undefined): FlowNode | undefined => {
        if (!n) return undefined;
        if (n.id === nodeId) return n;
        if (n.children) {
          const f = findNode(n.children);
          if (f) return f;
        }
        if (n.branches) {
          for (const b of n.branches) {
            if (b.children) {
              const f = findNode(b.children);
              if (f) return f;
            }
          }
        }
        return undefined;
      };
      const existing = findNode(prev.initiator);
      let next = updateNode(prev, nodeId, updates);
      if (existing?.type === 'routeBranch' && updates.props && 'routeFieldKey' in updates.props) {
        const oldKey = ((existing.props?.routeFieldKey as string | undefined) ?? '').trim();
        const newKey = ((updates.props.routeFieldKey as string | undefined) ?? '').trim();
        if (oldKey !== newKey) {
          next = resetRouteCaseValues(next, nodeId);
          if (oldKey) Toast.info('路由字段已切换，分支匹配值已清空');
        }
      }
      return next;
    });
    setDrawerVisible(false);
    setEditingNode(null);
  }, [setProcess]);

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
  }, [setProcess]);

  const handleRemoveBranch = useCallback((branchNodeId: string, branchId: string) => {
    setProcess(prev => removeBranchFromProcess(prev, branchNodeId, branchId));
  }, [setProcess]);

  const handleMoveBranch = useCallback((branchNodeId: string, branchId: string, direction: 'up' | 'down') => {
    setProcess(prev => moveBranchInProcess(prev, branchNodeId, branchId, direction));
  }, [setProcess]);

  const handleEditBranch = useCallback((branch: FlowBranch, branchNodeId: string) => {
    // 根据父节点类型分流到对应编辑器
    const findNode = (n: FlowNode | undefined): FlowNode | undefined => {
      if (!n) return undefined;
      if (n.id === branchNodeId) return n;
      if (n.children) {
        const f = findNode(n.children);
        if (f) return f;
      }
      if (n.branches) {
        for (const b of n.branches) {
          if (b.children) {
            const f = findNode(b.children);
            if (f) return f;
          }
        }
      }
      return undefined;
    };
    const parent = findNode(process.initiator);
    setEditingBranch(deepClone(branch));
    setEditingBranchParent(parent ? deepClone(parent) : null);
    if (parent?.type === 'routeBranch') {
      setRouteEditorVisible(true);
    } else {
      setConditionEditorVisible(true);
    }
  }, [process]);

  const handleSaveBranchConditions = useCallback((branchId: string, updates: { name: string; conditions: ConditionGroup[] }) => {
    setProcess(prev => updateBranch(prev, branchId, updates));
    setConditionEditorVisible(false);
    setEditingBranch(null);
    setEditingBranchParent(null);
  }, [setProcess]);

  const handleSaveRouteBranch = useCallback((branchId: string, updates: RouteBranchEditorUpdates) => {
    const parent = editingBranchParent;
    setProcess(prev => {
      let next = prev;
      // 如果切换了路由字段：先写父节点 props，再清空其它分支的 caseValue
      if (parent && updates.newRouteFieldKey !== undefined) {
        next = updateNode(next, parent.id, { props: { routeFieldKey: updates.newRouteFieldKey } });
        next = resetRouteCaseValues(next, parent.id);
        if (parent.props?.routeFieldKey) {
          Toast.info('路由字段已切换，其它分支的匹配值已清空');
        }
      }
      const branchUpdates: { name: string; caseValue?: string } = { name: updates.name };
      if (updates.caseValue !== undefined) branchUpdates.caseValue = updates.caseValue;
      next = updateBranch(next, branchId, branchUpdates);
      return next;
    });
    setRouteEditorVisible(false);
    setEditingBranch(null);
    setEditingBranchParent(null);
  }, [setProcess, editingBranchParent]);

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
  }, [setProcess]);

  // ─── 保存 ─────────────────────────────────────────────────────────

  const buildCurrentMeta = () => ({
    name: metaName,
    description: metaDesc || null,
    categoryId: metaCategoryId,
    initiatorScopeType: metaInitiatorScopeType,
    initiatorScopeIds: metaInitiatorScopeType === 'all' ? null : metaInitiatorScopeIds,
  });

  const validateBeforeSave = () => {
    if (!metaName.trim()) {
      Toast.warning('请先填写流程名称');
      setCurrentStep(1);
      return false;
    }
    const routeErrors = validateRouteBranches(process);
    if (routeErrors.length > 0) {
      Toast.warning(`路由分支配置不完整：${routeErrors[0]}`);
      setCurrentStep(3);
      return false;
    }
    const conditionErrors = validateConditionBranches(process);
    if (conditionErrors.length > 0) {
      Toast.warning(`条件分支配置不完整：${conditionErrors[0]}`);
      setCurrentStep(3);
      return false;
    }
    const emptyBranchErrors = validateBranchChildren(process);
    if (emptyBranchErrors.length > 0) {
      Toast.warning(`分支配置不完整：${emptyBranchErrors[0]}`);
      setCurrentStep(3);
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!validateBeforeSave()) return;
    await doSave(buildCurrentMeta());
  };

  const doSave = async (meta: {
    name: string;
    description?: string | null;
    categoryId: number | null;
    initiatorScopeType: 'all' | 'users' | 'departments' | 'roles';
    initiatorScopeIds: number[] | null;
  }, options: { showToast?: boolean } = {}): Promise<WorkflowDefinition | null> => {
    setSaving(true);
    try {
      const flat = treeToFlat(process);
      const flowData = { ...flat, process, settings: advancedSettings };
      const payload = {
        name: meta.name,
        description: meta.description ?? null,
        categoryId: meta.categoryId,
        initiatorScopeType: meta.initiatorScopeType,
        initiatorScopeIds: meta.initiatorScopeIds,
        flowData,
        formId: formType === 'designer' ? formId : null,
        formType,
        customForm: formType === 'custom' || formType === 'external' ? customForm : null,
      };

      let res;
      if (isNew) {
        res = await request.post<WorkflowDefinition>('/api/workflows/definitions', payload);
      } else {
        res = await request.put<WorkflowDefinition>(`/api/workflows/definitions/${id}`, payload);
      }

      if (res.code === 0) {
        if (options.showToast !== false) Toast.success('保存成功');
        if (isNew && res.data) {
          navigate(`/workflow/designer/${res.data.id}`, { replace: true });
        }
        setDefinition(res.data ?? null);
        return res.data ?? null;
      }
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (isNew || !id || !validateBeforeSave()) return;
    setPublishing(true);
    try {
      const saved = await doSave(buildCurrentMeta(), { showToast: false });
      if (!saved) return;
      const res = await request.post<WorkflowDefinition>(`/api/workflows/definitions/${id}/publish`, {});
      if (res.code === 0) {
        Toast.success('发布成功');
        setDefinition(res.data ?? { ...saved, status: 'published', version: saved.version + 1 });
      }
    } finally {
      setPublishing(false);
    }
  };

  // ─── 缩放 ─────────────────────────────────────────────────────────

  const handleZoomIn = () => setZoom(z => Math.min(z + 10, 200));
  const handleZoomOut = () => setZoom(z => Math.max(z - 10, 50));
  const handleZoomReset = () => setZoom(100);

  // ─── 快捷键：Undo / Redo ──────────────────────────────────────────

  useEffect(() => {
    if (currentStep !== 3) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        history.undo();
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        history.redo();
      }
    };
    globalThis.addEventListener('keydown', handler);
    return () => globalThis.removeEventListener('keydown', handler);
  }, [currentStep, history]);

  // ─── 步骤导航标签 ──────────────────────────────────────────────────

  const STEPS = [
    { step: 1 as const, label: '基础信息' },
    { step: 2 as const, label: '表单设计' },
    { step: 3 as const, label: '流程设计' },
    { step: 4 as const, label: '更多设置' },
  ];

  // ─── 基础信息回调 ─────────────────────────────────────────────────

  const handleMetaFieldChange = useCallback((field: string, value: string) => {
    if (field === 'name') setMetaName(value);
    if (field === 'description') setMetaDesc(value);
  }, []);

  // ─── 渲染 ─────────────────────────────────────────────────────────

  // 已发布流程也允许编辑；保存后后端会自动将 status 转为 draft，需重新发布。

  // 历史版本
  const openHistoryModal = () => {
    if (isNew || !id) return;
    setHistoryModalVisible(true);
  };

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
          title="返回列表"
          onClick={() => navigate('/workflow/definitions')}
        />

        <div className="fd-toolbar__title">
          <Tooltip content={isNew ? '新建流程' : (metaName || definition?.name || '')} position="bottom">
            <Typography.Title heading={6} style={{ margin: 0 }} ellipsis={{ showTooltip: false }}>
              {isNew ? '新建流程' : (metaName || definition?.name || '')}
            </Typography.Title>
          </Tooltip>
        </div>

        {/* 步骤导航 */}
        <div className="fd-steps-nav">
          {STEPS.map(({ step, label }) => (
            <button
              type="button"
              key={step}
              className={`fd-steps-nav__item ${currentStep === step ? 'fd-steps-nav__item--active' : ''}`}
              onClick={() => setCurrentStep(step)}
            >
              <span className="fd-steps-nav__number">{step}</span>
              <span className="fd-steps-nav__label">{label}</span>
            </button>
          ))}
        </div>

        {/* 右侧操作 */}
        <div className="fd-toolbar__actions">
          {currentStep === 2 && formType === 'designer' && (
            <Button
              icon={<Eye size={14} />}
              type="tertiary"
              theme="borderless"
              onClick={() => setPreviewVisible(true)}
            >
              预览
            </Button>
          )}
          <Button
            icon={<Save size={14} />}
            type="primary"
            loading={saving}
            onClick={() => void handleSave()}
          >
            保存
          </Button>
          {definition?.status === 'draft' && (
            <Button
              icon={<Send size={14} />}
              type="primary"
              theme="solid"
              loading={publishing}
              disabled={saving}
              onClick={() => void handlePublish()}
            >
              发布
            </Button>
          )}
        </div>
      </div>

      {/* 步骤 ① 基础信息 */}
      {currentStep === 1 && (
        <BasicInfoPanel
          definition={definition}
          isNew={isNew}
          categoryId={metaCategoryId}
          users={users}
          roles={roles}
          departments={departments}
          initiatorScopeType={metaInitiatorScopeType}
          initiatorScopeIds={metaInitiatorScopeIds}
          onFieldChange={handleMetaFieldChange}
          onCategoryChange={setMetaCategoryId}
          onInitiatorScopeTypeChange={(v) => {
            setMetaInitiatorScopeType(v);
            setMetaInitiatorScopeIds([]);
          }}
          onInitiatorScopeIdsChange={setMetaInitiatorScopeIds}
        />
      )}

      {/* 步骤 ② 表单 */}
      {currentStep === 2 && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ padding: '4px 20px 12px', borderBottom: '1px solid var(--semi-color-border)', marginBottom: 16 }}>
            <Typography.Text strong style={{ marginRight: 16 }}>表单类型</Typography.Text>
            <RadioGroup
              type="button"
              value={formType}
              onChange={(e) => setFormType((e.target as HTMLInputElement).value as WorkflowFormType)}
            >
              {WORKFLOW_FORM_TYPES.map((t) => (
                <Radio key={t} value={t}>{WORKFLOW_FORM_TYPE_LABELS[t]}</Radio>
              ))}
            </RadioGroup>
          </div>
          {formType === 'designer' ? (
            <FormSelectorPanel
              formId={formId}
              formName={definition?.formName}
              onSelect={(form) => {
                setFormId(form?.id ?? null);
                setLocalFormFields(form?.schema?.fields ?? []);
              }}
            />
          ) : (
            <CustomFormConfigPanel value={customForm} onChange={setCustomForm} formType={formType} />
          )}
        </div>
      )}

      {/* 步骤 ③ 流程设计画布 */}
      {currentStep === 3 && (
        <div className="fd-canvas">
          <div className="fd-canvas__toolbar">
            <Button
              icon={<Undo2 size={14} />}
              type="tertiary"
              theme="borderless"
              onClick={history.undo}
              disabled={!history.canUndo}
              title="撤销 (Ctrl+Z)"
            >
              撤销
            </Button>
            <Button
              icon={<Redo2 size={14} />}
              type="tertiary"
              theme="borderless"
              onClick={history.redo}
              disabled={!history.canRedo}
              title="重做 (Ctrl+Shift+Z)"
            >
              重做
            </Button>
            <span className="fd-canvas__toolbar-divider" />
            <Button icon={<Download size={14} />} type="tertiary" theme="borderless" onClick={handleExport}>
              导出
            </Button>
            <Button icon={<Upload size={14} />} type="tertiary" theme="borderless" onClick={handleImport}>
              导入
            </Button>
            {!isNew && (
              <Button icon={<History size={14} />} type="tertiary" theme="borderless" onClick={openHistoryModal}>
                历史版本
              </Button>
            )}
            <span className="fd-canvas__toolbar-divider" />
            <div className="fd-toolbar__zoom">
              <Button icon={<Minus size={14} />} type="tertiary" theme="borderless" size="small" onClick={handleZoomOut} />
              <span>{zoom}%</span>
              <Button icon={<Plus size={14} />} type="tertiary" theme="borderless" size="small" onClick={handleZoomIn} />
              <Button icon={<RotateCcw size={12} />} type="tertiary" theme="borderless" size="small" onClick={handleZoomReset} />
            </div>
          </div>
          <div style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}>
            <FlowRenderer
              process={process}
              onEditNode={handleEditNode}
              onDeleteNode={handleDeleteNode}
              onDuplicateNode={handleDuplicateNode}
              onAddNodeAfter={handleAddNodeAfter}
              onAddNodeInBranch={handleAddNodeInBranch}
              onAddBranch={handleAddBranch}
              onRemoveBranch={handleRemoveBranch}
              onEditBranch={handleEditBranch}
              onMoveBranch={handleMoveBranch}
              formFields={formFields}
            />
          </div>
        </div>
      )}

      {/* 步骤 ④ 更多设置 */}
      {currentStep === 4 && (
        <AdvancedSettingsPanel
          settings={advancedSettings}
          onChange={setAdvancedSettings}
        />
      )}

      {/* 表单预览 */}
      <FormPreview
        visible={previewVisible}
        fields={localFormFields}
        onClose={() => setPreviewVisible(false)}
      />

      {/* 节点配置抽屉 */}
      <NodeConfigDrawer
        visible={drawerVisible}
        node={editingNode}
        users={users}
        roles={roles}
        userGroups={userGroups}
        positions={positions}
        departments={departments}
        formFields={formFields}
        allNodes={collectAllNodes(process.initiator)}
        rejectableAncestorNodes={editingNode ? findAncestorApproverNodes(process.initiator, editingNode.id) : []}
        subProcessOptions={subProcessOptions}
        onSave={handleSaveNode}
        onCancel={() => { setDrawerVisible(false); setEditingNode(null); }}
      />

      {/* 条件规则编辑器 */}
      <ConditionEditor
        visible={conditionEditorVisible}
        branch={editingBranch}
        formFields={formFields}
        users={users}
        roles={roles}
        departments={departments}
        positions={positions}
        onSave={handleSaveBranchConditions}
        onCancel={() => { setConditionEditorVisible(false); setEditingBranch(null); setEditingBranchParent(null); }}
      />

      {/* 路由分支编辑器 */}
      <RouteBranchEditor
        visible={routeEditorVisible}
        branch={editingBranch}
        parentNode={editingBranchParent}
        formFields={formFields}
        onSave={handleSaveRouteBranch}
        onCancel={() => { setRouteEditorVisible(false); setEditingBranch(null); setEditingBranchParent(null); }}
      />

      {/* 历史版本 */}
      {id && !isNew && (
        <WorkflowVersionsModal
          visible={historyModalVisible}
          definitionId={Number(id)}
          currentVersion={definition?.version}
          currentStatus={definition?.status}
          onCancel={() => setHistoryModalVisible(false)}
          onRestored={() => globalThis.location.reload()}
        />
      )}
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
