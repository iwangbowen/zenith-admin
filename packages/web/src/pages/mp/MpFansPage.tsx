import { useEffect } from 'react';
import { Avatar, Button, Form, Modal, Space, Spin, Tag, Toast, Banner } from '@douyinfe/semi-ui';
import { RefreshCw, Ban } from 'lucide-react';
import { MP_FAN_SUBSCRIBES, type MpFan, type MpFanSubscribe, type UpdateMpFanInput } from '@zenith/shared/mp';
import { enumValueOf } from '@zenith/shared/core';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { dateTimeColumn, renderEllipsis } from '../../utils/table-columns';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';
import {
  mpFanKeys,
  useBlacklistMpFans,
  useCreateMpFanMember,
  useMpFanList,
  useSaveMpFan,
  useSyncMpBlacklist,
  useSyncMpFans,
  useUnblacklistMpFans,
  useUnbindMpFanMember,
} from '@/hooks/queries/mp-fans';
import { useMpTagOptions } from '@/hooks/queries/mp-tags';
import { useListSearch } from '@/hooks/useListSearch';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { confirmDanger } from '@/utils/confirm';
import { useEditModal } from '@/hooks/useEditModal';

const SEX_LABELS: Record<number, string> = { 0: '未知', 1: '男', 2: '女' };
const SUBSCRIBE_OPTIONS = [
  { label: '已关注', value: 'subscribed' },
  { label: '已取关', value: 'unsubscribed' },
];

export default function MpFansPage() {
  const { hasPermission: can } = usePermission();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();

  const tagsQuery = useMpTagOptions(currentId);
  const tags = tagsQuery.data?.list ?? [];
  const tagMap = new Map(tags.map((t) => [t.id, t.name]));

  interface SearchParams { keyword: string; subscribe: MpFanSubscribe | undefined; tagId: number | undefined; blacklisted: boolean | undefined; }
  const defaultSearch: SearchParams = { keyword: '', subscribe: undefined, tagId: undefined, blacklisted: undefined };
  const {
    page, pageSize, setPage, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: mpFanKeys.lists });

  const listQuery = useMpFanList({
    accountId: currentId ?? 0,
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    subscribe: submittedParams.subscribe,
    tagId: submittedParams.tagId,
    blacklisted: submittedParams.blacklisted,
  }, !!currentId);
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const syncFansMutation = useSyncMpFans();
  const syncBlacklistMutation = useSyncMpBlacklist();
  const blacklistMutation = useBlacklistMpFans();
  const unblacklistMutation = useUnblacklistMpFans();
  const saveMutation = useSaveMpFan();
  const createMemberMutation = useCreateMpFanMember();
  const unbindMemberMutation = useUnbindMpFanMember();
  const syncing = syncFansMutation.isPending || syncBlacklistMutation.isPending;
  const fanModal = useEditModal<MpFan, Partial<UpdateMpFanInput>>({
    save: saveMutation,
    toValues: (fan) => ({ remark: fan.remark ?? '', tagIds: fan.tagIds }),
    beforeSave: (values) => ({ remark: values.remark ?? '', tagIds: values.tagIds ?? [] }),
    successMessage: () => '保存成功',
    labelWidth: 72,
  });

  useEffect(() => {
    setPage(1);
  }, [currentId, setPage]);

  const handleSync = async () => {
    if (!currentId) return;
    const data = await syncFansMutation.mutateAsync({ body: { accountId: currentId } });
    Toast.success(`同步完成：共处理 ${data.synced ?? 0} 个粉丝`);
  };

  const handleBlacklist = async (record: MpFan) => {
    if (!currentId) return;
    const input = { body: { accountId: currentId, openids: [record.openid] } };
    await (record.blacklisted ? unblacklistMutation.mutateAsync(input) : blacklistMutation.mutateAsync(input));
    Toast.success(record.blacklisted ? '已移出黑名单' : '已拉黑');
  };

  const handleSyncBlacklist = async () => {
    if (!currentId) return;
    const data = await syncBlacklistMutation.mutateAsync({ body: { accountId: currentId } });
    Toast.success(`黑名单同步完成：共 ${data.synced ?? 0} 个`);
  };

  const handleCreateMember = async (record: MpFan) => {
    await createMemberMutation.mutateAsync({ params: { id: record.id } });
    Toast.success('会员已创建并绑定');
  };

  const handleUnbindMember = async (record: MpFan) => {
    await unbindMemberMutation.mutateAsync({ params: { id: record.id } });
    Toast.success('已解绑会员');
  };

  const confirmUnbindMember = (record: MpFan) => {
    confirmDanger({
      title: '确定解绑该粉丝的会员？',
      onOk: () => handleUnbindMember(record),
    });
  };

  const confirmBlacklist = (record: MpFan) => {
    Modal.confirm({
      title: record.blacklisted ? '移出黑名单？' : '确定拉黑该粉丝？',
      okButtonProps: record.blacklisted ? undefined : { type: 'danger', theme: 'solid' },
      onOk: () => handleBlacklist(record),
    });
  };

  const columns = [
    {
      title: '粉丝', dataIndex: 'nickname', width: 200,
      render: (v: string | null, record: MpFan) => (
        <Space>
          <Avatar size="extra-small" src={record.avatar ?? undefined} color="blue">{(v ?? '?').slice(0, 1)}</Avatar>
          <span>{v || '（未命名）'}</span>
        </Space>
      ),
    },
    { title: 'openid', dataIndex: 'openid', width: 200, render: renderEllipsis },
    { title: '性别', dataIndex: 'sex', width: 70, render: (v: number) => SEX_LABELS[v] ?? '未知' },
    { title: '地区', dataIndex: 'province', width: 140, render: (_: unknown, r: MpFan) => [r.province, r.city].filter(Boolean).join(' ') || '—' },
    {
      title: '标签', dataIndex: 'tagIds', width: 200,
      render: (ids: number[]) => (
        ids.length === 0 ? '—' : (
          <Space wrap spacing={4}>
            {ids.map((id) => <Tag key={id} color="light-blue" type="light" size="small">{tagMap.get(id) ?? `#${id}`}</Tag>)}
          </Space>
        )
      ),
    },
    { title: '备注', dataIndex: 'remark', minWidth: 140, render: (v: string | null) => v || '—' },
    dateTimeColumn('关注时间', 'subscribeTime'),
    {
      title: '会员', dataIndex: 'memberId', width: 130, align: 'center' as const,
      render: (v: number | null) => (v ? <Tag color="green" type="light">已绑定 #{v}</Tag> : <Tag color="grey" type="light">未绑定</Tag>),
    },
    {
      title: '关注状态', dataIndex: 'subscribe', width: 140, align: 'center' as const, fixed: 'right' as const,
      render: (v: MpFanSubscribe, r: MpFan) => (
        <Space spacing={2}>
          {v === 'subscribed' ? <Tag color="green" type="light">已关注</Tag> : <Tag color="grey" type="light">已取关</Tag>}
          {r.blacklisted && <Tag color="red" type="light">黑名单</Tag>}
        </Space>
      ),
    },
    createOperationColumn<MpFan>({
      width: 280,
      desktopInlineKeys: ['edit', 'member', 'blacklist'],
      menuAriaLabel: '粉丝操作',
      actions: (record) => [
        { key: 'edit', label: '编辑', hidden: !can('mp:fan:update'), onClick: () => fanModal.openEdit(record) },
        {
          key: 'member',
          label: record.memberId ? '解绑会员' : '创建会员',
          danger: !!record.memberId,
          hidden: !can('mp:fan:bind'),
          onClick: () => (record.memberId ? confirmUnbindMember(record) : void handleCreateMember(record)),
        },
        {
          key: 'blacklist',
          label: record.blacklisted ? '移出黑名单' : '拉黑',
          danger: !record.blacklisted,
          hidden: !can('mp:fan:blacklist'),
          onClick: () => confirmBlacklist(record),
        },
      ],
    }),
  ];

  const renderAccountFilter = () => (
    <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
  );
  const renderKeywordInput = () => (
    <KeywordInput placeholder="搜索昵称/openid/备注" value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onSearch={handleSearch} width={200} />
  );
  const renderSubscribeFilter = () => (
    <FilterSelect
      placeholder="全部关注状态"
      items={SUBSCRIBE_OPTIONS}
      value={draftParams.subscribe}
      onChange={(v) => setDraftParams({ ...draftParams, subscribe: enumValueOf(MP_FAN_SUBSCRIBES, v) })}
      width={140}
    />
  );
  const renderTagFilter = () => (
    <FilterSelect
      placeholder="全部标签"
      items={tags.map((t) => ({ label: t.name, value: t.id }))}
      value={draftParams.tagId}
      onChange={(v) => setDraftParams({ ...draftParams, tagId: v as number | undefined })}
      width={150}
      filter
    />
  );
  const renderBlacklistFilter = () => (
    <FilterSelect
      placeholder="全部黑名单"
      items={[{ label: '黑名单', value: 'true' }, { label: '正常', value: 'false' }]}
      value={draftParams.blacklisted === undefined ? undefined : String(draftParams.blacklisted)}
      onChange={(v) => setDraftParams({ ...draftParams, blacklisted: v === undefined ? undefined : v === 'true' })}
      width={140}
    />
  );
  const renderSearchButton = () => <SearchButton onClick={handleSearch} />;
  const renderResetButton = () => <ResetButton onClick={handleReset} />;
  const renderSyncActions = () => {
    const syncButton = can('mp:fan:sync') ? (
      <Button icon={<RefreshCw size={14} />} loading={syncing} disabled={!currentId} onClick={() => void handleSync()}>同步粉丝</Button>
    ) : null;
    const blacklistButton = can('mp:fan:blacklist') ? (
      <Button icon={<Ban size={14} />} loading={syncing} disabled={!currentId} onClick={() => void handleSyncBlacklist()}>同步黑名单</Button>
    ) : null;
    return syncButton || blacklistButton ? <>{syncButton}{blacklistButton}</> : null;
  };

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderAccountFilter()}
            {renderKeywordInput()}
            {renderSubscribeFilter()}
            {renderTagFilter()}
            {renderBlacklistFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderSyncActions()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordInput()}
            {renderSearchButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderAccountFilter()}
            {renderSubscribeFilter()}
            {renderTagFilter()}
            {renderBlacklistFilter()}
          </>
        )}
        mobileActions={renderSyncActions()}
        filterTitle="粉丝筛选"
        actionTitle="粉丝操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      {!accountsLoading && accounts.length === 0 && (
        <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" style={{ marginBottom: 12 }} />
      )}

      <ConfigurableTable bordered loading={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total)} />

      <AppModal {...fanModal.modalProps} title="编辑粉丝" width={520}>
        <Spin spinning={false} wrapperClassName="modal-spin-wrapper">
          <Form key={fanModal.formKey} {...fanModal.formProps}>
            <Form.Input field="remark" label="备注" placeholder="请输入备注（最多128字）" maxLength={128} />
            <Form.Select field="tagIds" label="标签" multiple style={{ width: '100%' }}
              placeholder="为该粉丝选择标签" optionList={tags.map((t) => ({ label: t.name, value: t.id }))} />
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
