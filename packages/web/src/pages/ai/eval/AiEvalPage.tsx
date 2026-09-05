import { useMemo, useState } from 'react';
import {
  ArrayField,
  Button,
  Form,
  Modal,
  SideSheet,
  Space,
  Table,
  TabPane,
  Tabs,
  Tag,
  Toast,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import { Plus, Trash2, FlaskConical } from 'lucide-react';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import {
  useAiEvalDatasets,
  useAiEvalItems,
  useSaveAiEvalDataset,
  useDeleteAiEvalDataset,
  useAddAiEvalItems,
  useDeleteAiEvalItem,
  useRunAiExperiment,
  useAiEvalExperiments,
  useAiEvalExperimentDetail,
} from '@/hooks/queries/ai-eval';
import { useMyAiAgents, useBuiltinAiAgents } from '@/hooks/queries/ai-agents';
import { usePermission } from '@/hooks/usePermission';
import type { AiEvalDataset, AiEvalExperiment, AiEvalExperimentResult, AiEvalScorerId } from '@zenith/shared/ai';
import { AI_EVAL_SCORERS } from '@zenith/shared/ai';
import { CreateButton } from '@/components/toolbar-controls';
import { confirmDelete } from '@/utils/confirm';
import { dateTimeColumn } from '@/utils/table-columns';

const { Text, Paragraph } = Typography;

/** 打分器 id → 中文名(目录见 shared AI_EVAL_SCORERS) */
const SCORER_LABELS = new Map<string, string>(AI_EVAL_SCORERS.map((s) => [s.id, s.label]));

/** 反向指标(toxicity/bias:高分 = 差) */
const INVERTED_SCORERS = new Set<string>(AI_EVAL_SCORERS.filter((s) => s.inverted).map((s) => s.id));

const SCORER_OPTIONS = AI_EVAL_SCORERS.map((s) => ({
  value: s.id,
  label: `${s.label}${s.kind === 'llm' ? '（LLM 评审）' : '（免费）'}`,
  extra: s.description,
}));

const STATUS_META: Record<AiEvalExperiment['status'], { label: string; color: 'blue' | 'green' | 'red' | 'grey' }> = {
  pending: { label: '等待中', color: 'grey' },
  running: { label: '运行中', color: 'blue' },
  completed: { label: '完成', color: 'green' },
  failed: { label: '失败', color: 'red' },
};

/** 各打分器分数(0-1)→ 百分比 Tag;reasons 提供时 LLM 评审理由经 Tooltip 透出 */
function renderScores(scores: Record<string, number> | null, reasons?: Record<string, string>) {
  if (!scores || Object.keys(scores).length === 0) return '—';
  return (
    <Space spacing={4} wrap>
      {Object.entries(scores).map(([scorer, score]) => {
        // 反向指标(毒性/偏见)高分为差:颜色按「好坏」而非分值
        const goodness = INVERTED_SCORERS.has(scorer) ? 1 - score : score;
        const tag = (
          <Tag key={scorer} size="small" color={goodness >= 0.6 ? 'green' : goodness >= 0.3 ? 'amber' : 'red'}>
            {SCORER_LABELS.get(scorer) ?? scorer} {(score * 100).toFixed(1)}%
          </Tag>
        );
        const reason = reasons?.[scorer];
        return reason
          ? <Tooltip key={scorer} content={<div style={{ maxWidth: 420 }}>{reason}</div>}>{tag}</Tooltip>
          : tag;
      })}
    </Space>
  );
}

/** 条目 ArrayField(创建数据集 / 批量添加共用) */
function EvalItemsArrayField() {
  return (
    <ArrayField field="items">
      {({ add, arrayFields }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {arrayFields.map(({ field, key, remove }, idx) => (
            <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Text type="tertiary" style={{ width: 24, lineHeight: '32px' }}>{idx + 1}.</Text>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Form.TextArea noLabel field={`${field}[input]`} rows={2} placeholder="评测问题" rules={[{ required: true, message: '必填' }]} />
                <Form.Input noLabel field={`${field}[groundTruth]`} placeholder="期望要点（可选，ground-truth 打分对照用）" />
              </div>
              <Button theme="borderless" type="danger" size="small" icon={<Trash2 size={13} />} onClick={() => remove()} />
            </div>
          ))}
          <Button theme="light" size="small" icon={<Plus size={13} />} onClick={() => add()} style={{ alignSelf: 'flex-start' }}>添加一条（最多 100 条）</Button>
        </div>
      )}
    </ArrayField>
  );
}

interface ItemDraft {
  input: string;
  groundTruth?: string;
}

function normalizeItems(items: ItemDraft[] | undefined) {
  return (items ?? [])
    .filter((it) => it?.input?.trim())
    .map((it) => ({ input: it.input.trim(), groundTruth: it.groundTruth?.trim() || null }));
}

/** 数据集详情(条目 + 实验)SideSheet 内容 */
function DatasetDetail({ dataset, canManage }: { dataset: AiEvalDataset; canManage: boolean }) {
  const [activeTab, setActiveTab] = useState('items');
  const itemsQuery = useAiEvalItems(dataset.id);
  // 有等待/进行中的实验时 3s 轮询刷新状态
  const experimentsQuery = useAiEvalExperiments(dataset.id, (query) => {
    const data = query.state.data as AiEvalExperiment[] | undefined;
    return data?.some((e) => e.status === 'pending' || e.status === 'running') ? 3000 : false;
  });
  const addItemsMutation = useAddAiEvalItems();
  const deleteItemMutation = useDeleteAiEvalItem();
  const runMutation = useRunAiExperiment();
  const myAgentsQuery = useMyAiAgents();
  const builtinQuery = useBuiltinAiAgents();

  const [addVisible, setAddVisible] = useState(false);
  const [runVisible, setRunVisible] = useState(false);
  const [detailExperimentId, setDetailExperimentId] = useState<string | null>(null);
  const detailQuery = useAiEvalExperimentDetail(dataset.id, detailExperimentId);

  /** 评测目标 = 注册进 Mastra 的 agent:系统对话 + 内置编程式 + 我的智能体(agent-{id}) */
  const targetOptions = useMemo(() => {
    const opts = [{ value: 'zenith-chat', label: '系统对话智能体（zenith-chat）' }];
    for (const b of builtinQuery.data ?? []) {
      opts.push({ value: b.agentId, label: `${b.name}（内置 ${b.agentId}）` });
    }
    for (const a of myAgentsQuery.data ?? []) {
      opts.push({ value: `agent-${a.id}`, label: `${a.name}（我的 agent-${a.id}）` });
    }
    return opts;
  }, [builtinQuery.data, myAgentsQuery.data]);

  const itemColumns = [
    { title: '#', width: 50, render: (_: unknown, __: unknown, idx: number) => idx + 1 },
    {
      title: '评测问题',
      dataIndex: 'input',
      render: (v: string) => <Paragraph ellipsis={{ rows: 2, showTooltip: true }} style={{ fontSize: 13 }}>{v}</Paragraph>,
    },
    {
      title: '期望要点',
      dataIndex: 'groundTruth',
      width: 240,
      render: (v: string | null) => v ? <Paragraph ellipsis={{ rows: 2, showTooltip: true }} style={{ fontSize: 13 }}>{v}</Paragraph> : '—',
    },
    ...(canManage ? [{
      title: '操作',
      width: 80,
      render: (_: unknown, record: { id: string }) => (
        <Button
          theme="borderless"
          type="danger"
          size="small"
          icon={<Trash2 size={13} />}
          onClick={() => {
            confirmDelete({
              title: '确定要删除该条目吗？',
              onOk: async () => {
                await deleteItemMutation.mutateAsync({ params: { id: dataset.id, itemId: record.id } }).then(() => Toast.success('已删除')).catch(() => {});
              },
            });
          }}
        />
      ),
    }] : []),
  ];

  const experimentColumns = [
    { title: '实验名', dataIndex: 'name', width: 170, render: (v: string) => <Text style={{ fontSize: 13 }}>{v}</Text> },
    { title: '目标', dataIndex: 'targetId', width: 150, render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: AiEvalExperiment['status']) => <Tag size="small" color={STATUS_META[v].color}>{STATUS_META[v].label}</Tag>,
    },
    {
      title: '进度',
      width: 110,
      render: (_: unknown, r: AiEvalExperiment) =>
        r.failedCount > 0
          ? <span>{r.succeededCount}/{r.totalCount}<Text type="danger" style={{ marginLeft: 4 }}>({r.failedCount} 失败)</Text></span>
          : `${r.succeededCount}/${r.totalCount}`,
    },
    { title: '平均分', dataIndex: 'avgScores', render: (v: Record<string, number> | null) => renderScores(v) },
    dateTimeColumn('发起时间', 'createdAt'),
    {
      title: '操作',
      width: 100,
      render: (_: unknown, record: AiEvalExperiment) => (
        <Button theme="borderless" size="small" onClick={() => setDetailExperimentId(record.id)}>查看结果</Button>
      ),
    },
  ];

  const resultColumns = [
    { title: '#', width: 50, render: (_: unknown, __: unknown, idx: number) => idx + 1 },
    {
      title: '问题',
      dataIndex: 'input',
      width: 220,
      render: (v: string) => <Paragraph ellipsis={{ rows: 3, showTooltip: true }} style={{ fontSize: 13 }}>{v}</Paragraph>,
    },
    {
      title: '模型输出',
      dataIndex: 'output',
      render: (v: string, record: AiEvalExperimentResult) =>
        record.error
          ? <Text type="danger" style={{ fontSize: 13 }}>{record.error}</Text>
          : <Paragraph ellipsis={{ rows: 4, showTooltip: { opts: { style: { maxWidth: 560 } } } }} style={{ fontSize: 13 }}>{v}</Paragraph>,
    },
    {
      title: '期望要点',
      dataIndex: 'groundTruth',
      width: 180,
      render: (v: string | null) => v ? <Paragraph ellipsis={{ rows: 3, showTooltip: true }} style={{ fontSize: 13 }}>{v}</Paragraph> : '—',
    },
    {
      title: '得分',
      dataIndex: 'scores',
      width: 170,
      render: (v: Record<string, number>, record: AiEvalExperimentResult) =>
        renderScores(Object.keys(v).length > 0 ? v : null, record.reasons),
    },
  ];

  return (
    <Space vertical align="start" style={{ width: '100%' }} spacing={8}>
      <Tabs
        type="line"
        activeKey={activeTab}
        onChange={setActiveTab}
        style={{ width: '100%' }}
        tabBarExtraContent={
          canManage ? (
            activeTab === 'items'
              ? <Button theme="light" size="small" icon={<Plus size={13} />} onClick={() => setAddVisible(true)}>添加条目</Button>
              : <Button theme="solid" size="small" icon={<FlaskConical size={13} />} onClick={() => setRunVisible(true)}>发起实验</Button>
          ) : undefined
        }
      >
        <TabPane tab="条目" itemKey="items">
          <Table
            style={{ marginTop: 12 }}
            columns={itemColumns}
            dataSource={itemsQuery.data ?? []}
            rowKey="id"
            loading={itemsQuery.isFetching}
            pagination={false}
            size="small"
            bordered
            empty="暂无条目，添加评测问题后即可发起实验"
          />
        </TabPane>
        <TabPane tab="实验记录" itemKey="experiments">
          <Table
            style={{ marginTop: 12 }}
            columns={experimentColumns}
            dataSource={experimentsQuery.data ?? []}
            rowKey="id"
            loading={experimentsQuery.isFetching}
            pagination={false}
            size="small"
            bordered
            empty="暂无实验，发起实验后 Mastra 在后台逐条执行并打分"
          />
        </TabPane>
      </Tabs>

      {/* 批量添加条目 */}
      <Modal
        title="添加评测条目"
        visible={addVisible}
        onCancel={() => setAddVisible(false)}
        width={680}
        footer={null}
      >
        <Form<{ items: ItemDraft[] }>
          initValues={{ items: [{ input: '' }] }}
          onSubmit={async (values) => {
            const items = normalizeItems(values.items);
            if (items.length === 0) {
              Toast.error('至少填写一条评测问题');
              return;
            }
            try {
              await addItemsMutation.mutateAsync({ params: { id: dataset.id }, body: { items } });
              Toast.success(`已添加 ${items.length} 条`);
              setAddVisible(false);
            } catch { /* 请求层已提示 */ }
          }}
        >
          {({ formApi }) => (
            <>
              <EvalItemsArrayField />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <Button onClick={() => setAddVisible(false)}>取消</Button>
                <Button theme="solid" loading={addItemsMutation.isPending} onClick={() => formApi.submitForm()}>添加</Button>
              </div>
            </>
          )}
        </Form>
      </Modal>

      {/* 发起实验 */}
      <Modal
        title={`发起实验：${dataset.name}`}
        visible={runVisible}
        onCancel={() => setRunVisible(false)}
        width={520}
        footer={null}
      >
        <Form<{ name?: string; targetId: string; scorers: AiEvalScorerId[] }>
          initValues={{ targetId: 'zenith-chat', scorers: ['ground-truth'] }}
          labelPosition="left"
          labelWidth={80}
          onSubmit={async (values) => {
            try {
              await runMutation.mutateAsync({
                params: { id: dataset.id },
                body: {
                  name: values.name || undefined,
                  targetId: values.targetId,
                  scorers: values.scorers?.length ? values.scorers : undefined,
                },
              });
              Toast.success('实验已发起，Mastra 在后台逐条执行，可在实验记录中查看进度');
              setRunVisible(false);
              setActiveTab('experiments');
            } catch { /* 请求层已提示 */ }
          }}
        >
          {({ formApi }) => (
            <>
              <Text type="tertiary" style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
                对全部条目执行所选智能体并按所选打分器打分；LLM 评审类打分器以系统默认服务商为评审模型，
                每条消耗 token 并产出评审理由。对同一数据集用不同目标分别实验，即可横向对比效果。
              </Text>
              <Form.Input field="name" label="实验名" placeholder="留空自动生成" maxLength={100} />
              <Form.Select
                field="targetId"
                label="评测目标"
                style={{ width: '100%' }}
                optionList={targetOptions}
                rules={[{ required: true, message: '请选择评测目标' }]}
              />
              <Form.Select
                field="scorers"
                label="打分器"
                multiple
                style={{ width: '100%' }}
                optionList={SCORER_OPTIONS}
                rules={[{ required: true, type: 'array', min: 1, message: '至少选择一个打分器' }]}
                extraText="「语义一致性」「期望答案重合度」需要条目已填期望要点"
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <Button onClick={() => setRunVisible(false)}>取消</Button>
                <Button theme="solid" loading={runMutation.isPending} onClick={() => formApi.submitForm()}>开始实验</Button>
              </div>
            </>
          )}
        </Form>
      </Modal>

      {/* 实验结果 */}
      <SideSheet
        title={detailQuery.data ? `实验结果 — ${detailQuery.data.experiment.name}` : '实验结果'}
        visible={detailExperimentId !== null}
        onCancel={() => setDetailExperimentId(null)}
        width={960}
      >
        {detailQuery.data && (
          <Space vertical align="start" style={{ width: '100%' }} spacing={12}>
            <Space wrap>
              <Tag color={STATUS_META[detailQuery.data.experiment.status].color}>
                {STATUS_META[detailQuery.data.experiment.status].label}
              </Tag>
              <Tag color="white">目标 {detailQuery.data.experiment.targetId}</Tag>
              <Tag color="white">{detailQuery.data.experiment.succeededCount}/{detailQuery.data.experiment.totalCount} 成功</Tag>
              {renderScores(detailQuery.data.experiment.avgScores)}
            </Space>
            <Table
              columns={resultColumns}
              dataSource={detailQuery.data.results}
              rowKey="itemId"
              pagination={false}
              size="small"
              bordered
            />
          </Space>
        )}
      </SideSheet>
    </Space>
  );
}

export default function AiEvalPage() {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('ai:eval:manage');

  const datasetsQuery = useAiEvalDatasets();
  const saveMutation = useSaveAiEvalDataset();
  const deleteMutation = useDeleteAiEvalDataset();
  const [detailDataset, setDetailDataset] = useState<AiEvalDataset | null>(null);

  /** 数据集编辑弹窗(id 为字符串,不走 useEditModal) */
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingDataset, setEditingDataset] = useState<AiEvalDataset | null>(null);
  const isEdit = editingDataset !== null;

  const openCreate = () => { setEditingDataset(null); setEditorVisible(true); };
  const openEdit = (ds: AiEvalDataset) => { setEditingDataset(ds); setEditorVisible(true); };
  const closeEditor = () => { setEditorVisible(false); setEditingDataset(null); };

  const handleEditorSubmit = async (
    values: { name: string; description?: string; items?: ItemDraft[] },
  ) => {
    if (isEdit) {
      try {
        await saveMutation.mutateAsync({ id: editingDataset.id, values: { name: values.name, description: values.description || null } });
        Toast.success('数据集已更新');
        closeEditor();
      } catch { /* 请求层已提示 */ }
      return;
    }
    const items = normalizeItems(values.items);
    if (items.length === 0) {
      Toast.error('至少添加一条评测问题');
      return;
    }
    try {
      await saveMutation.mutateAsync({ values: { name: values.name, description: values.description || null, items } });
      Toast.success('数据集已创建');
      closeEditor();
    } catch { /* 请求层已提示 */ }
  };

  const columns = [
    { title: '名称', dataIndex: 'name', width: 220 },
    { title: '描述', dataIndex: 'description', minWidth: 260, render: (v: string | null) => v || '—' },
    { title: '条目数', dataIndex: 'itemCount', width: 90, align: 'right' as const },
    { title: '版本', dataIndex: 'version', width: 70, align: 'right' as const, render: (v: number) => <Text code>v{v}</Text> },
    dateTimeColumn('更新时间', 'updatedAt'),
    createOperationColumn<AiEvalDataset>({
      width: 220,
      desktopInlineKeys: ['detail', 'edit'],
      actions: (record) => [
        { key: 'detail', label: '条目与实验', type: 'primary', onClick: () => setDetailDataset(record) },
        { key: 'edit', label: '编辑', hidden: !canManage, onClick: () => openEdit(record) },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !canManage,
          onClick: () => {
            confirmDelete({
              title: '确定要删除该数据集吗？',
              content: '将级联删除全部条目与实验记录',
              onOk: async () => {
                await deleteMutation.mutateAsync({ params: { id: record.id } }).then(() => Toast.success('已删除')).catch(() => {});
              },
            });
          },
        },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <Text type="tertiary" style={{ fontSize: 13 }}>
          评测由 Mastra Datasets / Experiments 承载：数据集版本化管理评测条目，实验对注册智能体逐条执行并打分。
        </Text>
        {canManage && <CreateButton onClick={openCreate}>新建数据集</CreateButton>}
      </div>
      <ConfigurableTable
        bordered
        columnSettingsKey="ai-eval-datasets"
        columns={columns}
        dataSource={datasetsQuery.data ?? []}
        rowKey="id"
        loading={datasetsQuery.isFetching}
        pagination={false}
        onRefresh={() => void datasetsQuery.refetch()}
        refreshLoading={datasetsQuery.isFetching}
      />

      {/* 数据集编辑 */}
      <Modal
        title={isEdit ? '编辑数据集' : '新建数据集'}
        visible={editorVisible}
        onCancel={closeEditor}
        width={720}
        footer={null}
      >
        <Form<{ name: string; description?: string; items?: ItemDraft[] }>
          key={isEdit ? `edit-${editingDataset.id}` : 'create'}
          initValues={isEdit
            ? { name: editingDataset.name, description: editingDataset.description ?? '' }
            : { name: '', description: '', items: [{ input: '' }] }}
          labelPosition="left"
          labelWidth={80}
          onSubmit={(values) => void handleEditorSubmit(values)}
        >
          {({ formApi }) => (
            <>
              <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} maxLength={100} />
              <Form.Input field="description" label="描述" maxLength={300} />
              {!isEdit && (
                <Form.Slot label={{ text: '评测条目' }}>
                  <EvalItemsArrayField />
                </Form.Slot>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <Button onClick={closeEditor}>取消</Button>
                <Button theme="solid" loading={saveMutation.isPending} onClick={() => formApi.submitForm()}>{isEdit ? '保存' : '创建'}</Button>
              </div>
            </>
          )}
        </Form>
      </Modal>

      {/* 数据集详情:条目 + 实验 */}
      <SideSheet
        title={detailDataset?.name ?? ''}
        visible={detailDataset !== null}
        onCancel={() => setDetailDataset(null)}
        width={980}
      >
        {detailDataset && <DatasetDetail dataset={detailDataset} canManage={canManage} />}
      </SideSheet>
    </div>
  );
}
