import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar, Button, Form, Space, Spin, Tag, Toast, Banner } from '@douyinfe/semi-ui';
import { RefreshCw } from 'lucide-react';
import type { CreateMpKfAccountInput, MpKfAccount } from '@zenith/shared/mp';
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
import {
  mpKfAccountKeys,
  useDeleteMpKfAccounts,
  useMpKfAccountList,
  useSaveMpKfAccount,
  useSyncMpKfAccounts,
} from '@/hooks/queries/mp-kf';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { KeywordInput } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { abortSubmit } from '@/lib/abort-submit';

const INVITE_LABEL: Record<string, { label: string; color: 'green' | 'orange' | 'grey' }> = {
  none: { label: '未邀请', color: 'grey' },
  inviting: { label: '邀请中', color: 'orange' },
  waiting: { label: '待确认', color: 'orange' },
  bound: { label: '已绑定', color: 'green' },
};

export default function MpKfAccountsPage() {
  const { hasPermission: can } = usePermission();
  const queryClient = useQueryClient();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const listQuery = useMpKfAccountList({ accountId: currentId ?? 0, page, pageSize, keyword: submittedKeyword || undefined }, !!currentId);
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const syncMutation = useSyncMpKfAccounts();
  const saveMutation = useSaveMpKfAccount();
  const deleteMutation = useDeleteMpKfAccounts();

  const handleSearch = () => {
    setPage(1);
    setSubmittedKeyword(draftKeyword);
    void queryClient.invalidateQueries({ queryKey: mpKfAccountKeys.lists });
  };
  const handleReset = () => {
    setDraftKeyword('');
    setSubmittedKeyword('');
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: mpKfAccountKeys.lists });
  };

  const handleSync = async () => {
    if (!currentId) return;
    await syncMutation.mutateAsync({ body: { accountId: currentId } });
    Toast.success('同步完成');
  };

  const modal = useEditModal<MpKfAccount, Pick<CreateMpKfAccountInput, 'kfAccount' | 'nickname'>, Partial<CreateMpKfAccountInput>>({
    save: saveMutation,
    defaults: { kfAccount: '', nickname: '' },
    toValues: (record) => ({ kfAccount: record.kfAccount, nickname: record.nickname }),
    // 新增归属当前公众号；编辑只改昵称
    beforeSave: (values, { isEdit }) => {
      if (!currentId) abortSubmit('validation');
      return isEdit ? { nickname: values.nickname } : { accountId: currentId, kfAccount: values.kfAccount, nickname: values.nickname };
    },
  });

  const handleDelete = (record: MpKfAccount) => {
    confirmDelete({
      title: `确定删除客服「${record.nickname}」吗？`,
      content: '将同时删除微信侧客服账号。',
      onOk: async () => {
        await deleteMutation.mutateAsync([record.id]);
        Toast.success('删除成功');
      },
    });
  };

  const columns = [
    {
      title: '客服', dataIndex: 'nickname', width: 200,
      render: (_: unknown, r: MpKfAccount) => (
        <Space>
          <Avatar size="small" src={r.avatar ?? undefined} color="blue">{r.nickname.slice(0, 1)}</Avatar>
          <span>{r.nickname}</span>
        </Space>
      ),
    },
    { title: '客服账号', dataIndex: 'kfAccount', minWidth: 220, render: renderEllipsis },
    { title: '绑定微信号', dataIndex: 'inviteWx', width: 140, render: (v: string | null) => v || '—' },
    {
      title: '绑定状态', dataIndex: 'inviteStatus', width: 100,
      render: (v: string) => { const m = INVITE_LABEL[v] ?? INVITE_LABEL.none; return <Tag color={m.color} type="light">{m.label}</Tag>; },
    },
    createdAtColumn,
    createOperationColumn<MpKfAccount>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      menuAriaLabel: '多客服操作',
      actions: (record) => [
        { key: 'edit', label: '编辑', hidden: !can('mp:kf:update'), onClick: () => modal.openEdit(record) },
        { key: 'delete', label: '删除', danger: true, hidden: !can('mp:kf:delete'), onClick: () => handleDelete(record) },
      ],
    }),
  ];

  const renderAccountFilter = () => (
    <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
  );
  const renderKeywordInput = () => (
    <KeywordInput placeholder="搜索客服昵称" value={draftKeyword} onChange={setDraftKeyword} onSearch={handleSearch} width={180} />
  );
  const renderSearchButton = () => <SearchButton onClick={handleSearch} />;
  const renderResetButton = () => <ResetButton onClick={handleReset} />;
  const renderCreateButton = () => can('mp:kf:create') ? (
    <CreateButton onClick={modal.openCreate} disabled={!currentId}>添加客服</CreateButton>
  ) : null;
  const renderSyncButton = () => can('mp:kf:sync') ? (
    <Button icon={<RefreshCw size={14} />} loading={syncMutation.isPending} disabled={!currentId} onClick={() => void handleSync()}>从微信同步</Button>
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
        filterTitle="多客服筛选"
        actionTitle="多客服操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      {!accountsLoading && accounts.length === 0 && (
        <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" style={{ marginBottom: 12 }} />
      )}

      <ConfigurableTable bordered loading={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total)} />

      <AppModal {...modal.modalProps} title={modal.isEdit ? '编辑客服' : '添加客服'} width={520}>
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}>
            <Form.Input field="kfAccount" label="客服账号" disabled={modal.isEdit}
              placeholder="形如 kf2001@公众号微信号" rules={[{ required: true, message: '请输入客服账号' }]} />
            <Form.Input field="nickname" label="客服昵称" placeholder="请输入客服昵称" rules={[{ required: true, message: '请输入客服昵称' }]} />
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
