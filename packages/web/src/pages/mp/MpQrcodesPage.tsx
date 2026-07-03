import { useEffect, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Image, Input, Modal, Select, Spin, Tag, Toast, Banner, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type { MpQrcode, MpQrcodeType } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn } from '../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';
import { mpQrcodeKeys, useCreateMpQrcode, useDeleteMpQrcode, useMpQrcodeList } from '@/hooks/queries/mp-qrcodes';

const TYPE_OPTIONS = [
  { label: '永久二维码', value: 'permanent' },
  { label: '临时二维码', value: 'temporary' },
];
const TYPE_META: Record<MpQrcodeType, { label: string; color: 'green' | 'orange' }> = {
  permanent: { label: '永久', color: 'green' },
  temporary: { label: '临时', color: 'orange' },
};

export default function MpQrcodesPage() {
  const { hasPermission: can } = usePermission();
  const queryClient = useQueryClient();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();

  const { page, pageSize, setPage, buildPagination } = usePagination();

  interface SearchParams { filterType: MpQrcodeType | undefined; keyword: string; }
  const defaultSearch: SearchParams = { filterType: undefined, keyword: '' };
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearch);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearch);

  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<MpQrcodeType>('permanent');
  const formRef = useRef<FormApi>(null);

  const listQuery = useMpQrcodeList({
    accountId: currentId,
    page,
    pageSize,
    type: submittedParams.filterType,
    keyword: submittedParams.keyword || undefined,
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const createMutation = useCreateMpQrcode();
  const deleteMutation = useDeleteMpQrcode();
  const submitting = createMutation.isPending;

  useEffect(() => {
    setPage(1);
  }, [currentId, setPage]);

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: mpQrcodeKeys.lists(currentId) });
  };
  const handleReset = () => {
    setDraftParams(defaultSearch);
    setSubmittedParams(defaultSearch);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: mpQrcodeKeys.lists(currentId) });
  };

  const openCreate = () => { setModalType('permanent'); setModalVisible(true); };

  const handleSubmit = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current?.validate())!; } catch { throw new Error('validation'); }
    if (!currentId) return;
    const payload: Record<string, unknown> = {
      accountId: currentId,
      type: modalType,
      sceneStr: values.sceneStr,
      name: values.name,
    };
    if (modalType === 'temporary') payload.expireSeconds = values.expireSeconds;
    payload.rewardPoints = values.rewardPoints ?? 0;

    await createMutation.mutateAsync(payload);
    Toast.success('生成成功');
    setModalVisible(false);
  };

  const handleDelete = (record: MpQrcode) => {
    Modal.confirm({
      title: '确定要删除该二维码吗？',
      content: '删除后本地记录移除，已投放的二维码图片仍可能被扫描。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(record.id);
        Toast.success('删除成功');
      },
    });
  };

  const columns = [
    { title: '名称', dataIndex: 'name', width: 160, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 150 }}>{v}</Typography.Text> },
    { title: '场景值', dataIndex: 'sceneStr', width: 180, render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
    { title: '类型', dataIndex: 'type', width: 90, render: (v: MpQrcodeType) => <Tag color={TYPE_META[v].color} type="light">{TYPE_META[v].label}</Tag> },
    { title: '扫码次数', dataIndex: 'scanCount', width: 100, align: 'center' as const },
    { title: '奖励积分', dataIndex: 'rewardPoints', width: 100, align: 'center' as const, render: (v: number) => (v > 0 ? <Typography.Text type="success">+{v}</Typography.Text> : '—') },
    {
      title: '二维码', dataIndex: 'url', width: 90, align: 'center' as const,
      render: (v: string | null) => (v
        ? <Image src={v} width={48} height={48} style={{ borderRadius: 4 }} />
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
    <Select
      placeholder="类型"
      value={draftParams.filterType}
      onChange={(v) => setDraftParams({ ...draftParams, filterType: v as MpQrcodeType | undefined })}
      optionList={TYPE_OPTIONS}
      showClear
      style={{ width: 130 }}
    />
  );
  const renderKeywordInput = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索名称 / 场景值"
      value={draftParams.keyword}
      onChange={(v) => setDraftParams({ ...draftParams, keyword: v })}
      onEnterPress={handleSearch}
      showClear
      style={{ width: 200 }}
    />
  );
  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
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
        pagination={buildPagination(total)} scroll={{ x: 1000 }} />

      <AppModal title="生成带参二维码" visible={modalVisible}
        onOk={handleSubmit} onCancel={() => setModalVisible(false)} confirmLoading={submitting} width={560}>
        <Spin spinning={false} wrapperClassName="modal-spin-wrapper">
          <Form
            key={`new-${modalType}`}
            getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
            labelPosition="left" labelWidth={90}
            initValues={{ sceneStr: '', name: '', expireSeconds: 604800, rewardPoints: 0 }}
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
