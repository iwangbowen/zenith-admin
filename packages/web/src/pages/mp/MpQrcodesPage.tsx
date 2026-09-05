import { useEffect, useState } from 'react';
import { Button, Form, Image, Select, Spin, Tag, Toast, Banner, Typography } from '@douyinfe/semi-ui';
import { Plus } from 'lucide-react';
import { enumValueOf } from '@zenith/shared/core';
import { MP_QRCODE_TYPES, type CreateMpQrcodeInput, type MpQrcode, type MpQrcodeType } from '@zenith/shared/mp';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn } from '../../utils/table-columns';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';
import { mpQrcodeKeys, useCreateMpQrcode, useDeleteMpQrcodes, useMpQrcodeList } from '@/hooks/queries/mp-qrcodes';
import { useListSearch } from '@/hooks/useListSearch';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { useEditModal } from '@/hooks/useEditModal';
import { abortSubmit } from '@/lib/abort-submit';

const TYPE_OPTIONS = [
  { label: '永久二维码', value: 'permanent' },
  { label: '临时二维码', value: 'temporary' },
];
const TYPE_META: Record<MpQrcodeType, { label: string; color: 'green' | 'orange' }> = {
  permanent: { label: '永久', color: 'green' },
  temporary: { label: '临时', color: 'orange' },
};
type QrcodeFormValues = Pick<CreateMpQrcodeInput, 'sceneStr' | 'name' | 'expireSeconds' | 'rewardPoints'>;

export default function MpQrcodesPage() {
  const { hasPermission: can } = usePermission();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();

  interface SearchParams { filterType: MpQrcodeType | undefined; keyword: string; }
  const defaultSearch: SearchParams = { filterType: undefined, keyword: '' };
  const {
    page, pageSize, setPage, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: mpQrcodeKeys.lists });

  const [modalType, setModalType] = useState<MpQrcodeType>('permanent');

  const listQuery = useMpQrcodeList({
    accountId: currentId ?? 0,
    page,
    pageSize,
    type: submittedParams.filterType,
    keyword: submittedParams.keyword || undefined,
  }, !!currentId);
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const createMutation = useCreateMpQrcode();
  const deleteMutation = useDeleteMpQrcodes();
  const createModal = useEditModal<MpQrcode, QrcodeFormValues, Partial<CreateMpQrcodeInput>>({
    save: createMutation,
    defaults: { sceneStr: '', name: '', expireSeconds: 604800, rewardPoints: 0 },
    beforeSave: (values) => {
      if (!currentId) abortSubmit('validation');
      const payload: Partial<CreateMpQrcodeInput> = {
        accountId: currentId,
        type: modalType,
        sceneStr: values.sceneStr,
        name: values.name,
      };
      if (modalType === 'temporary') payload.expireSeconds = values.expireSeconds;
      payload.rewardPoints = values.rewardPoints ?? 0;
      return payload;
    },
    successMessage: () => '生成成功',
  });

  useEffect(() => {
    setPage(1);
  }, [currentId, setPage]);

  const openCreate = () => { setModalType('permanent'); createModal.openCreate(); };

  const handleDelete = (record: MpQrcode) => {
    confirmDelete({
      title: '确定要删除该二维码吗？',
      content: '删除后本地记录移除，已投放的二维码图片仍可能被扫描。',
      onOk: async () => {
        await deleteMutation.mutateAsync([record.id]);
        Toast.success('删除成功');
      },
    });
  };

  const columns = [
    { title: '名称', dataIndex: 'name', minWidth: 160, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 150 }}>{v}</Typography.Text> },
    { title: '场景值', dataIndex: 'sceneStr', width: 180, render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
    { title: '类型', dataIndex: 'type', width: 90, render: (v: MpQrcodeType) => <Tag color={TYPE_META[v].color} type="light">{TYPE_META[v].label}</Tag> },
    { title: '扫码次数', dataIndex: 'scanCount', width: 100, align: 'center' as const },
    { title: '奖励积分', dataIndex: 'rewardPoints', width: 100, align: 'center' as const, render: (v: number) => (v > 0 ? <Typography.Text type="success">+{v}</Typography.Text> : '—') },
    {
      title: '二维码', dataIndex: 'url', width: 90, align: 'center' as const,
      render: (v: string | null) => (v
        ? <Image src={v} width={48} height={48} style={{ borderRadius: 'var(--semi-border-radius-small)' }} />
        : '—'),
    },
    createdAtColumn,
    createOperationColumn<MpQrcode>({
      width: 100,
      desktopInlineKeys: ['delete'],
      menuAriaLabel: '二维码操作',
      actions: (record) => [
        { key: 'delete', label: '删除', danger: true, hidden: !can('mp:qrcode:delete'), onClick: () => handleDelete(record) },
      ],
    }),
  ];

  const renderAccountFilter = () => (
    <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
  );
  const renderTypeFilter = () => (
    <FilterSelect
      placeholder="全部类型"
      items={TYPE_OPTIONS}
      value={draftParams.filterType}
      onChange={(v) => setDraftParams({ ...draftParams, filterType: enumValueOf(MP_QRCODE_TYPES, v) })}
    />
  );
  const renderKeywordInput = () => (
    <KeywordInput placeholder="搜索名称 / 场景值" value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onSearch={handleSearch} width={200} />
  );
  const renderSearchButton = () => <SearchButton onClick={handleSearch} />;
  const renderResetButton = () => <ResetButton onClick={handleReset} />;
  const renderCreateButton = () => can('mp:qrcode:create') ? (
    <Button type="primary" icon={<Plus size={14} />} disabled={!currentId} onClick={openCreate}>生成二维码</Button>
  ) : null;

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
        filterTitle="二维码筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      {!accountsLoading && accounts.length === 0 && (
        <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" style={{ marginBottom: 12 }} />
      )}

      <ConfigurableTable bordered loading={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total)} />

      <AppModal {...createModal.modalProps} title="生成带参二维码" width={560}>
        <Spin spinning={false} wrapperClassName="modal-spin-wrapper">
          <Form
            {...createModal.formProps}
            key={`${createModal.formKey}-${modalType}`}
          >
            <Form.Slot label="二维码类型">
              <Select style={{ width: '100%' }} optionList={TYPE_OPTIONS} value={modalType} onChange={(v) => setModalType(v as MpQrcodeType)} />
            </Form.Slot>
            <Form.Input field="name" label="名称" placeholder="如：线下门店物料"
              rules={[{ required: true, message: '请输入名称' }]} maxLength={100} />
            <Form.Input field="sceneStr" label="场景值" placeholder="渠道标识，仅字母/数字/下划线/连字符"
              rules={[{ required: true, message: '请输入场景值' }, { pattern: /^[A-Za-z0-9_-]+$/, message: '仅支持字母、数字、下划线、连字符' }]} maxLength={64} />
            {modalType === 'temporary' && (
              <Form.InputNumber field="expireSeconds" label="有效期(秒)" style={{ width: '100%' }} min={60} max={2592000} step={60}
                rules={[{ required: true, message: '请设置有效期' }]} />
            )}
            <Form.InputNumber field="rewardPoints" label="扫码奖励积分" style={{ width: '100%' }} min={0} max={100000}
              extraText="扫码关注的粉丝若已绑定会员，自动入账该积分；0 表示不奖励" />
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
