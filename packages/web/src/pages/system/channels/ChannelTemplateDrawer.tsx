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
import { useCallback, useEffect, useState } from 'react';
import { Button, Form, Popconfirm, SideSheet, Space, Tag, Toast, Typography, Upload } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ImagePlus, Plus, Trash2 } from 'lucide-react';
import type { ChannelMessageTemplate, ChannelMessageType, ChatCard, ChatMessageExtra } from '@zenith/shared';
import { request } from '@/utils/request';
import { config } from '@/config';
import { formatDateTime } from '@/utils/date';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** 模板增删改后通知父级刷新（如发布弹窗的模板下拉） */
  onChanged?: () => void;
}

const TYPE_LABELS: Partial<Record<ChannelMessageType, string>> = {
  text: '文本',
  image: '图片',
  news: '图文',
};

const TYPE_COLOR: Partial<Record<ChannelMessageType, 'blue' | 'cyan' | 'purple'>> = {
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

interface TemplateFormValues {
  name?: string;
  type?: ChannelMessageType;
  title?: string;
  content?: string;
  summary?: string;
  linkUrl?: string;
}

export function ChannelTemplateDrawer({ visible, onClose, onChanged }: Readonly<Props>) {
  const [list, setList] = useState<ChannelMessageTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [editing, setEditing] = useState<ChannelMessageTemplate | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formValues, setFormValues] = useState<TemplateFormValues>({});
  const [imageUrl, setImageUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<ChannelMessageTemplate[]>('/api/channels/templates', { silent: true });
      if (res.code === 0 && res.data) setList(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) void fetchList();
  }, [visible, fetchList]);

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
      type: t.type,
      title: t.title ?? '',
      content: t.type === 'image' ? '' : t.content,
      summary: t.extra?.card?.text ?? '',
      linkUrl: t.extra?.card?.actions?.[0]?.url ?? '',
    });
    setEditVisible(true);
  };

  const handleSubmit = async () => {
    const name = (formValues.name ?? '').trim();
    const type: ChannelMessageType = formValues.type ?? 'text';
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

    setSubmitting(true);
    try {
      const res = editing
        ? await request.put(`/api/channels/templates/${editing.id}`, payload)
        : await request.post('/api/channels/templates', payload);
      if (res.code === 0) {
        Toast.success(editing ? '已更新' : '已创建');
        setEditVisible(false);
        void fetchList();
        onChanged?.();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (t: ChannelMessageTemplate) => {
    const res = await request.delete(`/api/channels/templates/${t.id}`);
    if (res.code === 0) {
      Toast.success('已删除');
      void fetchList();
      onChanged?.();
    }
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
    { title: '更新时间', dataIndex: 'updatedAt', width: 180, render: (v: string) => formatDateTime(v) },
    {
      title: '操作', dataIndex: 'op', width: 120, fixed: 'right',
      render: (_: unknown, t: ChannelMessageTemplate) => (
        <Space>
          <Button theme="borderless" size="small" onClick={() => openEdit(t)}>编辑</Button>
          <Popconfirm title="确定删除该模板？" onConfirm={() => void handleDelete(t)}>
            <Button theme="borderless" type="danger" size="small">删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const editType: ChannelMessageType = formValues.type ?? 'text';

  return (
    <SideSheet title="消息模板库" visible={visible} onCancel={onClose} width={680} placement="right" closeOnEsc>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography.Text type="tertiary" size="small">模板仅保存消息内容，可在群发弹窗中一键载入</Typography.Text>
        <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增模板</Button>
      </div>
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={list}
        rowKey="id"
        loading={loading}
        pagination={false}
        size="small"
      />

      <AppModal
        title={editing ? '编辑模板' : '新增模板'}
        visible={editVisible}
        onCancel={() => setEditVisible(false)}
        onOk={() => void handleSubmit()}
        confirmLoading={submitting}
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

          {editType === 'news' && (
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
