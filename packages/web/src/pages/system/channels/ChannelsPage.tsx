import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Dropdown, Form, Input, Modal, Space, Tag, Toast, Typography, Upload } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ImagePlus, MoreHorizontal, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import type { ChannelAdmin, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { config } from '@/config';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { AppModal } from '@/components/AppModal';
import { usePagination } from '@/hooks/usePagination';
import { ChannelMenuDrawer } from './ChannelMenuDrawer';
import { ChannelAutoReplyDrawer } from './ChannelAutoReplyDrawer';
import { ChannelPublishModal } from './ChannelPublishModal';
import { ChannelMessagesDrawer } from './ChannelMessagesDrawer';

const TYPE_META: Record<string, { text: string; color: 'green' | 'blue' }> = {
  system: { text: '系统号', color: 'green' },
  business: { text: '运营号', color: 'blue' },
};

export default function ChannelsPage() {
  const { hasPermission } = usePermission();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PaginatedResponse<ChannelAdmin> | null>(null);
  const { page, setPage, pageSize, buildPagination } = usePagination();
  const [keyword, setKeyword] = useState('');
  const keywordRef = useRef('');
  keywordRef.current = keyword;

  const [editVisible, setEditVisible] = useState(false);
  const [editing, setEditing] = useState<ChannelAdmin | null>(null);
  const [formApi, setFormApi] = useState<FormApi | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState('');

  const [publishVisible, setPublishVisible] = useState(false);
  const [publishTarget, setPublishTarget] = useState<ChannelAdmin | null>(null);

  const [menuDrawer, setMenuDrawer] = useState<ChannelAdmin | null>(null);
  const [replyDrawer, setReplyDrawer] = useState<ChannelAdmin | null>(null);
  const [messagesDrawer, setMessagesDrawer] = useState<ChannelAdmin | null>(null);

  const fetchList = useCallback(async (p = page, ps = pageSize, kw = keywordRef.current) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(p), pageSize: String(ps), ...(kw ? { keyword: kw } : {}) }).toString();
      const res = await request.get<PaginatedResponse<ChannelAdmin>>(`/api/channels/admin?${query}`);
      if (res.code === 0) { setData(res.data); setPage(res.data.page); }
    } finally { setLoading(false); }
  }, [page, pageSize, setPage]);

  useEffect(() => { void fetchList(); }, [fetchList]);

  const handleSearch = () => { setPage(1); void fetchList(1, pageSize); };
  const handleReset = () => { setKeyword(''); setPage(1); void fetchList(1, pageSize, ''); };

  const openCreate = () => { setEditing(null); setAvatarUrl(''); setEditVisible(true); };
  const openEdit = (ch: ChannelAdmin) => { setEditing(ch); setAvatarUrl(ch.avatar ?? ''); setEditVisible(true); };

  const handleAvatarUpload = (res: unknown) => {
    const r = res as { code?: number; data?: { url?: string } };
    if (r?.code === 0 && r.data?.url) { setAvatarUrl(r.data.url); Toast.success('头像已上传'); }
    else Toast.error('头像上传失败');
  };

  const handleSubmit = async () => {
    if (!formApi) return;
    try {
      const values = await formApi.validate() as Record<string, unknown>;
      setSubmitting(true);
      const res = editing
        ? await request.put(`/api/channels/${editing.id}`, {
          name: values.name, avatar: avatarUrl || null, description: values.description || null, status: values.status,
        })
        : await request.post('/api/channels', {
          code: values.code, name: values.name, avatar: avatarUrl || null, description: values.description || null,
        });
      if (res.code === 0) { Toast.success(editing ? '已更新' : '已创建'); setEditVisible(false); void fetchList(); }
    } catch { /* validation failed */ } finally { setSubmitting(false); }
  };

  const handleDelete = (ch: ChannelAdmin) => {
    Modal.confirm({
      title: `确认删除频道「${ch.name}」？`,
      content: '该频道下的所有消息与订阅将一并删除',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete(`/api/channels/${ch.id}`);
        if (res.code === 0) { Toast.success('已删除'); void fetchList(); }
      },
    });
  };

  const openPublish = (ch: ChannelAdmin) => { setPublishTarget(ch); setPublishVisible(true); };

  const columns: ColumnProps<ChannelAdmin>[] = [
    {
      title: '频道', dataIndex: 'name',
      render: (v: string, r: ChannelAdmin) => (
        <div>
          <Typography.Text strong>{v}</Typography.Text>
          <Typography.Text type="tertiary" size="small" style={{ display: 'block' }}>{r.code}</Typography.Text>
        </div>
      ),
    },
    { title: '类型', dataIndex: 'type', width: 90, render: (v: string) => <Tag color={TYPE_META[v]?.color ?? 'grey'} size="small">{TYPE_META[v]?.text ?? v}</Tag> },
    { title: '订阅数', dataIndex: 'subscriberCount', width: 90 },
    { title: '消息数', dataIndex: 'messageCount', width: 90 },
    { title: '状态', dataIndex: 'status', width: 80, render: (v: string) => <Tag color={v === 'enabled' ? 'green' : 'grey'} size="small">{v === 'enabled' ? '启用' : '停用'}</Tag> },
    { title: '创建时间', dataIndex: 'createdAt', width: 180, render: (v: string) => formatDateTime(v) },
    {
      title: '操作', dataIndex: 'op', width: 180, fixed: 'right',
      render: (_: unknown, r: ChannelAdmin) => {
        const moreItems: ReactNode[] = [];
        if (hasPermission('channel:message:publish')) {
          moreItems.push(<Dropdown.Item key="records" onClick={() => setMessagesDrawer(r)}>消息记录</Dropdown.Item>);
        }
        if (r.type === 'business' && hasPermission('channel:menu:save')) {
          moreItems.push(<Dropdown.Item key="menu" onClick={() => setMenuDrawer(r)}>菜单配置</Dropdown.Item>);
        }
        if (r.type === 'business' && hasPermission('channel:reply:list')) {
          moreItems.push(<Dropdown.Item key="reply" onClick={() => setReplyDrawer(r)}>自动回复</Dropdown.Item>);
        }
        if (hasPermission('channel:channel:delete') && !r.builtin) {
          moreItems.push(<Dropdown.Item key="delete" type="danger" onClick={() => handleDelete(r)}>删除</Dropdown.Item>);
        }
        return (
          <Space>
            {hasPermission('channel:message:publish') && <Button theme="borderless" size="small" onClick={() => openPublish(r)}>群发</Button>}
            {hasPermission('channel:channel:update') && <Button theme="borderless" size="small" onClick={() => openEdit(r)}>编辑</Button>}
            {moreItems.length > 0 && (
              <Dropdown trigger="click" clickToHide position="bottomRight" render={<Dropdown.Menu>{moreItems}</Dropdown.Menu>}>
                <Button theme="borderless" size="small" icon={<MoreHorizontal size={16} />} />
              </Dropdown>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input prefix={<Search size={14} />} placeholder="搜索频道名称/编码" value={keyword} onChange={setKeyword} onEnterPress={handleSearch} showClear style={{ width: 220 }} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {hasPermission('channel:channel:create') && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>}
      </SearchToolbar>

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        rowKey="id"
        loading={loading}
        onRefresh={() => void fetchList()}
        refreshLoading={loading}
        pagination={buildPagination(data?.total ?? 0, fetchList)}
      />

      <AppModal
        title={editing ? '编辑频道' : '新建运营号'}
        visible={editVisible}
        onCancel={() => setEditVisible(false)}
        onOk={() => void handleSubmit()}
        confirmLoading={submitting}
        okText="保存"
        width={520}
      >
        <Form
          key={editing?.id ?? 'new'}
          getFormApi={setFormApi}
          labelPosition="left"
          labelWidth={90}
          initValues={{
            code: editing?.code ?? '',
            name: editing?.name ?? '',
            description: editing?.description ?? '',
            status: editing?.status ?? 'enabled',
          }}
        >
          {!editing && (
            <Form.Input field="code" label="编码" placeholder="小写字母 / 数字 / 连字符" rules={[{ required: true, message: '请填写编码' }]} />
          )}
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '请填写名称' }]} />
          <Form.Slot label="头像">
            <Space align="center">
              {avatarUrl
                ? (
                  <div style={{ position: 'relative', width: 64, height: 64 }}>
                    <img src={avatarUrl} alt="头像" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--semi-color-border)' }} />
                    <Button
                      theme="borderless" type="danger" size="small" icon={<Trash2 size={14} />}
                      style={{ position: 'absolute', top: -8, right: -8, background: 'var(--semi-color-bg-2)' }}
                      onClick={() => setAvatarUrl('')}
                    />
                  </div>
                )
                : (
                  <Upload
                    action={`${config.apiBaseUrl}/api/files/upload-one`}
                    headers={{ Authorization: `Bearer ${localStorage.getItem('zenith_token') ?? ''}` }}
                    name="file"
                    accept="image/*"
                    limit={1}
                    showUploadList={false}
                    onSuccess={handleAvatarUpload}
                  >
                    <Button icon={<ImagePlus size={14} />}>上传头像</Button>
                  </Upload>
                )}
            </Space>
          </Form.Slot>
          <Form.TextArea field="description" label="简介" autosize={{ minRows: 2, maxRows: 4 }} />
          {editing && (
            <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={[{ label: '启用', value: 'enabled' }, { label: '停用', value: 'disabled' }]} />
          )}
        </Form>
      </AppModal>

      <ChannelPublishModal
        channel={publishTarget}
        visible={publishVisible}
        onClose={() => setPublishVisible(false)}
        onSuccess={() => void fetchList()}
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
    </div>
  );
}
