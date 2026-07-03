/**
 * 运营号自动回复配置抽屉
 *
 * 优先级（后端 matchAutoReply）：subscribe → keyword(exact 优先 contains，按 sort) → default。
 */
import { useState } from 'react';
import { Button, Form, Modal, SideSheet, Space, Table, Tag, Toast, Typography, Upload } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ImagePlus, Plus, Trash2 } from 'lucide-react';
import type { ChannelAutoReply, ChannelMessageType, ChannelRichReplyExtra } from '@zenith/shared';
import {
  CHANNEL_AUTO_REPLY_MATCH_LABELS, CHANNEL_AUTO_REPLY_KEYWORD_MODE_LABELS,
} from '@zenith/shared';
import { config } from '@/config';
import { usePermission } from '@/hooks/usePermission';
import { AppModal } from '@/components/AppModal';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import {
  useChannelAutoReplies,
  useDeleteChannelAutoReply,
  useSaveChannelAutoReply,
} from '@/hooks/queries/channels';

interface Props {
  channelId: number;
  channelName: string;
  visible: boolean;
  onClose: () => void;
}

const MATCH_COLOR: Record<string, 'green' | 'blue' | 'orange'> = {
  subscribe: 'green',
  keyword: 'blue',
  default: 'orange',
};

const REPLY_TYPE_LABELS: Partial<Record<ChannelMessageType, string>> = {
  text: '文本',
  image: '图片',
  news: '图文',
};

const REPLY_TYPE_COLOR: Partial<Record<ChannelMessageType, 'blue' | 'cyan' | 'purple'>> = {
  text: 'blue',
  image: 'cyan',
  news: 'purple',
};

const UPLOAD_ACTION = `${config.apiBaseUrl}/api/files/upload-one`;
const uploadHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('zenith_token') ?? ''}` });

function extractUploadUrl(res: unknown): string | null {
  const r = res as { code?: number; data?: { url?: string } };
  return r?.code === 0 && r.data?.url ? r.data.url : null;
}

export function ChannelAutoReplyDrawer({ channelId, channelName, visible, onClose }: Readonly<Props>) {
  const { hasPermission } = usePermission();
  const canSave = hasPermission('channel:reply:save');
  const canDelete = hasPermission('channel:reply:delete');

  const [editVisible, setEditVisible] = useState(false);
  const [editing, setEditing] = useState<ChannelAutoReply | null>(null);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [imageUrl, setImageUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const listQuery = useChannelAutoReplies(channelId, visible && !!channelId);
  const list = listQuery.data ?? [];
  const saveMutation = useSaveChannelAutoReply();
  const deleteMutation = useDeleteChannelAutoReply();

  const openCreate = () => {
    setEditing(null);
    setImageUrl('');
    setCoverUrl('');
    setEditVisible(true);
  };
  const openEdit = (r: ChannelAutoReply) => {
    setEditing(r);
    setImageUrl(r.replyExtra?.imageUrl ?? '');
    setCoverUrl(r.replyExtra?.cover ?? '');
    setEditVisible(true);
  };

  const handleSubmit = async () => {
    const values = formValues as {
      matchType: ChannelAutoReply['matchType'];
      keyword?: string;
      keywordMode: ChannelAutoReply['keywordMode'];
      replyType?: ChannelMessageType;
      replyContent?: string;
      title?: string;
      summary?: string;
      linkUrl?: string;
      status: ChannelAutoReply['status'];
      sort: number;
    };
    const replyType: ChannelMessageType = values.replyType ?? 'text';
    const replyContent = (values.replyContent ?? '').trim();
    const title = (values.title ?? '').trim();

    if (values.matchType === 'keyword' && !values.keyword?.trim()) { Toast.error('关键词回复必须填写关键词'); return; }
    if (replyType === 'text' && !replyContent) { Toast.error('请填写回复内容'); return; }
    if (replyType === 'image' && !imageUrl) { Toast.error('请上传图片'); return; }
    if (replyType === 'news' && !title) { Toast.error('图文回复请填写标题'); return; }

    let replyExtra: ChannelRichReplyExtra | null = null;
    if (replyType === 'image') {
      replyExtra = { imageUrl };
    } else if (replyType === 'news') {
      replyExtra = {
        title,
        cover: coverUrl || null,
        summary: (values.summary ?? '').trim() || null,
        linkUrl: (values.linkUrl ?? '').trim() || null,
      };
    }

    const payload = {
      keyword: values.matchType === 'keyword' ? (values.keyword ?? '').trim() : null,
      keywordMode: values.keywordMode ?? 'contains',
      replyType,
      replyContent,
      replyExtra,
      status: values.status ?? 'enabled',
      sort: Number(values.sort) || 0,
    };
    await saveMutation.mutateAsync({
      channelId,
      id: editing?.id,
      values: editing ? payload : { matchType: values.matchType, ...payload },
    });
    Toast.success(editing ? '已更新' : '已创建');
    setEditVisible(false);
  };

  const handleDelete = async (r: ChannelAutoReply) => {
    await deleteMutation.mutateAsync({ channelId, id: r.id });
    Toast.success('已删除');
  };

  const columns: ColumnProps<ChannelAutoReply>[] = [
    {
      title: '类型', dataIndex: 'matchType', width: 110,
      render: (v: string) => <Tag color={MATCH_COLOR[v] ?? 'grey'} size="small">{CHANNEL_AUTO_REPLY_MATCH_LABELS[v as keyof typeof CHANNEL_AUTO_REPLY_MATCH_LABELS] ?? v}</Tag>,
    },
    {
      title: '关键词', dataIndex: 'keyword',
      render: (v: string | null, r: ChannelAutoReply) => (r.matchType === 'keyword'
        ? <span>{v} <Typography.Text type="tertiary" size="small">({CHANNEL_AUTO_REPLY_KEYWORD_MODE_LABELS[r.keywordMode]})</Typography.Text></span>
        : <Typography.Text type="tertiary">—</Typography.Text>),
    },
    {
      title: '回复类型', dataIndex: 'replyType', width: 90,
      render: (v: ChannelMessageType) => <Tag color={REPLY_TYPE_COLOR[v] ?? 'grey'} size="small">{REPLY_TYPE_LABELS[v] ?? v}</Tag>,
    },
    {
      title: '回复内容', dataIndex: 'replyContent',
      render: (v: string, r: ChannelAutoReply) => {
        const text = r.replyType === 'image'
          ? (r.replyExtra?.imageUrl ?? '')
          : r.replyType === 'news'
            ? (r.replyExtra?.title ?? v)
            : v;
        return <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 200 }}>{text || '—'}</Typography.Text>;
      },
    },
    {
      title: '命中次数', dataIndex: 'hitCount', width: 90,
      render: (v: number) => <Typography.Text>{Number(v) || 0}</Typography.Text>,
    },
    { title: '状态', dataIndex: 'status', width: 70, render: (v: string) => <Tag color={v === 'enabled' ? 'green' : 'grey'} size="small">{v === 'enabled' ? '启用' : '停用'}</Tag> },
    { title: '排序', dataIndex: 'sort', width: 60 },
    createOperationColumn<ChannelAutoReply>({
      width: 120,
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !canSave,
          onClick: () => openEdit(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !canDelete,
          onClick: () => {
            Modal.confirm({
              title: '确定删除该规则？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => { void handleDelete(record); },
            });
          },
        },
      ],
    }),
  ];

  return (
    <SideSheet title={`自动回复 · ${channelName}`} visible={visible} onCancel={onClose} width={620} placement="right" closeOnEsc>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography.Text type="tertiary" size="small">优先级：关注欢迎语 → 关键词（完全匹配优先）→ 默认兜底</Typography.Text>
        {canSave && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增规则</Button>}
      </div>
      <Table
        columns={columns}
        dataSource={list}
        rowKey="id"
        loading={listQuery.isFetching}
        pagination={false}
        size="small"
      />

      <AppModal
        title={editing ? '编辑自动回复' : '新增自动回复'}
        visible={editVisible}
        onCancel={() => setEditVisible(false)}
        onOk={() => void handleSubmit()}
        confirmLoading={saveMutation.isPending}
        okText="保存"
        width={520}
      >
        <Form
          key={editing?.id ?? 'new'}
          labelPosition="left"
          labelWidth={90}
          initValues={{
            matchType: editing?.matchType ?? 'keyword',
            keyword: editing?.keyword ?? '',
            keywordMode: editing?.keywordMode ?? 'contains',
            replyType: editing?.replyType ?? 'text',
            replyContent: editing?.replyContent ?? '',
            title: editing?.replyExtra?.title ?? '',
            summary: editing?.replyExtra?.summary ?? '',
            linkUrl: editing?.replyExtra?.linkUrl ?? '',
            status: editing?.status ?? 'enabled',
            sort: editing?.sort ?? 0,
          }}
          onValueChange={(v) => setFormValues(v)}
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

                {replyType === 'text' && (
                  <Form.TextArea field="replyContent" label="回复内容" rules={[{ required: true, message: '请填写回复内容' }]} autosize={{ minRows: 3, maxRows: 6 }} />
                )}

                {replyType === 'image' && (
                  <Form.Slot label="图片">
                    <Space align="start">
                      {imageUrl
                        ? (
                          <div style={{ position: 'relative' }}>
                            <img src={imageUrl} alt="图片" style={{ maxWidth: 240, maxHeight: 180, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--semi-color-border)' }} />
                            <Button
                              theme="borderless"
                              type="danger"
                              size="small"
                              icon={<Trash2 size={14} />}
                              style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(255,255,255,0.8)' }}
                              onClick={() => setImageUrl('')}
                            />
                          </div>
                        )
                        : (
                          <Upload
                            action={UPLOAD_ACTION}
                            headers={uploadHeaders()}
                            name="file"
                            accept="image/*"
                            limit={1}
                            showUploadList={false}
                            onSuccess={(res) => {
                              const url = extractUploadUrl(res);
                              if (url) { setImageUrl(url); Toast.success('图片已上传'); } else Toast.error('图片上传失败');
                            }}
                          >
                            <Button icon={<ImagePlus size={14} />}>上传图片</Button>
                          </Upload>
                        )}
                    </Space>
                  </Form.Slot>
                )}

                {replyType === 'news' && (
                  <>
                    <Form.Input field="title" label="标题" rules={[{ required: true, message: '请填写标题' }]} />
                    <Form.Slot label="封面图">
                      <Space align="start">
                        {coverUrl
                          ? (
                            <div style={{ position: 'relative' }}>
                              <img src={coverUrl} alt="封面" style={{ width: 120, height: 80, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--semi-color-border)' }} />
                              <Button
                                theme="borderless"
                                type="danger"
                                size="small"
                                icon={<Trash2 size={14} />}
                                style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(255,255,255,0.8)' }}
                                onClick={() => setCoverUrl('')}
                              />
                            </div>
                          )
                          : (
                            <Upload
                              action={UPLOAD_ACTION}
                              headers={uploadHeaders()}
                              name="file"
                              accept="image/*"
                              limit={1}
                              showUploadList={false}
                              onSuccess={(res) => {
                                const url = extractUploadUrl(res);
                                if (url) { setCoverUrl(url); Toast.success('封面已上传'); } else Toast.error('封面上传失败');
                              }}
                            >
                              <Button icon={<ImagePlus size={14} />}>上传封面</Button>
                            </Upload>
                          )}
                      </Space>
                    </Form.Slot>
                    <Form.TextArea field="summary" label="摘要" placeholder="可选，列表摘要" autosize={{ minRows: 2, maxRows: 3 }} />
                    <Form.Input field="linkUrl" label="跳转链接" placeholder="可选，点击图文跳转的 URL" />
                    <Form.TextArea field="replyContent" label="正文" placeholder="可选，图文正文内容" autosize={{ minRows: 3, maxRows: 6 }} />
                  </>
                )}

                <Form.InputNumber field="sort" label="排序" min={0} style={{ width: '100%' }} />
                <Form.Select
                  field="status"
                  label="状态"
                  style={{ width: '100%' }}
                  optionList={[{ label: '启用', value: 'enabled' }, { label: '停用', value: 'disabled' }]}
                />
              </>
            );
          }}
        </Form>
      </AppModal>
    </SideSheet>
  );
}

export default ChannelAutoReplyDrawer;
