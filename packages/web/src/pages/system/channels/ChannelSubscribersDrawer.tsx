/**
 * 频道订阅者管理抽屉
 *
 * 展示某频道的订阅者列表，支持搜索、导出。
 * - 系统号（system）：订阅者为全员，只读，不可手动增减。
 * - 运营号（business）：可添加订阅者（用户选择器）、按行移除、导出。
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Input, Modal, SideSheet, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, Search, RotateCcw } from 'lucide-react';
import type { ChannelAdmin, ChannelSubscriber } from '@zenith/shared';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { UserAvatar } from '@/components/UserAvatar';
import UserSelect from '@/components/UserSelect';
import { AppModal } from '@/components/AppModal';
import { ExportButton } from '@/components/ExportButton';
import {
  useAddChannelSubscribers,
  useChannelSubscribers,
  useRemoveChannelSubscriber,
} from '@/hooks/queries/channels';

interface Props {
  channel: ChannelAdmin | null;
  visible: boolean;
  onClose: () => void;
}

export function ChannelSubscribersDrawer({ channel, visible, onClose }: Readonly<Props>) {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const canManage = hasPermission('channel:channel:update');
  const isSystem = channel?.type === 'system';

  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');

  const [addVisible, setAddVisible] = useState(false);
  const [addUserIds, setAddUserIds] = useState<number[]>([]);
  const listQuery = useChannelSubscribers(channel?.id, {
    page,
    pageSize,
    keyword: submittedKeyword || undefined,
  }, visible && !!channel);
  const data = listQuery.data ?? null;
  const addMutation = useAddChannelSubscribers();
  const removeMutation = useRemoveChannelSubscriber();
  const exportQuery = channel
    ? { channelId: channel.id, ...(submittedKeyword.trim() ? { keyword: submittedKeyword.trim() } : {}) }
    : {};

  useEffect(() => {
    if (visible && channel) {
      setDraftKeyword('');
      setSubmittedKeyword('');
      setPage(1);
    }
  }, [visible, channel, setPage]);

  const handleSearch = () => {
    setPage(1);
    setSubmittedKeyword(draftKeyword);
    if (channel) void queryClient.invalidateQueries({ queryKey: ['channels', 'subscribers', channel.id] });
  };
  const handleReset = () => {
    setDraftKeyword('');
    setSubmittedKeyword('');
    setPage(1);
    if (channel) void queryClient.invalidateQueries({ queryKey: ['channels', 'subscribers', channel.id] });
  };

  const openAdd = () => { setAddUserIds([]); setAddVisible(true); };

  const handleAdd = async () => {
    if (!channel || addUserIds.length === 0) { Toast.warning('请选择要添加的用户'); return; }
    await addMutation.mutateAsync({ channelId: channel.id, userIds: addUserIds });
    Toast.success('已添加');
    setAddVisible(false);
  };

  const handleRemove = async (sub: ChannelSubscriber) => {
    if (!channel) return;
    await removeMutation.mutateAsync({ channelId: channel.id, userId: sub.userId });
    Toast.success('已移除');
  };

  const columns: ColumnProps<ChannelSubscriber>[] = [
    {
      title: '用户', dataIndex: 'name',
      render: (v: string, r: ChannelSubscriber) => (
        <Space align="center">
          <UserAvatar name={v} avatar={r.avatar} size={32} />
          <Typography.Text strong>{v}</Typography.Text>
          <Typography.Text type="tertiary" size="small">#{r.userId}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '订阅时间', dataIndex: 'subscribedAt', width: 180,
      render: (v: string | null) => (v ? formatDateTime(v) : <Typography.Text type="tertiary">—</Typography.Text>),
    },
    {
      title: '免打扰', dataIndex: 'isMuted', width: 90,
      render: (v: boolean) => <Tag size="small" color={v ? 'orange' : 'grey'}>{v ? '已开启' : '未开启'}</Tag>,
    },
  ];

  if (canManage && !isSystem) {
    columns.push(createOperationColumn<ChannelSubscriber>({
      width: 90,
      actions: (record) => [
        {
          key: 'remove',
          label: '移除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: `确定移除订阅者「${record.name}」？`,
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => { void handleRemove(record); },
            });
          },
        },
      ],
    }));
  }

  return (
    <SideSheet
      title={`订阅者 · ${channel?.name ?? ''}`}
      visible={visible}
      onCancel={onClose}
      width={760}
      placement="right"
    >
      {isSystem && (
        <Banner
          type="info"
          description="系统号默认全员订阅，不可手动增减。"
          closeIcon={null}
          style={{ marginBottom: 12 }}
        />
      )}

      <SearchToolbar
        primary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索用户姓名"
              value={draftKeyword}
              onChange={setDraftKeyword}
              onEnterPress={handleSearch}
              showClear
              style={{ width: 200 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
            {canManage && !isSystem && (
              <Button type="primary" icon={<Plus size={14} />} onClick={openAdd}>添加订阅者</Button>
            )}
          </>
        )}
        actions={channel ? <ExportButton entity="channel.subscribers" query={exportQuery} /> : null}
        mobilePrimary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索用户姓名"
              value={draftKeyword}
              onChange={setDraftKeyword}
              onEnterPress={handleSearch}
              showClear
              style={{ width: 200 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            {canManage && !isSystem && (
              <Button type="primary" icon={<Plus size={14} />} onClick={openAdd}>添加订阅者</Button>
            )}
          </>
        )}
        mobileActions={(
          <>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
            {channel && <ExportButton entity="channel.subscribers" query={exportQuery} variant="flat" />}
          </>
        )}
        actionTitle="订阅者操作"
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        rowKey="userId"
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(data?.total ?? 0)}
      />

      <AppModal
        title="添加订阅者"
        visible={addVisible}
        onCancel={() => setAddVisible(false)}
        onOk={() => void handleAdd()}
        confirmLoading={addMutation.isPending}
        okText="添加"
        width={460}
      >
        <Typography.Text type="tertiary" size="small">选择要订阅该运营号的用户（可多选）</Typography.Text>
        <div style={{ marginTop: 12 }}>
          <UserSelect
            multiple
            value={addUserIds}
            onChange={(v) => setAddUserIds((v as number[]) ?? [])}
            placeholder="请选择用户"
          />
        </div>
      </AppModal>
    </SideSheet>
  );
}

export default ChannelSubscribersDrawer;
