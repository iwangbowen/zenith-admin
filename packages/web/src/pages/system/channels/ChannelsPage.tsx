import { useState } from 'react';
import { Form, Space, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { channelContract, type ChannelAdmin } from '@zenith/shared/messaging';
import { usePermission } from '@/hooks/usePermission';
import { ImageUploadField } from '@/components/ImageUploadField';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListSearchToolbar, useCrudOperationColumn } from '@/components/list-page';
import { UserAvatar } from '@/components/UserAvatar';
import { useDictItems } from '@/hooks/useDictItems';
import { useEditModal } from '@/hooks/useEditModal';
import { ChannelMenuDrawer } from './ChannelMenuDrawer';
import { ChannelAutoReplyDrawer } from './ChannelAutoReplyDrawer';
import { ChannelPublishModal } from './ChannelPublishModal';
import { ChannelMessagesDrawer } from './ChannelMessagesDrawer';
import { ChannelSubscribersDrawer } from './ChannelSubscribersDrawer';
import {
  useChannelList,
  useDeleteChannel,
  useSaveChannel,
} from '@/hooks/queries/channels';
import { CreateButton } from '@/components/toolbar-controls';
import { dateTimeColumn, renderEnabledStatusTag } from '@/utils/table-columns';
import { useListPage } from '@/hooks/useListPage';
import { EditFormModal } from '@/components/EditFormModal';

const TYPE_META: Record<string, { text: string; color: 'green' | 'blue' }> = {
  system: { text: '系统号', color: 'green' },
  business: { text: '运营号', color: 'blue' },
};

export default function ChannelsPage() {
  const { hasPermission } = usePermission();
  const { options: statusOptions } = useDictItems('common_status');
  const page = useListPage({
    contract: channelContract,
    useList: useChannelList,
  });
  const { tableProps, listQuery } = page;

  const [avatarUrl, setAvatarUrl] = useState('');

  const [publishVisible, setPublishVisible] = useState(false);
  const [publishTarget, setPublishTarget] = useState<ChannelAdmin | null>(null);

  const [menuDrawer, setMenuDrawer] = useState<ChannelAdmin | null>(null);
  const [replyDrawer, setReplyDrawer] = useState<ChannelAdmin | null>(null);
  const [messagesDrawer, setMessagesDrawer] = useState<ChannelAdmin | null>(null);
  const [subscribersDrawer, setSubscribersDrawer] = useState<ChannelAdmin | null>(null);

  const saveMutation = useSaveChannel();
  const deleteMutation = useDeleteChannel();

  const modal = useEditModal<ChannelAdmin, Record<string, unknown>>({
    save: saveMutation,
    defaults: { code: '', name: '', description: '', status: 'enabled' },
    toValues: (ch) => ({
      code: ch.code,
      name: ch.name,
      description: ch.description ?? '',
      status: ch.status,
    }),
    beforeSave: (values, { isEdit }) => (
      isEdit
        ? { name: values.name, avatar: avatarUrl || null, description: values.description || null, status: values.status }
        : { code: values.code, name: values.name, avatar: avatarUrl || null, description: values.description || null }
    ),
    successMessage: ({ isEdit }) => (isEdit ? '已更新' : '已创建'),
  });

  const openCreate = () => { setAvatarUrl(''); modal.openCreate(); };
  const openEdit = (ch: ChannelAdmin) => { setAvatarUrl(ch.avatar ?? ''); modal.openEdit(ch); };

  const openPublish = (ch: ChannelAdmin) => { setPublishTarget(ch); setPublishVisible(true); };

  const operationColumn = useCrudOperationColumn<ChannelAdmin>({
    permission: 'channel:channel',
    edit: openEdit,
    remove: deleteMutation,
    hidden: { remove: (record) => record.builtin },
    title: (record) => `确认删除频道「${record.name}」？`,
    content: '该频道下的所有消息与订阅将一并删除',
    successMessage: '已删除',
    extra: (record) => [
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
    ],
    extraBetween: (record) => [
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
    ],
    width: 260,
    desktopInlineKeys: ['publish', 'messages', 'edit'],
  });

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
    { title: '订阅数', dataIndex: 'subscriberCount', width: 90, align: 'right' },
    { title: '消息数', dataIndex: 'messageCount', width: 90, align: 'right' },
    { title: '状态', dataIndex: 'status', width: 80, render: renderEnabledStatusTag },
    dateTimeColumn('创建时间', 'createdAt'),
    operationColumn,
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        page={page}
        filters={['keyword']}
        create={<CreateButton permission="channel:channel:create" onClick={openCreate} />}
        actionTitle="频道操作"
      />

      <ConfigurableTable<ChannelAdmin>
        columns={columns}
        {...tableProps}
      />

      <EditFormModal modal={modal} title={modal.isEdit ? '编辑频道' : '新建运营号'} okText="保存" width={520}>
        <Form.Input
          field="code"
          label="编码"
          placeholder="小写字母 / 数字 / 连字符"
          disabled={modal.isEdit}
          rules={modal.isEdit ? undefined : [{ required: true, message: '请填写编码' }]}
        />
        <Form.Input field="name" label="名称" rules={[{ required: true, message: '请填写名称' }]} />
        <Form.Slot label="头像">
          <ImageUploadField
            value={avatarUrl}
            onChange={setAvatarUrl}
            label="头像"
            previewStyle={{ width: 64, height: 64 }}
            buttonSize="small"
            uploadSuccessMessage="头像已上传"
          />
        </Form.Slot>
        <Form.TextArea field="description" label="简介" autosize={{ minRows: 2, maxRows: 4 }} />
        {modal.isEdit && (
          <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={statusOptions} />
        )}
      </EditFormModal>

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
