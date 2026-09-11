import { useEffect } from 'react';
import { Button, Form, Spin, Toast } from '@douyinfe/semi-ui';
import { RefreshCw } from 'lucide-react';
import type { CreateMpTagInput, MpTag } from '@zenith/shared/mp';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { createdAtColumn, renderEllipsis } from '../../utils/table-columns';
import { useListSearch } from '@/hooks/useListSearch';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountRequiredBanner } from './MpAccountRequiredBanner';
import { MpAccountSwitcher } from './MpAccountSwitcher';
import { mpTagKeys, useDeleteMpTags, useMpTagList, useSaveMpTag, useSyncMpTags } from '@/hooks/queries/mp-tags';
import { CreateButton } from '@/components/toolbar-controls';
import { KeywordInput } from '@/components/search-filters';
import { abortSubmit } from '@/lib/abort-submit';

export default function MpTagsPage() {
  const { hasPermission: can } = usePermission();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();

  const {
    page, pageSize, setPage, buildPagination,
    bindKeyword, submittedParams, handleSearch, handleReset,
  } = useListSearch<{ keyword: string }>({ defaults: { keyword: '' }, listKey: mpTagKeys.lists });

  const listQuery = useMpTagList({
    accountId: currentId ?? 0,
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
  }, !!currentId);
  const syncMutation = useSyncMpTags();
  const saveMutation = useSaveMpTag();
  const deleteMutation = useDeleteMpTags();
  const syncing = syncMutation.isPending;
  useEffect(() => {
    setPage(1);
  }, [currentId, setPage]);

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
        deleteAction({
          hidden: !can('mp:tag:delete'),
          title: `确定要删除标签「${record.name}」吗？`,
          content: '删除后将从所有粉丝的本地标签中移除该标签。',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ],
    }),
  ];

  const renderSyncButton = () => can('mp:tag:sync') ? (
    <Button icon={<RefreshCw size={14} />} loading={syncing} disabled={!currentId} onClick={() => void handleSync()}>从微信同步</Button>
  ) : null;

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索标签名称" {...bindKeyword('keyword')} width={180} />}
        filters={<MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />}
        onSearch={handleSearch}
        onReset={handleReset}
        actions={renderSyncButton()}
        create={(
          can('mp:tag:create') ? (
            <CreateButton onClick={modal.openCreate} disabled={!currentId} />
          ) : null
        )}
        mobileActions={renderSyncButton()}
        filterTitle="标签筛选"
        actionTitle="标签操作"
      />

      <MpAccountRequiredBanner loading={accountsLoading} accountCount={accounts.length} />

      <ConfigurableTable<MpTag> columns={columns} {...listTableProps(listQuery, { pagination: buildPagination })} />

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
