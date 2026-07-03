import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Modal, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Copy, Plus, RotateCcw, Search } from 'lucide-react';
import type { ChatWebhook } from '@zenith/shared';
import { UserAvatar } from '@/components/UserAvatar';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { AppModal } from '@/components/AppModal';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { formatDateTime } from '@/utils/date';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import {
  chatBotKeys,
  useChatBotGroupConversations,
  useChatBotList,
  useDeleteChatBot,
  useRegenerateChatBotToken,
  useSaveChatBot,
} from '@/hooks/queries/chat-bots';

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

async function copyText(text: string) {
  if (!text) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    Toast.success('已复制');
  } catch {
    Toast.error('复制失败，请手动复制');
  }
}

export default function ChatBotsPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi<BotFormValues> | null>(null);
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [modalVisible, setModalVisible] = useState(false);
  const [editingBot, setEditingBot] = useState<ChatWebhook | null>(null);
  const [secretInfo, setSecretInfo] = useState<ChatWebhook | null>(null);

  const listQuery = useChatBotList({
    page,
    pageSize,
    keyword: submittedKeyword.trim() || undefined,
  });
  const data = listQuery.data ?? null;
  const groupConversationsQuery = useChatBotGroupConversations(modalVisible);
  const groupConversations = useMemo(() => groupConversationsQuery.data ?? [], [groupConversationsQuery.data]);
  const saveMutation = useSaveChatBot();
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

  const formInitValues: BotFormValues = editingBot
    ? {
        name: editingBot.name,
        avatar: editingBot.avatar,
        description: editingBot.description,
        conversationId: editingBot.conversationId,
        enabled: editingBot.enabled,
      }
    : { name: '', avatar: null, description: null, enabled: true };

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

  function openCreateModal() {
    setEditingBot(null);
    setModalVisible(true);
  }

  function openEditModal(row: ChatWebhook) {
    setEditingBot(row);
    setModalVisible(true);
  }

  function closeFormModal() {
    setModalVisible(false);
    setEditingBot(null);
    formApi.current = null;
  }

  async function handleSubmit() {
    if (!formApi.current) return;
    let values: BotFormValues;
    try {
      values = await formApi.current.validate();
    } catch {
      throw new Error('validation');
    }

    const name = values.name.trim();
    const commonPayload = {
      name,
      avatar: optionalText(values.avatar),
      description: optionalText(values.description),
      enabled: values.enabled ?? true,
    };

    if (!editingBot && !values.conversationId) {
      Toast.warning('请选择目标会话');
      return;
    }

    const result = await saveMutation.mutateAsync({
      id: editingBot?.id,
      values: editingBot
        ? commonPayload
        : {
            ...commonPayload,
            conversationId: Number(values.conversationId),
          },
    });
    Toast.success(editingBot ? '更新成功' : '创建成功');
    closeFormModal();
    if (!editingBot) setSecretInfo(result);
  }

  async function handleRegenerate(row: ChatWebhook) {
    const result = await regenerateMutation.mutateAsync(row.id);
    Toast.success('令牌已重置');
    setSecretInfo(result);
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  }

  const columns: ColumnProps<ChatWebhook>[] = [
    {
      title: '名称',
      dataIndex: 'name',
      width: 220,
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
    {
      title: 'Webhook 地址',
      dataIndex: 'webhookUrl',
      width: 360,
      render: (_: unknown, row: ChatWebhook) => {
        const url = getAbsoluteWebhookUrl(row.webhookUrl);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 260 }}>{url}</Text>
            <Button theme="borderless" size="small" icon={<Copy size={14} />} onClick={() => void copyText(url)}>复制</Button>
          </div>
        );
      },
    },
    {
      title: '令牌',
      dataIndex: 'token',
      width: 220,
      render: (token: string) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Text code ellipsis={{ showTooltip: true }} style={{ maxWidth: 130 }}>{maskToken(token)}</Text>
          <Button theme="borderless" size="small" icon={<Copy size={14} />} onClick={() => void copyText(token)}>复制</Button>
        </div>
      ),
    },
    {
      title: '最近使用',
      dataIndex: 'lastUsedAt',
      width: 180,
      render: (value: string | null) => value ? formatDateTime(value) : '—',
    },
    createdAtColumn as ColumnProps<ChatWebhook>,
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 90,
      fixed: 'right',
      render: (enabled: boolean) => enabled ? <Tag color="green">启用</Tag> : <Tag color="grey">停用</Tag>,
    },
    createOperationColumn<ChatWebhook>({
      width: 220,
      actions: (row) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('chat:bot:update'),
          onClick: () => openEditModal(row),
        },
        {
          key: 'regenerate',
          label: '重置令牌',
          hidden: !hasPermission('chat:bot:update'),
          onClick: () => {
            Modal.confirm({
              title: '重置后旧地址立即失效，确认重置？',
              onOk: () => { void handleRegenerate(row); },
            });
          },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('chat:bot:delete'),
          onClick: () => {
            Modal.confirm({
              title: '确定删除该机器人？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => { void handleDelete(row.id); },
            });
          },
        },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索机器人名称"
              value={draftKeyword}
              onChange={setDraftKeyword}
              onEnterPress={handleSearch}
              style={{ width: 260 }}
              showClear
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
            {hasPermission('chat:bot:create') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={openCreateModal}>新增</Button>
            )}
          </>
        )}
        mobilePrimary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索机器人名称"
              value={draftKeyword}
              onChange={setDraftKeyword}
              onEnterPress={handleSearch}
              style={{ width: 260 }}
              showClear
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            {hasPermission('chat:bot:create') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={openCreateModal}>新增</Button>
            )}
          </>
        )}
        mobileActions={<Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>}
        actionTitle="机器人操作"
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(data?.total ?? 0)}
        rowKey="id"
        size="small"
        empty="暂无数据"
      />

      <AppModal
        title={editingBot ? '编辑 Webhook 机器人' : '新增 Webhook 机器人'}
        visible={modalVisible}
        onCancel={closeFormModal}
        onOk={handleSubmit}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={520}
        closeOnEsc
      >
        <Form<BotFormValues>
          key={editingBot?.id ?? 'new-chat-bot'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input field="name" label="名称" placeholder="请输入机器人名称" rules={[{ required: true, message: '请输入机器人名称' }]} />
          <Form.Select
            field="conversationId"
            label="目标会话"
            placeholder="请选择目标群聊"
            rules={[{ required: true, message: '请选择目标会话' }]}
            optionList={conversationOptions}
            loading={groupConversationsQuery.isFetching}
            disabled={!!editingBot}
            filter
            style={{ width: '100%' }}
          />
          <Form.Input field="avatar" label="头像" placeholder="请输入头像 URL（可选）" />
          <Form.TextArea field="description" label="描述" placeholder="请输入描述（可选）" autosize={{ minRows: 3, maxRows: 5 }} />
          <Form.Switch field="enabled" label="状态" checkedText="启用" uncheckedText="停用" />
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
        <Button theme="borderless" size="small" icon={<Copy size={14} />} onClick={() => void copyText(value)}>复制</Button>
      </div>
    </div>
  );
}
