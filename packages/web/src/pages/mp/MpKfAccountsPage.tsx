import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar, Button, Form, Input, Modal, Space, Spin, Tag, Toast, Banner } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, RotateCcw, Search, RefreshCw } from 'lucide-react';
import type { MpKfAccount } from '@zenith/shared';
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
  mpKfKeys,
  useDeleteMpKfAccount,
  useMpKfAccountList,
  useSaveMpKfAccount,
  useSyncMpKfAccounts,
} from '@/hooks/queries/mp-kf';

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
  const listQuery = useMpKfAccountList(currentId, { page, pageSize, keyword: submittedKeyword || undefined });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MpKfAccount | null>(null);
  const formRef = useRef<FormApi>(null);
  const syncMutation = useSyncMpKfAccounts();
  const saveMutation = useSaveMpKfAccount();
  const deleteMutation = useDeleteMpKfAccount();

  const handleSearch = () => {
    setPage(1);
    setSubmittedKeyword(draftKeyword);
    void queryClient.invalidateQueries({ queryKey: mpKfKeys.accountLists(currentId) });
  };
  const handleReset = () => {
    setDraftKeyword('');
    setSubmittedKeyword('');
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: mpKfKeys.accountLists(currentId) });
  };

  const handleSync = async () => {
    if (!currentId) return;
    await syncMutation.mutateAsync(currentId);
    Toast.success('同步完成');
  };

  const openCreate = () => { setEditingRecord(null); setModalVisible(true); };
  const openEdit = (record: MpKfAccount) => { setEditingRecord(record); setModalVisible(true); };

  const handleSubmit = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current?.validate())!; } catch { throw new Error('validation'); }
    if (!currentId) return;
    await saveMutation.mutateAsync({
      id: editingRecord?.id,
      values: editingRecord ? { nickname: values.nickname } : { accountId: currentId, kfAccount: values.kfAccount, nickname: values.nickname },
    });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
  };

  const handleDelete = (record: MpKfAccount) => {
    Modal.confirm({
      title: `确定删除客服「${record.nickname}」吗？`,
      content: '将同时删除微信侧客服账号。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(record.id);
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
    { title: '客服账号', dataIndex: 'kfAccount', width: 220, render: renderEllipsis },
    { title: '绑定微信号', dataIndex: 'inviteWx', width: 140, render: (v: string | null) => v || '—' },
    {
      title: '绑定状态', dataIndex: 'inviteStatus', width: 100,
      render: (v: string) => { const m = INVITE_LABEL[v] ?? INVITE_LABEL.none; return <Tag color={m.color} type="light">{m.label}</Tag>; },
    },
    createdAtColumn,
    createOperationColumn<MpKfAccount>({
      width: 140,
      desktopInlineKeys: ['edit', 'delete'],
      menuAriaLabel: '多客服操作',
      actions: (record) => [
        { key: 'edit', label: '编辑', hidden: !can('mp:kf:update'), onClick: () => openEdit(record) },
        { key: 'delete', label: '删除', danger: true, hidden: !can('mp:kf:delete'), onClick: () => handleDelete(record) },
      ],
    }),
  ];

  const renderAccountFilter = () => (
    <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
  );
  const renderKeywordInput = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索客服昵称"
      value={draftKeyword}
      onChange={setDraftKeyword}
      onEnterPress={handleSearch}
      showClear
      style={{ width: 180 }}
    />
  );
  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => can('mp:kf:create') ? (
    <Button type="primary" icon={<Plus size={14} />} disabled={!currentId} onClick={openCreate}>添加客服</Button>
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
        pagination={buildPagination(total)} scroll={{ x: 1000 }} />

      <AppModal title={editingRecord ? '编辑客服' : '添加客服'} visible={modalVisible}
        onOk={handleSubmit} onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        confirmLoading={saveMutation.isPending} width={520}>
        <Spin spinning={false} wrapperClassName="modal-spin-wrapper">
          <Form
            key={editingRecord?.id ?? 'new'}
            getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
            labelPosition="left" labelWidth={90}
            initValues={editingRecord ? { kfAccount: editingRecord.kfAccount, nickname: editingRecord.nickname } : { kfAccount: '', nickname: '' }}
          >
            <Form.Input field="kfAccount" label="客服账号" disabled={!!editingRecord}
              placeholder="形如 kf2001@公众号微信号" rules={[{ required: true, message: '请输入客服账号' }]} />
            <Form.Input field="nickname" label="客服昵称" placeholder="请输入客服昵称" rules={[{ required: true, message: '请输入客服昵称' }]} />
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
