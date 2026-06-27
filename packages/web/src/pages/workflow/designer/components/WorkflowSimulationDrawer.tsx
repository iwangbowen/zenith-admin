/**
 * 流程设计器仿真抽屉：收集测试表单数据，并在流程图中呈现 dry-run 运行态。
 */
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { Banner, Button, Select, SideSheet, Space, Switch, Tag, TextArea, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { AlertTriangle, Bookmark, Bug, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, Clock, FastForward, GitCompare, ListChecks, Minus, Pause, Play, Plus, RotateCcw, RotateCw, Save, Send, SlidersHorizontal, Wand2, X, XCircle } from 'lucide-react';
import type { WorkflowFlowData, WorkflowFormField, WorkflowSimulationDecision, WorkflowSimulationHealthIssue, WorkflowSimulationResult } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateForApi, formatDateTimeForApi } from '@/utils/date';
import WorkflowFormRenderer from './WorkflowFormRenderer';
import FlowRenderer from './FlowRenderer';
import type { FlowBranch, FlowNode, FlowProcess, NodeRuntimeInfo } from '../types';

interface UserOption {
  id: number;
  nickname: string;
}

interface WorkflowSimulationDrawerProps {
  visible: boolean;
  definitionId?: number | null;
  flowData: WorkflowFlowData;
  process: FlowProcess;
  formFields: WorkflowFormField[];
  users: UserOption[];
  onClose: () => void;
}

interface SavedSimulationCase {
  id: string;
  name: string;
  createdAt: string;
  starterUserId?: number;
  formData: Record<string, unknown>;
  decisions: WorkflowSimulationDecision[];
}

interface SelectedSimulationBranch {
  id: string;
  name: string;
  branchNodeKeys: string[];
  branchNodeName: string;
  childNodeKeys: string[];
}

const SAVED_CASE_STORAGE_KEY = 'zenith.workflow.simulation.cases';

const RESULT_META: Record<WorkflowSimulationResult['result'], { label: string; color: 'green' | 'red' | 'orange' | 'grey' | 'blue' }> = {
  finished: { label: '已完成', color: 'green' },
  rejected: { label: '已拒绝', color: 'red' },
  waiting: { label: '等待中', color: 'blue' },
  blocked: { label: '已阻塞', color: 'orange' },
  invalid: { label: '配置无效', color: 'red' },
  stepLimit: { label: '超过步数', color: 'orange' },
};

const STATUS_META: Record<WorkflowSimulationResult['timeline'][number]['status'], { label: string; color: string; icon: typeof CheckCircle2 }> = {
  entered: { label: '进入', color: 'var(--semi-color-primary)', icon: Send },
  waiting: { label: '等待', color: 'var(--semi-color-warning)', icon: Clock },
  approved: { label: '通过', color: 'var(--semi-color-success)', icon: CheckCircle2 },
  rejected: { label: '拒绝', color: 'var(--semi-color-danger)', icon: XCircle },
  autoApproved: { label: '自动通过', color: 'var(--semi-color-success)', icon: CheckCircle2 },
  skipped: { label: '跳过', color: 'var(--semi-color-tertiary)', icon: CircleDashed },
  blocked: { label: '阻塞', color: 'var(--semi-color-warning)', icon: AlertTriangle },
};

const HEALTH_META: Record<WorkflowSimulationHealthIssue['level'], { label: string; color: 'red' | 'orange' | 'blue' }> = {
  error: { label: '错误', color: 'red' },
  warning: { label: '风险', color: 'orange' },
  info: { label: '提示', color: 'blue' },
};

/** 画布图例：节点运行态 → 颜色，帮助用户解读流程图配色 */
const SIMULATION_LEGEND: Array<{ label: string; color: string }> = [
  { label: '当前', color: 'var(--semi-color-primary)' },
  { label: '通过', color: 'var(--semi-color-success)' },
  { label: '拒绝', color: 'var(--semi-color-danger)' },
  { label: '等待', color: 'var(--semi-color-warning)' },
  { label: '跳过', color: 'var(--semi-color-tertiary)' },
];

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pickValidationMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (!error || typeof error !== 'object') return '请先补全仿真表单必填项';

  const seen = new Set<unknown>();
  const readMessage = (value: unknown): string | null => {
    if (!value || typeof value !== 'object' || seen.has(value)) return null;
    seen.add(value);
    const record = value as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) return record.message;
    if (Array.isArray(record.errors)) {
      for (const item of record.errors) {
        const message = readMessage(item);
        if (message) return message;
      }
    }
    for (const item of Object.values(record)) {
      if (Array.isArray(item)) {
        for (const child of item) {
          const message = readMessage(child);
          if (message) return message;
        }
      } else {
        const message = readMessage(item);
        if (message) return message;
      }
    }
    return null;
  };

  return readMessage(error) ?? '请先补全仿真表单必填项';
}

function visitFormFields(fields: WorkflowFormField[], visitor: (field: WorkflowFormField) => void): void {
  for (const field of fields) {
    visitor(field);
    if (field.children) visitFormFields(field.children, visitor);
    if (field.columns) field.columns.forEach((col) => visitFormFields(col.fields, visitor));
    if (field.panes) field.panes.forEach((pane) => visitFormFields(pane.fields, visitor));
  }
}

function defaultFormDataFromFields(fields: WorkflowFormField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  visitFormFields(fields, (field) => {
    if (field.defaultValue !== undefined) out[field.key] = field.defaultValue;
  });
  return out;
}

function firstOption(field: WorkflowFormField): string | undefined {
  return field.optionItems?.find((item) => !item.disabled)?.value ?? field.options?.[0];
}

function mockValueForField(field: WorkflowFormField, users: UserOption[]): unknown {
  if (field.defaultValue !== undefined) return field.defaultValue;
  const option = firstOption(field) ?? '选项A';
  const firstUserId = users[0]?.id ?? 1;
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'autoComplete':
    case 'richtext':
      return `测试${field.label}`;
    case 'phone':
      return '13800138000';
    case 'email':
      return 'test@example.com';
    case 'url':
      return 'https://example.com';
    case 'idCard':
      return '110101199001011234';
    case 'password':
    case 'pinCode':
      return '123456';
    case 'number':
    case 'amount':
    case 'slider':
    case 'rate':
    case 'formula':
      return field.min ?? 100;
    case 'date':
      return formatDateForApi(new Date());
    case 'dateRange':
      return [formatDateForApi(new Date()), formatDateForApi(new Date())];
    case 'time':
      return '09:00';
    case 'select':
    case 'radio':
    case 'dictSelect':
      return option;
    case 'multiSelect':
    case 'checkbox':
    case 'tags':
      return [option];
    case 'switch':
      return true;
    case 'colorPicker':
      return '#1677ff';
    case 'userSelect':
      return field.multiple ? [firstUserId] : firstUserId;
    case 'deptSelect':
      return field.multiple ? [1] : 1;
    case 'detail': {
      const row: Record<string, unknown> = {};
      for (const child of field.children ?? []) {
        const value = mockValueForField(child, users);
        if (value !== undefined) row[child.key] = value;
      }
      return Object.keys(row).length > 0 ? [row] : [];
    }
    case 'attachment':
    case 'image':
      return [{ name: '测试附件.pdf', url: 'https://example.com/mock.pdf', size: 1024 }];
    case 'signature':
      return 'data:image/png;base64,simulation-signature';
    case 'relation':
      return null;
    case 'serialNumber':
    case 'description':
    case 'row':
    case 'divider':
    case 'group':
    case 'tabs':
    case 'steps':
      return undefined;
    default:
      return undefined;
  }
}

function generateMockFormData(fields: WorkflowFormField[], users: UserOption[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  visitFormFields(fields, (field) => {
    const value = mockValueForField(field, users);
    if (value !== undefined) out[field.key] = value;
  });
  return out;
}

function readSavedCases(): SavedSimulationCase[] {
  try {
    const raw = localStorage.getItem(SAVED_CASE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedSimulationCase => !!item && typeof item === 'object' && typeof (item as SavedSimulationCase).id === 'string');
  } catch {
    return [];
  }
}

function writeSavedCases(cases: SavedSimulationCase[]): void {
  localStorage.setItem(SAVED_CASE_STORAGE_KEY, JSON.stringify(cases.slice(0, 20)));
}

function buildLocalHealthIssues(flowData: WorkflowFlowData): WorkflowSimulationHealthIssue[] {
  const issues: WorkflowSimulationHealthIssue[] = [];
  const nodeById = new Map(flowData.nodes.map((node) => [node.id, node.data]));
  const inCount = new Map<string, number>();
  const outCount = new Map<string, number>();

  for (const edge of flowData.edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      issues.push({ level: 'error', scope: 'edge', edgeId: edge.id, message: '连线引用了不存在的节点', suggestion: '请删除异常连线后重新连接' });
      continue;
    }
    outCount.set(edge.source, (outCount.get(edge.source) ?? 0) + 1);
    inCount.set(edge.target, (inCount.get(edge.target) ?? 0) + 1);
  }

  if (!flowData.nodes.some((node) => node.data.type === 'start')) {
    issues.push({ level: 'error', scope: 'flow', message: '流程缺少发起节点', suggestion: '请保留一个发起人节点作为入口' });
  }
  if (!flowData.nodes.some((node) => node.data.type === 'end')) {
    issues.push({ level: 'warning', scope: 'flow', message: '流程缺少结束节点', suggestion: '建议补充结束节点，便于判断流程完成' });
  }

  for (const node of flowData.nodes) {
    if (node.data.type !== 'start' && (inCount.get(node.id) ?? 0) === 0) {
      issues.push({ level: node.data.type === 'end' ? 'warning' : 'error', scope: 'node', nodeKey: node.data.key, message: `${node.data.label || node.data.key} 没有上游连线`, suggestion: '请确认该节点是否应接入主流程' });
    }
    if (node.data.type !== 'end' && (outCount.get(node.id) ?? 0) === 0) {
      issues.push({ level: node.data.type === 'start' ? 'error' : 'warning', scope: 'node', nodeKey: node.data.key, message: `${node.data.label || node.data.key} 没有下游连线`, suggestion: '请为该节点连接下一步' });
    }
  }
  return issues;
}

function nodeLabel(flowData: WorkflowFlowData, key?: string): string {
  if (!key) return '-';
  return flowData.nodes.find((node) => node.data.key === key)?.data.label ?? key;
}

function nodeTypeCanDecide(item: WorkflowSimulationResult['timeline'][number] | null | undefined): boolean {
  return !!item && ['approve', 'handler'].includes(String(item.nodeType));
}

function uniquePath(result: WorkflowSimulationResult | null): string[] {
  return result?.pathSignature?.length ? result.pathSignature : (result?.timeline.map((item) => item.nodeKey) ?? []);
}

function pathText(result: WorkflowSimulationResult | null, flowData: WorkflowFlowData): string {
  const keys = uniquePath(result);
  return keys.length ? keys.map((key) => nodeLabel(flowData, key)).join(' -> ') : '暂无路径';
}

function uniqueKeys(...keys: Array<string | null | undefined>): string[] {
  return [...new Set(keys.filter((key): key is string => !!key))];
}

function runtimeNodeKey(node: FlowNode): string {
  if (node.type === 'initiator') return 'start';
  return node.key ?? node.id;
}

function flowDataEntryKeys(node: FlowNode | undefined): string[] {
  if (!node) return [];
  if (node.type === 'initiator') return ['start'];
  return uniqueKeys(node.key, node.id, node.branches?.length ? `fork-${node.id}` : undefined);
}

function branchGatewayKeys(node: FlowNode): string[] {
  return uniqueKeys(node.key, node.id, `fork-${node.id}`);
}

function cssAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function keepNodeVisibleInCanvas(canvas: HTMLElement, target: HTMLElement): void {
  const canvasRect = canvas.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const margin = 48;
  let topDelta = 0;
  let leftDelta = 0;

  if (targetRect.top < canvasRect.top + margin) {
    topDelta = targetRect.top - canvasRect.top - margin;
  } else if (targetRect.bottom > canvasRect.bottom - margin) {
    topDelta = targetRect.bottom - canvasRect.bottom + margin;
  }

  if (targetRect.left < canvasRect.left + margin) {
    leftDelta = targetRect.left - canvasRect.left - margin;
  } else if (targetRect.right > canvasRect.right - margin) {
    leftDelta = targetRect.right - canvasRect.right + margin;
  }

  if (topDelta !== 0 || leftDelta !== 0) {
    canvas.scrollBy({ top: topDelta, left: leftDelta, behavior: 'smooth' });
  }
}

function edgeMatchesSelectedBranch(
  edge: WorkflowSimulationResult['edgeResults'][number],
  selectedBranch: SelectedSimulationBranch,
): boolean {
  if (!edge.sourceKey || !selectedBranch.branchNodeKeys.includes(edge.sourceKey)) return false;
  if (edge.targetKey && selectedBranch.childNodeKeys.includes(edge.targetKey)) return true;
  return edge.label === selectedBranch.name;
}

export default function WorkflowSimulationDrawer({
  visible,
  definitionId,
  flowData,
  process,
  formFields,
  users,
  onClose,
}: Readonly<WorkflowSimulationDrawerProps>) {
  const formApi = useRef<FormApi | null>(null);
  const replayTimer = useRef<number | null>(null);
  const graphCanvasRef = useRef<HTMLDivElement | null>(null);
  const [starterUserId, setStarterUserId] = useState<number | undefined>(undefined);
  const [formData, setFormData] = useState<Record<string, unknown>>(() => defaultFormDataFromFields(formFields));
  const [formRenderKey, setFormRenderKey] = useState(0);
  const [jsonDraft, setJsonDraft] = useState('{}');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<WorkflowSimulationResult | null>(null);
  const [previousResult, setPreviousResult] = useState<WorkflowSimulationResult | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [graphZoom, setGraphZoom] = useState(90);
  const [decisions, setDecisions] = useState<WorkflowSimulationDecision[]>([]);
  const [breakpoints, setBreakpoints] = useState<Set<string>>(new Set());
  const [selectedBranch, setSelectedBranch] = useState<SelectedSimulationBranch | null>(null);
  const [savedCases, setSavedCases] = useState<SavedSimulationCase[]>(() => readSavedCases());
  const [selectedCaseId, setSelectedCaseId] = useState<string | undefined>(undefined);
  const [isPlaying, setIsPlaying] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  useEffect(() => () => {
    if (replayTimer.current !== null) window.clearInterval(replayTimer.current);
  }, []);

  const userOptions = useMemo(
    () => users.map((user) => ({ value: user.id, label: `${user.nickname} (#${user.id})` })),
    [users],
  );
  const savedCaseOptions = useMemo(
    () => savedCases.map((item) => ({ value: item.id, label: `${item.name} · ${item.createdAt}` })),
    [savedCases],
  );
  const localHealthIssues = useMemo(() => buildLocalHealthIssues(flowData), [flowData]);
  const healthIssues = result?.healthIssues?.length ? result.healthIssues : localHealthIssues;
  const totalSteps = result?.timeline.length ?? 0;
  const currentStep = result && totalSteps > 0 ? Math.min(Math.max(activeStep, 1), totalSteps) : 0;
  const currentItem = currentStep > 0 ? result?.timeline[currentStep - 1] : null;
  const progressPercent = totalSteps > 0 ? Math.round((currentStep / totalSteps) * 100) : 0;
  const currentDecision = currentItem ? decisions.find((item) => item.nodeKey === currentItem.nodeKey) : undefined;
  const timelineStepByNodeKey = useMemo(() => {
    const map = new Map<string, number>();
    result?.timeline.forEach((item) => {
      if (!map.has(item.nodeKey)) map.set(item.nodeKey, item.step);
    });
    return map;
  }, [result]);
  useEffect(() => {
    if (!visible || !currentItem) return;
    const canvas = graphCanvasRef.current;
    if (!canvas) return;
    const target = canvas.querySelector<HTMLElement>(`[data-fd-node-key="${cssAttrValue(currentItem.nodeKey)}"]`);
    if (target) keepNodeVisibleInCanvas(canvas, target);
  }, [currentItem?.nodeKey, currentStep, visible]);

  // 键盘快捷键：←/→ 上一步/下一步，空格 播放/暂停（输入态不拦截）
  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true;
      if (typing) return;
      if (!result || totalSteps === 0) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        moveStep(currentStep - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        moveStep(currentStep + 1);
      } else if (event.key === ' ' && tag !== 'BUTTON') {
        event.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, result, totalSteps, currentStep, isPlaying]);

  const currentEdges = useMemo(() => {
    if (!result) return [];
    if (selectedBranch) {
      const selected = result.edgeResults.filter((edge) => edgeMatchesSelectedBranch(edge, selectedBranch));
      if (selected.length > 0) return selected;
      return result.edgeResults.filter((edge) => selectedBranch.branchNodeKeys.includes(edge.sourceKey ?? ''));
    }
    if (!currentItem) return [];
    const outgoing = result.edgeResults.filter((edge) => edge.sourceKey === currentItem.nodeKey);
    if (outgoing.length > 0) return outgoing;
    return result.edgeResults.filter((edge) => edge.targetKey === currentItem.nodeKey || edge.taken);
  }, [currentItem, result, selectedBranch]);
  const pathCompare = useMemo(() => {
    if (!previousResult || !result) return null;
    const before = uniquePath(previousResult);
    const after = uniquePath(result);
    const changedIndex = after.findIndex((key, index) => key !== before[index]);
    return {
      before: pathText(previousResult, flowData),
      after: pathText(result, flowData),
      added: after.filter((key) => !before.includes(key)).map((key) => nodeLabel(flowData, key)),
      removed: before.filter((key) => !after.includes(key)).map((key) => nodeLabel(flowData, key)),
      changedAt: changedIndex >= 0 ? changedIndex + 1 : null,
    };
  }, [flowData, previousResult, result]);

  const stopReplay = () => {
    if (replayTimer.current !== null) {
      window.clearInterval(replayTimer.current);
      replayTimer.current = null;
    }
    setIsPlaying(false);
  };

  const applyFormValues = (values: Record<string, unknown>) => {
    setFormData(values);
    setJsonDraft(JSON.stringify(values, null, 2));
    setFormRenderKey((key) => key + 1);
  };

  const effectiveFormData = async () => {
    if (formFields.length > 0 && formApi.current) {
      try {
        const values = await formApi.current.validate() as Record<string, unknown>;
        return values;
      } catch (err) {
        Toast.warning(pickValidationMessage(err));
        return null;
      }
    }
    const parsed = parseJsonRecord(jsonDraft);
    if (!parsed) {
      Toast.warning('表单数据必须是 JSON 对象');
      return null;
    }
    return parsed;
  };

  const runSimulation = async (
    overrideValues?: Record<string, unknown>,
    overrideDecisions?: WorkflowSimulationDecision[],
    toastText = '仿真已启动',
  ) => {
    const values = overrideValues ?? await effectiveFormData();
    if (!values) return;
    const nextDecisions = overrideDecisions ?? decisions;
    setSubmitting(true);
    stopReplay();
    try {
      const res = await request.post<WorkflowSimulationResult>('/api/workflows/definitions/simulate', {
        definitionId: definitionId ?? undefined,
        flowData,
        formData: values,
        starterUserId,
        decisions: nextDecisions,
        options: {
          maxSteps: 160,
          mockDelay: true,
          mockTrigger: true,
          expandSubProcess: false,
        },
      });
      if (res.code === 0 && res.data) {
        if (result) setPreviousResult(result);
        setResult(res.data);
        setFormData(values);
        setDecisions(nextDecisions);
        setActiveStep(res.data.timeline.length > 0 ? 1 : 0);
        setSelectedBranch(null);
        setInspectorOpen(true);
        Toast.success(toastText);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const resetResult = () => {
    stopReplay();
    setResult(null);
    setPreviousResult(null);
    setActiveStep(0);
    setJsonDraft('{}');
    setDecisions([]);
    setBreakpoints(new Set());
    setSelectedBranch(null);
    setSelectedCaseId(undefined);
    applyFormValues(defaultFormDataFromFields(formFields));
    formApi.current?.reset();
  };

  const moveStep = (nextStep: number) => {
    stopReplay();
    if (!result || totalSteps === 0) {
      setActiveStep(0);
      return;
    }
    setActiveStep(Math.max(1, Math.min(totalSteps, nextStep)));
  };

  const jumpToNode = (node: FlowNode) => {
    const key = runtimeNodeKey(node);
    const step = timelineStepByNodeKey.get(key);
    setSelectedBranch(null);
    if (!result || !step) {
      Toast.info('该节点尚未出现在当前仿真路径中');
      return;
    }
    moveStep(step);
  };

  const toggleBreakpointForNode = (node: FlowNode) => {
    const key = runtimeNodeKey(node);
    setBreakpoints((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        Toast.info('已取消节点断点');
      } else {
        next.add(key);
        Toast.success('已设置节点断点');
      }
      return next;
    });
  };

  const selectBranch = (branch: FlowBranch, branchNode: FlowNode) => {
    setSelectedBranch({
      id: branch.id,
      name: branch.name,
      branchNodeKeys: branchGatewayKeys(branchNode),
      branchNodeName: branchNode.name || '分支',
      childNodeKeys: branch.children ? flowDataEntryKeys(branch.children) : uniqueKeys(`join-${branchNode.id}`),
    });
  };

  const generateTestData = () => {
    const values = formFields.length > 0
      ? generateMockFormData(formFields, users)
      : { amount: 1200, reason: '测试申请', urgent: false };
    applyFormValues(values);
    Toast.success('已生成测试表单数据');
  };

  const upsertDecision = (action: WorkflowSimulationDecision['action']) => {
    if (!currentItem) return;
    const reason = action === 'approve'
      ? '调试器手动通过'
      : action === 'reject'
        ? '调试器手动拒绝'
        : action === 'skip'
          ? '调试器手动跳过'
          : '调试器暂停等待';
    const next = decisions.filter((item) => item.nodeKey !== currentItem.nodeKey);
    next.push({ nodeKey: currentItem.nodeKey, action, reason });
    setDecisions(next);
    void runSimulation(undefined, next, `已按「${reason.replace('调试器手动', '').replace('调试器', '')}」重放仿真`);
  };

  const clearCurrentDecision = () => {
    if (!currentItem) return;
    const next = decisions.filter((item) => item.nodeKey !== currentItem.nodeKey);
    setDecisions(next);
    void runSimulation(undefined, next, '已清除当前节点动作并重放');
  };

  const toggleBreakpoint = () => {
    if (!currentItem) return;
    setBreakpoints((prev) => {
      const next = new Set(prev);
      if (next.has(currentItem.nodeKey)) next.delete(currentItem.nodeKey);
      else next.add(currentItem.nodeKey);
      return next;
    });
  };

  const replay = () => {
    if (!result || totalSteps === 0) return;
    stopReplay();
    let nextStep = currentStep >= totalSteps ? 1 : currentStep;
    setActiveStep(nextStep);
    setIsPlaying(true);
    replayTimer.current = window.setInterval(() => {
      nextStep += 1;
      if (nextStep > totalSteps) {
        stopReplay();
        return;
      }
      setActiveStep(nextStep);
      const item = result.timeline[nextStep - 1];
      if (item && breakpoints.has(item.nodeKey)) stopReplay();
    }, 720);
  };

  const togglePlay = () => {
    if (isPlaying) stopReplay();
    else replay();
  };

  const runToBreakpoint = () => {
    if (!result || totalSteps === 0) return;
    const index = result.timeline.findIndex((item, i) => i + 1 > currentStep && breakpoints.has(item.nodeKey));
    moveStep(index >= 0 ? index + 1 : totalSteps);
  };

  const saveCase = async () => {
    const values = await effectiveFormData();
    if (!values) return;
    const name = window.prompt('请输入用例名称', `仿真用例 ${savedCases.length + 1}`);
    if (!name?.trim()) return;
    const item: SavedSimulationCase = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: name.trim(),
      createdAt: formatDateTimeForApi(new Date()),
      starterUserId,
      formData: values,
      decisions,
    };
    const next = [item, ...savedCases.filter((saved) => saved.name !== item.name)].slice(0, 20);
    setSavedCases(next);
    writeSavedCases(next);
    setSelectedCaseId(item.id);
    Toast.success('仿真用例已保存');
  };

  const loadCase = (caseId: string | number | unknown) => {
    const id = typeof caseId === 'string' ? caseId : undefined;
    setSelectedCaseId(id);
    if (!id) return;
    const item = savedCases.find((saved) => saved.id === id);
    if (!item) return;
    setStarterUserId(item.starterUserId);
    setDecisions(item.decisions);
    applyFormValues(item.formData);
    setResult(null);
    setPreviousResult(null);
    setActiveStep(0);
    setSelectedBranch(null);
    Toast.success('已载入仿真用例');
  };

  const simulationNodeRuntime = useMemo(() => {
    if (!result || currentStep <= 0) return undefined;
    const visibleTimeline = result.timeline.slice(0, currentStep);
    const current = visibleTimeline[visibleTimeline.length - 1];
    const byNode = new Map<string, WorkflowSimulationResult['timeline']>();
    for (const item of visibleTimeline) {
      const arr = byNode.get(item.nodeKey) ?? [];
      arr.push(item);
      byNode.set(item.nodeKey, arr);
    }
    const map = new Map<string, NodeRuntimeInfo>();
    byNode.forEach((items, nodeKey) => {
      const last = items[items.length - 1];
      const active = current?.nodeKey === nodeKey && last.step === current.step;
      let status: NodeRuntimeInfo['status'];
      if (active && !['rejected', 'waiting', 'blocked', 'skipped'].includes(last.status)) status = 'pending';
      else if (last.status === 'rejected') status = 'rejected';
      else if (last.status === 'waiting' || last.status === 'blocked') status = 'waiting';
      else if (last.status === 'skipped') status = 'skipped';
      else status = 'approved';
      const statusLabel = active && !['rejected', 'waiting', 'blocked', 'skipped'].includes(last.status)
        ? '当前步骤'
        : STATUS_META[last.status].label;
      const nodeReason = last.detail ?? last.reason ?? null;
      const nextNodeNames = last.nextNodeKeys?.map((key) => nodeLabel(flowData, key)).filter(Boolean) ?? [];
      const approvers = items
        .flatMap((item) => item.assignees ?? [])
        .map((user) => ({
          name: user.name,
          status,
          actionAt: null,
          comment: active ? nodeReason ?? '当前仿真步骤' : nodeReason,
        }));
      map.set(nodeKey, {
        status,
        active,
        step: last.step,
        totalSteps,
        statusLabel,
        reason: last.reason ?? null,
        detail: last.detail ?? null,
        nextNodeNames,
        approvers: approvers.length > 0
          ? approvers
          : [{ name: active ? '当前步骤' : last.nodeName || '仿真经过', status, actionAt: null, comment: nodeReason }],
      });
    });
    return map;
  }, [currentStep, flowData, result, totalSteps]);

  const simulationDimmedBranchIds = useMemo(() => {
    if (!result || currentStep <= 0) return undefined;
    const visibleNodeKeys = new Set(result.timeline.slice(0, currentStep).map((item) => item.nodeKey));
    const skippedNodeKeys = new Set(
      Object.entries(result.nodeStates)
        .filter(([, state]) => state.status === 'skipped')
        .map(([key]) => key),
    );
    const dimmed = new Set<string>();
    const visit = (node: FlowNode | undefined) => {
      if (!node) return;
      node.branches?.forEach((branch) => {
        const first = branch.children;
        const branchStartKeys = node.branches
          ?.map((item) => item.children ? item.children.key ?? item.children.id : null)
          .filter((key): key is string => !!key) ?? [];
        const hasReachedThisDecision = branchStartKeys.some((key) => visibleNodeKeys.has(key));
        if (first && hasReachedThisDecision && skippedNodeKeys.has(first.key ?? first.id)) dimmed.add(branch.id);
        visit(first);
      });
      visit(node.children);
    };
    visit(process.initiator);
    return dimmed;
  }, [currentStep, process, result]);

  const simulationInstanceStatus = result && currentStep >= totalSteps
    ? result.result === 'finished'
      ? 'approved'
      : result.result === 'rejected'
        ? 'rejected'
        : undefined
    : undefined;

  const resultMeta = result ? RESULT_META[result.result] : null;
  const canDecide = nodeTypeCanDecide(currentItem);
  const currentAssigneeText = currentItem?.assignees?.map((user) => user.name).join('、') || '-';
  const currentNextText = currentItem?.nextNodeKeys?.map((key) => nodeLabel(flowData, key)).join('、') || '-';
  const currentReasonText = currentItem ? currentItem.detail ?? currentItem.reason ?? '' : '';
  const primaryEdge = currentEdges[0];
  const hasBranchNotice = !!selectedBranch || !!pathCompare || !!primaryEdge;

  const renderScrubber = () => {
    if (!result) return null;
    return (
      <div className="fd-simulation-scrubber" role="group" aria-label="步骤时间轴">
        <span className="fd-simulation-scrubber__fill" style={{ width: `${progressPercent}%` }} />
        {result.timeline.map((item, index) => {
          const step = index + 1;
          const meta = STATUS_META[item.status];
          const isCurrent = step === currentStep;
          const visited = step <= currentStep;
          return (
            <button
              key={`${item.nodeKey}-${step}`}
              type="button"
              className={`fd-simulation-scrubber__dot${isCurrent ? ' is-current' : ''}${visited ? ' is-visited' : ''}${breakpoints.has(item.nodeKey) ? ' is-breakpoint' : ''}`}
              style={{ '--dot-color': meta.color } as CSSProperties}
              onClick={() => moveStep(step)}
              aria-current={isCurrent ? 'step' : undefined}
              title={`第 ${step} 步 · ${item.nodeName} · ${meta.label}`}
            />
          );
        })}
      </div>
    );
  };

  const renderTransport = () => {
    if (!result || totalSteps === 0) {
      return (
        <div className="fd-simulation-transport fd-simulation-transport--empty">
          <Button type="primary" icon={<Play size={15} />} loading={submitting} onClick={() => void runSimulation()}>启动仿真</Button>
          <Typography.Text size="small" type="tertiary">填好左侧输入后启动，运行后可逐步播放、预设动作{debugMode ? '、设置断点' : ''}。</Typography.Text>
        </div>
      );
    }
    return (
      <div className="fd-simulation-transport" aria-live="polite">
        <div className="fd-simulation-transport__controls">
          <Tooltip content="上一步 (←)">
            <Button size="small" theme="borderless" icon={<ChevronLeft size={16} />} onClick={() => moveStep(currentStep - 1)} disabled={currentStep <= 1} aria-label="上一步" />
          </Tooltip>
          <Tooltip content={isPlaying ? '暂停 (空格)' : '播放 (空格)'}>
            <Button type="primary" icon={isPlaying ? <Pause size={16} /> : <Play size={16} />} onClick={togglePlay} aria-label={isPlaying ? '暂停' : '播放'} />
          </Tooltip>
          <Tooltip content="下一步 (→)">
            <Button size="small" theme="borderless" icon={<ChevronRight size={16} />} onClick={() => moveStep(currentStep + 1)} disabled={currentStep >= totalSteps} aria-label="下一步" />
          </Tooltip>
        </div>
        <div className="fd-simulation-transport__track">{renderScrubber()}</div>
        <div className="fd-simulation-transport__meta">
          <ListChecks size={14} />
          <Typography.Text strong>第 {currentStep} / {totalSteps} 步</Typography.Text>
          {resultMeta && <Tag size="small" color={resultMeta.color}>{resultMeta.label}</Tag>}
        </div>
        <div className="fd-simulation-transport__right">
          {debugMode && (
            <Tooltip content="运行到下一个断点">
              <Button size="small" type="tertiary" icon={<FastForward size={14} />} onClick={runToBreakpoint} disabled={breakpoints.size === 0}>运行到断点</Button>
            </Tooltip>
          )}
          <Button size="small" icon={<RotateCw size={14} />} loading={submitting} onClick={() => void runSimulation(undefined, undefined, '已重新运行仿真')}>重新运行</Button>
          <Button size="small" type="tertiary" theme="borderless" icon={<RotateCcw size={14} />} onClick={resetResult}>重置</Button>
        </div>
      </div>
    );
  };

  const renderPathChips = () => (
    <div className="fd-simulation-inspector__chips">
      {selectedBranch && (
        <Tag color="blue" closable onClose={() => setSelectedBranch(null)}>分支 · {selectedBranch.branchNodeName} / {selectedBranch.name}</Tag>
      )}
      {pathCompare?.changedAt ? <Tag color="orange">第 {pathCompare.changedAt} 步分叉</Tag> : null}
      {primaryEdge && (
        <Tag color={primaryEdge.taken ? 'green' : 'grey'}>
          {primaryEdge.taken ? '命中' : '未命中'}：{primaryEdge.reason ?? primaryEdge.conditionSummary ?? primaryEdge.label ?? '普通连线'}
        </Tag>
      )}
    </div>
  );

  const renderInspector = () => {
    if (!result || !currentItem) return null;
    if (!inspectorOpen) {
      return (
        <button type="button" className="fd-simulation-inspector-tab" onClick={() => setInspectorOpen(true)} title="展开节点详情">
          <ChevronLeft size={14} />
          <span>详情</span>
        </button>
      );
    }
    const meta = STATUS_META[currentItem.status];
    return (
      <aside className="fd-simulation-inspector" style={{ '--accent': meta.color } as CSSProperties}>
        <header className="fd-simulation-inspector__head">
          <div className="fd-simulation-inspector__head-main">
            <Tag size="small" className="fd-simulation-inspector__status">{meta.label}</Tag>
            <Typography.Text strong ellipsis={{ showTooltip: true }}>{currentItem.nodeName}</Typography.Text>
          </div>
          <div className="fd-simulation-inspector__head-side">
            <Typography.Text size="small" type="tertiary">第 {currentStep}/{totalSteps} 步</Typography.Text>
            <Tooltip content="收起详情">
              <Button size="small" type="tertiary" theme="borderless" icon={<ChevronRight size={14} />} onClick={() => setInspectorOpen(false)} aria-label="收起详情" />
            </Tooltip>
          </div>
        </header>

        <div className="fd-simulation-inspector__grid">
          <span>处理人</span><strong title={currentAssigneeText}>{currentAssigneeText}</strong>
          <span>下一步</span><strong title={currentNextText}>{currentNextText}</strong>
          <span>原因</span><strong title={currentReasonText}>{currentReasonText || '-'}</strong>
        </div>

        {hasBranchNotice && (
          <div className="fd-simulation-inspector__section">
            <div className="fd-simulation-inspector__section-title"><GitCompare size={13} /> 路径与分支</div>
            <div className="fd-simulation-inspector__path" title={pathText(result, flowData)}>{pathText(result, flowData)}</div>
            {renderPathChips()}
          </div>
        )}

        {canDecide && (
          <div className="fd-simulation-inspector__section">
            <div className="fd-simulation-inspector__section-title">节点操作<Typography.Text size="small" type="tertiary">&nbsp;预设人工动作</Typography.Text></div>
            <Space wrap spacing={6}>
              <Button size="small" type={currentDecision?.action === 'approve' ? 'primary' : 'tertiary'} icon={<CheckCircle2 size={13} />} onClick={() => upsertDecision('approve')}>通过</Button>
              <Button size="small" type={currentDecision?.action === 'reject' ? 'danger' : 'tertiary'} icon={<XCircle size={13} />} onClick={() => upsertDecision('reject')}>拒绝</Button>
              <Button size="small" type={currentDecision?.action === 'skip' ? 'primary' : 'tertiary'} icon={<CircleDashed size={13} />} onClick={() => upsertDecision('skip')}>跳过</Button>
              <Button size="small" type={currentDecision?.action === 'wait' ? 'primary' : 'tertiary'} icon={<Pause size={13} />} onClick={() => upsertDecision('wait')}>等待</Button>
              {currentDecision && <Button size="small" theme="borderless" onClick={clearCurrentDecision}>清除</Button>}
            </Space>
          </div>
        )}

        {debugMode && (
          <div className="fd-simulation-inspector__section">
            <div className="fd-simulation-inspector__section-title"><Bug size={13} /> 调试</div>
            <Space wrap spacing={6}>
              <Button size="small" type={breakpoints.has(currentItem.nodeKey) ? 'primary' : 'tertiary'} icon={<Bookmark size={13} />} onClick={toggleBreakpoint}>
                {breakpoints.has(currentItem.nodeKey) ? '取消断点' : '设为断点'}
              </Button>
            </Space>
          </div>
        )}
      </aside>
    );
  };

  return (
    <SideSheet
      title="流程仿真"
      visible={visible}
      placement="right"
      width="96vw"
      onCancel={onClose}
      className="fd-simulation-drawer"
    >
      <div className="fd-simulation-drawer__body">
        <aside className="fd-simulation-panel">
          <section className="fd-simulation-section fd-simulation-section--input">
            <div className="fd-simulation-section__title fd-simulation-section__title--stack">
              <span>仿真输入</span>
              <Space spacing={4} wrap>
                <Button size="small" type="tertiary" icon={<Wand2 size={13} />} onClick={generateTestData}>生成测试数据</Button>
                <Button size="small" type="tertiary" icon={<Save size={13} />} onClick={() => void saveCase()}>保存用例</Button>
              </Space>
            </div>
            <Select
              style={{ width: '100%', marginBottom: 10 }}
              placeholder="默认使用当前登录用户发起"
              showClear
              filter
              optionList={userOptions}
              value={starterUserId}
              onChange={(v) => setStarterUserId(typeof v === 'number' ? v : undefined)}
            />
            <Select
              style={{ width: '100%', marginBottom: 12 }}
              placeholder="载入已保存的仿真用例"
              showClear
              filter
              optionList={savedCaseOptions}
              value={selectedCaseId}
              onChange={loadCase}
            />
            {formFields.length > 0 ? (
              <div className="fd-simulation-form-box">
                <WorkflowFormRenderer
                  key={formRenderKey}
                  fields={formFields}
                  initValues={formData}
                  getFormApi={(api) => { formApi.current = api; }}
                  onValueChange={setFormData}
                  labelPosition="top"
                />
              </div>
            ) : (
              <TextArea value={jsonDraft} onChange={setJsonDraft} rows={8} placeholder={'{\n  "amount": 1200\n}'} />
            )}
            {!result && (
              <Button block type="primary" size="large" icon={<Play size={15} />} loading={submitting} onClick={() => void runSimulation()} className="fd-simulation-run-cta">
                启动仿真
              </Button>
            )}
          </section>

          <section className="fd-simulation-section fd-simulation-section--health">
            <div className="fd-simulation-section__title">
              <span><Bug size={14} /> 体检</span>
              <Tag color={healthIssues.some((item) => item.level === 'error') ? 'red' : healthIssues.length ? 'orange' : 'green'}>
                {healthIssues.length ? `${healthIssues.length} 项` : '通过'}
              </Tag>
            </div>
            {healthIssues.length > 0 ? (
              <div className="fd-simulation-health-list">
                {healthIssues.slice(0, 5).map((item, index) => {
                  const meta = HEALTH_META[item.level];
                  return (
                    <div className="fd-simulation-health-item" key={`${item.scope}-${item.nodeKey ?? item.edgeId ?? index}`}>
                      <Tag size="small" color={meta.color}>{meta.label}</Tag>
                      <div>
                        <Typography.Text size="small">{item.message}</Typography.Text>
                        {item.suggestion && <Typography.Text size="small" type="tertiary">{item.suggestion}</Typography.Text>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Typography.Text size="small" type="tertiary">流程结构未发现阻塞级问题。</Typography.Text>
            )}
          </section>

        </aside>

        <section className="fd-simulation-graph">
          <div className="fd-simulation-graph__toolbar">
            <div className="fd-simulation-graph__title">
              <Typography.Text strong>流程图仿真</Typography.Text>
              {currentItem ? (
                <Typography.Text type="tertiary" size="small">当前：{currentItem.nodeName}</Typography.Text>
              ) : (
                <Typography.Text type="tertiary" size="small">启动后在这里逐步呈现节点状态</Typography.Text>
              )}
            </div>
            <div className="fd-simulation-graph__tools">
              <Tooltip content="开启后显示断点等高级调试功能">
                <label className="fd-simulation-debug-toggle">
                  <SlidersHorizontal size={13} />
                  <span>调试模式</span>
                  <Switch size="small" checked={debugMode} onChange={setDebugMode} />
                </label>
              </Tooltip>
              <div className="fd-toolbar__zoom">
                <Button icon={<Minus size={14} />} type="tertiary" theme="borderless" size="small" onClick={() => setGraphZoom((z) => Math.max(z - 10, 50))} />
                <span>{graphZoom}%</span>
                <Button icon={<Plus size={14} />} type="tertiary" theme="borderless" size="small" onClick={() => setGraphZoom((z) => Math.min(z + 10, 160))} />
                <Button icon={<RotateCcw size={12} />} type="tertiary" theme="borderless" size="small" onClick={() => setGraphZoom(90)} />
              </div>
              <Button size="small" icon={<X size={14} />} onClick={onClose}>关闭</Button>
            </div>
          </div>
          <div className="fd-simulation-graph__status">
            {result?.warnings.length ? (
              <Banner type={result.valid ? 'warning' : 'danger'} description={result.warnings.join('；')} />
            ) : null}
            {renderTransport()}
          </div>
          <div className="fd-simulation-graph__viewport">
            <div className="fd-simulation-graph__canvas" ref={graphCanvasRef}>
              <div style={{ transform: `scale(${graphZoom / 100})`, transformOrigin: 'top center' }}>
                <FlowRenderer
                  process={process}
                  readOnly
                  formFields={formFields}
                  nodeRuntime={simulationNodeRuntime}
                  dimmedBranchIds={simulationDimmedBranchIds}
                  instanceStatus={simulationInstanceStatus}
                  onSimulationNodeClick={jumpToNode}
                  onSimulationNodeContextMenu={debugMode ? toggleBreakpointForNode : undefined}
                  onSimulationBranchClick={selectBranch}
                  selectedSimulationBranchId={selectedBranch?.id}
                  simulationBreakpoints={breakpoints}
                  simulationDebug={debugMode}
                />
              </div>
            </div>
            {result && (
              <div className="fd-simulation-legend" aria-hidden="true">
                {SIMULATION_LEGEND.map((legend) => (
                  <span className="fd-simulation-legend__item" key={legend.label}>
                    <i style={{ background: legend.color }} />
                    {legend.label}
                  </span>
                ))}
              </div>
            )}
            {renderInspector()}
          </div>
        </section>
      </div>
    </SideSheet>
  );
}
