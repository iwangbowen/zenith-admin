import { useState, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, InputNumber, Select, Space, Tag, Modal, Form, Toast, Typography, SideSheet, List, Empty } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Save, Search } from 'lucide-react';
import type { RuleDecisionTable, RuleEvaluateResult, RuleTestRunResult, RuleHitPolicy, RuleTestCase } from '@zenith/shared';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import DecisionTableEditor from './DecisionTableEditor';
import { buildExpectedValues, buildTestScope, coerceRuleValue, diffCaseOutputs, explainDecisionRows, flattenInputValues, formatRuleValue, generateCaseFromRule, inspectDecisionDraft } from './ruleTableUtils';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import {
  ruleKeys,
  useDeleteRuleDecisionTable,
  useDeleteRuleTestCase,
  usePublishRuleDecisionTable,
  useRollbackRuleDecisionTable,
  useRuleDecisionTableList,
  useRuleExecutions,
  useRuleTestCases,
  useRuleVersionDiff,
  useRuleVersions,
  useRunRuleTestCases,
  useSaveRuleDecisionTable,
  useSaveRuleTestCase,
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
const sample = JSON.stringify;

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
  const [modalVisible, setModalVisible] = useState(false);
  const [editorFullscreen, setEditorFullscreen] = useState(false);
  const [editorHitPolicy, setEditorHitPolicy] = useState<RuleHitPolicy>('first');
  const [editing, setEditing] = useState<RuleDecisionTable | null>(null);
  const [testRow, setTestRow] = useState<RuleDecisionTable | null>(null);
  const [testForm, setTestForm] = useState<Record<string, unknown>>({});
  const [testResult, setTestResult] = useState<RuleEvaluateResult | null>(null);
  const [testScope, setTestScope] = useState<Record<string, unknown>>({});
  const [testExplanations, setTestExplanations] = useState<ReturnType<typeof explainDecisionRows>>([]);
  const [verRow, setVerRow] = useState<RuleDecisionTable | null>(null);
  const [diffVersion, setDiffVersion] = useState<number | null>(null);
  const [caseRow, setCaseRow] = useState<RuleDecisionTable | null>(null);
  const [editingCase, setEditingCase] = useState<RuleTestCase | null>(null);
  const [caseForm, setCaseForm] = useState<{ name: string; inputValues: Record<string, unknown>; expectedValues: Record<string, unknown> }>({ name: '', inputValues: {}, expectedValues: {} });
  const [runRes, setRunRes] = useState<RuleTestRunResult | null>(null);
  const [execRow, setExecRow] = useState<RuleDecisionTable | null>(null);
  const [draft, setDraft] = useState<{ inputs: RuleDecisionTable['inputs']; outputs: RuleDecisionTable['outputs']; rules: RuleDecisionTable['rules'] }>({ inputs: [], outputs: [], rules: [] });
  const formApi = useRef<FormApi | null>(null);

  const listQuery = useRuleDecisionTableList({ page, pageSize, keyword: submittedKeyword || undefined });
  const data = listQuery.data ?? null;
  const versionsQuery = useRuleVersions(verRow?.id, !!verRow);
  const versions = versionsQuery.data ?? [];
  const diffQuery = useRuleVersionDiff(verRow?.id, diffVersion, !!verRow && diffVersion !== null);
  const diff = diffQuery.data ?? null;
  const casesQuery = useRuleTestCases(caseRow?.id, !!caseRow);
  const cases = casesQuery.data ?? [];
  const execsQuery = useRuleExecutions({ tableId: execRow?.id, limit: 50 }, !!execRow);
  const execs = execsQuery.data ?? [];
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
    setEditorHitPolicy('first');
    setDraft({ inputs: [], outputs: [], rules: [] });
    setEditorFullscreen(true);
    setModalVisible(true);
  };
  const openEdit = (r: RuleDecisionTable) => {
    setEditing(r);
    setEditorHitPolicy(r.hitPolicy);
    setDraft({ inputs: r.inputs, outputs: r.outputs, rules: r.rules });
    setEditorFullscreen(true);
    setModalVisible(true);
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
    const payload = { name: v.name, description: v.description ?? null, hitPolicy, ...draft };
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
    Modal.confirm({
    title: `发布「${r.name}」？`, content: warnings.length ? <div><Text type="warning">规则体检有 {warnings.length} 项提醒，发布接口仍会执行用例门禁。</Text><div style={{ marginTop: 8 }}>{renderIssueList(warnings, 6)}</div></div> : '将生成版本快照并置为已发布',
    onOk: async () => { await publishMutation.mutateAsync(r.id); Toast.success('发布成功'); },
  }); };
  const handleDelete = (r: RuleDecisionTable) => { Modal.confirm({
    title: '确定删除？', content: '删除后不可恢复', okButtonProps: { type: 'danger' },
    onOk: async () => { await deleteMutation.mutateAsync(r.id); Toast.success('删除成功'); },
  }); };
  const handleToggle = (r: RuleDecisionTable) => {
    if (r.status === 'disabled') {
      Modal.confirm({
        title: `启用「${r.name}」？`,
        content: r.publishedAt ? '启用后恢复为已发布，运行时按最新发布版本求值' : '该表尚未发布过，启用后恢复为草稿',
        onOk: async () => { await toggleMutation.mutateAsync({ id: r.id, enabled: true }); Toast.success('已启用'); },
      });
      return;
    }
    Modal.confirm({
      title: `停用「${r.name}」？`,
      content: '停用后运行时求值将返回空结果（工作流网关/审批矩阵等引用方按未命中处理）',
      okButtonProps: { type: 'danger' },
      onOk: async () => { await toggleMutation.mutateAsync({ id: r.id, enabled: false }); Toast.success('已停用'); },
    });
  };
  const openTest = (r: RuleDecisionTable) => { setTestRow(r); setTestForm({}); setTestScope({}); setTestResult(null); setTestExplanations([]); };
  const openVersions = (r: RuleDecisionTable) => {
    setVerRow(r); setDiffVersion(null);
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

  const saveCurrentTestAsCase = async () => {
    if (!testRow || !testResult) return;
    const name = prompt('用例名称', `${testRow.name} 手动测试 ${cases.length + 1}`);
    if (!name) return;
    const input = Object.keys(testScope).length ? testScope : buildTestScope(testRow.inputs, testForm);
    await saveCurrentTestAsCaseMutation.mutateAsync({ tableId: testRow.id, values: { name, input, expected: testResult.outputs } });
    Toast.success('已保存为测试用例');
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

  const renderCaseValueInput = (key: string, type: RuleDecisionTable['inputs'][number]['type'], values: Record<string, unknown>, onChange: (next: Record<string, unknown>) => void, placeholder?: string) => {
    const value = values[key];
    if (type === 'number') {
      const n = value == null || value === '' ? undefined : Number(value);
      return <InputNumber size="small" value={Number.isFinite(n) ? n : undefined} onChange={(v) => onChange({ ...values, [key]: v == null || v === '' ? undefined : Number(v) })} placeholder={placeholder} style={{ width: '100%' }} />;
    }
    if (type === 'boolean') {
      const v = value === true || value === 'true' ? 'true' : value === false || value === 'false' ? 'false' : undefined;
      return <Select size="small" value={v} onChange={(next) => onChange({ ...values, [key]: coerceRuleValue(next, 'boolean') })} optionList={[{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }]} showClear placeholder={placeholder} style={{ width: '100%' }} />;
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
                    {renderCaseValueInput(input.key, input.type, caseForm.inputValues, (next) => setCaseForm((prev) => ({ ...prev, inputValues: next })), input.expr)}
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
        {r.dirty && s === 'published' && <Tag size="small" color="orange">改动未发布</Tag>}
      </Space>
    ) },
    createdAtColumn,
    createOperationColumn<RuleDecisionTable>({
      desktopInlineKeys: ['edit', 'publish'],
      actions: (r) => [
        { key: 'test', label: '测试', onClick: () => openTest(r) },
        { key: 'versions', label: '版本', onClick: () => openVersions(r) },
        { key: 'cases', label: '用例', onClick: () => openCases(r) },
        { key: 'audit', label: '审计', onClick: () => openExec(r) },
        { key: 'edit', label: '编辑', hidden: !canEdit, onClick: () => openEdit(r) },
        { key: 'publish', label: '发布', hidden: !canPublish || r.status === 'disabled', onClick: () => handlePublish(r) },
        { key: 'toggle', label: r.status === 'disabled' ? '启用' : '停用', danger: r.status !== 'disabled', hidden: !canPublish, onClick: () => handleToggle(r) },
        { key: 'delete', label: '删除', danger: true, hidden: !canDelete, onClick: () => handleDelete(r) },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="搜索名称" value={draftKeyword} onChange={setDraftKeyword} onEnterPress={() => { setPage(1); setSubmittedKeyword(draftKeyword); void queryClient.invalidateQueries({ queryKey: ruleKeys.decisionTables.lists }); }} showClear style={{ width: 220 }} />
            <Button type="primary" icon={<Search size={14} />} onClick={() => { setPage(1); setSubmittedKeyword(draftKeyword); void queryClient.invalidateQueries({ queryKey: ruleKeys.decisionTables.lists }); }}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { setDraftKeyword(''); setSubmittedKeyword(''); setPage(1); void queryClient.invalidateQueries({ queryKey: ruleKeys.decisionTables.lists }); }}>重置</Button>
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
        <Form key={editing?.id ?? 'new'} getFormApi={(a) => { formApi.current = a; }} labelPosition="left" labelWidth={90}
          initValues={editing ? { key: editing.key, name: editing.name, description: editing.description, hitPolicy: editing.hitPolicy } : { hitPolicy: 'first' }}>
          <Form.Input field="key" label="Key" disabled={!!editing} rules={[{ required: true, message: 'key 必填' }]} placeholder="如 member_level" />
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '名称必填' }]} />
          <Form.Select field="hitPolicy" label="命中策略" optionList={HIT_POLICIES} onChange={(v) => setEditorHitPolicy(v as RuleHitPolicy)} style={{ width: '100%' }} />
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
        <List
          dataSource={versions}
          emptyContent={<Text type="tertiary">暂无已发布版本</Text>}
          renderItem={(v) => (
            <List.Item
              main={<><Text strong>v{v.version}</Text> <Text type="tertiary" size="small">{v.publishedAt}</Text></>}
              extra={<><Button size="small" theme="borderless" onClick={() => showDiff(v.version)}>对比当前</Button><Button size="small" theme="borderless" onClick={() => rollback(v.version)}>回滚</Button></>}
            />
          )}
        />
        {diff && (
          <pre style={{ marginTop: 12, background: 'var(--semi-color-fill-0)', padding: 12, borderRadius: 'var(--semi-border-radius-medium)', whiteSpace: 'pre-wrap' }}>
            {`v${diff.from} → 当前\n` + (diff.changes.length ? diff.changes.map((c) => `[${c.op}] ${c.kind} ${c.ref}: ${c.detail}`).join('\n') : '无差异')}
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
    </div>
  );
}
