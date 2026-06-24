import { useEffect, useState, useCallback, useRef } from 'react';
import { Button, Form, Modal, Select, Space, Spin, Tag, Toast, Banner, Typography, Tooltip } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, RotateCcw, Send } from 'lucide-react';
import type { PaginatedResponse, MpBroadcast, MpBroadcastType, MpBroadcastTarget, MpBroadcastStatus, MpTag, MpMaterial, MpDraft } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createdAtColumn } from '../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';

const TYPE_OPTIONS = [
  { label: '文本', value: 'text' },
  { label: '图片', value: 'image' },
  { label: '图文', value: 'mpnews' },
];
const TYPE_LABEL: Record<MpBroadcastType, string> = { text: '文本', image: '图片', mpnews: '图文' };
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
  const { accounts, currentId, currentIdRef, setCurrentId, loading: accountsLoading } = useMpAccounts();

  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<MpBroadcast[]>([]);
  const [total, setTotal] = useState(0);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [filterStatus, setFilterStatus] = useState<MpBroadcastStatus | undefined>(undefined);

  const [tags, setTags] = useState<MpTag[]>([]);
  const [materials, setMaterials] = useState<MpMaterial[]>([]);
  const [drafts, setDrafts] = useState<MpDraft[]>([]);
  const tagMap = new Map(tags.map((t) => [t.id, t.name]));

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MpBroadcast | null>(null);
  const [modalType, setModalType] = useState<MpBroadcastType>('text');
  const [modalTarget, setModalTarget] = useState<MpBroadcastTarget>('all');
  const [submitting, setSubmitting] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const formRef = useRef<FormApi>(null);

  const fetchList = useCallback(async (p = page, ps = pageSize, status = filterStatus) => {
    if (!currentId) { setList([]); setTotal(0); return; }
    const reqId = currentId;
    setLoading(true);
    try {
      const q = new URLSearchParams({ page: String(p), pageSize: String(ps), accountId: String(currentId) });
      if (status) q.set('status', status);
      const res = await request.get<PaginatedResponse<MpBroadcast>>(`/api/mp/broadcasts?${q}`);
      if (currentIdRef.current !== reqId) return; // 账号已切换，丢弃过期响应
      setList(res.data?.list ?? []);
      setTotal(res.data?.total ?? 0);
      setPage(res.data?.page ?? p);
      setPageSize(res.data?.pageSize ?? ps);
    } finally {
      if (currentIdRef.current === reqId) setLoading(false);
    }
  }, [page, pageSize, currentId, currentIdRef, filterStatus, setPage, setPageSize]);

  const fetchAux = useCallback(async (accountId: number) => {
    const [t, m, d] = await Promise.all([
      request.get<PaginatedResponse<MpTag>>(`/api/mp/tags?accountId=${accountId}&page=1&pageSize=200`),
      request.get<PaginatedResponse<MpMaterial>>(`/api/mp/materials?accountId=${accountId}&page=1&pageSize=200`),
      request.get<PaginatedResponse<MpDraft>>(`/api/mp/drafts?accountId=${accountId}&page=1&pageSize=200`),
    ]);
    if (currentIdRef.current !== accountId) return;
    setTags(t.data?.list ?? []);
    setMaterials((m.data?.list ?? []).filter((x) => x.type === 'image' && x.wechatMediaId));
    setDrafts((d.data?.list ?? []).filter((x) => x.wechatMediaId));
  }, [currentIdRef]);

  useEffect(() => {
    setPage(1);
    void fetchList(1, pageSize, filterStatus);
    if (currentId) void fetchAux(currentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  const handleSearch = () => { setPage(1); void fetchList(1, pageSize, filterStatus); };
  const handleReset = () => { setFilterStatus(undefined); setPage(1); void fetchList(1, pageSize, undefined); };

  const openCreate = () => { setEditingRecord(null); setModalType('text'); setModalTarget('all'); setModalVisible(true); };
  const openEdit = (record: MpBroadcast) => { setEditingRecord(record); setModalType(record.msgType); setModalTarget(record.target); setModalVisible(true); };

  const handleSubmit = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current?.validate())!; } catch { return; }
    if (!currentId) return;
    const payload: Record<string, unknown> = { msgType: modalType, target: modalTarget };
    if (modalType === 'text') payload.content = values.content;
    else payload.mediaId = values.mediaId;
    if (modalTarget === 'tag') payload.tagId = values.tagId;

    setSubmitting(true);
    try {
      if (editingRecord) {
        const res = await request.put(`/api/mp/broadcasts/${editingRecord.id}`, payload);
        if (res.code !== 0) return;
        Toast.success('更新成功');
      } else {
        const res = await request.post('/api/mp/broadcasts', { ...payload, accountId: currentId });
        if (res.code !== 0) return;
        Toast.success('已创建群发草稿');
      }
      setModalVisible(false);
      void fetchList();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSend = (record: MpBroadcast) => {
    Modal.confirm({
      title: '确认发送群发？',
      content: '发送后将立即推送给目标粉丝，且不可撤回。',
      okButtonProps: { type: 'primary', theme: 'solid' },
      onOk: async () => {
        setSendingId(record.id);
        try {
          const res = await request.post(`/api/mp/broadcasts/${record.id}/send`);
          if (res.code === 0) { Toast.success('发送成功'); void fetchList(); }
        } finally { setSendingId(null); }
      },
    });
  };

  const handleDelete = (record: MpBroadcast) => {
    Modal.confirm({
      title: '确定要删除该群发记录吗？',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete(`/api/mp/broadcasts/${record.id}`);
        if (res.code !== 0) return;
        Toast.success('删除成功');
        void fetchList();
      },
    });
  };

  const summarize = (r: MpBroadcast): string => {
    if (r.msgType === 'text') return r.content ?? '';
    if (r.msgType === 'image') return `[图片素材] ${r.mediaId ?? ''}`;
    return `[图文素材] ${r.mediaId ?? ''}`;
  };

  const columns = [
    { title: '内容类型', dataIndex: 'msgType', width: 90, render: (v: MpBroadcastType) => <Tag type="light" color="blue">{TYPE_LABEL[v]}</Tag> },
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
    {
      title: '操作', key: 'actions', width: 170, fixed: 'right' as const,
      render: (_: unknown, record: MpBroadcast) => (
        <Space>
          {record.status !== 'sent' && can('mp:broadcast:send') && (
            <Button theme="borderless" size="small" loading={sendingId === record.id} onClick={() => handleSend(record)}>发送</Button>
          )}
          {record.status !== 'sent' && can('mp:broadcast:update') && <Button theme="borderless" size="small" onClick={() => openEdit(record)}>编辑</Button>}
          {can('mp:broadcast:delete') && <Button theme="borderless" type="danger" size="small" onClick={() => handleDelete(record)}>删除</Button>}
        </Space>
      ),
    },
  ];

  const mediaOptions = modalType === 'image'
    ? materials.map((m) => ({ label: `${m.name}（${m.wechatMediaId}）`, value: m.wechatMediaId as string }))
    : drafts.map((d) => ({ label: `${d.title}（${d.wechatMediaId}）`, value: d.wechatMediaId as string }));

  return (
    <div className="page-container">
      <SearchToolbar>
        <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
        <Select placeholder="状态" value={filterStatus} onChange={(v) => setFilterStatus(v as MpBroadcastStatus | undefined)}
          optionList={STATUS_OPTIONS} showClear style={{ width: 130 }} />
        <Button type="primary" icon={<RotateCcw size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {can('mp:broadcast:create') && <Button type="primary" icon={<Plus size={14} />} disabled={!currentId} onClick={openCreate}>新增群发</Button>}
      </SearchToolbar>

      {!accountsLoading && accounts.length === 0 && (
        <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" style={{ marginBottom: 12 }} />
      )}

      <ConfigurableTable bordered loading={loading} onRefresh={() => void fetchList()} refreshLoading={loading} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total, fetchList)} scroll={{ x: 1100 }} />

      <AppModal title={editingRecord ? '编辑群发草稿' : '新增群发'} visible={modalVisible}
        onOk={handleSubmit} onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        confirmLoading={submitting} width={600}>
        <Spin spinning={false} wrapperClassName="modal-spin-wrapper">
          <Form
            key={editingRecord?.id ?? `new-${modalType}-${modalTarget}`}
            getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
            labelPosition="left" labelWidth={90}
            initValues={editingRecord
              ? { content: editingRecord.content ?? '', mediaId: editingRecord.mediaId ?? '', tagId: editingRecord.tagId ?? undefined }
              : { content: '', mediaId: '', tagId: undefined }}
          >
            <Form.Slot label="内容类型">
              <Select style={{ width: '100%' }} optionList={TYPE_OPTIONS} value={modalType} onChange={(v) => setModalType(v as MpBroadcastType)} />
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
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
