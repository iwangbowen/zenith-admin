import { useEffect, useMemo, useState } from 'react';
import { Button, Form, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Copy } from 'lucide-react';
import { chatBotContract, type ChatWebhook } from '@zenith/shared/chat';
import { maskSecret } from '@zenith/shared/core';
import { UserAvatar } from '@/components/UserAvatar';
import { ImageUploadField } from '@/components/ImageUploadField';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListSearchToolbar, useCrudOperationColumn } from '@/components/list-page';
import { AppModal } from '@/components/AppModal';
import { useEditModal } from '@/hooks/useEditModal';
import { usePermission } from '@/hooks/usePermission';
import { copyableNoColumn, createdAtColumn, dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';
import {
  type SaveChatBotValues,
  useChatBotGroupConversations,
  useChatBotList,
  useDeleteChatBot,
  useRegenerateChatBotToken,
  useSaveChatBot,
} from '@/hooks/queries/chat-bots';
import { CreateButton } from '@/components/toolbar-controls';
import { confirmDanger } from '@/utils/confirm';
import { copyTextWithToast } from '@/utils/clipboard';
import { abortSubmit } from '@/lib/abort-submit';
import { useListPage } from '@/hooks/useListPage';
import { EditFormModal } from '@/components/EditFormModal';

const { Text } = Typography;

interface BotFormValues {
  name: string;
  avatar?: string | null;
  description?: string | null;
  conversationId?: number;
  enabled?: boolean;
}

function optionalText(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function getAbsoluteWebhookUrl(webhookUrl: string): string {
  if (!webhookUrl) return '';
  if (/^https?:\/\//i.test(webhookUrl)) return webhookUrl;
  if (globalThis.window === undefined) return webhookUrl;
  return `${globalThis.window.location.origin}${webhookUrl.startsWith('/') ? webhookUrl : `/${webhookUrl}`}`;
}

/** 列表展示只露出 token 前 12 位（复制仍取完整值） */
function maskToken(token: string): string {
  if (!token) return EMPTY_PLACEHOLDER;
  return maskSecret(token, { head: 12, tail: 0, filler: '••••' });
}

export default function ChatBotsPage() {
  const { hasPermission } = usePermission();
  const page = useListPage({
    contract: chatBotContract,
    useList: useChatBotList,
  });
  const { tableProps } = page;
  const [secretInfo, setSecretInfo] = useState<ChatWebhook | null>(null);

  const saveMutation = useSaveChatBot();
  const botModal = useEditModal<ChatWebhook, BotFormValues, SaveChatBotValues>({
    entityName: ' Webhook 机器人',
    save: saveMutation,
    defaults: { name: '', avatar: null, description: null, enabled: true },
    toValues: (bot) => ({
      name: bot.name,
      avatar: bot.avatar,
      description: bot.description,
      conversationId: bot.conversationId,
      enabled: bot.enabled,
    }),
    beforeSave: (values, { isEdit }) => {
      const name = values.name.trim();
      const commonPayload = {
        name,
        avatar: optionalText(values.avatar),
        description: optionalText(values.description),
        enabled: values.enabled ?? true,
      };

      if (!isEdit && !values.conversationId) {
        Toast.warning('请选择目标会话');
        abortSubmit('validation');
      }

      return isEdit
        ? commonPayload
        : {
            ...commonPayload,
            conversationId: Number(values.conversationId),
          };
    },
    onSaved: (saved, { isEdit }) => {
      if (!isEdit) setSecretInfo(saved);
    },
  });
  const editingBot = botModal.editing;
  // 头像上传预览与表单 avatar 字段双向同步：打开弹窗时取记录值，手动改 URL 时跟随更新
  const [avatarPreview, setAvatarPreview] = useState('');
  useEffect(() => {
    if (botModal.visible) setAvatarPreview(editingBot?.avatar ?? '');
  }, [botModal.visible, editingBot]);

  function handleAvatarUploaded(url: string) {
    setAvatarPreview(url);
    botModal.formApi.current?.setValue('avatar', url);
  }
  const groupConversationsQuery = useChatBotGroupConversations(botModal.visible);
  const groupConversations = useMemo(() => groupConversationsQuery.data ?? [], [groupConversationsQuery.data]);
  const regenerateMutation = useRegenerateChatBotToken();
  const deleteMutation = useDeleteChatBot();

  const conversationOptions = useMemo(() => {
    const options = groupConversations.map((conv) => ({
      label: conv.name ?? '群聊',
      value: conv.id,
    }));
    if (editingBot && !options.some((item) => item.value === editingBot.conversationId)) {
      options.unshift({
        label: editingBot.conversationName ?? `会话#${editingBot.conversationId}`,
        value: editingBot.conversationId,
      });
    }
    return options;
  }, [editingBot, groupConversations]);

  async function handleRegenerate(row: ChatWebhook) {
    const result = await regenerateMutation.mutateAsync({ params: { id: row.id } });
    Toast.success('令牌已重置');
    setSecretInfo(result);
  }

  const operationColumn = useCrudOperationColumn<ChatWebhook>({
    permission: 'chat:bot',
    edit: botModal,
    remove: (row) => deleteMutation.mutateAsync({ params: { id: row.id } }),
    title: '确定删除该机器人？',
    extraBetween: (row) => [
      {
        key: 'regenerate',
        label: '重置令牌',
        hidden: !hasPermission('chat:bot:update'),
        onClick: () => {
          confirmDanger({
            title: '重置后旧地址立即失效，确认重置？',
            onOk: () => { void handleRegenerate(row); },
          });
        },
      },
    ],
    width: 240,
  });

  const columns: ColumnProps<ChatWebhook>[] = [
    {
      title: '名称',
      dataIndex: 'name',
      minWidth: 220,
      ellipsis: { showTitle: false },
      render: (_: unknown, row: ChatWebhook) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <UserAvatar name={row.name} avatar={row.avatar} semiSize="extra-small" size={24} />
          <span className="table-cell-ellipsis" title={row.name}>{row.name}</span>
        </div>
      ),
    },
    {
      title: '目标会话',
      dataIndex: 'conversationName',
      width: 180,
      render: (_: unknown, row: ChatWebhook) => renderEllipsis(row.conversationName ?? `会话#${row.conversationId}`),
    },
    {
      title: '描述',
      dataIndex: 'description',
      width: 220,
      render: renderEllipsis,
    },
    copyableNoColumn('Webhook 地址', 'webhookUrl', {
      width: 360,
      displayText: getAbsoluteWebhookUrl,
      copyContent: getAbsoluteWebhookUrl,
    }),
    copyableNoColumn('令牌', 'token', {
      width: 220,
      displayText: maskToken,
    }),
    dateTimeColumn('最近使用', 'lastUsedAt'),
    createdAtColumn as ColumnProps<ChatWebhook>,
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 90,
      fixed: 'right',
      render: (enabled: boolean) => enabled ? <Tag color="green">启用</Tag> : <Tag color="grey">停用</Tag>,
    },
    operationColumn,
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        page={page}
        filters={['keyword']}
        create={<CreateButton permission="chat:bot:create" onClick={botModal.openCreate} />}
        actionTitle="机器人操作"
      />

      <ConfigurableTable<ChatWebhook>
        columns={columns}
        empty="暂无数据"
        {...tableProps}
      />

      <EditFormModal modal={botModal} width={520} formProps={{ onValueChange: (values) => {
        const avatar = (values as BotFormValues).avatar;
        if (typeof avatar === 'string') setAvatarPreview(avatar);
      } }}>
        <Form.Input field="name" label="名称" placeholder="请输入机器人名称" rules={[{ required: true, message: '请输入机器人名称' }]} />
        <Form.Select
          field="conversationId"
          label="目标会话"
          placeholder="请选择目标群聊"
          rules={[{ required: true, message: '请选择目标会话' }]}
          optionList={conversationOptions}
          loading={groupConversationsQuery.isFetching}
          disabled={botModal.isEdit}
          filter
          style={{ width: '100%' }}
        />
        <Form.Slot label="头像上传">
          <ImageUploadField value={avatarPreview} onChange={handleAvatarUploaded} label="头像" />
        </Form.Slot>
        <Form.Input field="avatar" label="头像 URL" placeholder="请输入头像 URL（可选），上传后自动回填" />
        <Form.TextArea field="description" label="描述" placeholder="请输入描述（可选）" autosize={{ minRows: 3, maxRows: 5 }} />
        <Form.Switch field="enabled" label="状态" />
      </EditFormModal>

      <AppModal
        title="Webhook 机器人凭据"
        visible={!!secretInfo}
        onCancel={() => setSecretInfo(null)}
        footer={null}
        width={560}
        closeOnEsc
      >
        {secretInfo && (
          <Space vertical align="start" spacing={16} style={{ width: '100%' }}>
            <Text type="warning">请妥善保存，可随时在列表中复制。</Text>
            <SecretLine label="Webhook 地址" value={getAbsoluteWebhookUrl(secretInfo.webhookUrl)} />
            <SecretLine label="令牌" value={secretInfo.token} code />
          </Space>
        )}
      </AppModal>
    </div>
  );
}

function SecretLine({ label, value, code }: { readonly label: string; readonly value: string; readonly code?: boolean }) {
  return (
    <div style={{ width: '100%' }}>
      <div style={{ color: 'var(--semi-color-text-2)', fontSize: 13, marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <Text code={code} ellipsis={{ showTooltip: true }} style={{ flex: 1 }}>{value}</Text>
        <Button theme="borderless" size="small" icon={<Copy size={14} />} onClick={() => { if (value) void copyTextWithToast(value); }}>复制</Button>
      </div>
    </div>
  );
}
