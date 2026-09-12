import { useMemo } from 'react';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { Avatar, Button, Form, Space, Spin, Tag, Toast } from '@douyinfe/semi-ui';
import { RefreshCw } from 'lucide-react';
import type { CreateMpKfAccountInput, MpKfAccount } from '@zenith/shared/mp';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '../../utils/table-columns';
import { useListSearch } from '@/hooks/useListSearch';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountRequiredBanner } from './MpAccountRequiredBanner';
import { MpAccountSwitcher } from './MpAccountSwitcher';
import {
  mpKfAccountKeys,
  useDeleteMpKfAccounts,
  useMpKfAccountList,
  useSaveMpKfAccount,
  useSyncMpKfAccounts,
} from '@/hooks/queries/mp-kf';
import { CreateButton } from '@/components/toolbar-controls';
import { KeywordInput } from '@/components/search-filters';
import { abortSubmit } from '@/lib/abort-submit';
import { compactParams } from '@/lib/query';

const INVITE_LABEL: Record<string, { label: string; color: 'green' | 'orange' | 'grey' }> = {
  none: { label: '未邀请', color: 'grey' },
  inviting: { label: '邀请中', color: 'orange' },
  waiting: { label: '待确认', color: 'orange' },
  bound: { label: '已绑定', color: 'green' },
};

export default function MpKfAccountsPage() {
  const { hasPermission: can } = usePermission();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();
  const {
    page, pageSize, buildPagination,
    bindKeyword, submittedParams, handleSearch, handleReset,
  } = useListSearch<{ keyword: string }>({ defaults: { keyword: '' }, listKey: mpKfAccountKeys.lists });
  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword,
  }), [submittedParams]);
  const listQuery = useMpKfAccountList({
    accountId: currentId ?? 0,
    page,
    pageSize,
    ...filterQuery,
  }, !!currentId);

  const syncMutation = useSyncMpKfAccounts();
  const saveMutation = useSaveMpKfAccount();
  const deleteMutation = useDeleteMpKfAccounts();

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
    { title: '绑定微信号', dataIndex: 'inviteWx', width: 140, render: (v: string | null) => v || EMPTY_PLACEHOLDER },
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
        deleteAction({
          hidden: !can('mp:kf:delete'),
          title: `确定删除客服「${record.nickname}」吗？`,
          content: '将同时删除微信侧客服账号。',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ],
    }),
  ];

  const syncButton = can('mp:kf:sync') ? (
    <Button icon={<RefreshCw size={14} />} loading={syncMutation.isPending} disabled={!currentId} onClick={() => void handleSync()}>从微信同步</Button>
  ) : null;

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={(
          <>
            <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
            <KeywordInput placeholder="搜索客服昵称" {...bindKeyword('keyword')} width={180} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={(
          can('mp:kf:create') ? (
            <CreateButton onClick={modal.openCreate} disabled={!currentId}>添加客服</CreateButton>
          ) : null
        )}
        actions={syncButton}
        mobileActions={syncButton}
        filterTitle="多客服筛选"
        actionTitle="多客服操作"
      />

      <MpAccountRequiredBanner loading={accountsLoading} accountCount={accounts.length} />

      <ConfigurableTable columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

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
