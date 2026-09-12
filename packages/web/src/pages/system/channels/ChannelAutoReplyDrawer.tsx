/**
 * 运营号自动回复配置抽屉
 *
 * 优先级（后端 matchAutoReply）：subscribe → keyword(exact 优先 contains，按 sort) → default。
 */
import { useState } from 'react';
import { Button, Form, SideSheet, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Eye } from 'lucide-react';
import type { ChannelAutoReply, ChannelMessageType, ChannelRichReplyExtra, CreateChannelAutoReplyInput } from '@zenith/shared/messaging';
import { CHANNEL_AUTO_REPLY_MATCH_LABELS, CHANNEL_AUTO_REPLY_KEYWORD_MODE_LABELS, CHANNEL_MESSAGE_TYPE_LABELS as REPLY_TYPE_LABELS } from '@zenith/shared/messaging';
import { enumValueOf } from '@zenith/shared/core';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { AppModal } from '@/components/AppModal';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, listTableProps } from '@/components/list-page';
import {
  ChannelContentFields,
  ChannelNewsBodyField,
  ChannelNewsPreviewModal,
} from './ChannelContentEditor';
import { EMPTY_CHANNEL_CONTENT, validateChannelContent, type ChannelContentValue } from './channel-content';
import {
  useChannelAutoReplies,
  useCreateChannelAutoReply,
  useDeleteChannelAutoReply,
  useUpdateChannelAutoReply,
} from '@/hooks/queries/channels';
import { CreateButton } from '@/components/toolbar-controls';
import { renderEllipsis, renderEnabledStatusTag } from '@/utils/table-columns';
import { CHANNEL_MESSAGE_TYPE_COLOR } from './channel-tag-colors';

interface Props {
  channelId: number;
  channelName: string;
  visible: boolean;
  onClose: () => void;
}

/** 自动回复只支持文本 / 图片 / 图文（不含聊天卡片） */
type AutoReplyType = CreateChannelAutoReplyInput['replyType'];
const AUTO_REPLY_TYPES = ['text', 'image', 'news'] as const satisfies readonly AutoReplyType[];

interface AutoReplyFormValues {
  matchType: ChannelAutoReply['matchType'];
  keyword?: string;
  keywordMode?: ChannelAutoReply['keywordMode'];
  replyType?: AutoReplyType;
  status?: ChannelAutoReply['status'];
  sort?: number;
}

const MATCH_COLOR: Record<string, 'green' | 'blue' | 'orange'> = {
  subscribe: 'green',
  keyword: 'blue',
  default: 'orange',
};

export function ChannelAutoReplyDrawer({ channelId, channelName, visible, onClose }: Readonly<Props>) {
  const { hasPermission } = usePermission();
  const { options: statusOptions } = useDictItems('common_status');
  const canSave = hasPermission('channel:reply:save');
  const canDelete = hasPermission('channel:reply:delete');

  const [editVisible, setEditVisible] = useState(false);
  const [editing, setEditing] = useState<ChannelAutoReply | null>(null);
  const [formApi, setFormApi] = useState<FormApi<AutoReplyFormValues> | null>(null);
  /** 回复内容（text/image/news），与群发共用同一套内容编辑组件 */
  const [content, setContent] = useState<ChannelContentValue>(EMPTY_CHANNEL_CONTENT);
  const updateContent = (patch: Partial<ChannelContentValue>) => setContent((prev) => ({ ...prev, ...patch }));
  const [previewVisible, setPreviewVisible] = useState(false);
  const listQuery = useChannelAutoReplies(channelId, visible && !!channelId);
  const createMutation = useCreateChannelAutoReply();
  const updateMutation = useUpdateChannelAutoReply();
  const saving = createMutation.isPending || updateMutation.isPending;
  const deleteMutation = useDeleteChannelAutoReply();

  const openCreate = () => {
    setEditing(null);
    setContent(EMPTY_CHANNEL_CONTENT);
    setEditVisible(true);
  };
  const openEdit = (r: ChannelAutoReply) => {
    setEditing(r);
    setContent({
      title: r.replyExtra?.title ?? '',
      content: r.replyType === 'text' ? r.replyContent : '',
      imageUrl: r.replyExtra?.imageUrl ?? '',
      cover: r.replyExtra?.cover ?? '',
      summary: r.replyExtra?.summary ?? '',
      linkUrl: r.replyExtra?.linkUrl ?? '',
      bodyHtml: r.replyExtra?.bodyHtml ?? '',
    });
    setEditVisible(true);
  };

  const handleSubmit = async () => {
    if (!formApi) return;
    // 直接读表单快照；onValueChange 收集在「打开后未改任何字段」时会拿到空值
    const values = formApi.getValues();
    const replyType: AutoReplyType = values.replyType ?? 'text';

    if (values.matchType === 'keyword' && !values.keyword?.trim()) { Toast.error('关键词回复必须填写关键词'); return; }
    const contentErr = validateChannelContent(replyType, content);
    if (contentErr) { Toast.error(contentErr); return; }

    let replyExtra: ChannelRichReplyExtra | null = null;
    if (replyType === 'image') {
      replyExtra = { imageUrl: content.imageUrl };
    } else if (replyType === 'news') {
      replyExtra = {
        title: content.title.trim(),
        cover: content.cover || null,
        summary: content.summary.trim() || null,
        linkUrl: content.linkUrl.trim() || null,
        bodyHtml: content.bodyHtml.trim() || null,
      };
    }

    const payload = {
      keyword: values.matchType === 'keyword' ? (values.keyword ?? '').trim() : null,
      keywordMode: values.keywordMode ?? 'contains',
      replyType,
      replyContent: replyType === 'text' ? content.content.trim() : '',
      replyExtra,
      status: values.status ?? 'enabled',
      sort: Number(values.sort) || 0,
    };
    if (editing) {
      await updateMutation.mutateAsync({ params: { channelId, replyId: editing.id }, body: payload });
    } else {
      await createMutation.mutateAsync({ params: { id: channelId }, body: { matchType: values.matchType, ...payload } });
    }
    Toast.success(editing ? '已更新' : '已创建');
    setEditVisible(false);
  };


  const columns: ColumnProps<ChannelAutoReply>[] = [
    {
      title: '类型', dataIndex: 'matchType', width: 120,
      render: (v: string) => <Tag color={MATCH_COLOR[v] ?? 'grey'} size="small">{CHANNEL_AUTO_REPLY_MATCH_LABELS[v as keyof typeof CHANNEL_AUTO_REPLY_MATCH_LABELS] ?? v}</Tag>,
    },
    {
      title: '关键词', dataIndex: 'keyword', width: 170,
      render: (v: string | null, r: ChannelAutoReply) => (r.matchType === 'keyword'
        ? (
          <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 150 }}>
            {v}
            <Typography.Text type="tertiary" size="small">（{CHANNEL_AUTO_REPLY_KEYWORD_MODE_LABELS[r.keywordMode]}）</Typography.Text>
          </Typography.Text>
        )
        : <Typography.Text type="tertiary">—</Typography.Text>),
    },
    {
      title: '回复类型', dataIndex: 'replyType', width: 90,
      render: (v: ChannelMessageType) => <Tag color={CHANNEL_MESSAGE_TYPE_COLOR[v] ?? 'grey'} size="small">{REPLY_TYPE_LABELS[v] ?? v}</Tag>,
    },
    {
      title: '回复内容', dataIndex: 'replyContent',
      render: (v: string, r: ChannelAutoReply) => {
        const text = r.replyType === 'image'
          ? (r.replyExtra?.imageUrl ?? '')
          : r.replyType === 'news'
            ? (r.replyExtra?.title ?? v)
            : v;
        return renderEllipsis(text);
      },
    },
    {
      title: '命中', dataIndex: 'hitCount', width: 70, align: 'right',
      render: (v: number) => <Typography.Text>{Number(v) || 0}</Typography.Text>,
    },
    { title: '状态', dataIndex: 'status', width: 80, render: renderEnabledStatusTag },
    { title: '排序', dataIndex: 'sort', width: 64 },
    createOperationColumn<ChannelAutoReply>({
      width: 150,
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !canSave,
          onClick: () => openEdit(record),
        },
        deleteAction({
          hidden: !canDelete,
          title: '确定删除该规则？',
          run: () => deleteMutation.mutateAsync({ params: { channelId, replyId: record.id } }),
          successMessage: '已删除',
        }),
      ],
    }),
  ];

  return (
    <SideSheet title={`自动回复 · ${channelName}`} visible={visible} onCancel={onClose} width="min(1000px, 95vw)" placement="right" closeOnEsc>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography.Text type="tertiary" size="small">优先级：关注欢迎语 → 关键词（完全匹配优先）→ 默认兜底</Typography.Text>
        {canSave && <CreateButton onClick={openCreate}>新增规则</CreateButton>}
      </div>
      <ConfigurableTable
        columnSettingsKey="channel-auto-replies"
        columns={columns}
        {...listTableProps(listQuery)}
      />

      <AppModal
        title={editing ? '编辑自动回复' : '新增自动回复'}
        visible={editVisible}
        onCancel={() => setEditVisible(false)}
        onOk={() => void handleSubmit()}
        confirmLoading={saving}
        okText="保存"
        width={760}
      >
        <Form<AutoReplyFormValues>
          key={editing?.id ?? 'new'}
          getFormApi={(api) => setFormApi(api as FormApi<AutoReplyFormValues>)}
          labelPosition="left"
          labelWidth={90}
          initValues={{
            matchType: editing?.matchType ?? 'keyword',
            keyword: editing?.keyword ?? '',
            keywordMode: editing?.keywordMode ?? 'contains',
            replyType: enumValueOf(AUTO_REPLY_TYPES, editing?.replyType) ?? 'text',
            status: editing?.status ?? 'enabled',
            sort: editing?.sort ?? 0,
          }}
        >
          {({ formState }) => {
            const matchType = (formState.values?.matchType as string) ?? 'keyword';
            const replyType = (formState.values?.replyType as ChannelMessageType) ?? 'text';
            return (
              <>
                <Form.Select
                  field="matchType"
                  label="匹配类型"
                  style={{ width: '100%' }}
                  disabled={!!editing}
                  optionList={[
                    { label: '关键词回复', value: 'keyword' },
                    { label: '关注欢迎语', value: 'subscribe' },
                    { label: '默认兜底回复', value: 'default' },
                  ]}
                />
                {matchType === 'keyword' && (
                  <>
                    <Form.Input field="keyword" label="关键词" rules={[{ required: true, message: '请填写关键词' }]} />
                    <Form.Select
                      field="keywordMode"
                      label="匹配模式"
                      style={{ width: '100%' }}
                      optionList={[
                        { label: '包含匹配', value: 'contains' },
                        { label: '完全匹配', value: 'exact' },
                      ]}
                    />
                  </>
                )}
                <Form.RadioGroup field="replyType" label="回复类型" type="button">
                  <Form.Radio value="text">文本</Form.Radio>
                  <Form.Radio value="image">图片</Form.Radio>
                  <Form.Radio value="news">图文</Form.Radio>
                </Form.RadioGroup>

                {/* 内容编辑与群发共用 ChannelContentEditor，图文正文支持富文本 */}
                <ChannelContentFields type={replyType} value={content} onChange={updateContent} />
                {replyType === 'news' && (
                  <>
                    <ChannelNewsBodyField value={content} onChange={updateContent} height={280} />
                    <Form.Slot label=" ">
                      <Button icon={<Eye size={14} />} onClick={() => setPreviewVisible(true)}>预览图文</Button>
                    </Form.Slot>
                  </>
                )}

                <Form.InputNumber field="sort" label="排序" min={0} style={{ width: '100%' }} />
                <Form.Select
                  field="status"
                  label="状态"
                  style={{ width: '100%' }}
                  optionList={statusOptions}
                />
              </>
            );
          }}
        </Form>
      </AppModal>

      <ChannelNewsPreviewModal
        visible={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        value={content}
      />
    </SideSheet>
  );
}

export default ChannelAutoReplyDrawer;
