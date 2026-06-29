import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Input, TextArea, Tag, Modal, Form, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type { RuleDecisionTable, RuleEvaluateResult, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';

const { Text } = Typography;

const HIT_POLICIES = [
  { value: 'first', label: '首行命中' },
  { value: 'unique', label: '唯一命中' },
  { value: 'priority', label: '按优先级' },
  { value: 'collect', label: '收集全部' },
  { value: 'any', label: '任意命中' },
];
const STATUS: Record<string, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'grey' },
  published: { text: '已发布', color: 'green' },
  disabled: { text: '已禁用', color: 'red' },
};

const sample = JSON.stringify;

export default function RuleTablesPage() {
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('rule:table:update');
  const canCreate = hasPermission('rule:table:create');
  const canDelete = hasPermission('rule:table:delete');
  const canPublish = hasPermission('rule:table:publish');
  const { page, pageSize, setPage, buildPagination } = usePagination();

  const [data, setData] = useState<PaginatedResponse<RuleDecisionTable> | null>(null);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<RuleDecisionTable | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [testRow, setTestRow] = useState<RuleDecisionTable | null>(null);
  const [testInput, setTestInput] = useState('{}');
  const [testResult, setTestResult] = useState<RuleEvaluateResult | null>(null);
  const formApi = useRef<FormApi | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (keyword) qs.set('keyword', keyword);
      const res = await request.get<PaginatedResponse<RuleDecisionTable>>(`/api/rules/decision-tables?${qs}`);
      if (res.data) setData(res.data);
    } finally { setLoading(false); }
  }, [page, pageSize, keyword]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openCreate = () => { setEditing(null); setModalVisible(true); };
  const openEdit = (r: RuleDecisionTable) => { setEditing(r); setModalVisible(true); };

  const handleSubmit = async () => {
    const v = await formApi.current?.validate();
    if (!v) return;
    let inputs, outputs, rules;
    try {
      inputs = JSON.parse(v.inputs || '[]'); outputs = JSON.parse(v.outputs || '[]'); rules = JSON.parse(v.rules || '[]');
    } catch { Toast.error('inputs/outputs/rules 必须是合法 JSON'); return; }
    const payload = { name: v.name, description: v.description ?? null, hitPolicy: v.hitPolicy, inputs, outputs, rules };
    setSubmitting(true);
    try {
      if (editing) await request.put(`/api/rules/decision-tables/${editing.id}`, payload);
      else await request.post('/api/rules/decision-tables', { ...payload, key: v.key });
      Toast.success(editing ? '更新成功' : '创建成功');
      setModalVisible(false); fetchData();
    } finally { setSubmitting(false); }
  };

  const handlePublish = (r: RuleDecisionTable) => Modal.confirm({
    title: `发布「${r.name}」？`, content: '将生成版本快照并置为已发布',
    onOk: async () => { await request.post(`/api/rules/decision-tables/${r.id}/publish`); Toast.success('发布成功'); fetchData(); },
  });
  const handleDelete = (r: RuleDecisionTable) => Modal.confirm({
    title: '确定删除？', content: '删除后不可恢复', okButtonProps: { type: 'danger' },
    onOk: async () => { await request.delete(`/api/rules/decision-tables/${r.id}`); Toast.success('删除成功'); fetchData(); },
  });
  const openTest = (r: RuleDecisionTable) => { setTestRow(r); setTestInput('{}'); setTestResult(null); };
  const runTest = async () => {
    let input; try { input = JSON.parse(testInput || '{}'); } catch { Toast.error('input 必须是合法 JSON'); return; }
    const res = await request.post<RuleEvaluateResult>(`/api/rules/decision-tables/${testRow!.id}/test`, { input });
    if (res.data) setTestResult(res.data);
  };

  const columns: ColumnProps<RuleDecisionTable>[] = [
    { title: 'Key', dataIndex: 'key', width: 160, render: (t: string) => <Text code>{t}</Text> },
    { title: '名称', dataIndex: 'name', width: 160, render: renderEllipsis },
    { title: '命中策略', dataIndex: 'hitPolicy', width: 110, render: (p: string) => HIT_POLICIES.find((x) => x.value === p)?.label ?? p },
    { title: '版本', dataIndex: 'version', width: 70 },
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (s: string) => <Tag color={STATUS[s]?.color as never}>{STATUS[s]?.text ?? s}</Tag> },
    createdAtColumn(),
    createOperationColumn<RuleDecisionTable>({
      actions: (r) => [
        { key: 'test', label: '测试', onClick: () => openTest(r) },
        { key: 'edit', label: '编辑', hidden: !canEdit, onClick: () => openEdit(r) },
        { key: 'publish', label: '发布', hidden: !canPublish, onClick: () => handlePublish(r) },
        { key: 'delete', label: '删除', danger: true, hidden: !canDelete, onClick: () => handleDelete(r) },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="搜索名称" value={keyword} onChange={setKeyword} onEnterPress={() => { setPage(1); fetchData(); }} showClear style={{ width: 220 }} />
            <Button type="primary" icon={<Search size={14} />} onClick={() => { setPage(1); fetchData(); }}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { setKeyword(''); setPage(1); }}>重置</Button>
            {canCreate && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>}
          </>
        )}
      />
      <ConfigurableTable bordered columns={columns} dataSource={data?.list ?? []} loading={loading} onRefresh={fetchData} refreshLoading={loading} rowKey="id" size="small" empty="暂无数据" pagination={buildPagination(data?.total ?? 0, fetchData)} />

      <AppModal title={editing ? '编辑决策表' : '新增决策表'} visible={modalVisible} onOk={handleSubmit} onCancel={() => setModalVisible(false)} okButtonProps={{ loading: submitting }} width={680} closeOnEsc>
        <Form key={editing?.id ?? 'new'} getFormApi={(a) => { formApi.current = a; }} labelPosition="left" labelWidth={90}
          initValues={editing ? { ...editing, inputs: sample(editing.inputs, null, 2), outputs: sample(editing.outputs, null, 2), rules: sample(editing.rules, null, 2) } : { hitPolicy: 'first', inputs: '[]', outputs: '[]', rules: '[]' }}>
          <Form.Input field="key" label="Key" disabled={!!editing} rules={[{ required: true, message: 'key 必填' }]} placeholder="如 member_level" />
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '名称必填' }]} />
          <Form.Select field="hitPolicy" label="命中策略" optionList={HIT_POLICIES} style={{ width: '100%' }} />
          <Form.TextArea field="description" label="描述" autosize maxCount={500} />
          <Form.TextArea field="inputs" label="输入列" placeholder='[{"key":"amt","label":"金额","expr":"form.amount","type":"number"}]' rows={3} />
          <Form.TextArea field="outputs" label="输出列" placeholder='[{"key":"level","label":"等级","type":"string"}]' rows={3} />
          <Form.TextArea field="rules" label="规则行" placeholder='[{"id":"r1","when":[">= 100"],"then":{"level":"gold"}}]' rows={4} />
        </Form>
      </AppModal>

      <AppModal title={`测试求值 · ${testRow?.name ?? ''}`} visible={!!testRow} onOk={runTest} okText="运行" onCancel={() => setTestRow(null)} width={560} closeOnEsc>
        <Text type="tertiary">输入 scope（JSON），例如 {'{ "form": { "amount": 200 } }'}</Text>
        <TextArea value={testInput} onChange={setTestInput} rows={4} style={{ marginTop: 8, fontFamily: 'monospace' }} />
        {testResult && <pre style={{ marginTop: 12, background: 'var(--semi-color-fill-0)', padding: 12, borderRadius: 6 }}>{sample(testResult, null, 2)}</pre>}
      </AppModal>
    </div>
  );
}
