/**
 * 频道订阅者管理抽屉
 *
 * 展示某频道的订阅者列表，支持搜索、导出。
 * - 系统号（system）：订阅者为全员，只读，不可手动增减。
 * - 运营号（business）：可添加订阅者（用户选择器）、按行移除、导出。
 */
import { useCallback, useEffect, useState } from 'react';
import { Banner, Button, Input, Popconfirm, SideSheet, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Download, Plus, Search, RotateCcw } from 'lucide-react';
import type { ChannelAdmin, ChannelSubscriber, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { UserAvatar } from '@/components/UserAvatar';
import UserSelect from '@/components/UserSelect';
import { AppModal } from '@/components/AppModal';

interface Props {
  channel: ChannelAdmin | null;
  visible: boolean;
  onClose: () => void;
}

function downloadCsv(rows: ChannelSubscriber[], filename: string): void {
  const headers = ['用户ID', '姓名', '订阅时间', '免打扰'];
  const escape = (val: string): string => `"${val.replace(/"/g, '""')}"`;
  const lines = [
    headers.join(','),
    ...rows.map((r) => [
      String(r.userId),
      escape(r.name ?? ''),
      escape(r.subscribedAt ? formatDateTime(r.subscribedAt) : ''),
      r.isMuted ? '是' : '否',
    ].join(',')),
  ];
  const csv = `\uFEFF${lines.join('\r\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ChannelSubscribersDrawer({ channel, visible, onClose }: Readonly<Props>) {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('channel:channel:update');
  const isSystem = channel?.type === 'system';

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PaginatedResponse<ChannelSubscriber> | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [keyword, setKeyword] = useState('');

  const [addVisible, setAddVisible] = useState(false);
  const [addUserIds, setAddUserIds] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  const fetchList = useCallback(async (p = 1, ps = pageSize, kw = keyword) => {
    if (!channel) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(kw ? { keyword: kw } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<ChannelSubscriber>>(
        `/api/channels/admin/${channel.id}/subscribers?${query}`,
        { silent: true },
      );
      if (res.code === 0 && res.data) { setData(res.data); setPage(res.data.page); }
    } finally {
      setLoading(false);
    }
  }, [channel, pageSize, keyword, setPage]);

  useEffect(() => {
    if (visible && channel) {
      setKeyword('');
      setPage(1);
      void fetchList(1, pageSize, '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, channel]);

  const handleSearch = () => { setPage(1); void fetchList(1, pageSize, keyword); };
  const handleReset = () => { setKeyword(''); setPage(1); void fetchList(1, pageSize, ''); };

  const openAdd = () => { setAddUserIds([]); setAddVisible(true); };

  const handleAdd = async () => {
    if (!channel || addUserIds.length === 0) { Toast.warning('请选择要添加的用户'); return; }
    setSubmitting(true);
    try {
      const res = await request.post(`/api/channels/admin/${channel.id}/subscribers`, { userIds: addUserIds });
      if (res.code === 0) { Toast.success('已添加'); setAddVisible(false); void fetchList(page, pageSize, keyword); }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (sub: ChannelSubscriber) => {
    if (!channel) return;
    const res = await request.delete(`/api/channels/admin/${channel.id}/subscribers/${sub.userId}`);
    if (res.code === 0) { Toast.success('已移除'); void fetchList(page, pageSize, keyword); }
  };

  const handleExport = async () => {
    if (!channel) return;
    setExportLoading(true);
    try {
      const res = await request.get<ChannelSubscriber[]>(`/api/channels/admin/${channel.id}/subscribers/export`);
      if (res.code === 0 && res.data) {
        downloadCsv(res.data, `${channel.name}_订阅者.csv`);
        Toast.success('已导出');
      }
    } finally {
      setExportLoading(false);
    }
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
    columns.push({
      title: '操作', dataIndex: 'op', width: 90, fixed: 'right',
      render: (_: unknown, r: ChannelSubscriber) => (
        <Popconfirm title={`确定移除订阅者「${r.name}」？`} onConfirm={() => void handleRemove(r)}>
          <Button theme="borderless" type="danger" size="small">移除</Button>
        </Popconfirm>
      ),
    });
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
              value={keyword}
              onChange={setKeyword}
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
        actions={<Button icon={<Download size={14} />} loading={exportLoading} onClick={() => void handleExport()}>导出</Button>}
        mobilePrimary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索用户姓名"
              value={keyword}
              onChange={setKeyword}
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
            <Button icon={<Download size={14} />} loading={exportLoading} onClick={() => void handleExport()}>导出</Button>
          </>
        )}
        actionTitle="订阅者操作"
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        rowKey="userId"
        loading={loading}
        onRefresh={() => void fetchList(page, pageSize, keyword)}
        refreshLoading={loading}
        pagination={buildPagination(data?.total ?? 0, (p, ps) => fetchList(p, ps, keyword))}
      />

      <AppModal
        title="添加订阅者"
        visible={addVisible}
        onCancel={() => setAddVisible(false)}
        onOk={() => void handleAdd()}
        confirmLoading={submitting}
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
