import { useEffect, useState, useCallback, useRef } from 'react';
import { Button, Col, Form, Input, Modal, Row, Select, Space, Tag,
  Toast } from '@douyinfe/semi-ui';
import { AppModal } from '@/components/AppModal';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { CheckCheck, Plus, RotateCcw, Search } from 'lucide-react';
import type { InAppMessage, InAppMessageType, InAppTemplate, PaginatedResponse, User } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';

const TYPE_OPTIONS: { label: string; value: InAppMessageType; color: 'blue' | 'green' | 'orange' | 'red' }[] = [
  { label: '通知', value: 'info', color: 'blue' },
  { label: '成功', value: 'success', color: 'green' },
  { label: '警告', value: 'warning', color: 'orange' },
  { label: '错误', value: 'error', color: 'red' },
];

const READ_OPTIONS = [
  { label: '未读', value: 'false' },
  { label: '已读', value: 'true' },
];

export default function InAppMessagesPage() {
  const { hasPermission: can } = usePermission();

  interface SearchParams { keyword: string; filterType: InAppMessageType | undefined; filterRead: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', filterType: undefined, filterRead: undefined };
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<InAppMessage[]>([]);
  const [total, setTotal] = useState(0);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;

  const [sendVisible, setSendVisible] = useState(false);
  const [templates, setTemplates] = useState<InAppTemplate[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<FormApi>(null);

  const fetchList = useCallback(
    async (p = page, ps = pageSize, params?: SearchParams) => {
      const { keyword: kw, filterType: t, filterRead: isRead } = params ?? searchParamsRef.current;
      setLoading(true);
      try {
        const query = new URLSearchParams({ page: String(p), pageSize: String(ps) });
        if (kw) query.set('keyword', kw);
        if (t) query.set('type', t);
        if (isRead !== undefined) query.set('isRead', isRead);
        const res = await request.get<PaginatedResponse<InAppMessage>>(`/api/in-app-messages/admin?${query}`);
        setList(res.data?.list ?? []);
        setTotal(res.data?.total ?? 0);
        setPage(res.data?.page ?? p);
        setPageSize(res.data?.pageSize ?? ps);
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, setPage, setPageSize],
  );

  useEffect(() => { void fetchList(1); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const handleSearch = () => { setPage(1); void fetchList(1, pageSize); };
  const handleReset = () => {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchList(1, pageSize, defaultSearchParams);
  };

  const openSend = async () => {
    try {
      const [tplRes, userRes] = await Promise.all([
        request.get<PaginatedResponse<InAppTemplate>>('/api/in-app-templates?page=1&pageSize=100&status=enabled'),
        request.get<PaginatedResponse<User>>('/api/users?page=1&pageSize=100'),
      ]);
      setTemplates(tplRes.data?.list ?? []);
      setUsers(userRes.data?.list ?? []);
    } catch { /* ignore */ }
    setSendVisible(true);
  };

  const handleSend = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current?.validate())!; } catch { return; }
    // 变量字段是 JSON 字符串，提交前解析为对象
    if (typeof values.variables === 'string') {
      const raw = values.variables.trim();
      if (raw) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            values.variables = parsed as Record<string, string>;
          } else {
            Toast.error('变量必须是 JSON 对象');
            return;
          }
        } catch {
          Toast.error('变量 JSON 格式错误');
          return;
        }
      } else {
        delete values.variables;
      }
    }
    setSubmitting(true);
    try {
      const res = await request.post('/api/in-app-messages/send', values);
      if (res.code !== 0) return;
      Toast.success('发送成功');
      setSendVisible(false);
      globalThis.dispatchEvent(new CustomEvent('in-app-messages:refresh'));
      void fetchList(1, pageSize);
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkRead = async (id: number) => {
    const res = await request.post(`/api/in-app-messages/admin/${id}/read`);
    if (res.code !== 0) return;
    Toast.success('已标记为已读');
    globalThis.dispatchEvent(new CustomEvent('in-app-messages:refresh'));
    void fetchList();
  };

  const handleMarkAllRead = () => {
    Modal.confirm({
      title: '确定要将所有未读消息标记为已读吗？',
      onOk: async () => {
        const res = await request.post('/api/in-app-messages/read-all');
        if (res.code !== 0) return;
        Toast.success('已全部标记为已读');
        globalThis.dispatchEvent(new CustomEvent('in-app-messages:refresh'));
        void fetchList();
      },
    });
  };

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: '确定要删除该消息吗？',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete(`/api/in-app-messages/admin/${id}`);
        if (res.code !== 0) return;
        Toast.success('删除成功');
        globalThis.dispatchEvent(new CustomEvent('in-app-messages:refresh'));
        void fetchList();
      },
    });
  };

  const columns = [
    { title: '标题', dataIndex: 'title', render: renderEllipsis },
    { title: '内容', dataIndex: 'content', render: renderEllipsis },
    {
      title: '类型', dataIndex: 'type', width: 90,
      render: (v: InAppMessageType) => {
        const it = TYPE_OPTIONS.find((t) => t.value === v);
        return <Tag color={it?.color ?? 'grey'} type="light">{it?.label ?? v}</Tag>;
      },
    },
    { title: '收件人', dataIndex: 'username', width: 120, render: (v: string | null) => v || '—' },
    { title: '发送人', dataIndex: 'senderName', width: 120, render: (v: string | null) => v || '系统' },
    { title: '阅读时间', dataIndex: 'readAt', width: 180, render: (v: string | null) => v || '—' },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'isRead', width: 90, fixed: 'right' as const,
      render: (v: boolean) => v ? <Tag color="green" type="light">已读</Tag> : <Tag color="orange" type="light">未读</Tag>,
    },
    {
      title: '操作', key: 'actions', width: 160, fixed: 'right' as const,
      render: (_: unknown, record: InAppMessage) => (
        <Space>
          {can('system:in-app-message:update') && !record.isRead && (
            <Button theme="borderless" size="small" onClick={() => handleMarkRead(record.id)}>标记已读</Button>
          )}
          {can('system:in-app-message:delete') && (
            <Button theme="borderless" type="danger" size="small" onClick={() => handleDelete(record.id)}>删除</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input prefix={<Search size={14} />} placeholder="标题/内容关键词"
          value={searchParams.keyword} onChange={(v) => setSearchParams({ ...searchParams, keyword: v })} onEnterPress={handleSearch} showClear style={{ width: 200 }} />
        <Select placeholder="类型" value={searchParams.filterType} onChange={(v) => setSearchParams({ ...searchParams, filterType: v as InAppMessageType | undefined })}
          optionList={TYPE_OPTIONS} showClear style={{ width: 110 }} />
        <Select placeholder="阅读状态" value={searchParams.filterRead} onChange={(v) => setSearchParams({ ...searchParams, filterRead: v as string | undefined })}
          optionList={READ_OPTIONS} showClear style={{ width: 120 }} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {can('system:in-app-message:update') && (
          <Button type="tertiary" icon={<CheckCheck size={14} />} onClick={handleMarkAllRead}>全部已读</Button>
        )}
        {can('system:in-app-message:send') && (
          <Button type="primary" icon={<Plus size={14} />} onClick={openSend}>发送站内信</Button>
        )}
      </SearchToolbar>

      <ConfigurableTable bordered loading={loading} onRefresh={() => void fetchList()} refreshLoading={loading} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total, fetchList)}
        scroll={{ x: 1400 }} />

      <AppModal title="发送站内信" visible={sendVisible} onOk={handleSend}
        onCancel={() => setSendVisible(false)} confirmLoading={submitting} width={720}>
        <Form key="send" getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
          allowEmpty labelPosition="left" labelWidth={120} initValues={{ type: 'info' }}>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Select field="userIds" label="收件人" multiple filter style={{ width: '100%' }}
                optionList={users.map((u) => ({ label: `${u.nickname || u.username} (${u.username})`, value: u.id }))}
                placeholder="请选择收件人"
                rules={[{ required: true, message: '请选择收件人' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Select field="templateId" label="模板" style={{ width: '100%' }} showClear filter
                optionList={templates.map((t) => ({ label: `${t.name} (${t.code})`, value: t.id }))}
                placeholder="可选，使用模板自动填充" />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Select field="type" label="类型" style={{ width: '100%' }} optionList={TYPE_OPTIONS}
                placeholder="请选择类型"
                rules={[{ required: true, message: '请选择类型' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Input field="title" label="标题" placeholder="请输入标题"
                rules={[{ required: true, message: '请输入标题' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.TextArea field="content" label="内容" rows={5} placeholder="请输入内容"
                rules={[{ required: true, message: '请输入内容' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Input field="variables" label="变量" placeholder='如：{"username":"张三"}' />
            </Col>
          </Row>
        </Form>
      </AppModal>
    </div>
  );
}
