import { useMemo } from 'react';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import { Avatar, Button, Form, Modal, Space, Spin, Tag, Toast } from '@douyinfe/semi-ui';
import { RefreshCw, Ban } from 'lucide-react';
import { MP_FAN_SUBSCRIBE_OPTIONS, MP_FAN_SUBSCRIBES, type MpFan, type MpFanSubscribe, type UpdateMpFanInput } from '@zenith/shared/mp';
import { enumValueOf } from '@zenith/shared/core';
import { usePermission } from '@/hooks/usePermission';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '../../utils/table-columns';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountRequiredBanner } from './MpAccountRequiredBanner';
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
import { compactParams } from '@/lib/query';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { confirmDanger } from '@/utils/confirm';
import { useEditModal } from '@/hooks/useEditModal';

const SEX_LABELS: Record<number, string> = { 0: '未知', 1: '男', 2: '女' };

export default function MpFansPage() {
  const { hasPermission: can } = usePermission();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();

  const tagsQuery = useMpTagOptions(currentId);
  const tags = tagsQuery.data?.list ?? [];
  const tagMap = new Map(tags.map((t) => [t.id, t.name]));

  /** 黑名单筛选在草稿里以 'true' / 'false' 字串保存（Select 选项值），提交时收窄为布尔 */
  interface SearchParams { keyword: string; subscribe: MpFanSubscribe | undefined; tagId: number | undefined; blacklisted?: 'true' | 'false'; }
  const defaultSearch: SearchParams = { keyword: '', subscribe: undefined, tagId: undefined, blacklisted: undefined };
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: mpFanKeys.lists, resetKey: currentId });

  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword,
    subscribe: submittedParams.subscribe,
    tagId: submittedParams.tagId,
    blacklisted: submittedParams.blacklisted === undefined ? undefined : submittedParams.blacklisted === 'true',
  }), [submittedParams]);
  const listQuery = useMpFanList({
    accountId: currentId ?? 0,
    page,
    pageSize,
    ...filterQuery,
  }, !!currentId);
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
    { title: '地区', dataIndex: 'province', width: 140, render: (_: unknown, r: MpFan) => [r.province, r.city].filter(Boolean).join(' ') || EMPTY_PLACEHOLDER },
    {
      title: '标签', dataIndex: 'tagIds', width: 200,
      render: (ids: number[]) => (
        ids.length === 0 ? EMPTY_PLACEHOLDER : (
          <Space wrap spacing={4}>
            {ids.map((id) => <Tag key={id} color="light-blue" type="light" size="small">{tagMap.get(id) ?? `#${id}`}</Tag>)}
          </Space>
        )
      ),
    },
    { title: '备注', dataIndex: 'remark', minWidth: 140, render: renderEllipsis },
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

  const syncButton = can('mp:fan:sync') ? (
    <Button icon={<RefreshCw size={14} />} loading={syncing} disabled={!currentId} onClick={() => void handleSync()}>同步粉丝</Button>
  ) : null;
  const blacklistButton = can('mp:fan:blacklist') ? (
    <Button icon={<Ban size={14} />} loading={syncing} disabled={!currentId} onClick={() => void handleSyncBlacklist()}>同步黑名单</Button>
  ) : null;
  const syncActions = syncButton || blacklistButton ? <>{syncButton}{blacklistButton}</> : null;

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={(
          <>
            <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
            <KeywordInput placeholder="搜索昵称/openid/备注" {...bindKeyword('keyword')} width={200} />
          </>
        )}
        filters={(
          <>
            <FilterSelect
              placeholder="全部关注状态"
              items={MP_FAN_SUBSCRIBE_OPTIONS}
              {...bind('subscribe', (v) => enumValueOf(MP_FAN_SUBSCRIBES, v))}
              width={140}
            />
            <FilterSelect
              placeholder="全部标签"
              items={tags.map((t) => ({ label: t.name, value: t.id }))}
              {...bind('tagId')}
              width={150}
              filter
            />
            <FilterSelect<'true' | 'false'>
              placeholder="全部黑名单"
              items={[{ label: '黑名单', value: 'true' }, { label: '正常', value: 'false' }]}
              {...bind('blacklisted')}
              width={140}
            />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        actions={syncActions}
        filterTitle="粉丝筛选"
        actionTitle="粉丝操作"
      />

      <MpAccountRequiredBanner loading={accountsLoading} accountCount={accounts.length} />

      <ConfigurableTable columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

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
