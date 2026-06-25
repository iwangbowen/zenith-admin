/**
 * 客服快捷回复管理抽屉
 *
 * 快捷回复分两类：全局（channelId=null，所有运营号可用）与频道专属（绑定某运营号）。
 * 在此可对全部快捷回复做 CRUD；新建/编辑时作用域可选「全局」或「当前频道」。
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Form, Modal, SideSheet, Table, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus } from 'lucide-react';
import type { ChannelQuickReply } from '@zenith/shared';
import { request } from '@/utils/request';
import { AppModal } from '@/components/AppModal';
import { createOperationColumn } from '@/components/ResponsiveTableActions';

interface Props {
  channelId: number;
  channelName: string;
  visible: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

export function ChannelQuickReplyDrawer({ channelId, channelName, visible, onClose, onChanged }: Readonly<Props>) {
  const [list, setList] = useState<ChannelQuickReply[]>([]);
  const [loading, setLoading] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [editing, setEditing] = useState<ChannelQuickReply | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<ChannelQuickReply[]>(
        `/api/channels/cs/quick-replies?channelId=${channelId}`,
        { silent: true },
      );
      if (res.code === 0 && res.data) setList(res.data);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    if (visible) void fetchList();
  }, [visible, fetchList]);

  const openCreate = () => { setEditing(null); setEditVisible(true); };
  const openEdit = (r: ChannelQuickReply) => { setEditing(r); setEditVisible(true); };

  const handleSubmit = async () => {
    const values = formValues as { scope?: 'global' | 'channel'; title?: string; content?: string; sort?: number };
    const title = values.title?.trim();
    const content = values.content?.trim();
    if (!title) { Toast.error('请填写标题'); return; }
    if (!content) { Toast.error('请填写内容'); return; }
    setSubmitting(true);
    try {
      const payload = {
        channelId: (values.scope ?? 'global') === 'channel' ? channelId : null,
        title,
        content,
        sort: Number(values.sort) || 0,
      };
      const res = editing
        ? await request.put(`/api/channels/cs/quick-replies/${editing.id}`, payload)
        : await request.post('/api/channels/cs/quick-replies', payload);
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

  const handleDelete = async (r: ChannelQuickReply) => {
    const res = await request.delete(`/api/channels/cs/quick-replies/${r.id}`);
    if (res.code === 0) { Toast.success('已删除'); void fetchList(); onChanged?.(); }
  };

  const columns: ColumnProps<ChannelQuickReply>[] = [
    {
      title: '标题', dataIndex: 'title', width: 160,
      render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 150 }}>{v}</Typography.Text>,
    },
    {
      title: '内容', dataIndex: 'content',
      render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 240 }}>{v}</Typography.Text>,
    },
    {
      title: '作用域', dataIndex: 'channelId', width: 120,
      render: (v: number | null, r: ChannelQuickReply) => (v == null
        ? <Tag color="green" size="small">全局</Tag>
        : <Tag color="blue" size="small">{r.channelName ?? `频道#${v}`}</Tag>),
    },
    { title: '排序', dataIndex: 'sort', width: 60 },
    createOperationColumn<ChannelQuickReply>({
      width: 120,
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
            Modal.confirm({
              title: '确定删除该快捷回复？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => { void handleDelete(record); },
            });
          },
        },
      ],
    }),
  ];

  return (
    <SideSheet title={`快捷回复 · ${channelName}`} visible={visible} onCancel={onClose} width={680} placement="right">
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography.Text type="tertiary" size="small">全局快捷回复对所有运营号可用，频道专属仅对当前运营号生效</Typography.Text>
        <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
      </div>
      <Table
        columns={columns}
        dataSource={list}
        rowKey="id"
        loading={loading}
        pagination={false}
        size="small"
      />

      <AppModal
        title={editing ? '编辑快捷回复' : '新增快捷回复'}
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
          initValues={{
            scope: editing ? (editing.channelId == null ? 'global' : 'channel') : 'global',
            title: editing?.title ?? '',
            content: editing?.content ?? '',
            sort: editing?.sort ?? 0,
          }}
          onValueChange={(v) => setFormValues(v)}
        >
          <Form.Select
            field="scope"
            label="作用域"
            style={{ width: '100%' }}
            optionList={[
              { label: '全局（所有运营号）', value: 'global' },
              { label: `当前频道（${channelName}）`, value: 'channel' },
            ]}
          />
          <Form.Input field="title" label="标题" rules={[{ required: true, message: '请填写标题' }]} maxLength={100} />
          <Form.TextArea field="content" label="内容" rules={[{ required: true, message: '请填写内容' }]} autosize={{ minRows: 3, maxRows: 6 }} maxCount={2000} />
          <Form.InputNumber field="sort" label="排序" min={0} style={{ width: '100%' }} />
        </Form>
      </AppModal>
    </SideSheet>
  );
}

export default ChannelQuickReplyDrawer;
