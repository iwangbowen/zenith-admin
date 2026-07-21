import { useState } from 'react';
import { Button, Form, Modal, Progress, Space, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import {
  useCmsPollList, useCmsPollResults, useSaveCmsPoll, useSetCmsPollStatus, useDeleteCmsPoll,
} from '@/hooks/queries/cms';
import { CMS_POLL_STATUS_LABELS } from '@zenith/shared';
import type { CmsPoll, CmsPollStatus } from '@zenith/shared';
import { CmsSiteSelect } from './CmsSiteSelect';

const STATUS_COLORS: Record<CmsPollStatus, 'grey' | 'green' | 'orange'> = {
  draft: 'grey',
  published: 'green',
  closed: 'orange',
};

interface PollFormValues {
  title: string;
  code: string;
  optionsText: string;
  maxChoices: number;
  allowAnonymous: boolean;
  remark?: string;
}

/** 结果弹窗：选项计票进度条 */
function ResultsModal({ poll, onClose }: Readonly<{ poll: CmsPoll | null; onClose: () => void }>) {
  const resultsQuery = useCmsPollResults(poll?.id ?? null);
  const data = resultsQuery.data;
  return (
    <AppModal title={`投票结果 — ${poll?.title ?? ''}`} visible={poll !== null} onCancel={onClose} footer={null} width={480} centered closeOnEsc>
      {resultsQuery.isLoading ? (
        <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
      ) : data ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 16 }}>
          {data.options.map((o) => {
            const pct = data.totalVotes > 0 ? Math.round((o.votes * 100) / data.totalVotes) : 0;
            return (
              <div key={o.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                  <span>{o.label}</span>
                  <span style={{ color: 'var(--semi-color-text-2)' }}>{o.votes} 票 · {pct}%</span>
                </div>
                <Progress percent={pct} showInfo={false} stroke="var(--semi-color-primary)" />
              </div>
            );
          })}
          <Typography.Text type="tertiary" size="small">共 {data.totalVotes} 人参与</Typography.Text>
        </div>
      ) : null}
    </AppModal>
  );
}

export default function PollsPage() {
  const { hasPermission } = usePermission();
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<CmsPoll | null>(null);
  const [resultsTarget, setResultsTarget] = useState<CmsPoll | null>(null);

  const listQuery = useCmsPollList({ page, pageSize, siteId: siteId ?? 0 }, siteId !== undefined);
  const saveMutation = useSaveCmsPoll();
  const statusMutation = useSetCmsPollStatus();
  const deleteMutation = useDeleteCmsPoll();
  const canManage = hasPermission('cms:poll:manage');

  function openCreate() {
    setEditing(null);
    setModalVisible(true);
  }

  function openEdit(record: CmsPoll) {
    setEditing(record);
    setModalVisible(true);
  }

  async function handleSubmit(values: PollFormValues) {
    if (siteId === undefined && !editing) return;
    const labels = values.optionsText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (labels.length < 2) {
      Toast.warning('至少配置 2 个选项（每行一个）');
      return;
    }
    // 编辑时按行位置沿用旧选项 id（保住已有计票），新增行分配新 id
    const oldOptions = editing?.options ?? [];
    const maxOldId = Math.max(0, ...oldOptions.map((o) => o.id));
    let nextId = maxOldId + 1;
    const options = labels.map((label, i) => ({ id: oldOptions[i]?.id ?? nextId++, label }));
    const payload: Record<string, unknown> = {
      title: values.title,
      options,
      maxChoices: values.maxChoices,
      allowAnonymous: values.allowAnonymous,
      remark: values.remark || null,
    };
    if (!editing) {
      payload.siteId = siteId;
      payload.code = values.code;
    }
    await saveMutation.mutateAsync({ id: editing?.id, values: payload });
    Toast.success(editing ? '已保存' : '创建成功');
    setModalVisible(false);
  }

  async function changeStatus(record: CmsPoll, status: CmsPollStatus, msg: string) {
    await statusMutation.mutateAsync({ id: record.id, status });
    Toast.success(msg);
  }

  function handleDelete(record: CmsPoll) {
    Modal.confirm({
      title: `删除投票「${record.title}」？`,
      content: '将同时删除全部投票记录，不可恢复。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(record.id);
        Toast.success('删除成功');
      },
    });
  }

  const columns: ColumnProps<CmsPoll>[] = [
    { title: '标题', dataIndex: 'title', width: 220, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 200 }}>{v}</Typography.Text> },
    { title: '标识', dataIndex: 'code', width: 140, render: (v: string) => <Typography.Text code copyable={{ content: `[投票:${v}]` }}>{v}</Typography.Text> },
    { title: '选项数', dataIndex: 'options', width: 80, align: 'right', render: (v: CmsPoll['options']) => v.length },
    { title: '可选数', dataIndex: 'maxChoices', width: 80, align: 'right', render: (v: number) => (v > 1 ? `多选 ${v}` : '单选') },
    { title: '游客可投', dataIndex: 'allowAnonymous', width: 90, render: (v: boolean) => (v ? '是' : '仅会员') },
    { title: '总票数', dataIndex: 'totalVotes', width: 90, align: 'right' },
    { title: '创建时间', dataIndex: 'createdAt', width: 170 },
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right',
      render: (v: CmsPollStatus) => <Tag size="small" color={STATUS_COLORS[v]}>{CMS_POLL_STATUS_LABELS[v]}</Tag>,
    },
    createOperationColumn<CmsPoll>({
      width: 250,
      desktopInlineKeys: ['results', 'publish', 'close', 'edit', 'delete'],
      actions: (record) => [
        { key: 'results', label: '结果', onClick: () => setResultsTarget(record) },
        ...(canManage && record.status !== 'published' ? [{
          key: 'publish', label: '发布',
          onClick: () => void changeStatus(record, 'published', '已发布，前台可参与投票'),
        }] : []),
        ...(canManage && record.status === 'published' ? [{
          key: 'close', label: '结束',
          onClick: () => void changeStatus(record, 'closed', '已结束，前台展示最终结果'),
        }] : []),
        ...(canManage ? [{ key: 'edit', label: '编辑', onClick: () => openEdit(record) }] : []),
        ...(canManage ? [{ key: 'delete', label: '删除', danger: true, onClick: () => handleDelete(record) }] : []),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={(v) => { setSiteId(v); setPage(1); }} width={200} />
        {canManage ? (
          <Button type="primary" icon={<Plus size={14} />} disabled={siteId === undefined} onClick={openCreate}>新增</Button>
        ) : null}
      </SearchToolbar>
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={listQuery.data?.list ?? []}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无投票，正文插入 [投票:标识] 即可在内容页嵌入"
        scroll={{ x: 1220 }}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(listQuery.data?.total ?? 0)}
      />

      <AppModal
        title={editing ? `编辑投票 — ${editing.title}` : '新增投票'}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={520}
        centered
        closeOnEsc
      >
        <Form<PollFormValues>
          labelPosition="left"
          labelWidth={90}
          key={editing?.id ?? 'create'}
          initValues={editing ? {
            title: editing.title,
            code: editing.code,
            optionsText: editing.options.map((o) => o.label).join('\n'),
            maxChoices: editing.maxChoices,
            allowAnonymous: editing.allowAnonymous,
            remark: editing.remark ?? '',
          } : { title: '', code: '', maxChoices: 1, allowAnonymous: true, optionsText: '', remark: '' }}
          onSubmit={(values) => void handleSubmit(values)}
        >
          <Form.Input field="title" label="标题" rules={[{ required: true, message: '请输入投票标题' }]} maxLength={200} />
          <Form.Input field="code" label="标识" disabled={!!editing} placeholder="小写字母/数字/连字符，如 reader-vote"
            rules={editing ? [] : [{ required: true, message: '请输入标识' }, { pattern: /^[a-z0-9-]+$/, message: '仅支持小写字母、数字和连字符' }]}
            extraText={editing ? '正文插入 [投票:标识] 嵌入本投票' : undefined} />
          <Form.TextArea field="optionsText" label="选项" rows={5} placeholder={'每行一个选项，至少 2 行'} rules={[{ required: true, message: '请输入选项' }]} />
          <Form.InputNumber field="maxChoices" label="可选项数" min={1} max={20} extraText="1 = 单选；大于 1 为多选上限" />
          <Form.Switch field="allowAnonymous" label="游客可投" extraText="关闭后仅登录会员可投票" />
          <Form.Input field="remark" label="备注" maxLength={200} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8, paddingBottom: 12 }}>
            <Space>
              <Button onClick={() => setModalVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>保存</Button>
            </Space>
          </div>
        </Form>
      </AppModal>

      <ResultsModal poll={resultsTarget} onClose={() => setResultsTarget(null)} />
    </div>
  );
}
