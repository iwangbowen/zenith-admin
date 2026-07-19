import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, List, Modal, Select, SideSheet, Space, Tag, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ChevronDown, ChevronUp, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import type { RuleDecisionFlow, RuleFlowEvaluateResult, RuleFlowStep } from '@zenith/shared';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useWorkflowDesignerDecisionTableOptions } from '@/hooks/queries/workflow-designer';
import {
  ruleKeys,
  useDeleteRuleFlow,
  usePublishRuleFlow,
  useRuleFlowList,
  useSaveRuleFlow,
  useTestRuleFlow,
  useToggleRuleFlow,
} from '@/hooks/queries/rules';
import { PUBLISHABLE_STATUS_META as STATUS } from '@/lib/publishable-status';

const { Text } = Typography;

let sid = 0;
const newStepId = () => `s${Date.now()}_${sid++}`;

/** 规则中心 · 决策流：多决策表顺序编排（前序输出并入 scope 供后续步骤引用） */
export default function RuleFlowsPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const canCreate = hasPermission('rule:flow:create');
  const canEdit = hasPermission('rule:flow:update');
  const canDelete = hasPermission('rule:flow:delete');
  const canPublish = hasPermission('rule:flow:publish');
  const { page, pageSize, setPage, buildPagination } = usePagination();

  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<RuleDecisionFlow | null>(null);
  const [steps, setSteps] = useState<RuleFlowStep[]>([]);
  const [testRow, setTestRow] = useState<RuleDecisionFlow | null>(null);
  const [testInput, setTestInput] = useState('{\n  "form": {}\n}');
  const [testResult, setTestResult] = useState<RuleFlowEvaluateResult | null>(null);
  const formApi = useRef<FormApi | null>(null);

  const listQuery = useRuleFlowList({ page, pageSize, keyword: submittedKeyword || undefined });
  const data = listQuery.data ?? null;
  const tableOptionsQuery = useWorkflowDesignerDecisionTableOptions(modalVisible);
  const tableOptions = tableOptionsQuery.data ?? [];
  const saveMutation = useSaveRuleFlow();
  const publishMutation = usePublishRuleFlow();
  const toggleMutation = useToggleRuleFlow();
  const deleteMutation = useDeleteRuleFlow();
  const testMutation = useTestRuleFlow();

  const openCreate = () => { setEditing(null); setSteps([]); setModalVisible(true); };
  const openEdit = (r: RuleDecisionFlow) => { setEditing(r); setSteps(r.steps); setModalVisible(true); };

  const setStep = (i: number, patch: Partial<RuleFlowStep>) => setSteps((prev) => prev.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const addStep = () => setSteps((prev) => [...prev, { id: newStepId(), tableKey: '' }]);
  const delStep = (i: number) => setSteps((prev) => prev.filter((_, k) => k !== i));
  const moveStep = (i: number, dir: -1 | 1) => setSteps((prev) => {
    const target = i + dir;
    if (target < 0 || target >= prev.length) return prev;
    const next = [...prev];
    [next[i], next[target]] = [next[target], next[i]];
    return next;
  });

  const handleSubmit = async () => {
    const v = await formApi.current?.validate();
    if (!v) return;
    if (steps.length === 0) { Toast.warning('请至少添加一个步骤'); return; }
    if (steps.some((s) => !s.tableKey)) { Toast.warning('存在未选择决策表的步骤'); return; }
    const payload = { name: v.name, description: v.description ?? null, steps };
    await saveMutation.mutateAsync({
      id: editing?.id,
      values: editing ? { ...payload, expectedUpdatedAt: editing.updatedAt } : { ...payload, key: v.key },
    });
    Toast.success(editing ? '更新成功' : '创建成功');
    setModalVisible(false);
  };

  const handlePublish = (r: RuleDecisionFlow) => { Modal.confirm({
    title: `发布「${r.name}」？`,
    content: '将把当前步骤固化为运行时快照；引用的决策表必须均已发布',
    onOk: async () => { await publishMutation.mutateAsync(r.id); Toast.success('发布成功'); },
  }); };
  const handleToggle = (r: RuleDecisionFlow) => { Modal.confirm({
    title: r.status === 'disabled' ? `启用「${r.name}」？` : `停用「${r.name}」？`,
    content: r.status === 'disabled' ? '启用后恢复运行时求值' : '停用后运行时求值返回空结果',
    okButtonProps: r.status === 'disabled' ? undefined : { type: 'danger' },
    onOk: async () => { await toggleMutation.mutateAsync({ id: r.id, enabled: r.status === 'disabled' }); Toast.success('操作成功'); },
  }); };
  const handleDelete = (r: RuleDecisionFlow) => { Modal.confirm({
    title: '确定删除？', content: '删除后不可恢复', okButtonProps: { type: 'danger' },
    onOk: async () => { await deleteMutation.mutateAsync(r.id); Toast.success('删除成功'); },
  }); };

  const runTest = async () => {
    if (!testRow) return;
    let input: Record<string, unknown>;
    try { input = JSON.parse(testInput || '{}'); } catch { Toast.error('输入不是合法 JSON'); return; }
    const res = await testMutation.mutateAsync({ id: testRow.id, input });
    if (res) setTestResult(res);
  };

  const columns: ColumnProps<RuleDecisionFlow>[] = [
    { title: 'Key', dataIndex: 'key', width: 180, render: (t: string) => <Text code>{t}</Text> },
    { title: '名称', dataIndex: 'name', width: 180, render: renderEllipsis },
    { title: '步骤', width: 220, render: (_: unknown, r: RuleDecisionFlow) => (
      <Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ maxWidth: 200 }}>
        {r.steps.map((s) => s.label || s.tableKey).join(' → ') || '-'}
      </Text>
    ) },
    { title: '版本', dataIndex: 'version', width: 70 },
    { title: '状态', dataIndex: 'status', width: 132, fixed: 'right', render: (s: string, r: RuleDecisionFlow) => (
      <Space spacing={4} wrap>
        <Tag color={STATUS[s]?.color as never}>{STATUS[s]?.text ?? s}</Tag>
        {r.dirty && s === 'published' && <Tag size="small" color="orange">改动未发布</Tag>}
      </Space>
    ) },
    createdAtColumn,
    createOperationColumn<RuleDecisionFlow>({
      desktopInlineKeys: ['edit', 'publish'],
      actions: (r) => [
        { key: 'test', label: '测试', onClick: () => { setTestRow(r); setTestResult(null); } },
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
            <Input prefix={<Search size={14} />} placeholder="搜索名称" value={draftKeyword} onChange={setDraftKeyword} onEnterPress={() => { setPage(1); setSubmittedKeyword(draftKeyword); void queryClient.invalidateQueries({ queryKey: ruleKeys.flows.lists }); }} showClear style={{ width: 220 }} />
            <Button type="primary" icon={<Search size={14} />} onClick={() => { setPage(1); setSubmittedKeyword(draftKeyword); void queryClient.invalidateQueries({ queryKey: ruleKeys.flows.lists }); }}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { setDraftKeyword(''); setSubmittedKeyword(''); setPage(1); void queryClient.invalidateQueries({ queryKey: ruleKeys.flows.lists }); }}>重置</Button>
            {canCreate && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>}
          </>
        )}
      />
      <ConfigurableTable bordered columns={columns} dataSource={data?.list ?? []} loading={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据" pagination={buildPagination(data?.total ?? 0)} />

      <AppModal
        title={editing ? '编辑决策流' : '新增决策流'}
        visible={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={880}
        bodyStyle={{ maxHeight: '72vh', overflowY: 'auto' }}
        closeOnEsc
      >
        <Form key={editing?.id ?? 'new'} getFormApi={(a) => { formApi.current = a; }} labelPosition="left" labelWidth={80}
          initValues={editing ? { key: editing.key, name: editing.name, description: editing.description } : {}}>
          <Form.Input field="key" label="Key" disabled={!!editing} rules={[{ required: true, message: 'key 必填' }]} placeholder="如 risk_decision_flow" />
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '名称必填' }]} />
          <Form.TextArea field="description" label="描述" autosize={{ minRows: 2, maxRows: 3 }} maxCount={500} />
        </Form>
        <div style={{ marginTop: 12 }}>
          <Space spacing={8} align="center">
            <Text strong>步骤编排</Text>
            <Text type="tertiary" size="small">按序执行；前序输出并入 scope，后续步骤条件与决策表输入表达式可直接引用其输出键</Text>
          </Space>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {steps.map((s, i) => (
              <div key={s.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: 8, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)' }}>
                <Tag size="small">{i + 1}</Tag>
                <Select size="small" value={s.tableKey || undefined} onChange={(v) => setStep(i, { tableKey: String(v ?? '') })} optionList={tableOptions} filter placeholder="选择已发布决策表" style={{ width: 220 }} emptyContent="暂无已发布决策表" />
                <Input size="small" value={s.label ?? ''} onChange={(v) => setStep(i, { label: v || undefined })} placeholder="步骤名(可选)" style={{ width: 130 }} />
                <Input size="small" value={s.condition ?? ''} onChange={(v) => setStep(i, { condition: v || undefined })} placeholder="前置条件表达式(可选)，如 level === 'gold'" style={{ flex: 1, minWidth: 180 }} />
                <Input size="small" value={s.outputNamespace ?? ''} onChange={(v) => setStep(i, { outputNamespace: v || undefined })} placeholder="命名空间(可选)" style={{ width: 130 }} />
                <Button size="small" theme="borderless" icon={<ChevronUp size={14} />} disabled={i === 0} onClick={() => moveStep(i, -1)} />
                <Button size="small" theme="borderless" icon={<ChevronDown size={14} />} disabled={i === steps.length - 1} onClick={() => moveStep(i, 1)} />
                <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={14} />} onClick={() => delStep(i)} />
              </div>
            ))}
          </div>
          <Button size="small" theme="borderless" icon={<Plus size={14} />} onClick={addStep} style={{ marginTop: 8 }}>加步骤</Button>
        </div>
      </AppModal>

      <SideSheet title={`测试求值 · ${testRow?.name ?? ''}`} visible={!!testRow} onCancel={() => setTestRow(null)} width={640}>
        <Text type="tertiary" size="small">输入 JSON（作为初始 scope，如 {'{ "form": { "amount": 5000 } }'}）</Text>
        <TextArea value={testInput} onChange={setTestInput} autosize={{ minRows: 4, maxRows: 10 }} style={{ marginTop: 8, fontFamily: 'monospace' }} />
        <Button type="primary" loading={testMutation.isPending} onClick={runTest} style={{ marginTop: 8 }}>运行</Button>
        {testResult && (
          <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
            <div>
              <Text strong>最终输出</Text>
              <pre style={{ margin: '6px 0 0', padding: 8, background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-medium)', whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(testResult.outputs, null, 2)}</pre>
            </div>
            <Text strong>步骤 Trace</Text>
            <List
              dataSource={testResult.steps}
              renderItem={(s, i) => (
                <List.Item
                  main={(
                    <div>
                      <Space spacing={8} wrap>
                        <Tag size="small">{i + 1}</Tag>
                        <Text strong>{s.label || s.tableKey}</Text>
                        {s.skipped
                          ? <Tag size="small" color="grey">{s.skipReason === 'condition' ? '条件跳过' : s.skipReason === 'unavailable' ? '表不可用' : '异常跳过'}</Tag>
                          : <Tag size="small" color={s.matched ? 'green' : 'red'}>{s.matched ? '命中' : s.reason === 'unique_conflict' ? '唯一冲突' : s.reason === 'any_conflict' ? '输出不一致' : '未命中'}</Tag>}
                        {!s.skipped && s.matchedRowIds.length > 0 && <Text type="tertiary" size="small">行 {s.matchedRowIds.join(', ')}</Text>}
                      </Space>
                      {s.error && <Text type="danger" size="small" style={{ display: 'block', marginTop: 4 }}>{s.error}</Text>}
                      {!s.skipped && <Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>out: {JSON.stringify(s.outputs)}</Text>}
                    </div>
                  )}
                />
              )}
            />
          </div>
        )}
      </SideSheet>
    </div>
  );
}
