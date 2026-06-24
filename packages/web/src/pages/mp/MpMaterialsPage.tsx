import { useEffect, useState, useCallback, useRef } from 'react';
import { Button, Form, Input, Modal, Select, Space, Spin, Tag, Toast, Banner, Upload, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, RotateCcw, Search, RefreshCw, UploadCloud } from 'lucide-react';
import { TOKEN_KEY } from '@zenith/shared';
import type { PaginatedResponse, MpMaterial, MpMaterialType } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { request } from '@/utils/request';
import { config } from '@/config';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createdAtColumn, renderEllipsis } from '../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';

const TYPE_OPTIONS = [
  { label: '图片', value: 'image' },
  { label: '语音', value: 'voice' },
  { label: '视频', value: 'video' },
  { label: '缩略图', value: 'thumb' },
];

function fmtSize(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function MpMaterialsPage() {
  const { hasPermission: can } = usePermission();
  const { accounts, currentId, currentIdRef, setCurrentId, loading: accountsLoading } = useMpAccounts();

  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<MpMaterial[]>([]);
  const [total, setTotal] = useState(0);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();

  interface SearchParams { filterType: MpMaterialType | undefined; keyword: string; }
  const defaultSearch: SearchParams = { filterType: undefined, keyword: '' };
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearch);
  const searchRef = useRef<SearchParams>(defaultSearch);
  searchRef.current = searchParams;

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MpMaterial | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const formRef = useRef<FormApi>(null);

  const [uploadVisible, setUploadVisible] = useState(false);
  const [uploadType, setUploadType] = useState<MpMaterialType>('image');
  const [uploadName, setUploadName] = useState('');
  const [uploading, setUploading] = useState(false);

  const ACCEPT_MAP: Record<MpMaterialType, string> = { image: 'image/*', thumb: 'image/*', voice: 'audio/*', video: 'video/*' };

  const fetchList = useCallback(
    async (p = page, ps = pageSize, params?: SearchParams) => {
      if (!currentId) { setList([]); setTotal(0); return; }
      const reqId = currentId;
      const { filterType, keyword } = params ?? searchRef.current;
      setLoading(true);
      try {
        const query = new URLSearchParams({ page: String(p), pageSize: String(ps), accountId: String(currentId) });
        if (filterType) query.set('type', filterType);
        if (keyword) query.set('keyword', keyword);
        const res = await request.get<PaginatedResponse<MpMaterial>>(`/api/mp/materials?${query}`);
        if (currentIdRef.current !== reqId) return; // 账号已切换，丢弃过期响应
        setList(res.data?.list ?? []);
        setTotal(res.data?.total ?? 0);
        setPage(res.data?.page ?? p);
        setPageSize(res.data?.pageSize ?? ps);
      } finally { setLoading(false); }
    },
    [page, pageSize, currentId, currentIdRef, setPage, setPageSize],
  );

  useEffect(() => { setPage(1); void fetchList(1, pageSize, searchRef.current); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [currentId]);

  const handleSearch = () => { setPage(1); void fetchList(1, pageSize); };
  const handleReset = () => { setSearchParams(defaultSearch); setPage(1); void fetchList(1, pageSize, defaultSearch); };

  const handleSync = async () => {
    if (!currentId) return;
    setSyncing(true);
    try {
      const res = await request.post<{ created: number; updated: number }>('/api/mp/materials/sync', { accountId: currentId });
      if (res.code === 0) { Toast.success(`同步完成：新增 ${res.data?.created ?? 0}，更新 ${res.data?.updated ?? 0}`); void fetchList(); }
    } finally { setSyncing(false); }
  };

  const openCreate = () => { setEditingRecord(null); setModalVisible(true); };
  const openEdit = (record: MpMaterial) => { setEditingRecord(record); setModalVisible(true); };

  const handleSubmit = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current?.validate())!; } catch { return; }
    if (!currentId) return;
    setSubmitting(true);
    try {
      if (editingRecord) {
        const res = await request.put(`/api/mp/materials/${editingRecord.id}`, { name: values.name });
        if (res.code !== 0) return;
        Toast.success('更新成功');
      } else {
        const res = await request.post('/api/mp/materials', { ...values, accountId: currentId });
        if (res.code !== 0) return;
        Toast.success('创建成功');
      }
      setModalVisible(false);
      void fetchList();
    } finally { setSubmitting(false); }
  };

  const handleDelete = (record: MpMaterial) => {
    Modal.confirm({
      title: `确定要删除素材「${record.name}」吗？`,
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete(`/api/mp/materials/${record.id}`);
        if (res.code !== 0) return;
        Toast.success('删除成功');
        void fetchList();
      },
    });
  };

  const columns = [
    {
      title: '预览', dataIndex: 'url', width: 90,
      render: (v: string | null, r: MpMaterial) => (
        (r.type === 'image' || r.type === 'thumb') && v
          ? <img src={v} alt={r.name} style={{ width: 56, height: 42, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--semi-color-border)' }} />
          : <Tag type="light">{TYPE_OPTIONS.find((t) => t.value === r.type)?.label ?? r.type}</Tag>
      ),
    },
    { title: '名称', dataIndex: 'name', width: 180, render: renderEllipsis },
    { title: '类型', dataIndex: 'type', width: 90, render: (v: string) => TYPE_OPTIONS.find((t) => t.value === v)?.label ?? v },
    { title: '微信 MediaID', dataIndex: 'wechatMediaId', width: 200, render: (v: string | null) => v || '— 未同步' },
    { title: '大小', dataIndex: 'fileSize', width: 100, render: (v: number | null) => fmtSize(v) },
    createdAtColumn,
    {
      title: '操作', key: 'actions', width: 140, fixed: 'right' as const,
      render: (_: unknown, record: MpMaterial) => (
        <Space>
          {can('mp:material:update') && <Button theme="borderless" size="small" onClick={() => openEdit(record)}>重命名</Button>}
          {can('mp:material:delete') && <Button theme="borderless" type="danger" size="small" onClick={() => handleDelete(record)}>删除</Button>}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
        <Select placeholder="类型" value={searchParams.filterType} onChange={(v) => setSearchParams({ ...searchParams, filterType: v as MpMaterialType | undefined })}
          optionList={TYPE_OPTIONS} showClear style={{ width: 120 }} />
        <Input prefix={<Search size={14} />} placeholder="搜索素材名称" value={searchParams.keyword}
          onChange={(v) => setSearchParams({ ...searchParams, keyword: v })} onEnterPress={handleSearch} showClear style={{ width: 180 }} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {can('mp:material:sync') && <Button icon={<RefreshCw size={14} />} loading={syncing} disabled={!currentId} onClick={() => void handleSync()}>从微信同步</Button>}
        {can('mp:material:create') && <Button icon={<UploadCloud size={14} />} disabled={!currentId} onClick={() => { setUploadType('image'); setUploadName(''); setUploadVisible(true); }}>上传素材</Button>}
        {can('mp:material:create') && <Button type="primary" icon={<Plus size={14} />} disabled={!currentId} onClick={openCreate}>新增</Button>}
      </SearchToolbar>

      {!accountsLoading && accounts.length === 0 && (
        <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" style={{ marginBottom: 12 }} />
      )}

      <ConfigurableTable bordered loading={loading} onRefresh={() => void fetchList()} refreshLoading={loading} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total, fetchList)} scroll={{ x: 1000 }} />

      <AppModal title={editingRecord ? '重命名素材' : '新增素材'} visible={modalVisible}
        onOk={handleSubmit} onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        confirmLoading={submitting} width={520}>
        <Spin spinning={false} wrapperClassName="modal-spin-wrapper">
          <Form
            key={editingRecord?.id ?? 'new'}
            getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
            labelPosition="left" labelWidth={90}
            initValues={editingRecord ? { name: editingRecord.name } : { type: 'image', name: '', url: '' }}
          >
            {!editingRecord && (
              <Form.Select field="type" label="素材类型" style={{ width: '100%' }} optionList={TYPE_OPTIONS} />
            )}
            <Form.Input field="name" label="素材名称" placeholder="请输入素材名称" rules={[{ required: true, message: '请输入素材名称' }]} />
            {!editingRecord && (
              <Form.Input field="url" label="素材URL" placeholder="图片/媒体可访问 URL（选填）" />
            )}
          </Form>
        </Spin>
      </AppModal>

      <Modal title="上传素材到微信" visible={uploadVisible} footer={null} onCancel={() => setUploadVisible(false)} width={520}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
          <div>
            <Typography.Text type="secondary" size="small">素材类型</Typography.Text>
            <Select style={{ width: '100%', marginTop: 4 }} value={uploadType} onChange={(v) => setUploadType(v as MpMaterialType)} optionList={TYPE_OPTIONS} />
          </div>
          <div>
            <Typography.Text type="secondary" size="small">素材名称（选填，默认取文件名）</Typography.Text>
            <Input style={{ marginTop: 4 }} value={uploadName} onChange={setUploadName} placeholder="请输入素材名称" maxLength={200} />
          </div>
          <Upload
            action={`${config.apiBaseUrl}/api/mp/materials/upload`}
            headers={{ Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) ?? ''}` }}
            name="file"
            limit={1}
            accept={ACCEPT_MAP[uploadType]}
            showUploadList
            disabled={uploading || !currentId}
            data={() => ({ accountId: String(currentId ?? ''), type: uploadType, name: uploadName, ...(uploadType === 'video' ? { title: uploadName } : {}) })}
            onChange={({ fileList }) => setUploading(fileList.some((f) => f.status === 'uploading'))}
            onSuccess={(res) => {
              if (res?.code === 0) { Toast.success('上传成功'); setUploadVisible(false); void fetchList(); }
              else Toast.error(res?.message || '上传失败');
            }}
            onError={() => Toast.error('上传失败，请重试')}
            draggable
          >
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--semi-color-text-2)' }}>
              <UploadCloud size={28} style={{ marginBottom: 8 }} />
              <div>点击或拖拽文件到此处上传（{TYPE_OPTIONS.find((t) => t.value === uploadType)?.label}）</div>
            </div>
          </Upload>
        </div>
      </Modal>
    </div>
  );
}
