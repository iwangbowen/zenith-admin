/**
 * 运营号自动回复配置抽屉
 *
 * 优先级（后端 matchAutoReply）：subscribe → keyword(exact 优先 contains，按 sort) → default。
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Form, Popconfirm, SideSheet, Space, Table, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus } from 'lucide-react';
import type { ChannelAutoReply } from '@zenith/shared';
import {
  CHANNEL_AUTO_REPLY_MATCH_LABELS, CHANNEL_AUTO_REPLY_KEYWORD_MODE_LABELS,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import { AppModal } from '@/components/AppModal';

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

export function ChannelAutoReplyDrawer({ channelId, channelName, visible, onClose }: Readonly<Props>) {
  const { hasPermission } = usePermission();
  const canSave = hasPermission('channel:reply:save');
  const canDelete = hasPermission('channel:reply:delete');

  const [list, setList] = useState<ChannelAutoReply[]>([]);
  const [loading, setLoading] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [editing, setEditing] = useState<ChannelAutoReply | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<ChannelAutoReply[]>(`/api/channels/${channelId}/auto-replies`, { silent: true });
      if (res.code === 0 && res.data) setList(res.data);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    if (visible) void fetchList();
  }, [visible, fetchList]);

  const openCreate = () => { setEditing(null); setEditVisible(true); };
  const openEdit = (r: ChannelAutoReply) => { setEditing(r); setEditVisible(true); };

  const handleSubmit = async () => {
    const values = formValues as {
      matchType: ChannelAutoReply['matchType'];
      keyword?: string;
      keywordMode: ChannelAutoReply['keywordMode'];
      replyContent: string;
      status: ChannelAutoReply['status'];
      sort: number;
    };
    if (!values.replyContent?.trim()) { Toast.error('请填写回复内容'); return; }
    if (values.matchType === 'keyword' && !values.keyword?.trim()) { Toast.error('关键词回复必须填写关键词'); return; }
    setSubmitting(true);
    try {
      const payload = {
        keyword: values.matchType === 'keyword' ? (values.keyword ?? '').trim() : null,
        keywordMode: values.keywordMode ?? 'contains',
        replyContent: values.replyContent.trim(),
        status: values.status ?? 'enabled',
        sort: Number(values.sort) || 0,
      };
      const res = editing
        ? await request.put(`/api/channels/${channelId}/auto-replies/${editing.id}`, payload)
        : await request.post(`/api/channels/${channelId}/auto-replies`, { matchType: values.matchType, ...payload });
      if (res.code === 0) {
        Toast.success(editing ? '已更新' : '已创建');
        setEditVisible(false);
        void fetchList();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (r: ChannelAutoReply) => {
    const res = await request.delete(`/api/channels/${channelId}/auto-replies/${r.id}`);
    if (res.code === 0) { Toast.success('已删除'); void fetchList(); }
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
      title: '回复内容', dataIndex: 'replyContent',
      render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 220 }}>{v}</Typography.Text>,
    },
    { title: '状态', dataIndex: 'status', width: 70, render: (v: string) => <Tag color={v === 'enabled' ? 'green' : 'grey'} size="small">{v === 'enabled' ? '启用' : '停用'}</Tag> },
    { title: '排序', dataIndex: 'sort', width: 60 },
    {
      title: '操作', dataIndex: 'op', width: 120, fixed: 'right',
      render: (_: unknown, r: ChannelAutoReply) => (
        <Space>
          {canSave && <Button theme="borderless" size="small" onClick={() => openEdit(r)}>编辑</Button>}
          {canDelete && (
            <Popconfirm title="确定删除该规则？" onConfirm={() => void handleDelete(r)}>
              <Button theme="borderless" type="danger" size="small">删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <SideSheet title={`自动回复 · ${channelName}`} visible={visible} onCancel={onClose} width={620} placement="right">
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography.Text type="tertiary" size="small">优先级：关注欢迎语 → 关键词（完全匹配优先）→ 默认兜底</Typography.Text>
        {canSave && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增规则</Button>}
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
        title={editing ? '编辑自动回复' : '新增自动回复'}
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
            matchType: editing?.matchType ?? 'keyword',
            keyword: editing?.keyword ?? '',
            keywordMode: editing?.keywordMode ?? 'contains',
            replyContent: editing?.replyContent ?? '',
            status: editing?.status ?? 'enabled',
            sort: editing?.sort ?? 0,
          }}
          onValueChange={(v) => setFormValues(v)}
        >
          {({ formState }) => {
            const matchType = (formState.values?.matchType as string) ?? 'keyword';
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
                <Form.TextArea field="replyContent" label="回复内容" rules={[{ required: true, message: '请填写回复内容' }]} autosize={{ minRows: 3, maxRows: 6 }} />
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
