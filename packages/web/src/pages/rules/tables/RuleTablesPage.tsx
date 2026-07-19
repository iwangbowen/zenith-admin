import { useState, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Input, InputNumber, Select, Space, Tag, Modal, Form, Toast, Typography, SideSheet, List, Empty } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Save, Search, Upload } from 'lucide-react';
import type { RuleDecisionTable, RuleEvaluateResult, RuleTestRunResult, RuleHitPolicy, RuleTestCase, RuleUsageItem, RuleDecisionTableSettings, RuleShadowRunResult } from '@zenith/shared';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import DecisionTableEditor from './DecisionTableEditor';
import { buildExpectedValues, buildTestScope, coerceRuleValue, diffCaseOutputs, explainDecisionRows, flattenInputValues, formatRuleValue, generateCaseFromRule, inspectDecisionDraft } from './ruleTableUtils';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { formatDateTimeForApi } from '@/utils/date';
import {
  fetchRuleUsages,
  ruleKeys,
  useDeleteRuleDecisionTable,
  useDeleteRuleTestCase,
  usePublishRuleDecisionTable,
  useReviewRuleTable,
  useRollbackRuleDecisionTable,
  useRuleDecisionTableList,
  useRuleExecutions,
  useRulePublishApprovalEnabled,
  useRuleTableStats,
  useRuleTestCases,
  useRuleVersionDiff,
  useRuleVersions,
  useRunRuleTestCases,
  useSaveRuleDecisionTable,
  useSaveRuleTestCase,
  useShadowRunRuleTable,
  useSubmitRuleTableReview,
  useTestRuleDecisionTable,
  useToggleRuleDecisionTable,
} from '@/hooks/queries/rules';
import { PUBLISHABLE_STATUS_META as STATUS } from '@/lib/publishable-status';

const { Text } = Typography;

const HIT_POLICIES = [
  { value: 'first', label: '首行命中' },
  { value: 'unique', label: '唯一命中' },
  { value: 'priority', label: '按优先级' },
  { value: 'collect', label: '收集全部' },
  { value: 'any', label: '任意命中' },
];
const COLLECT_AGGREGATES = [
  { value: 'list', label: '列表（默认）' },
  { value: 'sum', label: '求和' },
  { value: 'min', label: '最小值' },
  { value: 'max', label: '最大值' },
  { value: 'count', label: '计数' },
  { value: 'distinct', label: '去重列表' },
];
const sample = JSON.stringify;

/** 导出的决策表定义文件结构（含可选用例） */
interface DecisionTableExport {
  key: string;
  name: string;
  description?: string | null;
  hitPolicy: RuleHitPolicy;
  settings?: RuleDecisionTableSettings;
  inputs: RuleDecisionTable['inputs'];
  outputs: RuleDecisionTable['outputs'];
  rules: RuleDecisionTable['rules'];
  cases?: Array<{ name: string; input: Record<string, unknown>; expected: Record<string, unknown> }>;
}

function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function pickJsonFile(onLoad: (text: string) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onLoad(String(reader.result ?? ''));
    reader.readAsText(file);
  };
  input.click();
}

const csvEscape = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** 字典绑定输入的测试/用例控件（组件封装保证 hooks 数量稳定） */
function DictValueSelect({ dictCode, value, onChange, placeholder, size }: Readonly<{ dictCode: string; value: unknown; onChange: (v: string | undefined) => void; placeholder?: string; size?: 'small' | 'default' }>) {
  const { items } = useDictItems(dictCode);
  return (
    <Select
      size={size}
      value={value == null || value === '' ? undefined : String(value)}
      onChange={(v) => onChange(v == null ? undefined : String(v))}
      optionList={items.map((i) => ({ value: i.value, label: i.label }))}
      showClear
      filter
      placeholder={placeholder}
      style={{ width: '100%' }}
    />
  );
}

export default function RuleTablesPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const canEdit = hasPermission('rule:table:update');
  const canCreate = hasPermission('rule:table:create');
  const canDelete = hasPermission('rule:table:delete');
  const canPublish = hasPermission('rule:table:publish');
  const { page, pageSize, setPage, buildPagination } = usePagination();

  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const [draftStatus, setDraftStatus] = useState<string | undefined>(undefined);
  const [submittedStatus, setSubmittedStatus] = useState<string | undefined>(undefined);
  const [modalVisible, setModalVisible] = useState(false);
  const [editorFullscreen, setEditorFullscreen] = useState(false);
  const [editorHitPolicy, setEditorHitPolicy] = useState<RuleHitPolicy>('first');
  const [editing, setEditing] = useState<RuleDecisionTable | null>(null);
  const [importSeed, setImportSeed] = useState<Partial<DecisionTableExport> | null>(null);
  const [testRow, setTestRow] = useState<RuleDecisionTable | null>(null);
  const [testForm, setTestForm] = useState<Record<string, unknown>>({});
  const [testResult, setTestResult] = useState<RuleEvaluateResult | null>(null);
  const [testScope, setTestScope] = useState<Record<string, unknown>>({});
  const [testExplanations, setTestExplanations] = useState<ReturnType<typeof explainDecisionRows>>([]);
  const [verRow, setVerRow] = useState<RuleDecisionTable | null>(null);
  const [diffVersion, setDiffVersion] = useState<number | null>(null);
  const [diffTarget, setDiffTarget] = useState<number>(0);
  const [statsRow, setStatsRow] = useState<RuleDecisionTable | null>(null);
  const [statsDays, setStatsDays] = useState(30);
  const [shadowRow, setShadowRow] = useState<RuleDecisionTable | null>(null);
  const [shadowResult, setShadowResult] = useState<RuleShadowRunResult | null>(null);
  const [caseRow, setCaseRow] = useState<RuleDecisionTable | null>(null);
  const [editingCase, setEditingCase] = useState<RuleTestCase | null>(null);
  const [caseForm, setCaseForm] = useState<{ name: string; inputValues: Record<string, unknown>; expectedValues: Record<string, unknown> }>({ name: '', inputValues: {}, expectedValues: {} });
  const [runRes, setRunRes] = useState<RuleTestRunResult | null>(null);
  const [execRow, setExecRow] = useState<RuleDecisionTable | null>(null);
  const [draft, setDraft] = useState<{ inputs: RuleDecisionTable['inputs']; outputs: RuleDecisionTable['outputs']; rules: RuleDecisionTable['rules'] }>({ inputs: [], outputs: [], rules: [] });
  const formApi = useRef<FormApi | null>(null);

  const listQuery = useRuleDecisionTableList({ page, pageSize, keyword: submittedKeyword || undefined, status: submittedStatus as 'draft' | 'published' | 'disabled' | undefined });
  const data = listQuery.data ?? null;
  const versionsQuery = useRuleVersions(verRow?.id, !!verRow);
  const versions = versionsQuery.data ?? [];
  const diffQuery = useRuleVersionDiff(verRow?.id, diffVersion, diffTarget, !!verRow && diffVersion !== null);
  const diff = diffQuery.data ?? null;
  const statsQuery = useRuleTableStats(statsRow?.id, statsDays, !!statsRow);
  const stats = statsQuery.data ?? null;
  const casesQuery = useRuleTestCases(caseRow?.id, !!caseRow);
  const cases = casesQuery.data ?? [];
  const execsQuery = useRuleExecutions({ tableId: execRow?.id, page: 1, pageSize: 50 }, !!execRow);
  const execs = execsQuery.data?.list ?? [];
  const saveMutation = useSaveRuleDecisionTable();
  const publishMutation = usePublishRuleDecisionTable();
  const deleteMutation = useDeleteRuleDecisionTable();
  const rollbackMutation = useRollbackRuleDecisionTable();
  const toggleMutation = useToggleRuleDecisionTable();
  const saveCaseMutation = useSaveRuleTestCase();
  const deleteCaseMutation = useDeleteRuleTestCase();
  const runCasesMutation = useRunRuleTestCases();
  const runTestMutation = useTestRuleDecisionTable();
  const runSingleCaseMutation = useTestRuleDecisionTable();
  const saveCurrentTestAsCaseMutation = useSaveRuleTestCase();
  const shadowMutation = useShadowRunRuleTable();
  const submitReviewMutation = useSubmitRuleTableReview();
  const reviewMutation = useReviewRuleTable();
  const approvalEnabledQuery = useRulePublishApprovalEnabled();
  const approvalEnabled = approvalEnabledQuery.data ?? false;
  const canApprove = hasPermission('rule:table:approve');

  const draftIssues = useMemo(() => inspectDecisionDraft(draft, editorHitPolicy), [draft, editorHitPolicy]);
  const draftErrors = draftIssues.filter((issue) => issue.severity === 'error');
  const draftWarnings = draftIssues.filter((issue) => issue.severity === 'warning');

  const renderIssueList = (issues: typeof draftIssues, limit = 5) => (
    <div style={{ display: 'grid', gap: 4 }}>
      {issues.slice(0, limit).map((issue, index) => (
        <Text key={`${issue.severity}-${issue.message}-${index}`} size="small" type={issue.severity === 'error' ? 'danger' : 'warning'}>
          {issue.message}
        </Text>
      ))}
      {issues.length > limit && <Text size="small" type="tertiary">还有 {issues.length - limit} 项未显示</Text>}
    </div>
  );

  const openCreate = () => {
    setEditing(null);
    setImportSeed(null);
    setEditorHitPolicy('first');
    setDraft({ inputs: [], outputs: [], rules: [] });
    setEditorFullscreen(true);
    setModalVisible(true);
  };
  /** 从导入文件或整表复制预填新建弹窗 */
  const openCreateFrom = (seed: Partial<DecisionTableExport>) => {
    setEditing(null);
    setImportSeed(seed);
    setEditorHitPolicy(seed.hitPolicy ?? 'first');
    setDraft({ inputs: seed.inputs ?? [], outputs: seed.outputs ?? [], rules: seed.rules ?? [] });
    setEditorFullscreen(true);
    setModalVisible(true);
  };
  const openEdit = (r: RuleDecisionTable) => {
    setEditing(r);
    setImportSeed(null);
    setEditorHitPolicy(r.hitPolicy);
    setDraft({ inputs: r.inputs, outputs: r.outputs, rules: r.rules });
    setEditorFullscreen(true);
    setModalVisible(true);
  };

  const duplicateTable = (r: RuleDecisionTable) => {
    openCreateFrom({ key: `${r.key}_copy`, name: `${r.name} 副本`, description: r.description, hitPolicy: r.hitPolicy, settings: r.settings, inputs: r.inputs, outputs: r.outputs, rules: r.rules });
  };

  const exportTable = (r: RuleDecisionTable) => {
    const payload: DecisionTableExport = { key: r.key, name: r.name, description: r.description ?? null, hitPolicy: r.hitPolicy, settings: r.settings, inputs: r.inputs, outputs: r.outputs, rules: r.rules };
    downloadFile(`decision-table-${r.key}.json`, JSON.stringify(payload, null, 2), 'application/json');
  };

  const exportTableCsv = (r: RuleDecisionTable) => {
    const header = ['规则名', ...(r.hitPolicy === 'priority' ? ['优先级'] : []), ...r.inputs.map((i) => `条件:${i.label}`), ...r.outputs.map((o) => `输出:${o.label}`)];
    const rows = r.rules.map((row) => [
      row.label ?? row.id,
      ...(r.hitPolicy === 'priority' ? [row.priority ?? 0] : []),
      ...r.inputs.map((_, ci) => row.when[ci] ?? '-'),
      ...r.outputs.map((o) => row.then[o.key] ?? o.default ?? ''),
    ]);
    const csv = '\uFEFF' + [header, ...rows].map((cols) => cols.map(csvEscape).join(',')).join('\n');
    downloadFile(`decision-table-${r.key}.csv`, csv, 'text/csv;charset=utf-8');
  };

  const importTable = () => {
    pickJsonFile((text) => {
      try {
        const parsed = JSON.parse(text) as DecisionTableExport;
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.inputs) || !Array.isArray(parsed.outputs) || !Array.isArray(parsed.rules)) {
          Toast.error('文件格式不正确：缺少 inputs/outputs/rules');
          return;
        }
        openCreateFrom(parsed);
        Toast.info('已载入导入内容，请确认后保存为新决策表');
      } catch {
        Toast.error('JSON 解析失败');
      }
    });
  };

  const exportCases = () => {
    if (!caseRow) return;
    const payload = cases.map((c) => ({ name: c.name, input: c.input, expected: c.expected }));
    downloadFile(`decision-cases-${caseRow.key}.json`, JSON.stringify(payload, null, 2), 'application/json');
  };

  const importCases = () => {
    if (!caseRow) return;
    pickJsonFile(async (text) => {
      try {
        const parsed = JSON.parse(text) as Array<{ name: string; input?: Record<string, unknown>; expected?: Record<string, unknown> }>;
        if (!Array.isArray(parsed)) { Toast.error('文件格式不正确：应为用例数组'); return; }
        let ok = 0, fail = 0;
        for (const item of parsed) {
          if (!item?.name) { fail += 1; continue; }
          try {
            await saveCaseMutation.mutateAsync({ tableId: caseRow.id, values: { name: item.name, input: item.input ?? {}, expected: item.expected ?? {} } });
            ok += 1;
          } catch { fail += 1; }
        }
        Toast.info(`用例导入完成：成功 ${ok} 个${fail ? `，失败 ${fail} 个（可能重名）` : ''}`);
      } catch {
        Toast.error('JSON 解析失败');
      }
    });
  };

  const handleSubmit = async () => {
    const v = await formApi.current?.validate();
    if (!v) return;
    const hitPolicy = (v.hitPolicy ?? editorHitPolicy) as RuleHitPolicy;
    const issues = inspectDecisionDraft(draft, hitPolicy);
    const errors = issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0) {
      Toast.error(`规则体检存在 ${errors.length} 个错误，请修正后再保存`);
      return;
    }
    const settings: RuleDecisionTableSettings = {
      ...(hitPolicy === 'collect' && v.collectAggregate && v.collectAggregate !== 'list' ? { collectAggregate: v.collectAggregate as RuleDecisionTableSettings['collectAggregate'] } : {}),
      ...(v.fallbackToDefaults ? { fallbackToDefaults: true } : {}),
    };
    const payload = { name: v.name, description: v.description ?? null, hitPolicy, settings, ...draft };
    await saveMutation.mutateAsync({
      id: editing?.id,
      values: editing
        ? { ...payload, expectedUpdatedAt: editing.updatedAt }
        : { ...payload, key: v.key },
    });
    Toast.success(editing ? '更新成功' : '创建成功');
    setModalVisible(false); setEditorFullscreen(false);
  };

  const handlePublish = (r: RuleDecisionTable) => {
    const issues = inspectDecisionDraft({ inputs: r.inputs, outputs: r.outputs, rules: r.rules }, r.hitPolicy);
    const errors = issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0) {
      Modal.error({ title: '发布前体检未通过', content: renderIssueList(errors, 8) });
      return;
    }
    const warnings = issues.filter((issue) => issue.severity === 'warning');
    if (approvalEnabled) {
      Modal.confirm({
        title: `申请发布「${r.name}」？`,
        content: <div><Text>已开启发布审批（四眼原则）：提交前将执行全部发布门禁，通过后由审批人批准生效。</Text>{warnings.length > 0 && <div style={{ marginTop: 8 }}>{renderIssueList(warnings, 6)}</div>}</div>,
        onOk: async () => { await submitReviewMutation.mutateAsync(r.id); Toast.success('已提交审批'); },
      });
      return;
    }
    Modal.confirm({
    title: `发布「${r.name}」？`, content: warnings.length ? <div><Text type="warning">规则体检有 {warnings.length} 项提醒，发布接口仍会执行用例门禁。</Text><div style={{ marginTop: 8 }}>{renderIssueList(warnings, 6)}</div></div> : '将生成版本快照并置为已发布',
    onOk: async () => { await publishMutation.mutateAsync(r.id); Toast.success('发布成功'); },
  }); };

  const handleReview = (r: RuleDecisionTable, approve: boolean) => {
    const commentRef = { current: '' };
    Modal.confirm({
      title: approve ? `批准并发布「${r.name}」？` : `驳回「${r.name}」的发布申请？`,
      okButtonProps: approve ? undefined : { type: 'danger' },
      content: (
        <div style={{ display: 'grid', gap: 8 }}>
          <Text type="tertiary" size="small">申请人：用户 #{r.reviewRequestedBy ?? '-'} · {r.reviewRequestedAt ?? '-'}</Text>
          <Input placeholder={approve ? '审批意见（可选）' : '驳回原因'} onChange={(v) => { commentRef.current = v; }} />
        </div>
      ),
      onOk: async () => {
        await reviewMutation.mutateAsync({ id: r.id, approve, comment: commentRef.current });
        Toast.success(approve ? '已批准并发布' : '已驳回');
      },
    });
  };

  const runShadow = async (r: RuleDecisionTable) => {
    setShadowRow(r);
    setShadowResult(null);
    const res = await shadowMutation.mutateAsync({ id: r.id, limit: 100 });
    if (res) setShadowResult(res);
  };
  const renderUsageList = (usages: RuleUsageItem[]) => (
    <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
      {usages.map((u, i) => (
        <Text key={`${u.type}-${u.id}-${i}`} size="small" type="warning">
          {u.type === 'workflow' ? `工作流定义 #${u.id}「${u.name}」（${u.status ?? '-'}）` : u.name}
        </Text>
      ))}
    </div>
  );

  const handleDelete = async (r: RuleDecisionTable) => {
    const usages = await fetchRuleUsages(r.id).catch(() => [] as RuleUsageItem[]);
    if (usages.length > 0) {
      Modal.warning({
        title: `「${r.name}」正在被 ${usages.length} 处引用`,
        content: <div><Text>请先解除以下引用后再删除（服务端会拒绝删除被引用的决策表）：</Text>{renderUsageList(usages)}</div>,
      });
      return;
    }
    Modal.confirm({
      title: '确定删除？', content: '删除后不可恢复', okButtonProps: { type: 'danger' },
      onOk: async () => { await deleteMutation.mutateAsync(r.id); Toast.success('删除成功'); },
    });
  };
  const handleToggle = async (r: RuleDecisionTable) => {
    if (r.status === 'disabled') {
      Modal.confirm({
        title: `启用「${r.name}」？`,
        content: r.publishedAt ? '启用后恢复为已发布，运行时按最新发布版本求值' : '该表尚未发布过，启用后恢复为草稿',
        onOk: async () => { await toggleMutation.mutateAsync({ id: r.id, enabled: true }); Toast.success('已启用'); },
      });
      return;
    }
    const usages = await fetchRuleUsages(r.id).catch(() => [] as RuleUsageItem[]);
    Modal.confirm({
      title: `停用「${r.name}」？`,
      content: (
        <div>
          <Text>停用后运行时求值将返回空结果（引用方按未命中处理）。</Text>
          {usages.length > 0 && <><Text type="warning" style={{ display: 'block', marginTop: 8 }}>该表正被 {usages.length} 处引用，停用将立即影响：</Text>{renderUsageList(usages)}</>}
        </div>
      ),
      okButtonProps: { type: 'danger' },
      onOk: async () => { await toggleMutation.mutateAsync({ id: r.id, enabled: false }); Toast.success('已停用'); },
    });
  };
  const openTest = (r: RuleDecisionTable) => { setTestRow(r); setTestForm({}); setTestScope({}); setTestResult(null); setTestExplanations([]); };
  const openVersions = (r: RuleDecisionTable) => {
    setVerRow(r); setDiffVersion(null); setDiffTarget(0);
  };
  const showDiff = (v: number) => {
    setDiffVersion(v);
  };
  const rollback = (v: number) => Modal.confirm({
    title: `回滚到 v${v}？`, content: '将以该版本快照覆盖当前编辑态并置为草稿',
    onOk: async () => { await rollbackMutation.mutateAsync({ id: verRow!.id, version: v }); Toast.success('回滚成功'); setVerRow(null); },
  });
  const openCases = (r: RuleDecisionTable) => {
    setCaseRow(r); setRunRes(null); setEditingCase(null);
  };
  const resetCaseEditor = (row = caseRow) => {
    if (!row) return;
    setEditingCase(null);
    setCaseForm({
      name: `${row.name} 用例 ${cases.length + 1}`,
      inputValues: Object.fromEntries(row.inputs.map((input) => [input.key, undefined])),
      expectedValues: Object.fromEntries(row.outputs.map((output) => [output.key, output.default ?? undefined])),
    });
  };
  const editCase = (item: RuleTestCase) => {
    if (!caseRow) return;
    setEditingCase(item);
    setCaseForm({
      name: item.name,
      inputValues: flattenInputValues(caseRow.inputs, item.input),
      expectedValues: Object.fromEntries(caseRow.outputs.map((output) => [output.key, item.expected?.[output.key]])),
    });
  };
  const saveCase = async () => {
    if (!caseRow) return;
    if (!caseForm.name.trim()) {
      Toast.warning('请输入用例名称');
      return;
    }
    const payload = {
      name: caseForm.name.trim(),
      input: buildTestScope(caseRow.inputs, caseForm.inputValues),
      expected: buildExpectedValues(caseRow.outputs, caseForm.expectedValues),
    };
    await saveCaseMutation.mutateAsync({ tableId: caseRow.id, caseId: editingCase?.id, values: payload });
    Toast.success(editingCase ? '用例已更新' : '用例已新增');
    setEditingCase(null);
  };
  const duplicateCase = (item: RuleTestCase) => {
    if (!caseRow) return;
    setEditingCase(null);
    setCaseForm({
      name: `${item.name} 副本`,
      inputValues: flattenInputValues(caseRow.inputs, item.input),
      expectedValues: Object.fromEntries(caseRow.outputs.map((output) => [output.key, item.expected?.[output.key]])),
    });
  };
  const generateCaseByRule = (rowIndex: number) => {
    if (!caseRow) return;
    const row = caseRow.rules[rowIndex];
    const generated = generateCaseFromRule(caseRow, row);
    setEditingCase(null);
    setCaseForm({
      name: `${caseRow.name} 行${rowIndex + 1}`,
      inputValues: flattenInputValues(caseRow.inputs, generated.input),
      expectedValues: Object.fromEntries(caseRow.outputs.map((output) => [output.key, generated.expected[output.key]])),
    });
  };
  const runCases = async () => {
    const res = await runCasesMutation.mutateAsync(caseRow!.id);
    setRunRes(res);
  };
  const runSingleCase = async (item: RuleTestCase) => {
    if (!caseRow) return;
    const res = await runSingleCaseMutation.mutateAsync({ tableId: caseRow.id, input: item.input });
    if (res) {
      const pass = sample(res.outputs) === sample(item.expected);
      setRunRes((prev) => {
        const base = prev ?? { total: cases.length, passed: 0, failed: 0, coverage: 0, uncoveredRowIds: caseRow.rules.map((r) => r.id), cases: [] };
        const nextCases = [...base.cases.filter((c) => c.id !== item.id), { id: item.id, name: item.name, pass, expected: item.expected, actual: res.outputs }];
        return { ...base, cases: nextCases, passed: nextCases.filter((c) => c.pass).length, failed: nextCases.filter((c) => !c.pass).length };
      });
      Toast[pass ? 'success' : 'error'](pass ? '单条用例通过' : '单条用例失败');
    }
  };
  const delCase = async (cid: number) => { await deleteCaseMutation.mutateAsync({ tableId: caseRow!.id, caseId: cid }); };
  const openExec = (r: RuleDecisionTable) => {
    setExecRow(r);
  };
  const runTest = async () => {
    const scope = buildTestScope(testRow!.inputs, testForm);
    setTestScope(scope);
    const res = await runTestMutation.mutateAsync({ tableId: testRow!.id, input: scope });
    if (res) {
      setTestResult(res);
      setTestExplanations(explainDecisionRows(testRow!, scope));
    }
  };

  const saveCurrentTestAsCase = () => {
    if (!testRow || !testResult) return;
    const nameRef = { current: `${testRow.name} 手动测试 ${cases.length + 1}` };
    Modal.confirm({
      title: '保存为测试用例',
      content: <Input defaultValue={nameRef.current} onChange={(v) => { nameRef.current = v; }} placeholder="用例名称" />,
      onOk: async () => {
        const name = nameRef.current.trim();
        if (!name) { Toast.warning('请输入用例名称'); return Promise.reject(new Error('empty')); }
        const input = Object.keys(testScope).length ? testScope : buildTestScope(testRow.inputs, testForm);
        await saveCurrentTestAsCaseMutation.mutateAsync({ tableId: testRow.id, values: { name, input, expected: testResult.outputs } });
        Toast.success('已保存为测试用例');
      },
    });
  };

  const renderTestInput = (i: RuleDecisionTable['inputs'][number]) => {
    const value = testForm[i.key];
    if (i.type === 'number') {
      const n = value == null || value === '' ? undefined : Number(value);
      return <InputNumber value={Number.isFinite(n) ? n : undefined} onChange={(v) => setTestForm({ ...testForm, [i.key]: v == null || v === '' ? undefined : Number(v) })} placeholder={i.expr} style={{ flex: 1 }} />;
    }
    if (i.type === 'boolean') {
      const v = value === true || value === 'true' ? 'true' : value === false || value === 'false' ? 'false' : undefined;
      return <Select value={v} onChange={(next) => setTestForm({ ...testForm, [i.key]: coerceRuleValue(next, 'boolean') })} optionList={[{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }]} placeholder={i.expr} style={{ flex: 1 }} />;
    }
    if (i.type === 'date') {
      return (
        <div style={{ flex: 1 }}>
          <DatePicker type="dateTime" value={value == null || value === '' ? undefined : String(value)} onChange={(d) => setTestForm({ ...testForm, [i.key]: d == null ? undefined : formatDateTimeForApi(d as Date) })} placeholder={i.expr} style={{ width: '100%' }} />
        </div>
      );
    }
    if (i.dictCode) {
      return (
        <div style={{ flex: 1 }}>
          <DictValueSelect dictCode={i.dictCode} value={value} onChange={(v) => setTestForm({ ...testForm, [i.key]: v })} placeholder={i.expr} />
        </div>
      );
    }
    return <Input value={value == null ? '' : String(value)} onChange={(v) => setTestForm({ ...testForm, [i.key]: v })} placeholder={i.expr} style={{ flex: 1 }} />;
  };

  const renderTestRulePreview = () => {
    if (!testRow || testRow.rules.length === 0) return null;
    const matchedIds = new Set(testResult?.matchedRowIds ?? []);
    const headStyle = { padding: '7px 8px', borderBottom: '1px solid var(--semi-color-border)', color: 'var(--semi-color-text-2)', fontSize: 12, whiteSpace: 'nowrap', textAlign: 'left' } as const;
    const cellStyle = { padding: '7px 8px', borderBottom: '1px solid var(--semi-color-border)', fontSize: 12, whiteSpace: 'nowrap' } as const;
    return (
      <div style={{ marginTop: 14 }}>
        <Text strong>规则</Text>
        <div style={{ marginTop: 8, overflowX: 'auto', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ ...headStyle, width: 58 }}>行</th>
                {testRow.inputs.map((input) => <th key={input.key} style={headStyle}>{input.label}</th>)}
                {testRow.outputs.map((output) => <th key={output.key} style={headStyle}>{output.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {testRow.rules.map((row, index) => {
                const matched = matchedIds.has(row.id);
                return (
                  <tr key={row.id} style={{ background: matched ? 'var(--semi-color-success-light-default)' : undefined }}>
                    <td style={cellStyle}>
                      <Space spacing={4}>
                        <Tag size="small" color={matched ? 'green' : 'grey'}>行 {index + 1}</Tag>
                        <Text size="small">{row.label || row.id}</Text>
                      </Space>
                    </td>
                    {testRow.inputs.map((input, inputIndex) => <td key={input.key} style={cellStyle}>{row.when[inputIndex] || '-'}</td>)}
                    {testRow.outputs.map((output) => <td key={output.key} style={cellStyle}>{formatRuleValue(row.then[output.key] ?? output.default)}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderCaseValueInput = (key: string, type: RuleDecisionTable['inputs'][number]['type'], values: Record<string, unknown>, onChange: (next: Record<string, unknown>) => void, placeholder?: string, dictCode?: string | null) => {
    const value = values[key];
    if (type === 'number') {
      const n = value == null || value === '' ? undefined : Number(value);
      return <InputNumber size="small" value={Number.isFinite(n) ? n : undefined} onChange={(v) => onChange({ ...values, [key]: v == null || v === '' ? undefined : Number(v) })} placeholder={placeholder} style={{ width: '100%' }} />;
    }
    if (type === 'boolean') {
      const v = value === true || value === 'true' ? 'true' : value === false || value === 'false' ? 'false' : undefined;
      return <Select size="small" value={v} onChange={(next) => onChange({ ...values, [key]: coerceRuleValue(next, 'boolean') })} optionList={[{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }]} showClear placeholder={placeholder} style={{ width: '100%' }} />;
    }
    if (type === 'date') {
      return <DatePicker size="small" type="dateTime" value={value == null || value === '' ? undefined : String(value)} onChange={(d) => onChange({ ...values, [key]: d == null ? undefined : formatDateTimeForApi(d as Date) })} placeholder={placeholder} style={{ width: '100%' }} />;
    }
    if (dictCode) {
      return <DictValueSelect size="small" dictCode={dictCode} value={value} onChange={(v) => onChange({ ...values, [key]: v })} placeholder={placeholder} />;
    }
    return <Input size="small" value={value == null ? '' : String(value)} onChange={(v) => onChange({ ...values, [key]: v })} placeholder={placeholder} style={{ width: '100%' }} />;
  };

  const renderCaseEditor = () => {
    if (!caseRow) return null;
    return (
      <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', padding: 12, marginBottom: 12 }}>
        <Space vertical align="start" style={{ width: '100%' }}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Text strong>{editingCase ? '编辑用例' : '新增用例'}</Text>
            <Button size="small" theme="borderless" onClick={() => resetCaseEditor()}>清空</Button>
          </Space>
          <Input size="small" value={caseForm.name} onChange={(v) => setCaseForm((prev) => ({ ...prev, name: v }))} placeholder="用例名称" style={{ width: '100%' }} />
          <div style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <Text strong size="small">输入</Text>
              <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                {caseRow.inputs.map((input) => (
                  <div key={input.key} style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: 8, alignItems: 'center' }}>
                    <Text size="small" type="tertiary">{input.label}</Text>
                    {renderCaseValueInput(input.key, input.type, caseForm.inputValues, (next) => setCaseForm((prev) => ({ ...prev, inputValues: next })), input.expr, input.dictCode)}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <Text strong size="small">期望输出</Text>
              <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                {caseRow.outputs.map((output) => (
                  <div key={output.key} style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: 8, alignItems: 'center' }}>
                    <Text size="small" type="tertiary">{output.label}</Text>
                    {renderCaseValueInput(output.key, output.type, caseForm.expectedValues, (next) => setCaseForm((prev) => ({ ...prev, expectedValues: next })), output.default == null ? output.key : `默认 ${formatRuleValue(output.default)}`)}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <Space spacing={8}>
            <Button size="small" type="primary" loading={saveCaseMutation.isPending} onClick={saveCase}>{editingCase ? '保存用例' : '新增用例'}</Button>
            {editingCase && <Button size="small" theme="borderless" onClick={() => resetCaseEditor()}>取消编辑</Button>}
          </Space>
        </Space>
      </div>
    );
  };

  const renderCaseResult = (item: RuleTestCase) => {
    const res = runRes?.cases.find((x) => x.id === item.id);
    if (!res) return null;
    const diff = diffCaseOutputs(res);
    return (
      <div style={{ marginTop: 8, padding: 8, background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-medium)' }}>
        <Space spacing={8}>
          <Tag color={res.pass ? 'green' : 'red'}>{res.pass ? '通过' : '失败'}</Tag>
          <Text size="small" type="tertiary">实际输出 / 期望输出</Text>
        </Space>
        <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
          {diff.map((d) => (
            <Text key={d.key} size="small" type={d.equal ? 'tertiary' : 'danger'}>
              {d.key}: 实际 {formatRuleValue(d.actual)} / 期望 {formatRuleValue(d.expected)}
            </Text>
          ))}
        </div>
      </div>
    );
  };

  const columns: ColumnProps<RuleDecisionTable>[] = [
    { title: 'Key', dataIndex: 'key', width: 160, render: (t: string) => <Text code>{t}</Text> },
    { title: '名称', dataIndex: 'name', width: 160, render: renderEllipsis },
    { title: '命中策略', dataIndex: 'hitPolicy', width: 110, render: (p: string) => HIT_POLICIES.find((x) => x.value === p)?.label ?? p },
    { title: '规模', width: 120, render: (_: unknown, r: RuleDecisionTable) => <Text type="tertiary" size="small">{r.inputs.length}入/{r.outputs.length}出/{r.rules.length}行</Text> },
    { title: '版本', dataIndex: 'version', width: 70 },
    { title: '状态', dataIndex: 'status', width: 132, fixed: 'right', render: (s: string, r: RuleDecisionTable) => (
      <Space spacing={4} wrap>
        <Tag color={STATUS[s]?.color as never}>{STATUS[s]?.text ?? s}</Tag>
        {r.reviewStatus === 'pending' && <Tag size="small" color="blue">待审批</Tag>}
        {r.dirty && s === 'published' && r.reviewStatus !== 'pending' && <Tag size="small" color="orange">改动未发布</Tag>}
      </Space>
    ) },
    createdAtColumn,
    createOperationColumn<RuleDecisionTable>({
      desktopInlineKeys: ['edit', 'publish'],
      actions: (r) => [
        { key: 'test', label: '测试', onClick: () => openTest(r) },
        { key: 'versions', label: '版本', onClick: () => openVersions(r) },
        { key: 'cases', label: '用例', onClick: () => openCases(r) },
        { key: 'stats', label: '分析', onClick: () => { setStatsDays(30); setStatsRow(r); } },
        { key: 'shadow', label: '影子对比', onClick: () => void runShadow(r) },
        { key: 'audit', label: '审计', onClick: () => openExec(r) },
        { key: 'edit', label: '编辑', hidden: !canEdit, onClick: () => openEdit(r) },
        { key: 'publish', label: approvalEnabled ? '申请发布' : '发布', hidden: !canPublish || r.status === 'disabled' || r.reviewStatus === 'pending', onClick: () => handlePublish(r) },
        { key: 'approve', label: '批准发布', hidden: !canApprove || r.reviewStatus !== 'pending', onClick: () => handleReview(r, true) },
        { key: 'reject', label: '驳回申请', danger: true, hidden: !canApprove || r.reviewStatus !== 'pending', onClick: () => handleReview(r, false) },
        { key: 'duplicate', label: '复制', hidden: !canCreate, onClick: () => duplicateTable(r) },
        { key: 'export-json', label: '导出 JSON', onClick: () => exportTable(r) },
        { key: 'export-csv', label: '导出 CSV', onClick: () => exportTableCsv(r) },
        { key: 'toggle', label: r.status === 'disabled' ? '启用' : '停用', danger: r.status !== 'disabled', hidden: !canPublish, onClick: () => void handleToggle(r) },
        { key: 'delete', label: '删除', danger: true, hidden: !canDelete, onClick: () => void handleDelete(r) },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="搜索名称" value={draftKeyword} onChange={setDraftKeyword} onEnterPress={() => { setPage(1); setSubmittedKeyword(draftKeyword); setSubmittedStatus(draftStatus); void queryClient.invalidateQueries({ queryKey: ruleKeys.decisionTables.lists }); }} showClear style={{ width: 220 }} />
            <Select placeholder="状态" value={draftStatus} onChange={(v) => setDraftStatus(v as string | undefined)} optionList={[{ value: 'draft', label: '草稿' }, { value: 'published', label: '已发布' }, { value: 'disabled', label: '已禁用' }]} showClear style={{ width: 130 }} />
            <Button type="primary" icon={<Search size={14} />} onClick={() => { setPage(1); setSubmittedKeyword(draftKeyword); setSubmittedStatus(draftStatus); void queryClient.invalidateQueries({ queryKey: ruleKeys.decisionTables.lists }); }}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { setDraftKeyword(''); setSubmittedKeyword(''); setDraftStatus(undefined); setSubmittedStatus(undefined); setPage(1); void queryClient.invalidateQueries({ queryKey: ruleKeys.decisionTables.lists }); }}>重置</Button>
            {canCreate && <Button icon={<Upload size={14} />} onClick={importTable}>导入</Button>}
            {canCreate && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>}
          </>
        )}
      />
      <ConfigurableTable bordered columns={columns} dataSource={data?.list ?? []} loading={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据" pagination={buildPagination(data?.total ?? 0)} />

      <AppModal
        title={editing ? '编辑决策表' : '新增决策表'}
        visible={modalVisible}
        onOk={handleSubmit}
        onCancel={() => { setModalVisible(false); setEditorFullscreen(false); }}
        okButtonProps={{ loading: saveMutation.isPending, disabled: draftErrors.length > 0 }}
        width={1180}
        fullscreen={editorFullscreen}
        onToggleFullscreen={() => setEditorFullscreen((v) => !v)}
        bodyStyle={{ maxHeight: editorFullscreen ? 'calc(100vh - 132px)' : '78vh', overflowY: 'auto' }}
        closeOnEsc
      >
        <Form key={editing?.id ?? (importSeed ? `import-${importSeed.key ?? 'new'}` : 'new')} getFormApi={(a) => { formApi.current = a; }} labelPosition="left" labelWidth={90}
          initValues={editing
            ? { key: editing.key, name: editing.name, description: editing.description, hitPolicy: editing.hitPolicy, collectAggregate: editing.settings?.collectAggregate ?? 'list', fallbackToDefaults: !!editing.settings?.fallbackToDefaults }
            : { key: importSeed?.key, name: importSeed?.name, description: importSeed?.description, hitPolicy: importSeed?.hitPolicy ?? 'first', collectAggregate: importSeed?.settings?.collectAggregate ?? 'list', fallbackToDefaults: !!importSeed?.settings?.fallbackToDefaults }}>
          <Form.Input field="key" label="Key" disabled={!!editing} rules={[{ required: true, message: 'key 必填' }]} placeholder="如 member_level" />
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '名称必填' }]} />
          <Form.Select field="hitPolicy" label="命中策略" optionList={HIT_POLICIES} onChange={(v) => setEditorHitPolicy(v as RuleHitPolicy)} style={{ width: '100%' }} />
          {editorHitPolicy === 'collect' && (
            <Form.Select field="collectAggregate" label="聚合方式" optionList={COLLECT_AGGREGATES} style={{ width: '100%' }} extraText="collect 策略下多行命中的输出聚合方式；数值聚合仅对数值输出列有意义" />
          )}
          <Form.Switch field="fallbackToDefaults" label="未命中回退" extraText="开启后未命中任何规则时返回各输出列默认值（matched 仍为 false）" />
          <Form.TextArea field="description" label="描述" autosize={{ minRows: 2, maxRows: 3 }} maxCount={500} />
        </Form>
        <div style={{ marginTop: 12, padding: 12, borderRadius: 'var(--semi-border-radius-medium)', background: draftErrors.length > 0 ? 'var(--semi-color-danger-light-default)' : draftWarnings.length > 0 ? 'var(--semi-color-warning-light-default)' : 'var(--semi-color-success-light-default)' }}>
          <Space spacing={8} align="start" vertical style={{ width: '100%' }}>
            <Space spacing={8}>
              <Tag color={draftErrors.length > 0 ? 'red' : draftWarnings.length > 0 ? 'orange' : 'green'}>规则体检</Tag>
              <Text size="small">{draftErrors.length > 0 ? `${draftErrors.length} 个错误` : draftWarnings.length > 0 ? `${draftWarnings.length} 项提醒` : '未发现明显问题'}</Text>
            </Space>
            {draftErrors.length > 0 ? renderIssueList(draftErrors) : draftWarnings.length > 0 ? renderIssueList(draftWarnings) : null}
          </Space>
        </div>
        <div style={{ marginTop: 16 }}>
          <DecisionTableEditor inputs={draft.inputs} outputs={draft.outputs} rules={draft.rules} hitPolicy={editorHitPolicy} onChange={setDraft} />
        </div>
      </AppModal>

      <AppModal title={`测试求值 · ${testRow?.name ?? ''}`} visible={!!testRow} onOk={runTest} okText="运行" onCancel={() => setTestRow(null)} width={760} closeOnEsc>
        {(testRow?.inputs ?? []).length === 0
          ? <Text type="tertiary">该表无输入列，无法测试</Text>
          : (testRow?.inputs ?? []).map((i) => (
            <div key={i.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Text style={{ width: 120, textAlign: 'right' }}>{i.label}<Text type="tertiary" size="small">（{i.type}）</Text></Text>
              {renderTestInput(i)}
            </div>
          ))}
        {renderTestRulePreview()}
        {testResult && (
          <div style={{ marginTop: 12, background: 'var(--semi-color-fill-0)', padding: 12, borderRadius: 'var(--semi-border-radius-medium)' }}>
            <Space spacing={8} align="center">
              <Tag color={testResult.matched ? 'green' : 'red'}>
                {testResult.matched ? '命中' : testResult.reason === 'unique_conflict' ? '唯一命中冲突' : testResult.reason === 'any_conflict' ? '输出不一致' : '未命中'}
              </Tag>
              {testResult.matched && testResult.hitPolicy === 'collect' && <Tag color="blue" size="small">聚合 {testRow?.settings?.collectAggregate ?? 'list'}</Tag>}
              {testResult.usedFallback && <Tag color="orange" size="small">已回退默认值</Tag>}
              {testResult.matched && <Text type="tertiary" size="small">命中行 {testResult.matchedRowIds.join(', ')}</Text>}
              {!testResult.matched && testResult.reason === 'unique_conflict' && <Text type="danger" size="small">unique 策略要求唯一命中，实际命中多行：{testResult.matchedRowIds.join(', ')}</Text>}
              {!testResult.matched && testResult.reason === 'any_conflict' && <Text type="danger" size="small">any 策略要求多命中行输出一致，冲突行：{testResult.matchedRowIds.join(', ')}</Text>}
              <Button size="small" theme="borderless" icon={<Save size={14} />} loading={saveCurrentTestAsCaseMutation.isPending} onClick={saveCurrentTestAsCase}>保存为用例</Button>
            </Space>
            <pre style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{sample(testResult.outputs, null, 2)}</pre>
            {testExplanations.length > 0 && (
              <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                <Text strong>命中解释</Text>
                {testExplanations.map((row) => (
                  <div key={row.rowId} style={{ padding: 8, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', background: row.matched ? 'var(--semi-color-success-light-default)' : 'var(--semi-color-bg-0)' }}>
                    <Space spacing={8} align="center">
                      <Tag color={row.matched ? 'green' : 'grey'}>行 {row.index + 1}</Tag>
                      <Text size="small">{row.label || row.rowId}</Text>
                    </Space>
                    <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
                      {row.cells.map((cell) => (
                        <Text key={`${row.rowId}-${cell.inputKey}`} size="small" type={cell.matched ? 'tertiary' : 'danger'}>
                          {cell.label}: {cell.condition || '-'} · 输入 {formatRuleValue(cell.value)} · {cell.detail}
                        </Text>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </AppModal>

      <SideSheet title={`版本历史 · ${verRow?.name ?? ''}`} visible={!!verRow} onCancel={() => setVerRow(null)} width={480}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <Text type="tertiary" size="small">对比</Text>
          <Select
            size="small"
            placeholder="基准版本"
            value={diffVersion ?? undefined}
            onChange={(v) => setDiffVersion(v as number)}
            optionList={versions.map((v) => ({ value: v.version, label: `v${v.version}` }))}
            style={{ width: 110 }}
          />
          <Text type="tertiary" size="small">→</Text>
          <Select
            size="small"
            value={diffTarget}
            onChange={(v) => setDiffTarget(v as number)}
            optionList={[{ value: 0, label: '当前编辑态' }, ...versions.map((v) => ({ value: v.version, label: `v${v.version}` }))]}
            style={{ width: 130 }}
          />
        </div>
        <List
          dataSource={versions}
          emptyContent={<Text type="tertiary">暂无已发布版本</Text>}
          renderItem={(v) => (
            <List.Item
              main={<><Text strong>v{v.version}</Text> <Text type="tertiary" size="small">{v.publishedAt}</Text></>}
              extra={<><Button size="small" theme="borderless" onClick={() => { setDiffTarget(0); showDiff(v.version); }}>对比当前</Button><Button size="small" theme="borderless" onClick={() => rollback(v.version)}>回滚</Button></>}
            />
          )}
        />
        {diff && (
          <pre style={{ marginTop: 12, background: 'var(--semi-color-fill-0)', padding: 12, borderRadius: 'var(--semi-border-radius-medium)', whiteSpace: 'pre-wrap' }}>
            {`v${diff.from} → ${diff.to === 0 ? '当前' : `v${diff.to}`}\n` + (diff.changes.length ? diff.changes.map((c) => `[${c.op}] ${c.kind} ${c.ref}: ${c.detail}`).join('\n') : '无差异')}
          </pre>
        )}
      </SideSheet>

      <SideSheet title={`测试矩阵 · ${caseRow?.name ?? ''}`} visible={!!caseRow} onCancel={() => setCaseRow(null)} width={720}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <Button size="small" onClick={() => resetCaseEditor()}>新增用例</Button>
          <Select
            size="small"
            placeholder="按规则行生成"
            style={{ width: 150 }}
            optionList={(caseRow?.rules ?? []).map((row, index) => ({ value: String(index), label: `行 ${index + 1} ${row.label ?? row.id}` }))}
            onChange={(v) => generateCaseByRule(Number(v))}
          />
          <Button size="small" onClick={importCases}>导入用例</Button>
          <Button size="small" onClick={exportCases} disabled={cases.length === 0}>导出用例</Button>
          <Button size="small" type="primary" onClick={runCases}>运行全部</Button>
        </div>
        {renderCaseEditor()}
        {runRes && (
          <div style={{ marginBottom: 12, background: 'var(--semi-color-fill-0)', padding: 12, borderRadius: 'var(--semi-border-radius-medium)' }}>
            <Space spacing={8}>
              <Tag color={runRes.failed > 0 ? 'red' : 'green'}>通过 {runRes.passed}/{runRes.total}</Tag>
              <Tag color={runRes.coverage < 100 ? 'orange' : 'green'}>覆盖率 {runRes.coverage}%</Tag>
            </Space>
            {runRes.uncoveredRowIds.length > 0 && <Text size="small" type="warning" style={{ display: 'block', marginTop: 6 }}>未覆盖行: {runRes.uncoveredRowIds.join(', ')}</Text>}
          </div>
        )}
        {cases.length === 0 ? (
          <Empty description="暂无用例" />
        ) : (
          <List
            dataSource={cases}
            renderItem={(c) => (
              <List.Item
                main={(
                  <div>
                    <Space spacing={8}>
                      <Text strong>{c.name}</Text>
                      {runRes?.cases.find((x) => x.id === c.id) && <Tag color={runRes.cases.find((x) => x.id === c.id)?.pass ? 'green' : 'red'}>{runRes.cases.find((x) => x.id === c.id)?.pass ? '通过' : '失败'}</Tag>}
                    </Space>
                    <Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>输入 {sample(c.input)} · 期望 {sample(c.expected)}</Text>
                    {renderCaseResult(c)}
                  </div>
                )}
                extra={(
                  <Space spacing={2}>
                    <Button size="small" theme="borderless" onClick={() => editCase(c)}>编辑</Button>
                    <Button size="small" theme="borderless" onClick={() => duplicateCase(c)}>复制</Button>
                    <Button size="small" theme="borderless" onClick={() => runSingleCase(c)}>运行</Button>
                    <Button size="small" theme="borderless" type="danger" onClick={() => delCase(c.id)}>删除</Button>
                  </Space>
                )}
              />
            )}
          />
        )}
      </SideSheet>

      <SideSheet title={`决策审计 · ${execRow?.name ?? ''}`} visible={!!execRow} onCancel={() => setExecRow(null)} width={560}>
        <List
          dataSource={execs}
          emptyContent={<Text type="tertiary">暂无执行记录</Text>}
          renderItem={(e) => (
            <List.Item
              main={<>
                <Text strong>{e.matched ? '命中' : '未命中'}</Text> <Tag size="small">{e.source}</Tag> {e.instanceId ? <Text type="tertiary" size="small">实例#{e.instanceId}{e.nodeKey ? `·${e.nodeKey}` : ''}</Text> : null}
                <Text type="tertiary" size="small" style={{ display: 'block' }}>{e.createdAt} · 行 {e.matchedRowIds.join(',') || '-'}</Text>
                <Text size="small" style={{ display: 'block' }}>out: {JSON.stringify(e.outputs)}</Text>
              </>}
            />
          )}
        />
      </SideSheet>

      <SideSheet title={`命中分析 · ${statsRow?.name ?? ''}`} visible={!!statsRow} onCancel={() => setStatsRow(null)} width={620}>
        <Space spacing={8} align="center" style={{ marginBottom: 12 }}>
          <Text type="tertiary" size="small">统计周期</Text>
          <Select size="small" value={statsDays} onChange={(v) => setStatsDays(Number(v))} optionList={[{ value: 7, label: '近 7 天' }, { value: 30, label: '近 30 天' }, { value: 90, label: '近 90 天' }]} style={{ width: 110 }} />
        </Space>
        {stats && (
          <div style={{ display: 'grid', gap: 16 }}>
            <Space spacing={12} wrap>
              <Tag size="large">求值 {stats.total}</Tag>
              <Tag size="large" color="green">命中 {stats.matched}</Tag>
              <Tag size="large" color="red">未命中 {stats.unmatched}</Tag>
              <Tag size="large" color={stats.total > 0 && stats.unmatched / stats.total > 0.2 ? 'orange' : 'blue'}>
                命中率 {stats.total > 0 ? Math.round((stats.matched / stats.total) * 100) : 0}%
              </Tag>
            </Space>
            <div>
              <Text strong size="small">规则行命中分布</Text>
              {stats.rowHits.length === 0 ? <Text type="tertiary" size="small" style={{ display: 'block', marginTop: 6 }}>暂无命中数据</Text> : (
                <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                  {stats.rowHits.map((h) => {
                    const max = stats.rowHits[0]?.count || 1;
                    const rowLabel = statsRow?.rules.find((x) => x.id === h.rowId)?.label;
                    return (
                      <div key={h.rowId} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 56px', gap: 8, alignItems: 'center' }}>
                        <Text size="small" ellipsis={{ showTooltip: true }}>{rowLabel || h.rowId}</Text>
                        <div style={{ height: 10, background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-small)', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.max(4, Math.round((h.count / max) * 100))}%`, height: '100%', background: 'var(--semi-color-primary)' }} />
                        </div>
                        <Text type="tertiary" size="small">{h.count}</Text>
                      </div>
                    );
                  })}
                </div>
              )}
              {statsRow && stats.rowHits.length > 0 && (() => {
                const hitIds = new Set(stats.rowHits.map((h) => h.rowId));
                const deadRows = statsRow.rules.filter((x) => !hitIds.has(x.id));
                return deadRows.length > 0
                  ? <Text type="warning" size="small" style={{ display: 'block', marginTop: 8 }}>周期内零命中行：{deadRows.map((x, i) => x.label || `行${i + 1}(${x.id})`).join('、')}（可评估精简）</Text>
                  : null;
              })()}
            </div>
            <div>
              <Text strong size="small">按日趋势</Text>
              {stats.byDay.length === 0 ? <Text type="tertiary" size="small" style={{ display: 'block', marginTop: 6 }}>暂无数据</Text> : (
                <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
                  {stats.byDay.map((d) => {
                    const max = Math.max(...stats.byDay.map((x) => x.total), 1);
                    return (
                      <div key={d.date} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 90px', gap: 8, alignItems: 'center' }}>
                        <Text type="tertiary" size="small">{d.date}</Text>
                        <div style={{ height: 8, background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-small)', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.round((d.total / max) * 100)}%`, height: '100%', background: 'var(--semi-color-success)' }} />
                        </div>
                        <Text type="tertiary" size="small">{d.matched}/{d.total} 命中</Text>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div>
              <Text strong size="small">来源分布</Text>
              <Space spacing={8} style={{ marginTop: 6 }} wrap>
                {stats.bySource.length === 0 ? <Text type="tertiary" size="small">暂无数据</Text> : stats.bySource.map((s) => (
                  <Tag key={s.source} size="small">{s.source}: {s.count}</Tag>
                ))}
              </Space>
            </div>
          </div>
        )}
      </SideSheet>

      <SideSheet title={`影子对比 · ${shadowRow?.name ?? ''}`} visible={!!shadowRow} onCancel={() => setShadowRow(null)} width={640}>
        <Text type="tertiary" size="small">以最近执行记录的输入重放当前编辑态，评估「若现在发布」的行为差异（不影响线上）。</Text>
        {shadowMutation.isPending && <Text type="tertiary" size="small" style={{ display: 'block', marginTop: 12 }}>正在重放…</Text>}
        {shadowResult && (
          <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
            <Space spacing={8}>
              <Tag size="large">重放 {shadowResult.total}</Tag>
              <Tag size="large" color="green">一致 {shadowResult.same}</Tag>
              <Tag size="large" color={shadowResult.changed > 0 ? 'red' : 'green'}>差异 {shadowResult.changed}</Tag>
            </Space>
            {shadowResult.total === 0 && <Text type="tertiary" size="small">暂无历史执行记录可重放，可先在线上运行一段时间或手动测试后再对比。</Text>}
            {shadowResult.changed > 0 && (
              <>
                <Text strong size="small">差异样本（最多 20 条）</Text>
                <List
                  dataSource={shadowResult.samples}
                  renderItem={(s) => (
                    <List.Item
                      main={(
                        <div style={{ display: 'grid', gap: 4 }}>
                          <Space spacing={8}>
                            <Text type="tertiary" size="small">执行 #{s.executionId}</Text>
                            <Tag size="small" color={s.beforeMatched ? 'green' : 'grey'}>线上{s.beforeMatched ? '命中' : '未命中'}</Tag>
                            <Tag size="small" color={s.afterMatched ? 'green' : 'grey'}>编辑态{s.afterMatched ? '命中' : '未命中'}</Tag>
                          </Space>
                          <Text size="small" type="tertiary">in: {sample(s.input)}</Text>
                          <Text size="small">线上: {sample(s.before)}</Text>
                          <Text size="small" type="danger">编辑态: {sample(s.after)}</Text>
                        </div>
                      )}
                    />
                  )}
                />
              </>
            )}
          </div>
        )}
      </SideSheet>
    </div>
  );
}
