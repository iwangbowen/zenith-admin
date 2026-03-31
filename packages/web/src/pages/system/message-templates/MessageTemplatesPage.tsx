import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Table,
  Button,
  Input,
  Select,
  Space,
  Modal,
  Form,
  Toast,
  Tag,
  Typography,
  Descriptions,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw, Eye } from 'lucide-react';
import type { MessageTemplate, MessageChannelType } from '@zenith/shared';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';

const CHANNEL_LABELS: Record<MessageChannelType, string> = {
  email: '邮件',
  sms: '短信',
  in_app: '站内通知',
};

const CHANNEL_COLORS: Record<MessageChannelType, string> = {
  email: 'blue',
  sms: 'orange',
  in_app: 'green',
};

const CHANNEL_OPTIONS = [
  { value: 'email', label: '邮件' },
  { value: 'sms', label: '短信' },
  { value: 'in_app', label: '站内通知' },
];

export default function MessageTemplatesPage() {
  const { hasPermission } = usePermission();

  interface SearchParams {
    keyword: string;
    channel: string;
    status: string;
  }

  const defaultSearchParams: SearchParams = { keyword: '', channel: '', status: '' };
  const formApi = useRef<FormApi | null>(null);
  const [data, setData] = useState<MessageTemplate[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);

  // 新增/编辑弹窗
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [modalConfirmLoading, setModalConfirmLoading] = useState(false);

  // 预览弹窗
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<MessageTemplate | null>(null);
  const [previewVars, setPreviewVars] = useState<Record<string, string>>({});
  const [previewResult, setPreviewResult] = useState<{ subject: string | null; content: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const fetchData = useCallback(async (p = page, ps = pageSize, params = searchParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(params.keyword ? { keyword: params.keyword } : {}),
        ...(params.channel ? { channel: params.channel } : {}),
        ...(params.status ? { status: params.status } : {}),
      }).toString();
      const res = await request.get<{ list: MessageTemplate[]; total: number }>(`/api/message-templates?${query}`);
      if (res.code === 0) {
        setData(res.data.list);
        setTotal(res.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchParams]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  function handleSearch() {
    setPage(1);
    void fetchData(1, pageSize);
  }

  function handleReset() {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchData(1, pageSize, defaultSearchParams);
  }

  function openCreate() {
    setEditingTemplate(null);
    setModalVisible(true);
  }

  function openEdit(row: MessageTemplate) {
    setEditingTemplate(row);
    setModalVisible(true);
  }

  function openPreview(row: MessageTemplate) {
    setPreviewTemplate(row);
    setPreviewVars({});
    setPreviewResult(null);
    setPreviewVisible(true);
  }

  async function handleModalOk() {
    if (!formApi.current) return;
    let values: Record<string, unknown>;
    try {
      values = await formApi.current.validate();
    } catch {
      return;
    }
    setModalConfirmLoading(true);
    try {
      const res = editingTemplate
        ? await request.put(`/api/message-templates/${editingTemplate.id}`, values)
        : await request.post('/api/message-templates', values);
      if (res.code === 0) {
        Toast.success(editingTemplate ? '更新成功' : '创建成功');
        setModalVisible(false);
        void fetchData();
      }
    } finally {
      setModalConfirmLoading(false);
    }
  }

  async function handleDelete(id: number) {
    const res = await request.delete(`/api/message-templates/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchData();
    }
  }

  async function handlePreview() {
    if (!previewTemplate) return;
    setPreviewLoading(true);
    try {
      const res = await request.post<{ subject: string | null; content: string }>(
        `/api/message-templates/${previewTemplate.id}/preview`,
        { variables: previewVars },
      );
      if (res.code === 0) {
        setPreviewResult(res.data);
      }
    } finally {
      setPreviewLoading(false);
    }
  }

  /** 从模板内容中提取 {{varName}} 变量名列表 */
  function extractVarNames(template: MessageTemplate): string[] {
    const text = [template.subject ?? '', template.content].join(' ');
    const matches = text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g);
    return [...new Set([...matches].map((m) => m[1]))];
  }

  const columns: ColumnProps<MessageTemplate>[] = [
    { title: '模板名称', dataIndex: 'name', width: 160, ellipsis: true },
    { title: '模板编码', dataIndex: 'code', width: 160, ellipsis: true },
    {
      title: '渠道',
      dataIndex: 'channel',
      width: 110,
      align: 'center',
      render: (v: MessageChannelType) => (
        <Tag color={CHANNEL_COLORS[v]} type="light">{CHANNEL_LABELS[v] ?? v}</Tag>
      ),
    },
    { title: '模板标题', dataIndex: 'subject', width: 180, ellipsis: true, render: (v) => v || '—' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      align: 'center',
      render: (v: string) => (
        <Tag color={v === 'active' ? 'green' : 'red'} type="light">
          {v === 'active' ? '启用' : '停用'}
        </Tag>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 180,
      ellipsis: true,
      render: (v) => formatDateTime(v),
    },
    {
      title: '操作',
      fixed: 'right',
      width: 220,
      align: 'center',
      render: (_v, row) => (
        <Space>
          {hasPermission('system:message-template:list') && (
            <Button theme="borderless" size="small" onClick={() => openPreview(row)}>预览</Button>
          )}
          {hasPermission('system:message-template:update') && (
            <Button theme="borderless" size="small" onClick={() => openEdit(row)}>编辑</Button>
          )}
          {hasPermission('system:message-template:delete') && (
            <Button
              theme="borderless"
              size="small"
              type="danger"
              onClick={() => {
                Modal.confirm({
                  title: '确认删除该模板？',
                  content: '删除后不可恢复，请谨慎操作。',
                  okButtonProps: { type: 'danger', theme: 'solid' },
                  onOk: () => handleDelete(row.id),
                });
              }}
            >
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const varNames = previewTemplate ? extractVarNames(previewTemplate) : [];

  return (
    <div className="page-container">
      <SearchToolbar
        left={<>
          <Input
            prefix={<Search size={14} />}
            placeholder="搜索名称/编码"
            value={searchParams.keyword}
            onChange={(v) => setSearchParams((prev) => ({ ...prev, keyword: v }))}
            onEnterPress={handleSearch}
            style={{ width: 200 }}
            showClear
          />
          <Select
            placeholder="全部渠道"
            value={searchParams.channel || undefined}
            onChange={(v) => setSearchParams((prev) => ({ ...prev, channel: (v as string) ?? '' }))}
            style={{ width: 130 }}
            optionList={[
              { value: '', label: '全部渠道' },
              ...CHANNEL_OPTIONS,
            ]}
          />
          <Select
            placeholder="全部状态"
            value={searchParams.status || undefined}
            onChange={(v) => setSearchParams((prev) => ({ ...prev, status: (v as string) ?? '' }))}
            style={{ width: 120 }}
            optionList={[
              { value: '', label: '全部状态' },
              { value: 'active', label: '启用' },
              { value: 'disabled', label: '停用' },
            ]}
          />
          <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        </>}
        right={
          hasPermission('system:message-template:create') ? (
            <Button type="secondary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
          ) : null
        }
      />

      <Table
        bordered
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        pagination={{
          total,
          currentPage: page,
          pageSize,
          showSizeChanger: true,
          pageSizeOpts: [10, 20, 50],
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
            void fetchData(p, ps);
          },
        }}
      />

      {/* 新增/编辑弹窗 */}
      <Modal
        title={editingTemplate ? '编辑消息模板' : '新增消息模板'}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={handleModalOk}
        okButtonProps={{ loading: modalConfirmLoading }}
        width={640}
        afterClose={() => { formApi.current?.reset(); }}
      >
        <Form
          getFormApi={(api) => { formApi.current = api; }}
          labelPosition="left"
          labelWidth={90}
          initValues={editingTemplate ?? { status: 'active' }}
        >
          <Form.Input
            field="name"
            label="模板名称"
            rules={[{ required: true, message: '请输入模板名称' }]}
            placeholder="请输入模板名称"
          />
          <Form.Input
            field="code"
            label="模板编码"
            rules={[
              { required: true, message: '请输入模板编码' },
              { pattern: /^[a-zA-Z]\w*$/, message: '只能包含字母、数字和下划线，且以字母开头' },
            ]}
            placeholder="如：user_welcome"
            disabled={!!editingTemplate}
          />
          <Form.Select
            field="channel"
            label="渠道类型"
            rules={[{ required: true, message: '请选择渠道类型' }]}
            placeholder="请选择渠道"
            optionList={CHANNEL_OPTIONS}
            style={{ width: '100%' }}
          />
          <Form.Input
            field="subject"
            label="模板标题"
            placeholder="邮件主题等，选填"
          />
          <Form.TextArea
            field="content"
            label="模板内容"
            rules={[{ required: true, message: '请输入模板内容' }]}
            placeholder={'支持 {{变量名}} 插值，例如：您好 {{username}}，请点击 {{link}} 激活账户。'}
            rows={5}
          />
          <Form.TextArea
            field="variables"
            label="变量说明"
            placeholder={'JSON 格式说明变量含义，例如：{"username": "用户名", "link": "激活链接"}'}
            rows={3}
          />
          <Form.Select
            field="status"
            label="状态"
            optionList={[
              { value: 'active', label: '启用' },
              { value: 'disabled', label: '停用' },
            ]}
            style={{ width: '100%' }}
          />
          <Form.TextArea
            field="remark"
            label="备注"
            placeholder="选填"
            rows={2}
          />
        </Form>
      </Modal>

      {/* 预览弹窗 */}
      <Modal
        title={<Space><Eye size={16} /><span>模板预览 — {previewTemplate?.name}</span></Space>}
        visible={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={null}
        width={680}
        afterClose={() => { setPreviewResult(null); setPreviewVars({}); }}
      >
        {previewTemplate && (
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              <strong>渠道：</strong>{CHANNEL_LABELS[previewTemplate.channel]}
              {previewTemplate.subject && <>&nbsp;&nbsp;<strong>标题：</strong>{previewTemplate.subject}</>}
            </Typography.Text>

            {varNames.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <Typography.Text strong>填入变量值</Typography.Text>
                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {varNames.map((name) => (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Typography.Text code style={{ flexShrink: 0 }}>{`{{${name}}}`}</Typography.Text>
                      <Input
                        size="small"
                        placeholder={`请输入 ${name}`}
                        value={previewVars[name] ?? ''}
                        onChange={(v) => setPreviewVars((prev) => ({ ...prev, [name]: v }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {varNames.length === 0 && (
              <Typography.Text type="tertiary" style={{ marginTop: 8, display: 'block', fontSize: 12 }}>
                该模板不包含变量
              </Typography.Text>
            )}

            <div style={{ marginTop: 12 }}>
              <Button
                type="primary"
                size="small"
                icon={<Eye size={14} />}
                loading={previewLoading}
                onClick={handlePreview}
              >
                渲染预览
              </Button>
            </div>

            {previewResult && (
              <div style={{ marginTop: 16 }}>
                <Typography.Text strong>渲染结果</Typography.Text>
                {previewResult.subject && (
                  <Descriptions
                    style={{ marginTop: 8 }}
                    data={[{ key: '标题', value: previewResult.subject }]}
                  />
                )}
                <div
                  style={{
                    marginTop: 8,
                    padding: '12px 16px',
                    background: 'var(--semi-color-fill-0)',
                    borderRadius: 6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    fontSize: 13,
                    lineHeight: 1.7,
                  }}
                >
                  {previewResult.content}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
