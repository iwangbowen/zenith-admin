import { useState } from 'react';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { Button, Form, Input, Modal, Select, Spin, Tag, Toast, Upload, Typography } from '@douyinfe/semi-ui';
import { RefreshCw, UploadCloud } from 'lucide-react';
import { MP_MATERIAL_TYPES, MP_MATERIAL_TYPE_LABELS, MP_MATERIAL_TYPE_OPTIONS } from '@zenith/shared/mp';
import type { CreateMpMaterialInput, MpMaterial, MpMaterialType } from '@zenith/shared/mp';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { useListSearch } from '@/hooks/useListSearch';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { EMPTY_PLACEHOLDER, createdAtColumn, renderEllipsis } from '../../utils/table-columns';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountRequiredBanner } from './MpAccountRequiredBanner';
import { MpAccountSwitcher } from './MpAccountSwitcher';
import {
  mpMaterialKeys,
  useDeleteMpMaterials,
  useMpMaterialList,
  useSaveMpMaterial,
  useSyncMpMaterials,
  useUploadMpMaterial,
} from '@/hooks/queries/mp-materials';
import { CreateButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { abortSubmit } from '@/lib/abort-submit';
import { enumValueOf, formatBytes } from '@zenith/shared/core';

interface SearchParams { filterType: MpMaterialType | undefined; keyword: string; }
const defaultSearch: SearchParams = { filterType: undefined, keyword: '' };

export default function MpMaterialsPage() {
  const { hasPermission: can } = usePermission();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: mpMaterialKeys.lists });

  const listQuery = useMpMaterialList({
    accountId: currentId ?? 0,
    page,
    pageSize,
    type: submittedParams.filterType,
    keyword: submittedParams.keyword || undefined,
  }, !!currentId);

  const [uploadVisible, setUploadVisible] = useState(false);
  const [uploadType, setUploadType] = useState<MpMaterialType>('image');
  const [uploadName, setUploadName] = useState('');

  const saveMutation = useSaveMpMaterial();
  const deleteMutation = useDeleteMpMaterials();
  const syncMutation = useSyncMpMaterials();
  const uploadMutation = useUploadMpMaterial();

  const ACCEPT_MAP: Record<MpMaterialType, string> = { image: 'image/*', thumb: 'image/*', voice: 'audio/*', video: 'video/*' };

  const handleSync = async () => {
    if (!currentId) return;
    const data = await syncMutation.mutateAsync({ body: { accountId: currentId } });
    Toast.success(`同步完成：新增 ${data.created ?? 0}，更新 ${data.updated ?? 0}`);
  };

  const modal = useEditModal<MpMaterial, Partial<CreateMpMaterialInput>>({
    save: saveMutation,
    defaults: { type: 'image', name: '', url: '' },
    toValues: (record) => ({ name: record.name }),
    // 新增归属当前公众号；重命名只改名称
    beforeSave: (values, { isEdit }) => {
      if (!currentId) abortSubmit('validation');
      return isEdit ? { name: values.name } : { ...values, accountId: currentId };
    },
  });

  const columns = [
    {
      title: '预览', dataIndex: 'url', width: 90,
      render: (v: string | null, r: MpMaterial) => (
        (r.type === 'image' || r.type === 'thumb') && v
          ? <img src={v} alt={r.name} style={{ width: 56, height: 42, objectFit: 'cover', borderRadius: 'var(--semi-border-radius-small)', border: '1px solid var(--semi-color-border)' }} />
          : <Tag type="light">{MP_MATERIAL_TYPE_LABELS[r.type]}</Tag>
      ),
    },
    { title: '名称', dataIndex: 'name', minWidth: 180, render: renderEllipsis },
    { title: '类型', dataIndex: 'type', width: 90, render: (v: MpMaterialType) => MP_MATERIAL_TYPE_LABELS[v] },
    { title: '微信 MediaID', dataIndex: 'wechatMediaId', width: 200, render: (v: string | null) => v || '— 未同步' },
    { title: '大小', dataIndex: 'fileSize', width: 100, align: 'right' as const, render: (v: number | null) => (v == null ? EMPTY_PLACEHOLDER : formatBytes(v)) },
    createdAtColumn,
    createOperationColumn<MpMaterial>({
      width: 170,
      desktopInlineKeys: ['rename', 'delete'],
      menuAriaLabel: '素材操作',
      actions: (record) => [
        { key: 'rename', label: '重命名', hidden: !can('mp:material:update'), onClick: () => modal.openEdit(record) },
        deleteAction({
          hidden: !can('mp:material:delete'),
          title: `确定要删除素材「${record.name}」吗？`,
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ],
    }),
  ];

  const syncButton = can('mp:material:sync') ? (
    <Button icon={<RefreshCw size={14} />} loading={syncMutation.isPending} disabled={!currentId} onClick={() => void handleSync()}>从微信同步</Button>
  ) : null;
  const uploadButton = can('mp:material:create') ? (
    <Button icon={<UploadCloud size={14} />} disabled={!currentId} onClick={() => { setUploadType('image'); setUploadName(''); setUploadVisible(true); }}>上传素材</Button>
  ) : null;
  const materialActions = syncButton || uploadButton ? <>{syncButton}{uploadButton}</> : null;

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={(
          <>
            <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
            <KeywordInput placeholder="搜索素材名称" {...bindKeyword('keyword')} width={180} />
          </>
        )}
        filters={(
          <FilterSelect
            placeholder="全部类型"
            items={MP_MATERIAL_TYPE_OPTIONS}
            {...bind('filterType', (v) => enumValueOf(MP_MATERIAL_TYPES, v))}
          />
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={(
          can('mp:material:create') ? (
            <CreateButton onClick={modal.openCreate} disabled={!currentId} />
          ) : null
        )}
        actions={materialActions}
        mobileActions={materialActions}
        filterTitle="素材筛选"
        actionTitle="素材操作"
      />

      <MpAccountRequiredBanner loading={accountsLoading} accountCount={accounts.length} />

      <ConfigurableTable columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <AppModal {...modal.modalProps} title={modal.isEdit ? '重命名素材' : '新增素材'} width={520}>
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}>
            {!modal.isEdit && (
              <Form.Select field="type" label="素材类型" style={{ width: '100%' }} optionList={MP_MATERIAL_TYPE_OPTIONS} />
            )}
            <Form.Input field="name" label="素材名称" placeholder="请输入素材名称" rules={[{ required: true, message: '请输入素材名称' }]} />
            {!modal.isEdit && (
              <Form.Input field="url" label="素材URL" placeholder="图片/媒体可访问 URL（选填）" />
            )}
          </Form>
        </Spin>
      </AppModal>

      <Modal title="上传素材到微信" visible={uploadVisible} closeOnEsc footer={null} onCancel={() => setUploadVisible(false)} width={520}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
          <div>
            <Typography.Text type="secondary" size="small">素材类型</Typography.Text>
            <Select style={{ width: '100%', marginTop: 4 }} value={uploadType} onChange={(v) => setUploadType(v as MpMaterialType)} optionList={MP_MATERIAL_TYPE_OPTIONS} />
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
              <div>点击或拖拽文件到此处上传（{MP_MATERIAL_TYPE_LABELS[uploadType]}）</div>
            </div>
          </Upload>
        </div>
      </Modal>
    </div>
  );
}
