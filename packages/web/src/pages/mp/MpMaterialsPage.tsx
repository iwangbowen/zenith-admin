import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Modal, Select, Spin, Tag, Toast, Banner, Upload, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, RotateCcw, Search, RefreshCw, UploadCloud } from 'lucide-react';
import type { MpMaterial, MpMaterialType } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, renderEllipsis } from '../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';
import {
  mpMaterialKeys,
  useDeleteMpMaterial,
  useMpMaterialList,
  useSaveMpMaterial,
  useSyncMpMaterials,
  useUploadMpMaterial,
} from '@/hooks/queries/mp-materials';

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

interface SearchParams { filterType: MpMaterialType | undefined; keyword: string; }
const defaultSearch: SearchParams = { filterType: undefined, keyword: '' };

export default function MpMaterialsPage() {
  const { hasPermission: can } = usePermission();
  const queryClient = useQueryClient();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearch);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearch);

  const listQuery = useMpMaterialList(currentId, {
    page,
    pageSize,
    type: submittedParams.filterType,
    keyword: submittedParams.keyword || undefined,
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MpMaterial | null>(null);
  const formRef = useRef<FormApi>(null);
  const [uploadVisible, setUploadVisible] = useState(false);
  const [uploadType, setUploadType] = useState<MpMaterialType>('image');
  const [uploadName, setUploadName] = useState('');

  const saveMutation = useSaveMpMaterial();
  const deleteMutation = useDeleteMpMaterial();
  const syncMutation = useSyncMpMaterials();
  const uploadMutation = useUploadMpMaterial();

  const ACCEPT_MAP: Record<MpMaterialType, string> = { image: 'image/*', thumb: 'image/*', voice: 'audio/*', video: 'video/*' };

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: mpMaterialKeys.lists(currentId) });
  };
  const handleReset = () => {
    setDraftParams(defaultSearch);
    setSubmittedParams(defaultSearch);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: mpMaterialKeys.lists(currentId) });
  };

  const handleSync = async () => {
    if (!currentId) return;
    const data = await syncMutation.mutateAsync(currentId);
    Toast.success(`同步完成：新增 ${data.created ?? 0}，更新 ${data.updated ?? 0}`);
  };

  const openCreate = () => { setEditingRecord(null); setModalVisible(true); };
  const openEdit = (record: MpMaterial) => { setEditingRecord(record); setModalVisible(true); };

  const handleSubmit = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current?.validate())!; } catch { throw new Error('validation'); }
    if (!currentId) return;
    await saveMutation.mutateAsync({ id: editingRecord?.id, values: editingRecord ? { name: values.name } : { ...values, accountId: currentId } });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
  };

  const handleDelete = (record: MpMaterial) => {
    Modal.confirm({
      title: `确定要删除素材「${record.name}」吗？`,
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(record.id);
        Toast.success('删除成功');
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
    createOperationColumn<MpMaterial>({
      width: 140,
      desktopInlineKeys: ['rename', 'delete'],
      menuAriaLabel: '素材操作',
      actions: (record) => [
        { key: 'rename', label: '重命名', hidden: !can('mp:material:update'), onClick: () => openEdit(record) },
        { key: 'delete', label: '删除', danger: true, hidden: !can('mp:material:delete'), onClick: () => handleDelete(record) },
      ],
    }),
  ];

  const renderAccountFilter = () => (
    <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
  );
  const renderTypeFilter = () => (
    <Select
      placeholder="类型"
      value={draftParams.filterType}
      onChange={(v) => setDraftParams({ ...draftParams, filterType: v as MpMaterialType | undefined })}
      optionList={TYPE_OPTIONS}
      showClear
      style={{ width: 120 }}
    />
  );
  const renderKeywordInput = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索素材名称"
      value={draftParams.keyword}
      onChange={(v) => setDraftParams({ ...draftParams, keyword: v })}
      onEnterPress={handleSearch}
      showClear
      style={{ width: 180 }}
    />
  );
  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => can('mp:material:create') ? (
    <Button type="primary" icon={<Plus size={14} />} disabled={!currentId} onClick={openCreate}>新增</Button>
  ) : null;
  const renderMaterialActions = () => {
    const syncButton = can('mp:material:sync') ? (
      <Button icon={<RefreshCw size={14} />} loading={syncMutation.isPending} disabled={!currentId} onClick={() => void handleSync()}>从微信同步</Button>
    ) : null;
    const uploadButton = can('mp:material:create') ? (
      <Button icon={<UploadCloud size={14} />} disabled={!currentId} onClick={() => { setUploadType('image'); setUploadName(''); setUploadVisible(true); }}>上传素材</Button>
    ) : null;
    return syncButton || uploadButton ? <>{syncButton}{uploadButton}</> : null;
  };

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderAccountFilter()}
            {renderTypeFilter()}
            {renderKeywordInput()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderMaterialActions()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordInput()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderAccountFilter()}
            {renderTypeFilter()}
          </>
        )}
        mobileActions={renderMaterialActions()}
        filterTitle="素材筛选"
        actionTitle="素材操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      {!accountsLoading && accounts.length === 0 && (
        <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" style={{ marginBottom: 12 }} />
      )}

      <ConfigurableTable bordered loading={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total)} scroll={{ x: 1000 }} />

      <AppModal title={editingRecord ? '重命名素材' : '新增素材'} visible={modalVisible}
        onOk={handleSubmit} onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        confirmLoading={saveMutation.isPending} width={520}>
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
            action=""
            name="file"
            limit={1}
            accept={ACCEPT_MAP[uploadType]}
            showUploadList
            disabled={uploadMutation.isPending || !currentId}
            customRequest={async ({ fileInstance, onProgress, onSuccess, onError }) => {
              if (!currentId) return;
              try {
                const formData = new FormData();
                formData.append('file', fileInstance);
                formData.append('accountId', String(currentId));
                formData.append('type', uploadType);
                if (uploadName) formData.append('name', uploadName);
                if (uploadType === 'video' && uploadName) formData.append('title', uploadName);
                await uploadMutation.mutateAsync({ formData, onProgress: (percent) => onProgress?.({ total: 100, loaded: percent }) });
                Toast.success('上传成功');
                setUploadVisible(false);
                onSuccess?.({});
              } catch {
                onError?.({ status: 0 });
              }
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
