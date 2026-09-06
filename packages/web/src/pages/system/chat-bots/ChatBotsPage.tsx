import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Copy } from 'lucide-react';
import type { ChatWebhook } from '@zenith/shared/chat';
import { UserAvatar } from '@/components/UserAvatar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { AppModal } from '@/components/AppModal';
import { useEditModal } from '@/hooks/useEditModal';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { copyableNoColumn, createdAtColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import {
  chatBotKeys,
  type SaveChatBotValues,
  useChatBotGroupConversations,
  useChatBotList,
  useDeleteChatBot,
  useRegenerateChatBotToken,
  useSaveChatBot,
} from '@/hooks/queries/chat-bots';
import { CreateButton } from '@/components/toolbar-controls';
import { KeywordInput } from '@/components/search-filters';
import { confirmDanger } from '@/utils/confirm';
import { copyTextWithToast } from '@/utils/clipboard';
import { abortSubmit } from '@/lib/abort-submit';

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

function maskToken(token: string): string {
  if (!token) return '—';
  return `${token.slice(0, 12)}••••`;
}

export default function ChatBotsPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [secretInfo, setSecretInfo] = useState<ChatWebhook | null>(null);

  const listQuery = useChatBotList({
    page,
    pageSize,
    keyword: submittedKeyword.trim() || undefined,
  });
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

  function handleSearch() {
    setPage(1);
    setSubmittedKeyword(draftKeyword);
    void queryClient.invalidateQueries({ queryKey: chatBotKeys.lists });
  }

  function handleReset() {
    setDraftKeyword('');
    setSubmittedKeyword('');
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: chatBotKeys.lists });
  }

  async function handleRegenerate(row: ChatWebhook) {
    const result = await regenerateMutation.mutateAsync({ params: { id: row.id } });
    Toast.success('令牌已重置');
    setSecretInfo(result);
  }


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
    createOperationColumn<ChatWebhook>({
      width: 240,
      actions: (row) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('chat:bot:update'),
          onClick: () => botModal.openEdit(row),
        },
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
        deleteAction({
          hidden: !hasPermission('chat:bot:delete'),
          title: '确定删除该机器人？',
          run: () => deleteMutation.mutateAsync({ params: { id: row.id } }),
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索机器人名称" value={draftKeyword} onChange={setDraftKeyword} onSearch={handleSearch} width={260} />}
        onSearch={handleSearch}
        onReset={handleReset}
        create={hasPermission('chat:bot:create') && (
          <CreateButton onClick={botModal.openCreate} />
        )}
        actionTitle="机器人操作"
      />

      <ConfigurableTable<ChatWebhook>
        columns={columns}
        empty="暂无数据"
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <AppModal
        {...botModal.modalProps}
        width={520}
      >
        <Form key={botModal.formKey} {...botModal.formProps}>
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
          <Form.Input field="avatar" label="头像" placeholder="请输入头像 URL（可选）" />
          <Form.TextArea field="description" label="描述" placeholder="请输入描述（可选）" autosize={{ minRows: 3, maxRows: 5 }} />
          <Form.Switch field="enabled" label="状态" />
        </Form>
      </AppModal>

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
