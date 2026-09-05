/**
 * 群发消息模板库管理抽屉
 *
 * 提供模板的 列表 / 新建 / 编辑 / 删除。
 * 模板仅存储消息内容（名称 / 类型 / 标题 / 正文 / 图片 / 图文卡片），不含受众与发送方式。
 * 内容结构与 ChannelPublishModal 保持一致：
 *   - text：content 为文本
 *   - image：content 为图片 URL
 *   - news：extra.card = { title, cover, text(摘要), actions:[{ url }] }
 */
import { useState } from 'react';
import { Form, SideSheet, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { CHANNEL_MESSAGE_TYPE_LABELS as TYPE_LABELS } from '@zenith/shared/messaging';
import type { ChatCard, ChatMessageExtra } from '@zenith/shared/chat';
import type { ChannelMessageTemplate, ChannelMessageType, CreateChannelTemplateInput } from '@zenith/shared/messaging';
import { enumValueOf } from '@zenith/shared/core';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ImageUploadField } from '@/components/ImageUploadField';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import {
  useChannelTemplates,
  useDeleteChannelTemplate,
  useSaveChannelTemplate,
} from '@/hooks/queries/channels';
import { CreateButton } from '@/components/toolbar-controls';
import { confirmDelete } from '@/utils/confirm';
import { dateTimeColumn } from '@/utils/table-columns';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** 模板增删改后通知父级刷新（如发布弹窗的模板下拉） */
  onChanged?: () => void;
}

const TYPE_COLOR: Partial<Record<ChannelMessageType, 'blue' | 'cyan' | 'purple'>> = {
  text: 'blue',
  image: 'cyan',
  news: 'purple',
};

/** 群发模板只支持文本 / 图片 / 图文（不含聊天卡片） */
type TemplateType = CreateChannelTemplateInput['type'];
const TEMPLATE_TYPES = ['text', 'image', 'news'] as const satisfies readonly TemplateType[];

interface TemplateFormValues {
  name?: string;
  type?: TemplateType;
  title?: string;
  content?: string;
  summary?: string;
  linkUrl?: string;
}

export function ChannelTemplateDrawer({ visible, onClose, onChanged }: Readonly<Props>) {
  const [editVisible, setEditVisible] = useState(false);
  const [editing, setEditing] = useState<ChannelMessageTemplate | null>(null);
  const [formValues, setFormValues] = useState<TemplateFormValues>({});
  const [imageUrl, setImageUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const listQuery = useChannelTemplates(visible);
  const list = listQuery.data ?? [];
  const saveMutation = useSaveChannelTemplate();
  const deleteMutation = useDeleteChannelTemplate();

  const openCreate = () => {
    setEditing(null);
    setImageUrl('');
    setCoverUrl('');
    setFormValues({ type: 'text' });
    setEditVisible(true);
  };

  const openEdit = (t: ChannelMessageTemplate) => {
    setEditing(t);
    setImageUrl(t.type === 'image' ? t.content : '');
    setCoverUrl(t.type === 'news' ? (t.extra?.card?.cover ?? '') : '');
    setFormValues({
      name: t.name,
      type: enumValueOf(TEMPLATE_TYPES, t.type) ?? 'text',
      title: t.title ?? '',
      content: t.type === 'image' ? '' : t.content,
      summary: t.extra?.card?.text ?? '',
      linkUrl: t.extra?.card?.actions?.[0]?.url ?? '',
    });
    setEditVisible(true);
  };

  const handleSubmit = async () => {
    const name = (formValues.name ?? '').trim();
    const type: TemplateType = formValues.type ?? 'text';
    const title = (formValues.title ?? '').trim();
    const content = (formValues.content ?? '').trim();

    if (!name) { Toast.error('请填写模板名称'); return; }
    if (type === 'text' && !content) { Toast.error('请填写文本内容'); return; }
    if (type === 'image' && !imageUrl) { Toast.error('请上传图片'); return; }
    if (type === 'news' && !title) { Toast.error('图文模板请填写标题'); return; }

    let extra: ChatMessageExtra | null = null;
    let payloadContent = content;
    let payloadTitle: string | null = title || null;

    if (type === 'image') {
      payloadContent = imageUrl;
      payloadTitle = null;
    } else if (type === 'news') {
      const linkUrl = (formValues.linkUrl ?? '').trim();
      const card: ChatCard = {
        title,
        cover: coverUrl || null,
        text: (formValues.summary ?? '').trim() || null,
        actions: linkUrl ? [{ key: 'link', label: '查看详情', action: 'link', url: linkUrl }] : [],
      };
      extra = { card };
    }

    const payload = { name, type, title: payloadTitle, content: payloadContent, extra };

    await saveMutation.mutateAsync({ id: editing?.id, values: payload });
    Toast.success(editing ? '已更新' : '已创建');
    setEditVisible(false);
    onChanged?.();
  };

  const handleDelete = async (t: ChannelMessageTemplate) => {
    await deleteMutation.mutateAsync({ params: { id: t.id } });
    Toast.success('已删除');
    onChanged?.();
  };

  const columns: ColumnProps<ChannelMessageTemplate>[] = [
    {
      title: '名称', dataIndex: 'name',
      render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 200 }}>{v}</Typography.Text>,
    },
    {
      title: '类型', dataIndex: 'type', width: 90,
      render: (v: ChannelMessageType) => <Tag color={TYPE_COLOR[v] ?? 'grey'} size="small">{TYPE_LABELS[v] ?? v}</Tag>,
    },
    dateTimeColumn('更新时间', 'updatedAt'),
    createOperationColumn<ChannelMessageTemplate>({
      width: 150,
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          onClick: () => openEdit(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            confirmDelete({
              title: '确定删除该模板？',
              onOk: () => { void handleDelete(record); },
            });
          },
        },
      ],
    }),
  ];

  const editType: ChannelMessageType = formValues.type ?? 'text';

  return (
    <SideSheet title="消息模板库" visible={visible} onCancel={onClose} width={680} placement="right" closeOnEsc>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography.Text type="tertiary" size="small">模板仅保存消息内容，可在群发弹窗中一键载入</Typography.Text>
        <CreateButton onClick={openCreate}>新增模板</CreateButton>
      </div>
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={list}
        rowKey="id"
        loading={listQuery.isFetching}
        pagination={false}
        size="small"
      />

      <AppModal
        title={editing ? '编辑模板' : '新增模板'}
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
          initValues={formValues}
          onValueChange={(v) => setFormValues(v as TemplateFormValues)}
        >
          <Form.Input field="name" label="模板名称" rules={[{ required: true, message: '请填写模板名称' }]} maxLength={50} />
          <Form.RadioGroup field="type" label="消息类型" type="button">
            <Form.Radio value="text">文本</Form.Radio>
            <Form.Radio value="image">图片</Form.Radio>
            <Form.Radio value="news">图文</Form.Radio>
          </Form.RadioGroup>

          {editType === 'text' && (
            <>
              <Form.Input field="title" label="标题" placeholder="可选" />
              <Form.TextArea field="content" label="内容" placeholder="请输入文本内容" autosize={{ minRows: 3, maxRows: 8 }} />
            </>
          )}

          {editType === 'image' && (
            <Form.Slot label="图片">
              <ImageUploadField value={imageUrl} onChange={setImageUrl} label="图片" />
            </Form.Slot>
          )}

          {editType === 'news' && (
            <>
              <Form.Input field="title" label="标题" rules={[{ required: true, message: '请填写标题' }]} />
              <Form.Slot label="封面图">
                <ImageUploadField
                  value={coverUrl}
                  onChange={setCoverUrl}
                  label="封面"
                  previewStyle={{ width: 120, height: 80 }}
                />
              </Form.Slot>
              <Form.TextArea field="summary" label="摘要" placeholder="可选，列表摘要" autosize={{ minRows: 2, maxRows: 3 }} />
              <Form.TextArea field="content" label="正文" placeholder="图文正文内容" autosize={{ minRows: 4, maxRows: 10 }} />
              <Form.Input field="linkUrl" label="跳转链接" placeholder="可选，点击图文跳转的 URL" />
            </>
          )}
        </Form>
      </AppModal>
    </SideSheet>
  );
}

export default ChannelTemplateDrawer;
