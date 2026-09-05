import { useState } from 'react';
import { Banner, Button, Divider, Input, InputNumber, List, Modal, Select, Space, Tag, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, Trash2 } from 'lucide-react';
import { RULE_DECISION_STATUSES, type RuleScorecard, type RuleScorecardBand, type RuleScorecardEvaluateResult, type RuleScorecardGrade, type RuleScorecardVariable } from '@zenith/shared/rules';
import { enumValueOf } from '@zenith/shared/core';
import { createdAtColumn, renderEllipsis, EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import {
  type RuleScorecardSaveValues,
  useDeleteRuleScorecard, useEvaluateRuleScorecard, usePublishRuleScorecard,
  useRollbackRuleScorecard, useRuleScorecardList, useRuleScorecardVersions,
  useSaveRuleScorecard, useToggleRuleScorecard,
} from '@/hooks/queries/rules-scorecards';

const { Text } = Typography;

const STATUS_META: Record<string, { text: string; color: 'grey' | 'green' | 'red' }> = {
  draft: { text: '草稿', color: 'grey' },
  published: { text: '已发布', color: 'green' },
  disabled: { text: '已停用', color: 'red' },
};
const STATUS_OPTIONS = [
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已发布' },
  { value: 'disabled', label: '已停用' },
];
const BAND_OP_OPTIONS = [
  { value: 'range', label: '数值区间' },
  { value: 'eq', label: '等值' },
  { value: 'in', label: '集合' },
  { value: 'default', label: '兜底' },
];
const VAR_TYPE_OPTIONS = [
  { value: 'number', label: '数值' },
  { value: 'string', label: '文本' },
  { value: 'boolean', label: '布尔' },
];

interface EditorState {
  id?: number;
  key: string;
  name: string;
  description: string;
  baseScore: number;
  variables: RuleScorecardVariable[];
  grades: RuleScorecardGrade[];
  expectedUpdatedAt?: string;
}

const emptyEditor = (): EditorState => ({ key: '', name: '', description: '', baseScore: 0, variables: [], grades: [] });

let bandSeq = 0;
const nextBandId = () => `b${Date.now().toString(36)}${(bandSeq += 1)}`;

/** 规则中心 · 评分卡：变量分段打分 × 权重 + 基础分 → 总分 → 等级/决策映射 */
export default function RuleScorecardsPage() {
  const { hasPermission } = usePermission();
  const canCreate = hasPermission('rule:scorecard:create');
  const canEdit = hasPermission('rule:scorecard:update');
  const canDelete = hasPermission('rule:scorecard:delete');
  const canPublish = hasPermission('rule:scorecard:publish');
  const canEvaluate = hasPermission('rule:scorecard:evaluate');
  const { page, pageSize, setPage, buildPagination } = usePagination();

  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const [draftStatus, setDraftStatus] = useState<string | undefined>(undefined);
  const [submittedStatus, setSubmittedStatus] = useState<string | undefined>(undefined);
  // 编辑器为嵌套动态结构（变量 × 分段 × 等级），不适用 useEditModal 的 Form 模式，走受控状态
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [testTarget, setTestTarget] = useState<RuleScorecard | null>(null);
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState<RuleScorecardEvaluateResult | null>(null);
  const [versionsRow, setVersionsRow] = useState<RuleScorecard | null>(null);

  const listQuery = useRuleScorecardList({
    page, pageSize,
    keyword: submittedKeyword || undefined,
    status: enumValueOf(RULE_DECISION_STATUSES, submittedStatus),
  });
  const data = listQuery.data ?? null;
  const saveMutation = useSaveRuleScorecard();
  const deleteMutation = useDeleteRuleScorecard();
  const publishMutation = usePublishRuleScorecard();
  const toggleMutation = useToggleRuleScorecard();
  const versionsQuery = useRuleScorecardVersions(versionsRow?.id, !!versionsRow);
  const rollbackMutation = useRollbackRuleScorecard();
  const evaluateMutation = useEvaluateRuleScorecard();

  const handleSearch = () => { setPage(1); setSubmittedKeyword(draftKeyword.trim()); setSubmittedStatus(draftStatus); };
  const handleReset = () => { setPage(1); setDraftKeyword(''); setSubmittedKeyword(''); setDraftStatus(undefined); setSubmittedStatus(undefined); };

  const openCreate = () => setEditor(emptyEditor());
  const openEdit = (r: RuleScorecard) => setEditor({
    id: r.id, key: r.key, name: r.name, description: r.description ?? '',
    baseScore: r.baseScore,
    variables: structuredClone(r.variables),
    grades: structuredClone(r.grades),
    expectedUpdatedAt: r.updatedAt,
  });

  const openTest = (r: RuleScorecard) => {
    setTestTarget(r);
    setTestResult(null);
    const sample: Record<string, unknown> = { form: {} };
    for (const v of r.variables) {
      const path = v.expr.split('.');
      if (path.length === 2 && path[0] === 'form') {
        (sample.form as Record<string, unknown>)[path[1]] = v.type === 'number' ? 0 : v.type === 'boolean' ? true : '';
      }
    }
    setTestInput(JSON.stringify(sample, null, 2));
  };

  async function handleSave() {
    if (!editor) return;
    if (!editor.key.trim() && editor.id === undefined) { Toast.warning('请填写 Key'); return; }
    if (!editor.name.trim()) { Toast.warning('请填写名称'); return; }
    const values: RuleScorecardSaveValues = {
      name: editor.name.trim(),
      description: editor.description || null,
      baseScore: editor.baseScore,
      variables: editor.variables,
      grades: editor.grades,
      ...(editor.id !== undefined ? { expectedUpdatedAt: editor.expectedUpdatedAt } : { key: editor.key.trim() }),
    };
    await saveMutation.mutateAsync({ id: editor.id, values });
    Toast.success(editor.id === undefined ? '创建成功' : '保存成功');
    setEditor(null);
  }

  function handlePublish(r: RuleScorecard) {
    Modal.confirm({
      title: `发布「${r.name}」？`,
      content: '发布后固化当前配置为运行时快照，继续编辑不影响线上，直至下次发布。',
      onOk: async () => { await publishMutation.mutateAsync({ params: { id: r.id } }); Toast.success('发布成功'); },
    });
  }
  async function handleRunTest() {
    if (!testTarget) return;
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(testInput || '{}') as Record<string, unknown>;
    } catch {
      Toast.warning('输入不是合法 JSON');
      return;
    }
    setTestResult(await evaluateMutation.mutateAsync({ params: { id: testTarget.id }, body: { input } }));
  }

  // ─── 编辑器结构操作 ─────────────────────────────────────────────────────────
  const patchVariable = (index: number, patch: Partial<RuleScorecardVariable>) =>
    setEditor((e) => e && ({ ...e, variables: e.variables.map((v, i) => (i === index ? { ...v, ...patch } : v)) }));
  const patchBand = (vi: number, bi: number, patch: Partial<RuleScorecardBand>) =>
    setEditor((e) => e && ({
      ...e,
      variables: e.variables.map((v, i) => (i === vi ? { ...v, bands: v.bands.map((b, j) => (j === bi ? { ...b, ...patch } : b)) } : v)),
    }));
  const patchGrade = (index: number, patch: Partial<RuleScorecardGrade>) =>
    setEditor((e) => e && ({ ...e, grades: e.grades.map((g, i) => (i === index ? { ...g, ...patch } : g)) }));

  const columns: ColumnProps<RuleScorecard>[] = [
    { title: 'Key', dataIndex: 'key', width: 170, render: renderEllipsis },
    {
      title: '名称', dataIndex: 'name', width: 210,
      render: (v: string, r) => (
        <Space spacing={4}>
          <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 130 }}>{v}</Text>
          {r.dirty ? <Tag size="small" color="orange">未发布修改</Tag> : null}
        </Space>
      ),
    },
    { title: '基础分', dataIndex: 'baseScore', width: 90, align: 'right' },
    { title: '变量', dataIndex: 'variables', width: 76, align: 'right', render: (v: RuleScorecardVariable[]) => v?.length ?? 0 },
    { title: '等级档', dataIndex: 'grades', width: 84, align: 'right', render: (v: RuleScorecardGrade[]) => v?.length ?? 0 },
    { title: '版本', dataIndex: 'version', width: 70, render: (v: number, r) => (r.publishedAt ? `v${v}` : EMPTY_PLACEHOLDER) },
    { title: '描述', dataIndex: 'description', minWidth: 220, render: renderEllipsis },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right',
      render: (v: string) => <Tag color={STATUS_META[v]?.color}>{STATUS_META[v]?.text ?? v}</Tag>,
    },
    createOperationColumn<RuleScorecard>({
      width: 240,
      desktopInlineKeys: ['edit', 'publish', 'test'],
      actions: (r) => [
        { key: 'edit', label: '编辑', hidden: !canEdit, onClick: () => openEdit(r) },
        { key: 'publish', label: '发布', hidden: !canPublish, onClick: () => handlePublish(r) },
        { key: 'test', label: '测试', hidden: !canEvaluate, onClick: () => openTest(r) },
        { key: 'versions', label: '版本', onClick: () => setVersionsRow(r) },
        {
          key: 'toggle', label: r.status === 'disabled' ? '启用' : '停用', hidden: !canEdit || r.status === 'draft',
          onClick: async () => { await toggleMutation.mutateAsync({ params: { id: r.id }, body: { enabled: r.status === 'disabled' } }); Toast.success('操作成功'); },
        },
        {
          key: 'delete', label: '删除', danger: true, hidden: !canDelete,
          onClick: () => {
            confirmDelete({
              title: `删除评分卡「${r.name}」？`, content: '删除后不可恢复',
              onOk: async () => { await deleteMutation.mutateAsync({ params: { id: r.id } }); Toast.success('删除成功'); },
            });
          },
        },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <KeywordInput placeholder="搜索名称" value={draftKeyword} onChange={setDraftKeyword} onSearch={handleSearch} width={200} />
            <StatusSelect value={draftStatus} onChange={(v) => setDraftStatus(v || undefined)} items={STATUS_OPTIONS} />
            <SearchButton onClick={handleSearch} />
            <ResetButton onClick={handleReset} />
          </>
        )}
        actions={canCreate ? <CreateButton onClick={openCreate} /> : null}
        mobilePrimary={(
          <>
            <KeywordInput placeholder="搜索名称" value={draftKeyword} onChange={setDraftKeyword} onSearch={handleSearch} />
            {canCreate ? <CreateButton onClick={openCreate} /> : null}
          </>
        )}
      />
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无评分卡"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(data?.total ?? 0)}
      />

      {/* 结构化编辑器：基本信息 + 变量分段 + 等级映射 */}
      <AppModal
        title={editor?.id === undefined ? '新增评分卡' : '编辑评分卡'}
        visible={!!editor}
        closeOnEsc
        width={920}
        onCancel={() => setEditor(null)}
        onOk={() => void handleSave()}
        okButtonProps={{ loading: saveMutation.isPending }}
      >
        {editor ? (
          <div style={{ maxHeight: '62vh', overflowY: 'auto', paddingRight: 4 }}>
            <div className="auto-grid" style={{ '--auto-grid-cols': 3 } as React.CSSProperties}>
              <Input prefix="Key" value={editor.key} disabled={editor.id !== undefined} placeholder="如 credit_score"
                onChange={(v) => setEditor((e) => e && { ...e, key: v })} />
              <Input prefix="名称" value={editor.name} placeholder="如 信用评分卡"
                onChange={(v) => setEditor((e) => e && { ...e, name: v })} />
              <InputNumber prefix="基础分" value={editor.baseScore} style={{ width: '100%' }}
                onChange={(v) => setEditor((e) => e && { ...e, baseScore: Number(v) || 0 })} />
            </div>
            <TextArea style={{ marginTop: 8 }} rows={2} maxCount={500} placeholder="描述（选填）"
              value={editor.description} onChange={(v) => setEditor((e) => e && { ...e, description: v })} />

            <Divider align="left" style={{ margin: '14px 0 10px' }}>变量与分段</Divider>
            {editor.variables.map((variable, vi) => (
              <div key={vi} style={{ border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', padding: 10, marginBottom: 10 }}>
                <div className="auto-grid" style={{ '--auto-grid-cols': 6 } as React.CSSProperties}>
                  <Input prefix="key" size="small" value={variable.key} onChange={(v) => patchVariable(vi, { key: v })} />
                  <Input prefix="名称" size="small" value={variable.label} onChange={(v) => patchVariable(vi, { label: v })} />
                  <Input prefix="表达式" size="small" value={variable.expr} placeholder="form.age" onChange={(v) => patchVariable(vi, { expr: v })} />
                  <Select size="small" value={variable.type} optionList={VAR_TYPE_OPTIONS} style={{ width: '100%' }}
                    onChange={(v) => patchVariable(vi, { type: v as RuleScorecardVariable['type'] })} />
                  <InputNumber prefix="权重" size="small" value={variable.weight ?? 1} min={0} style={{ width: '100%' }}
                    onChange={(v) => patchVariable(vi, { weight: Number(v) || 0 })} />
                  <Space spacing={4}>
                    <InputNumber prefix="未中分" size="small" value={variable.missingScore ?? 0} style={{ width: '100%' }}
                      onChange={(v) => patchVariable(vi, { missingScore: Number(v) || 0 })} />
                    <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={13} />} aria-label="删除变量"
                      onClick={() => setEditor((e) => e && ({ ...e, variables: e.variables.filter((_, i) => i !== vi) }))} />
                  </Space>
                </div>
                {variable.bands.map((band, bi) => (
                  <div key={band.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                    <Select size="small" value={band.op} optionList={BAND_OP_OPTIONS} style={{ width: 110 }}
                      onChange={(v) => patchBand(vi, bi, { op: v as RuleScorecardBand['op'] })} />
                    {band.op === 'range' ? (
                      <>
                        <InputNumber size="small" placeholder="下界(含),空=-∞" style={{ width: 140 }} value={band.min ?? undefined}
                          onChange={(v) => patchBand(vi, bi, { min: v === '' || v == null ? null : Number(v) })} />
                        <InputNumber size="small" placeholder="上界(不含),空=+∞" style={{ width: 150 }} value={band.max ?? undefined}
                          onChange={(v) => patchBand(vi, bi, { max: v === '' || v == null ? null : Number(v) })} />
                      </>
                    ) : null}
                    {band.op === 'eq' ? (
                      <Input size="small" placeholder="比较值" style={{ width: 150 }} value={band.value ?? ''}
                        onChange={(v) => patchBand(vi, bi, { value: v })} />
                    ) : null}
                    {band.op === 'in' ? (
                      <Input size="small" placeholder="集合，逗号分隔" style={{ width: 220 }} value={(band.values ?? []).join(',')}
                        onChange={(v) => patchBand(vi, bi, { values: v.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })} />
                    ) : null}
                    <InputNumber size="small" prefix="得分" style={{ width: 120 }} value={band.score}
                      onChange={(v) => patchBand(vi, bi, { score: Number(v) || 0 })} />
                    <Input size="small" placeholder="分段说明(选填)" style={{ width: 150 }} value={band.label ?? ''}
                      onChange={(v) => patchBand(vi, bi, { label: v })} />
                    <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={13} />} aria-label="删除分段"
                      onClick={() => patchVariable(vi, { bands: variable.bands.filter((_, j) => j !== bi) })} />
                  </div>
                ))}
                <Button size="small" theme="borderless" icon={<Plus size={13} />} style={{ marginTop: 6 }}
                  onClick={() => patchVariable(vi, { bands: [...variable.bands, { id: nextBandId(), op: 'range', min: null, max: null, score: 0 }] })}>
                  加分段
                </Button>
              </div>
            ))}
            <Button icon={<Plus size={14} />} onClick={() => setEditor((e) => e && ({
              ...e,
              variables: [...e.variables, { key: `var${e.variables.length + 1}`, label: '', expr: 'form.', type: 'number', weight: 1, bands: [{ id: nextBandId(), op: 'range', min: null, max: null, score: 0 }] }],
            }))}>
              加变量
            </Button>

            <Divider align="left" style={{ margin: '14px 0 10px' }}>等级映射（按 minScore 从高到低匹配）</Divider>
            {editor.grades.map((grade, gi) => (
              <div key={gi} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                <Input size="small" prefix="等级" style={{ width: 140 }} value={grade.grade} onChange={(v) => patchGrade(gi, { grade: v })} />
                <InputNumber size="small" prefix="最低分" style={{ width: 150 }} value={grade.minScore} onChange={(v) => patchGrade(gi, { minScore: Number(v) || 0 })} />
                <Input size="small" prefix="决策" style={{ width: 180 }} placeholder="approve/review/reject" value={grade.decision ?? ''}
                  onChange={(v) => patchGrade(gi, { decision: v || null })} />
                <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={13} />} aria-label="删除等级"
                  onClick={() => setEditor((e) => e && ({ ...e, grades: e.grades.filter((_, i) => i !== gi) }))} />
              </div>
            ))}
            <Button size="small" icon={<Plus size={13} />}
              onClick={() => setEditor((e) => e && ({ ...e, grades: [...e.grades, { grade: '', minScore: 0, decision: null }] }))}>
              加等级
            </Button>
          </div>
        ) : null}
      </AppModal>

      {/* 求值测试 */}
      <AppModal
        title={`测试「${testTarget?.name ?? ''}」（按编辑态求值）`}
        visible={!!testTarget}
        closeOnEsc
        width={720}
        onCancel={() => setTestTarget(null)}
        footer={(
          <Space spacing={8}>
            <Button onClick={() => setTestTarget(null)}>关闭</Button>
            <Button theme="solid" loading={evaluateMutation.isPending} onClick={() => void handleRunTest()}>执行求值</Button>
          </Space>
        )}
      >
        <TextArea rows={7} value={testInput} onChange={setTestInput} placeholder='{"form": {"age": 35}}' style={{ fontFamily: 'monospace' }} />
        {testResult ? (
          <div style={{ marginTop: 12 }}>
            <Banner
              type={testResult.decision === 'reject' ? 'danger' : testResult.decision === 'review' ? 'warning' : 'success'}
              closeIcon={null}
              description={(
                <Space spacing={12}>
                  <Text strong>总分 {testResult.totalScore}</Text>
                  <Text>基础分 {testResult.baseScore}</Text>
                  <Text>等级 {testResult.grade ?? EMPTY_PLACEHOLDER}</Text>
                  <Text>决策 {testResult.decision ?? EMPTY_PLACEHOLDER}</Text>
                </Space>
              )}
            />
            <ConfigurableTable
              bordered
              size="small"
              style={{ marginTop: 10 }}
              rowKey="key"
              columns={[
                { title: '变量', dataIndex: 'label', width: 130, render: (v: string, r: RuleScorecardEvaluateResult['variables'][number]) => renderEllipsis(`${v}（${r.key}）`) },
                { title: '取值', dataIndex: 'raw', width: 100, render: (v: unknown) => renderEllipsis(v == null ? null : String(v)) },
                { title: '命中分段', dataIndex: 'matchedBand', width: 130, render: (v: string | null, r: RuleScorecardEvaluateResult['variables'][number]) => (r.missed ? <Tag size="small" color="orange">未命中</Tag> : renderEllipsis(v)) },
                { title: '得分', dataIndex: 'score', width: 76, align: 'right' },
                { title: '权重', dataIndex: 'weight', width: 76, align: 'right' },
                { title: '加权分', dataIndex: 'weighted', width: 86, align: 'right' },
              ] as ColumnProps<RuleScorecardEvaluateResult['variables'][number]>[]}
              dataSource={testResult.variables}
              pagination={false}
            />
          </div>
        ) : null}
      </AppModal>

      <AppModal
        title={versionsRow ? `版本历史 · ${versionsRow.name}` : '版本历史'}
        visible={!!versionsRow}
        onCancel={() => setVersionsRow(null)}
        footer={null}
        width={460}
      >
        <List
          dataSource={versionsQuery.data ?? []}
          emptyContent="暂无发布版本"
          renderItem={(v) => (
            <List.Item
              main={(
                <Space spacing={8} wrap>
                  <Tag size="small" color="blue">v{v.version}</Tag>
                  <Text type="tertiary" size="small">{v.publishedAt}</Text>
                </Space>
              )}
              extra={canEdit ? (
                <Button
                  size="small"
                  loading={rollbackMutation.isPending}
                  onClick={() => { Modal.confirm({
                    title: `回滚到 v${v.version}？`,
                    content: '历史快照将覆盖当前编辑态并置为草稿；线上继续运行既有发布，重新发布后生效',
                    onOk: async () => {
                      if (!versionsRow) return;
                      await rollbackMutation.mutateAsync({ params: { id: versionsRow.id, version: v.version } });
                      Toast.success('回滚成功');
                      setVersionsRow(null);
                    },
                  }); }}
                >回滚</Button>
              ) : undefined}
            />
          )}
        />
      </AppModal>
    </div>
  );
}
