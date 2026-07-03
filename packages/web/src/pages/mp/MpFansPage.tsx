import { useEffect, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar, Button, Form, Input, Modal, Select, Space, Spin, Tag, Toast, Banner } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { RotateCcw, Search, RefreshCw, Ban } from 'lucide-react';
import type { MpFan, MpFanSubscribe } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { renderEllipsis } from '../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';
import {
  mpFanKeys,
  useCreateMpFanMember,
  useMpFanList,
  useSaveMpFan,
  useSetMpFanBlacklist,
  useSyncMpBlacklist,
  useSyncMpFans,
  useUnbindMpFanMember,
} from '@/hooks/queries/mp-fans';
import { useMpTagOptions } from '@/hooks/queries/mp-tags';

const SEX_LABELS: Record<number, string> = { 0: '未知', 1: '男', 2: '女' };
const SUBSCRIBE_OPTIONS = [
  { label: '已关注', value: 'subscribed' },
  { label: '已取关', value: 'unsubscribed' },
];

export default function MpFansPage() {
  const { hasPermission: can } = usePermission();
  const queryClient = useQueryClient();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();

  const { page, pageSize, setPage, buildPagination } = usePagination();

  const tagsQuery = useMpTagOptions(currentId);
  const tags = tagsQuery.data?.list ?? [];
  const tagMap = new Map(tags.map((t) => [t.id, t.name]));

  interface SearchParams { keyword: string; subscribe: MpFanSubscribe | undefined; tagId: number | undefined; blacklisted: 'true' | 'false' | undefined; }
  const defaultSearch: SearchParams = { keyword: '', subscribe: undefined, tagId: undefined, blacklisted: undefined };
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearch);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearch);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MpFan | null>(null);
  const formRef = useRef<FormApi>(null);

  const listQuery = useMpFanList({
    accountId: currentId,
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    subscribe: submittedParams.subscribe,
    tagId: submittedParams.tagId,
    blacklisted: submittedParams.blacklisted,
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const syncFansMutation = useSyncMpFans();
  const syncBlacklistMutation = useSyncMpBlacklist();
  const blacklistMutation = useSetMpFanBlacklist();
  const saveMutation = useSaveMpFan();
  const createMemberMutation = useCreateMpFanMember();
  const unbindMemberMutation = useUnbindMpFanMember();
  const syncing = syncFansMutation.isPending || syncBlacklistMutation.isPending;
  const submitting = saveMutation.isPending;

  useEffect(() => {
    setPage(1);
  }, [currentId, setPage]);

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: mpFanKeys.lists(currentId) });
  };
  const handleReset = () => {
    setDraftParams(defaultSearch);
    setSubmittedParams(defaultSearch);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: mpFanKeys.lists(currentId) });
  };

  const handleSync = async () => {
    if (!currentId) return;
    const data = await syncFansMutation.mutateAsync(currentId);
    Toast.success(`同步完成：共处理 ${data.synced ?? 0} 个粉丝`);
  };

  const handleBlacklist = async (record: MpFan) => {
    if (!currentId) return;
    await blacklistMutation.mutateAsync({ accountId: currentId, openid: record.openid, blacklisted: record.blacklisted });
    Toast.success(record.blacklisted ? '已移出黑名单' : '已拉黑');
  };

  const handleSyncBlacklist = async () => {
    if (!currentId) return;
    const data = await syncBlacklistMutation.mutateAsync(currentId);
    Toast.success(`黑名单同步完成：共 ${data.synced ?? 0} 个`);
  };

  const openEdit = (record: MpFan) => { setEditingRecord(record); setModalVisible(true); };

  const handleCreateMember = async (record: MpFan) => {
    await createMemberMutation.mutateAsync(record.id);
    Toast.success('会员已创建并绑定');
  };

  const handleUnbindMember = async (record: MpFan) => {
    await unbindMemberMutation.mutateAsync(record.id);
    Toast.success('已解绑会员');
  };

  const confirmUnbindMember = (record: MpFan) => {
    Modal.confirm({
      title: '确定解绑该粉丝的会员？',
      okButtonProps: { type: 'danger', theme: 'solid' },
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

  const handleSubmit = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current?.validate())!; } catch { throw new Error('validation'); }
    if (!editingRecord) return;
    await saveMutation.mutateAsync({ id: editingRecord.id, values: { remark: values.remark ?? '', tagIds: values.tagIds ?? [] } });
    Toast.success('保存成功');
    setModalVisible(false);
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
    { title: '备注', dataIndex: 'remark', width: 140, render: (v: string | null) => v || '—' },
    { title: '关注时间', dataIndex: 'subscribeTime', width: 170, render: (v: string | null) => v || '—' },
    {
      title: '会员', dataIndex: 'memberId', width: 90, align: 'center' as const,
      render: (v: number | null) => (v ? <Tag color="green" type="light">已绑定 #{v}</Tag> : <Tag color="grey" type="light">未绑定</Tag>),
    },
    {
      title: '关注状态', dataIndex: 'subscribe', width: 100, align: 'center' as const, fixed: 'right' as const,
      render: (v: MpFanSubscribe, r: MpFan) => (
        <Space spacing={2}>
          {v === 'subscribed' ? <Tag color="green" type="light">已关注</Tag> : <Tag color="grey" type="light">已取关</Tag>}
          {r.blacklisted && <Tag color="red" type="light">黑名单</Tag>}
        </Space>
      ),
    },
    createOperationColumn<MpFan>({
      width: 240,
      desktopInlineKeys: ['edit', 'member', 'blacklist'],
      menuAriaLabel: '粉丝操作',
      actions: (record) => [
        { key: 'edit', label: '编辑', hidden: !can('mp:fan:update'), onClick: () => openEdit(record) },
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
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索昵称/openid/备注"
      value={draftParams.keyword}
      onChange={(v) => setDraftParams({ ...draftParams, keyword: v })}
      onEnterPress={handleSearch}
      showClear
      style={{ width: 200 }}
    />
  );
  const renderSubscribeFilter = () => (
    <Select
      placeholder="关注状态"
      value={draftParams.subscribe}
      onChange={(v) => setDraftParams({ ...draftParams, subscribe: v as MpFanSubscribe | undefined })}
      optionList={SUBSCRIBE_OPTIONS}
      showClear
      style={{ width: 120 }}
    />
  );
  const renderTagFilter = () => (
    <Select
      placeholder="标签"
      value={draftParams.tagId}
      onChange={(v) => setDraftParams({ ...draftParams, tagId: v as number | undefined })}
      optionList={tags.map((t) => ({ label: t.name, value: t.id }))}
      showClear
      filter
      style={{ width: 150 }}
    />
  );
  const renderBlacklistFilter = () => (
    <Select
      placeholder="黑名单"
      value={draftParams.blacklisted}
      onChange={(v) => setDraftParams({ ...draftParams, blacklisted: v as 'true' | 'false' | undefined })}
      optionList={[{ label: '黑名单', value: 'true' }, { label: '正常', value: 'false' }]}
      showClear
      style={{ width: 110 }}
    />
  );
  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
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
        pagination={buildPagination(total)}
        scroll={{ x: 1320 }} />

      <AppModal title="编辑粉丝" visible={modalVisible}
        onOk={handleSubmit} onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        confirmLoading={submitting} width={520}>
        <Spin spinning={false} wrapperClassName="modal-spin-wrapper">
          <Form
            key={editingRecord?.id ?? 'none'}
            getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
            labelPosition="left" labelWidth={72}
            initValues={editingRecord ? { remark: editingRecord.remark ?? '', tagIds: editingRecord.tagIds } : { remark: '', tagIds: [] }}
          >
            <Form.Input field="remark" label="备注" placeholder="请输入备注（最多128字）" maxLength={128} />
            <Form.Select field="tagIds" label="标签" multiple style={{ width: '100%' }}
              placeholder="为该粉丝选择标签" optionList={tags.map((t) => ({ label: t.name, value: t.id }))} />
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
