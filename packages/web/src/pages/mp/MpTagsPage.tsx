import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Spin, Toast, Banner } from '@douyinfe/semi-ui';
import { RefreshCw } from 'lucide-react';
import type { CreateMpTagInput, MpTag } from '@zenith/shared/mp';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, renderEllipsis } from '../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';
import { mpTagKeys, useDeleteMpTags, useMpTagList, useSaveMpTag, useSyncMpTags } from '@/hooks/queries/mp-tags';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { KeywordInput } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { abortSubmit } from '@/lib/abort-submit';

export default function MpTagsPage() {
  const { hasPermission: can } = usePermission();
  const queryClient = useQueryClient();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();

  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');

  const listQuery = useMpTagList({
    accountId: currentId ?? 0,
    page,
    pageSize,
    keyword: submittedKeyword || undefined,
  }, !!currentId);
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const syncMutation = useSyncMpTags();
  const saveMutation = useSaveMpTag();
  const deleteMutation = useDeleteMpTags();
  const syncing = syncMutation.isPending;
  useEffect(() => {
    setPage(1);
  }, [currentId, setPage]);

  const handleSearch = () => {
    setPage(1);
    setSubmittedKeyword(draftKeyword);
    void queryClient.invalidateQueries({ queryKey: mpTagKeys.lists });
  };
  const handleReset = () => {
    setDraftKeyword('');
    setSubmittedKeyword('');
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: mpTagKeys.lists });
  };

  const handleSync = async () => {
    if (!currentId) return;
    const data = await syncMutation.mutateAsync({ body: { accountId: currentId } });
    Toast.success(`同步完成：新增 ${data.created ?? 0}，更新 ${data.updated ?? 0}`);
  };

  const modal = useEditModal<MpTag, Pick<CreateMpTagInput, 'name'>, Partial<CreateMpTagInput>>({
    entityName: '标签',
    save: saveMutation,
    defaults: { name: '' },
    toValues: (record) => ({ name: record.name }),
    // 新增归属当前公众号；编辑只改名称
    beforeSave: (values, { isEdit }) => {
      if (isEdit) return { name: values.name };
      if (!currentId) abortSubmit('validation');
      return { accountId: currentId, name: values.name };
    },
  });

  const handleDelete = (record: MpTag) => {
    confirmDelete({
      title: `确定要删除标签「${record.name}」吗？`,
      content: '删除后将从所有粉丝的本地标签中移除该标签。',
      onOk: async () => {
        await deleteMutation.mutateAsync([record.id]);
        Toast.success('删除成功');
      },
    });
  };

  const columns = [
    { title: '标签名称', dataIndex: 'name', minWidth: 200, render: renderEllipsis },
    { title: '微信标签ID', dataIndex: 'wechatTagId', width: 140, render: (v: number | null) => (v == null ? '— 未同步' : v) },
    { title: '粉丝数', dataIndex: 'fansCount', width: 120, align: 'right' as const },
    createdAtColumn,
    createOperationColumn<MpTag>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      menuAriaLabel: '标签操作',
      actions: (record) => [
        { key: 'edit', label: '编辑', hidden: !can('mp:tag:update'), onClick: () => modal.openEdit(record) },
        { key: 'delete', label: '删除', danger: true, hidden: !can('mp:tag:delete'), onClick: () => handleDelete(record) },
      ],
    }),
  ];

  const renderAccountFilter = () => (
    <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
  );
  const renderKeywordInput = () => (
    <KeywordInput placeholder="搜索标签名称" value={draftKeyword} onChange={setDraftKeyword} onSearch={handleSearch} width={180} />
  );
  const renderSearchButton = () => <SearchButton onClick={handleSearch} />;
  const renderResetButton = () => <ResetButton onClick={handleReset} />;
  const renderCreateButton = () => can('mp:tag:create') ? (
    <CreateButton onClick={modal.openCreate} disabled={!currentId} />
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
        pagination={buildPagination(total)} />

      <AppModal {...modal.modalProps} width={480}>
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}>
            <Form.Input field="name" label="标签名称" placeholder="请输入标签名称（最多30字）"
              maxLength={30} rules={[{ required: true, message: '请输入标签名称' }]} />
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
