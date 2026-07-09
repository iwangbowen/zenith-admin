import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Modal, Space, Tag, Toast, Typography, Upload } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ImagePlus, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import type { ChannelAdmin } from '@zenith/shared';
import { config } from '@/config';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { AppModal } from '@/components/AppModal';
import { UserAvatar } from '@/components/UserAvatar';
import { usePagination } from '@/hooks/usePagination';
import { useDictItems } from '@/hooks/useDictItems';
import { ChannelMenuDrawer } from './ChannelMenuDrawer';
import { ChannelAutoReplyDrawer } from './ChannelAutoReplyDrawer';
import { ChannelPublishModal } from './ChannelPublishModal';
import { ChannelMessagesDrawer } from './ChannelMessagesDrawer';
import { ChannelSubscribersDrawer } from './ChannelSubscribersDrawer';
import {
  channelKeys,
  useChannelList,
  useDeleteChannel,
  useSaveChannel,
} from '@/hooks/queries/channels';

const TYPE_META: Record<string, { text: string; color: 'green' | 'blue' }> = {
  system: { text: '系统号', color: 'green' },
  business: { text: '运营号', color: 'blue' },
};

export default function ChannelsPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const { items: statusItems } = useDictItems('common_status');
  const { page, setPage, pageSize, buildPagination } = usePagination();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');

  const [editVisible, setEditVisible] = useState(false);
  const [editing, setEditing] = useState<ChannelAdmin | null>(null);
  const [formApi, setFormApi] = useState<FormApi | null>(null);
  const [avatarUrl, setAvatarUrl] = useState('');

  const [publishVisible, setPublishVisible] = useState(false);
  const [publishTarget, setPublishTarget] = useState<ChannelAdmin | null>(null);

  const [menuDrawer, setMenuDrawer] = useState<ChannelAdmin | null>(null);
  const [replyDrawer, setReplyDrawer] = useState<ChannelAdmin | null>(null);
  const [messagesDrawer, setMessagesDrawer] = useState<ChannelAdmin | null>(null);
  const [subscribersDrawer, setSubscribersDrawer] = useState<ChannelAdmin | null>(null);

  const listQuery = useChannelList({
    page,
    pageSize,
    keyword: submittedKeyword || undefined,
  });
  const data = listQuery.data ?? null;
  const saveMutation = useSaveChannel();
  const deleteMutation = useDeleteChannel();

  const handleSearch = () => {
    setPage(1);
    setSubmittedKeyword(draftKeyword);
    void queryClient.invalidateQueries({ queryKey: channelKeys.lists });
  };
  const handleReset = () => {
    setDraftKeyword('');
    setSubmittedKeyword('');
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: channelKeys.lists });
  };

  const openCreate = () => { setEditing(null); setAvatarUrl(''); setEditVisible(true); };
  const openEdit = (ch: ChannelAdmin) => { setEditing(ch); setAvatarUrl(ch.avatar ?? ''); setEditVisible(true); };

  const handleAvatarUpload = (res: unknown) => {
    const r = res as { code?: number; data?: { url?: string } };
    if (r?.code === 0 && r.data?.url) { setAvatarUrl(r.data.url); Toast.success('头像已上传'); }
    else Toast.error('头像上传失败');
  };

  const handleSubmit = async () => {
    if (!formApi) return;
    let values: Record<string, unknown>;
    try {
      values = await formApi.validate() as Record<string, unknown>;
    } catch {
      throw new Error('validation');
    }
    await saveMutation.mutateAsync({
      id: editing?.id,
      values: editing
        ? { name: values.name, avatar: avatarUrl || null, description: values.description || null, status: values.status }
        : { code: values.code, name: values.name, avatar: avatarUrl || null, description: values.description || null },
    });
    Toast.success(editing ? '已更新' : '已创建');
    setEditVisible(false);
  };

  const handleDelete = (ch: ChannelAdmin) => {
    Modal.confirm({
      title: `确认删除频道「${ch.name}」？`,
      content: '该频道下的所有消息与订阅将一并删除',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(ch.id);
        Toast.success('已删除');
      },
    });
  };

  const openPublish = (ch: ChannelAdmin) => { setPublishTarget(ch); setPublishVisible(true); };

  const columns: ColumnProps<ChannelAdmin>[] = [
    {
      title: '频道', dataIndex: 'name',
      render: (v: string, r: ChannelAdmin) => (
        <Space align="center">
          <UserAvatar name={v} avatar={r.avatar} size={36} />
          <Typography.Text strong>{v}</Typography.Text>
          <Typography.Text type="tertiary" size="small">{r.code}</Typography.Text>
        </Space>
      ),
    },
    { title: '类型', dataIndex: 'type', width: 90, render: (v: string) => <Tag color={TYPE_META[v]?.color ?? 'grey'} size="small">{TYPE_META[v]?.text ?? v}</Tag> },
    { title: '订阅数', dataIndex: 'subscriberCount', width: 90 },
    { title: '消息数', dataIndex: 'messageCount', width: 90 },
    { title: '状态', dataIndex: 'status', width: 80, render: (v: string) => <Tag color={v === 'enabled' ? 'green' : 'grey'} size="small">{v === 'enabled' ? '启用' : '停用'}</Tag> },
    { title: '创建时间', dataIndex: 'createdAt', width: 180, render: (v: string) => formatDateTime(v) },
    createOperationColumn<ChannelAdmin>({
      width: 290,
      desktopInlineKeys: ['publish', 'messages', 'edit'],
      actions: (record) => [
        {
          key: 'publish',
          label: '群发',
          hidden: !hasPermission('channel:message:publish'),
          onClick: () => openPublish(record),
        },
        {
          key: 'messages',
          label: '消息记录',
          hidden: !hasPermission('channel:message:publish'),
          onClick: () => setMessagesDrawer(record),
        },
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('channel:channel:update'),
          onClick: () => openEdit(record),
        },
        {
          key: 'subscribers',
          label: '订阅者',
          onClick: () => setSubscribersDrawer(record),
        },
        {
          key: 'menu',
          label: '菜单配置',
          hidden: record.type !== 'business' || !hasPermission('channel:menu:save'),
          onClick: () => setMenuDrawer(record),
        },
        {
          key: 'reply',
          label: '自动回复',
          hidden: record.type !== 'business' || !hasPermission('channel:reply:list'),
          onClick: () => setReplyDrawer(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('channel:channel:delete') || record.builtin,
          onClick: () => handleDelete(record),
        },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="搜索频道名称/编码" value={draftKeyword} onChange={setDraftKeyword} onEnterPress={handleSearch} showClear style={{ width: 220 }} />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
            {hasPermission('channel:channel:create') && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>}
          </>
        )}
        mobilePrimary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="搜索频道名称/编码" value={draftKeyword} onChange={setDraftKeyword} onEnterPress={handleSearch} showClear style={{ width: 220 }} />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            {hasPermission('channel:channel:create') && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>}
          </>
        )}
        mobileActions={<Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>}
        actionTitle="频道操作"
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        rowKey="id"
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(data?.total ?? 0)}
      />

      <AppModal
        title={editing ? '编辑频道' : '新建运营号'}
        visible={editVisible}
        onCancel={() => setEditVisible(false)}
        onOk={handleSubmit}
        confirmLoading={saveMutation.isPending}
        okText="保存"
        width={520}
      >
        <Form
          key={editing?.id ?? 'new'}
          getFormApi={setFormApi}
          labelPosition="left"
          labelWidth={90}
          initValues={{
            code: editing?.code ?? '',
            name: editing?.name ?? '',
            description: editing?.description ?? '',
            status: editing?.status ?? 'enabled',
          }}
        >
          <Form.Input
            field="code"
            label="编码"
            placeholder="小写字母 / 数字 / 连字符"
            disabled={!!editing}
            rules={editing ? undefined : [{ required: true, message: '请填写编码' }]}
          />
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '请填写名称' }]} />
          <Form.Slot label="头像">
            <Space align="center">
              {avatarUrl
                ? (
                  <div style={{ position: 'relative', width: 64, height: 64 }}>
                    <img src={avatarUrl} alt="头像" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 'var(--semi-border-radius-medium)', border: '1px solid var(--semi-color-border)' }} />
                    <Button
                      theme="borderless" type="danger" size="small" icon={<Trash2 size={14} />}
                      style={{ position: 'absolute', top: -8, right: -8, background: 'var(--semi-color-bg-2)' }}
                      onClick={() => setAvatarUrl('')}
                    />
                  </div>
                )
                : (
                  <Upload
                    action={`${config.apiBaseUrl}/api/files/upload-one`}
                    headers={{ Authorization: `Bearer ${localStorage.getItem('zenith_token') ?? ''}` }}
                    name="file"
                    accept="image/*"
                    limit={1}
                    showUploadList={false}
                    onSuccess={handleAvatarUpload}
                  >
                    <Button icon={<ImagePlus size={14} />}>上传头像</Button>
                  </Upload>
                )}
            </Space>
          </Form.Slot>
          <Form.TextArea field="description" label="简介" autosize={{ minRows: 2, maxRows: 4 }} />
          {editing && (
            <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={statusItems.map((item) => ({ value: item.value, label: item.label }))} />
          )}
        </Form>
      </AppModal>

      <ChannelPublishModal
        channel={publishTarget}
        visible={publishVisible}
        onClose={() => setPublishVisible(false)}
        onSuccess={() => void listQuery.refetch()}
      />

      {menuDrawer && (
        <ChannelMenuDrawer
          channelId={menuDrawer.id}
          channelName={menuDrawer.name}
          visible={!!menuDrawer}
          onClose={() => setMenuDrawer(null)}
        />
      )}
      {replyDrawer && (
        <ChannelAutoReplyDrawer
          channelId={replyDrawer.id}
          channelName={replyDrawer.name}
          visible={!!replyDrawer}
          onClose={() => setReplyDrawer(null)}
        />
      )}
      {messagesDrawer && (
        <ChannelMessagesDrawer
          channel={messagesDrawer}
          visible={!!messagesDrawer}
          onClose={() => setMessagesDrawer(null)}
        />
      )}
      {subscribersDrawer && (
        <ChannelSubscribersDrawer
          channel={subscribersDrawer}
          visible={!!subscribersDrawer}
          onClose={() => setSubscribersDrawer(null)}
        />
      )}
    </div>
  );
}
