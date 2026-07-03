import { useEffect, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Modal, Spin, Toast, Banner } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, RotateCcw, Search, RefreshCw } from 'lucide-react';
import type { MpTag } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, renderEllipsis } from '../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';
import { mpTagKeys, useDeleteMpTag, useMpTagList, useSaveMpTag, useSyncMpTags } from '@/hooks/queries/mp-tags';

export default function MpTagsPage() {
  const { hasPermission: can } = usePermission();
  const queryClient = useQueryClient();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();

  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MpTag | null>(null);
  const formRef = useRef<FormApi>(null);

  const listQuery = useMpTagList({
    accountId: currentId,
    page,
    pageSize,
    keyword: submittedKeyword || undefined,
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const syncMutation = useSyncMpTags();
  const saveMutation = useSaveMpTag();
  const deleteMutation = useDeleteMpTag();
  const syncing = syncMutation.isPending;
  const submitting = saveMutation.isPending;

  useEffect(() => {
    setPage(1);
  }, [currentId, setPage]);

  const handleSearch = () => {
    setPage(1);
    setSubmittedKeyword(draftKeyword);
    void queryClient.invalidateQueries({ queryKey: mpTagKeys.lists(currentId) });
  };
  const handleReset = () => {
    setDraftKeyword('');
    setSubmittedKeyword('');
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: mpTagKeys.lists(currentId) });
  };

  const handleSync = async () => {
    if (!currentId) return;
    const data = await syncMutation.mutateAsync(currentId);
    Toast.success(`同步完成：新增 ${data.created ?? 0}，更新 ${data.updated ?? 0}`);
  };

  const openCreate = () => { setEditingRecord(null); setModalVisible(true); };
  const openEdit = (record: MpTag) => { setEditingRecord(record); setModalVisible(true); };

  const handleSubmit = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current?.validate())!; } catch { throw new Error('validation'); }
    if (!currentId) return;
    await saveMutation.mutateAsync({ id: editingRecord?.id, accountId: currentId, name: values.name });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
  };

  const handleDelete = (record: MpTag) => {
    Modal.confirm({
      title: `确定要删除标签「${record.name}」吗？`,
      content: '删除后将从所有粉丝的本地标签中移除该标签。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(record.id);
        Toast.success('删除成功');
      },
    });
  };

  const columns = [
    { title: '标签名称', dataIndex: 'name', width: 200, render: renderEllipsis },
    { title: '微信标签ID', dataIndex: 'wechatTagId', width: 140, render: (v: number | null) => (v == null ? '— 未同步' : v) },
    { title: '粉丝数', dataIndex: 'fansCount', width: 120 },
    createdAtColumn,
    createOperationColumn<MpTag>({
      width: 160,
      desktopInlineKeys: ['edit', 'delete'],
      menuAriaLabel: '标签操作',
      actions: (record) => [
        { key: 'edit', label: '编辑', hidden: !can('mp:tag:update'), onClick: () => openEdit(record) },
        { key: 'delete', label: '删除', danger: true, hidden: !can('mp:tag:delete'), onClick: () => handleDelete(record) },
      ],
    }),
  ];

  const renderAccountFilter = () => (
    <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
  );
  const renderKeywordInput = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索标签名称"
      value={draftKeyword}
      onChange={setDraftKeyword}
      onEnterPress={handleSearch}
      showClear
      style={{ width: 180 }}
    />
  );
  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => can('mp:tag:create') ? (
    <Button type="primary" icon={<Plus size={14} />} disabled={!currentId} onClick={openCreate}>新增</Button>
  ) : null;
  const renderSyncButton = () => can('mp:tag:sync') ? (
    <Button icon={<RefreshCw size={14} />} loading={syncing} disabled={!currentId} onClick={() => void handleSync()}>从微信同步</Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderAccountFilter()}
            {renderKeywordInput()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderSyncButton()}
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
        mobileFilters={renderAccountFilter()}
        mobileActions={renderSyncButton()}
        filterTitle="标签筛选"
        actionTitle="标签操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      {!accountsLoading && accounts.length === 0 && (
        <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" style={{ marginBottom: 12 }} />
      )}

      <ConfigurableTable bordered loading={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total)}
        scroll={{ x: 800 }} />

      <AppModal title={editingRecord ? '编辑标签' : '新增标签'} visible={modalVisible}
        onOk={handleSubmit} onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        confirmLoading={submitting} width={480}>
        <Spin spinning={false} wrapperClassName="modal-spin-wrapper">
          <Form
            key={editingRecord?.id ?? 'new'}
            getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
            labelPosition="left" labelWidth={90}
            initValues={editingRecord ? { name: editingRecord.name } : { name: '' }}
          >
            <Form.Input field="name" label="标签名称" placeholder="请输入标签名称（最多30字）"
              maxLength={30} rules={[{ required: true, message: '请输入标签名称' }]} />
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
