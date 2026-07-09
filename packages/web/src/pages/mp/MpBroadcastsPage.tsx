import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Modal, Select, Spin, Tag, Toast, Banner, Typography, Tooltip, Input, Descriptions } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, RotateCcw, Search } from 'lucide-react';
import { MP_BROADCAST_TYPE_LABELS, MP_BROADCAST_TYPE_OPTIONS } from '@zenith/shared';
import type { MpBroadcast, MpBroadcastType, MpBroadcastTarget, MpBroadcastStatus } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { formatDateTimeForApi } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn } from '../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';
import {
  mpBroadcastKeys,
  useDeleteMpBroadcast,
  useMpBroadcastAux,
  useMpBroadcastList,
  useMpBroadcastResult,
  usePreviewMpBroadcast,
  useSaveMpBroadcast,
  useSendMpBroadcast,
} from '@/hooks/queries/mp-broadcasts';

const STATUS_OPTIONS = [
  { label: '草稿', value: 'draft' },
  { label: '已发送', value: 'sent' },
  { label: '失败', value: 'failed' },
];
const STATUS_META: Record<MpBroadcastStatus, { label: string; color: 'grey' | 'green' | 'red' }> = {
  draft: { label: '草稿', color: 'grey' },
  sent: { label: '已发送', color: 'green' },
  failed: { label: '失败', color: 'red' },
};

export default function MpBroadcastsPage() {
  const { hasPermission: can } = usePermission();
  const queryClient = useQueryClient();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftStatus, setDraftStatus] = useState<MpBroadcastStatus | undefined>(undefined);
  const [submittedStatus, setSubmittedStatus] = useState<MpBroadcastStatus | undefined>(undefined);

  const listQuery = useMpBroadcastList(currentId, { page, pageSize, status: submittedStatus });
  const auxQuery = useMpBroadcastAux(currentId);
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const tags = auxQuery.data?.tags ?? [];
  const materials = auxQuery.data?.materials ?? [];
  const drafts = auxQuery.data?.drafts ?? [];
  const tagMap = new Map(tags.map((t) => [t.id, t.name]));

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MpBroadcast | null>(null);
  const [modalType, setModalType] = useState<MpBroadcastType>('text');
  const [modalTarget, setModalTarget] = useState<MpBroadcastTarget>('all');
  const formRef = useRef<FormApi>(null);

  const [previewState, setPreviewState] = useState<{ visible: boolean; id: number | null }>({ visible: false, id: null });
  const [previewOpenid, setPreviewOpenid] = useState('');
  const [resultState, setResultState] = useState<{ visible: boolean; id: number | null }>({ visible: false, id: null });
  const resultQuery = useMpBroadcastResult(resultState.id, resultState.visible);

  const saveMutation = useSaveMpBroadcast();
  const sendMutation = useSendMpBroadcast();
  const previewMutation = usePreviewMpBroadcast();
  const deleteMutation = useDeleteMpBroadcast();
  const sendingId = sendMutation.isPending ? (sendMutation.variables ?? null) : null;

  const handleSearch = () => {
    setPage(1);
    setSubmittedStatus(draftStatus);
    void queryClient.invalidateQueries({ queryKey: mpBroadcastKeys.lists(currentId) });
  };
  const handleReset = () => {
    setDraftStatus(undefined);
    setSubmittedStatus(undefined);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: mpBroadcastKeys.lists(currentId) });
  };

  const openCreate = () => { setEditingRecord(null); setModalType('text'); setModalTarget('all'); setModalVisible(true); };
  const openEdit = (record: MpBroadcast) => { setEditingRecord(record); setModalType(record.msgType); setModalTarget(record.target); setModalVisible(true); };

  const handleSubmit = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current?.validate())!; } catch { throw new Error('validation'); }
    if (!currentId) return;
    const payload: Record<string, unknown> = { msgType: modalType, target: modalTarget };
    if (modalType === 'text') payload.content = values.content;
    else payload.mediaId = values.mediaId;
    if (modalTarget === 'tag') payload.tagId = values.tagId;
    payload.scheduledAt = values.scheduledAt ? formatDateTimeForApi(values.scheduledAt as Date) : null;
    await saveMutation.mutateAsync({ id: editingRecord?.id, values: editingRecord ? payload : { ...payload, accountId: currentId } });
    Toast.success(editingRecord ? '更新成功' : '已创建群发草稿');
    setModalVisible(false);
  };

  const handleSend = (record: MpBroadcast) => {
    Modal.confirm({
      title: '确认发送群发？',
      content: '发送后将立即推送给目标粉丝，且不可撤回。',
      okButtonProps: { type: 'primary', theme: 'solid' },
      onOk: async () => {
        await sendMutation.mutateAsync(record.id);
        Toast.success('发送成功');
      },
    });
  };

  const handleDelete = (record: MpBroadcast) => {
    Modal.confirm({
      title: '确定要删除该群发记录吗？',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(record.id);
        Toast.success('删除成功');
      },
    });
  };

  const handlePreview = async () => {
    if (!previewState.id || !previewOpenid.trim()) { Toast.warning('请输入预览 openid'); return; }
    await previewMutation.mutateAsync({ id: previewState.id, openid: previewOpenid.trim() });
    Toast.success('预览已发送');
    setPreviewState({ visible: false, id: null });
  };

  const openResult = (record: MpBroadcast) => {
    setResultState({ visible: true, id: record.id });
  };

  const summarize = (r: MpBroadcast): string => {
    if (r.msgType === 'text') return r.content ?? '';
    if (r.msgType === 'image') return `[图片素材] ${r.mediaId ?? ''}`;
    return `[图文素材] ${r.mediaId ?? ''}`;
  };

  const columns = [
    { title: '内容类型', dataIndex: 'msgType', width: 90, render: (v: MpBroadcastType) => <Tag type="light" color="blue">{MP_BROADCAST_TYPE_LABELS[v]}</Tag> },
    {
      title: '群发对象', dataIndex: 'target', width: 130,
      render: (v: MpBroadcastTarget, r: MpBroadcast) => (v === 'all' ? '全部粉丝' : `标签：${r.tagId ? (tagMap.get(r.tagId) ?? `#${r.tagId}`) : '—'}`),
    },
    { title: '内容', dataIndex: 'content', width: 260, render: (_: unknown, r: MpBroadcast) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 240 }}>{summarize(r)}</Typography.Text> },
    { title: '发送时间', dataIndex: 'sentAt', width: 160, render: (v: string | null) => v || '—' },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 90, align: 'center' as const, fixed: 'right' as const,
      render: (v: MpBroadcastStatus, r: MpBroadcast) => {
        const meta = STATUS_META[v];
        const tag = <Tag color={meta.color} type="light">{meta.label}</Tag>;
        return v === 'failed' && r.errorMsg ? <Tooltip content={r.errorMsg}>{tag}</Tooltip> : tag;
      },
    },
    createOperationColumn<MpBroadcast>({
      width: 170,
      desktopInlineKeys: ['send', 'preview', 'result', 'edit', 'delete'],
      menuAriaLabel: '群发操作',
      actions: (record) => [
        {
          key: 'send',
          label: '发送',
          loading: sendingId === record.id,
          hidden: record.status === 'sent' || !can('mp:broadcast:send'),
          onClick: () => handleSend(record),
        },
        {
          key: 'preview',
          label: '预览',
          hidden: !can('mp:broadcast:send'),
          onClick: () => { setPreviewOpenid(''); setPreviewState({ visible: true, id: record.id }); },
        },
        { key: 'result', label: '结果', hidden: record.status !== 'sent', onClick: () => openResult(record) },
        { key: 'edit', label: '编辑', hidden: record.status === 'sent' || !can('mp:broadcast:update'), onClick: () => openEdit(record) },
        { key: 'delete', label: '删除', danger: true, hidden: !can('mp:broadcast:delete'), onClick: () => handleDelete(record) },
      ],
    }),
  ];

  const mediaOptions = modalType === 'image'
    ? materials.map((m) => ({ label: `${m.name}（${m.wechatMediaId}）`, value: m.wechatMediaId as string }))
    : drafts.map((d) => ({ label: `${d.title}（${d.wechatMediaId}）`, value: d.wechatMediaId as string }));

  const renderAccountFilter = () => (
    <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
  );
  const renderStatusFilter = () => (
    <Select
      placeholder="状态"
      value={draftStatus}
      onChange={(v) => setDraftStatus(v as MpBroadcastStatus | undefined)}
      optionList={STATUS_OPTIONS}
      showClear
      style={{ width: 130 }}
    />
  );
  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => can('mp:broadcast:create') ? (
    <Button type="primary" icon={<Plus size={14} />} disabled={!currentId} onClick={openCreate}>新增群发</Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderAccountFilter()}
            {renderStatusFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderAccountFilter()}
            {renderStatusFilter()}
          </>
        )}
        filterTitle="群发筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      {!accountsLoading && accounts.length === 0 && (
        <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" style={{ marginBottom: 12 }} />
      )}

      <ConfigurableTable bordered loading={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total)} scroll={{ x: 1100 }} />

      <AppModal title={editingRecord ? '编辑群发草稿' : '新增群发'} visible={modalVisible}
        onOk={handleSubmit} onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        confirmLoading={saveMutation.isPending} width={600}>
        <Spin spinning={false} wrapperClassName="modal-spin-wrapper">
          <Form
            key={editingRecord?.id ?? `new-${modalType}-${modalTarget}`}
            getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
            labelPosition="left" labelWidth={90}
            initValues={editingRecord
              ? { content: editingRecord.content ?? '', mediaId: editingRecord.mediaId ?? '', tagId: editingRecord.tagId ?? undefined, scheduledAt: editingRecord.scheduledAt ? new Date(editingRecord.scheduledAt) : undefined }
              : { content: '', mediaId: '', tagId: undefined, scheduledAt: undefined }}
          >
            <Form.Slot label="内容类型">
              <Select style={{ width: '100%' }} optionList={MP_BROADCAST_TYPE_OPTIONS} value={modalType} onChange={(v) => setModalType(v as MpBroadcastType)} />
            </Form.Slot>

            {modalType === 'text' ? (
              <Form.TextArea field="content" label="文本内容" rows={4} placeholder="请输入群发文本内容"
                rules={[{ required: true, message: '请输入群发文本内容' }]} />
            ) : (
              <Form.Select field="mediaId" label={modalType === 'image' ? '图片素材' : '图文素材'} style={{ width: '100%' }} filter showClear
                placeholder={modalType === 'image' ? '请选择已同步到微信的图片素材' : '请选择已推送到微信的图文草稿'}
                optionList={mediaOptions}
                rules={[{ required: true, message: '请选择素材' }]}
                emptyContent={modalType === 'image' ? '暂无可用图片素材（需含微信 media_id）' : '暂无可用图文草稿（需已推送到微信）'} />
            )}

            <Form.Slot label="群发对象">
              <Select style={{ width: '100%' }} value={modalTarget} onChange={(v) => setModalTarget(v as MpBroadcastTarget)}
                optionList={[{ label: '全部粉丝', value: 'all' }, { label: '指定标签', value: 'tag' }]} />
            </Form.Slot>

            {modalTarget === 'tag' && (
              <Form.Select field="tagId" label="选择标签" style={{ width: '100%' }} filter showClear placeholder="请选择标签"
                optionList={tags.map((t) => ({ label: t.name, value: t.id }))}
                rules={[{ required: true, message: '请选择标签' }]}
                emptyContent="暂无标签，请先在「标签管理」创建并同步" />
            )}

            <Form.DatePicker field="scheduledAt" label="定时发送" type="dateTime" style={{ width: '100%' }}
              placeholder="留空表示立即发送（保存草稿后手动发送）" />
          </Form>
        </Spin>
      </AppModal>

      <AppModal title="群发预览" visible={previewState.visible} confirmLoading={previewMutation.isPending}
        onOk={() => void handlePreview()} okText="发送预览" onCancel={() => setPreviewState({ visible: false, id: null })} width={420}>
        <Banner type="info" fullMode={false} description="预览将把该群发内容发送给指定的测试 openid（需已关注），用于发送前检查效果。" style={{ marginBottom: 12 }} />
        <Input value={previewOpenid} onChange={setPreviewOpenid} placeholder="输入测试粉丝 openid" onEnterPress={() => void handlePreview()} />
      </AppModal>

      <AppModal title="群发发送结果" visible={resultState.visible} footer={null}
        onCancel={() => setResultState({ visible: false, id: null })} width={420}>
        <Spin spinning={resultQuery.isFetching}>
          {resultQuery.data ? (
            <Descriptions row size="medium" data={[
              { key: '发送状态', value: resultQuery.data.msgStatus },
              { key: '目标总数', value: String(resultQuery.data.totalCount ?? '—') },
              { key: '过滤后', value: String(resultQuery.data.filterCount ?? '—') },
              { key: '送达数', value: String(resultQuery.data.sentCount ?? '—') },
              { key: '失败数', value: String(resultQuery.data.errorCount ?? '—') },
            ]} />
          ) : <div style={{ padding: 24, textAlign: 'center', color: 'var(--semi-color-text-2)' }}>暂无数据</div>}
        </Spin>
      </AppModal>
    </div>
  );
}
