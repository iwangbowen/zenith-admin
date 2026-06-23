import { useEffect, useState, useCallback, useRef } from 'react';
import { Button, Col, Form, Modal, Row, Select, Space, Spin, Tag, Toast, Switch, Banner } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type { PaginatedResponse, MpAutoReply, MpAutoReplyType } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createdAtColumn, renderEllipsis } from '../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';

const REPLY_TYPE_OPTIONS = [
  { label: '关注回复', value: 'subscribe' },
  { label: '关键词回复', value: 'keyword' },
  { label: '默认回复', value: 'default' },
];
const MATCH_OPTIONS = [
  { label: '全匹配', value: 'exact' },
  { label: '包含匹配', value: 'contain' },
];
const TYPE_TAG_COLOR: Record<MpAutoReplyType, 'green' | 'blue' | 'orange'> = {
  subscribe: 'green', keyword: 'blue', default: 'orange',
};

export default function MpAutoRepliesPage() {
  const { hasPermission: can } = usePermission();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();

  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<MpAutoReply[]>([]);
  const [total, setTotal] = useState(0);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();

  interface SearchParams { filterType: MpAutoReplyType | undefined; keyword: string; }
  const defaultSearch: SearchParams = { filterType: undefined, keyword: '' };
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearch);
  const searchRef = useRef<SearchParams>(defaultSearch);
  searchRef.current = searchParams;

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MpAutoReply | null>(null);
  const [modalType, setModalType] = useState<MpAutoReplyType>('keyword');
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<FormApi>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const fetchList = useCallback(
    async (p = page, ps = pageSize, params?: SearchParams) => {
      if (!currentId) { setList([]); setTotal(0); return; }
      const { filterType, keyword } = params ?? searchRef.current;
      setLoading(true);
      try {
        const query = new URLSearchParams({ page: String(p), pageSize: String(ps), accountId: String(currentId) });
        if (filterType) query.set('replyType', filterType);
        if (keyword) query.set('keyword', keyword);
        const res = await request.get<PaginatedResponse<MpAutoReply>>(`/api/mp/auto-replies?${query}`);
        setList(res.data?.list ?? []);
        setTotal(res.data?.total ?? 0);
        setPage(res.data?.page ?? p);
        setPageSize(res.data?.pageSize ?? ps);
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, currentId, setPage, setPageSize],
  );

  useEffect(() => { setPage(1); void fetchList(1, pageSize, searchRef.current); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [currentId]);

  const handleSearch = () => { setPage(1); void fetchList(1, pageSize); };
  const handleReset = () => { setSearchParams(defaultSearch); setPage(1); void fetchList(1, pageSize, defaultSearch); };

  const openCreate = () => { setEditingRecord(null); setModalType('keyword'); setModalVisible(true); };
  const openEdit = (record: MpAutoReply) => { setEditingRecord(record); setModalType(record.replyType); setModalVisible(true); };

  const handleSubmit = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current?.validate())!; } catch { return; }
    if (!currentId) return;
    setSubmitting(true);
    try {
      if (editingRecord) {
        const res = await request.put(`/api/mp/auto-replies/${editingRecord.id}`, values);
        if (res.code !== 0) return;
        Toast.success('更新成功');
      } else {
        const res = await request.post('/api/mp/auto-replies', { ...values, accountId: currentId, replyType: modalType });
        if (res.code !== 0) return;
        Toast.success('创建成功');
      }
      setModalVisible(false);
      void fetchList();
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (record: MpAutoReply, status: 'enabled' | 'disabled') => {
    setTogglingId(record.id);
    try {
      const res = await request.put(`/api/mp/auto-replies/${record.id}`, { status });
      if (res.code === 0) { Toast.success(status === 'enabled' ? '已启用' : '已禁用'); void fetchList(); }
    } finally { setTogglingId(null); }
  };

  const handleDelete = (record: MpAutoReply) => {
    Modal.confirm({
      title: '确定要删除该自动回复吗？',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete(`/api/mp/auto-replies/${record.id}`);
        if (res.code !== 0) return;
        Toast.success('删除成功');
        void fetchList();
      },
    });
  };

  const columns = [
    {
      title: '类型', dataIndex: 'replyType', width: 110,
      render: (v: MpAutoReplyType) => <Tag color={TYPE_TAG_COLOR[v]} type="light">{REPLY_TYPE_OPTIONS.find((t) => t.value === v)?.label ?? v}</Tag>,
    },
    { title: '关键词', dataIndex: 'keyword', width: 140, render: (v: string | null) => v || '—' },
    { title: '匹配', dataIndex: 'matchType', width: 90, render: (v: string, r: MpAutoReply) => (r.replyType === 'keyword' ? (v === 'exact' ? '全匹配' : '包含') : '—') },
    { title: '回复内容', dataIndex: 'content', width: 280, render: renderEllipsis },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 80, align: 'center' as const, fixed: 'right' as const,
      render: (v: string, record: MpAutoReply) => (
        <Switch size="small" checked={v === 'enabled'} loading={togglingId === record.id}
          disabled={!can('mp:reply:update')} onChange={(ck: boolean) => void handleToggle(record, ck ? 'enabled' : 'disabled')} />
      ),
    },
    {
      title: '操作', key: 'actions', width: 140, fixed: 'right' as const,
      render: (_: unknown, record: MpAutoReply) => (
        <Space>
          {can('mp:reply:update') && <Button theme="borderless" size="small" onClick={() => openEdit(record)}>编辑</Button>}
          {can('mp:reply:delete') && <Button theme="borderless" type="danger" size="small" onClick={() => handleDelete(record)}>删除</Button>}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
        <Select placeholder="回复类型" value={searchParams.filterType} onChange={(v) => setSearchParams({ ...searchParams, filterType: v as MpAutoReplyType | undefined })}
          optionList={REPLY_TYPE_OPTIONS} showClear style={{ width: 140 }} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {can('mp:reply:create') && <Button type="primary" icon={<Plus size={14} />} disabled={!currentId} onClick={openCreate}>新增</Button>}
      </SearchToolbar>

      {!accountsLoading && accounts.length === 0 && (
        <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" style={{ marginBottom: 12 }} />
      )}

      <ConfigurableTable bordered loading={loading} onRefresh={() => void fetchList()} refreshLoading={loading} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total, fetchList)} scroll={{ x: 1100 }} />

      <AppModal title={editingRecord ? '编辑自动回复' : '新增自动回复'} visible={modalVisible}
        onOk={handleSubmit} onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        confirmLoading={submitting} width={600}>
        <Spin spinning={false} wrapperClassName="modal-spin-wrapper">
          <Form
            key={editingRecord?.id ?? `new-${modalType}`}
            getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
            labelPosition="left" labelWidth={90}
            initValues={editingRecord
              ? { keyword: editingRecord.keyword ?? '', matchType: editingRecord.matchType, content: editingRecord.content ?? '', status: editingRecord.status, sort: editingRecord.sort }
              : { matchType: 'contain', content: '', status: 'enabled', sort: 0 }}
          >
            <Row gutter={16}>
              <Col span={12}>
                <Form.Slot label="回复类型">
                  <Select style={{ width: '100%' }} optionList={REPLY_TYPE_OPTIONS} value={modalType}
                    disabled={!!editingRecord} onChange={(v) => setModalType(v as MpAutoReplyType)} />
                </Form.Slot>
              </Col>
              {modalType === 'keyword' && (
                <Col span={12}>
                  <Form.Select field="matchType" label="匹配方式" style={{ width: '100%' }} optionList={MATCH_OPTIONS} />
                </Col>
              )}
            </Row>
            {modalType === 'keyword' && (
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Input field="keyword" label="关键词" placeholder="请输入关键词"
                    rules={[{ required: true, message: '请输入关键词' }]} />
                </Col>
                <Col span={12}>
                  <Form.InputNumber field="sort" label="优先级" style={{ width: '100%' }} min={0} />
                </Col>
              </Row>
            )}
            <Form.TextArea field="content" label="回复内容" rows={4} placeholder="请输入回复内容"
              rules={[{ required: true, message: '请输入回复内容' }]} />
            <Form.Select field="status" label="状态" style={{ width: '100%' }}
              optionList={[{ label: '启用', value: 'enabled' }, { label: '禁用', value: 'disabled' }]} />
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
