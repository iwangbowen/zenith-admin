import { useEffect, useState, useCallback, useRef } from 'react';
import { Button, Form, Input, Modal, Select, SplitButtonGroup, Dropdown, Tag,
  Toast } from '@douyinfe/semi-ui';
import { AppModal } from '@/components/AppModal';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Download, Plus, RotateCcw, Search, ChevronDown } from 'lucide-react';
import type { EmailSendLog, EmailTemplate, PaginatedResponse, SendStatus } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { renderEllipsis } from '../../../utils/table-columns';

const STATUS_OPTIONS: { label: string; value: SendStatus; color: 'orange' | 'green' | 'red' }[] = [
  { label: '待发送', value: 'pending', color: 'orange' },
  { label: '已发送', value: 'success', color: 'green' },
  { label: '失败', value: 'failed', color: 'red' },
];

const SOURCE_OPTIONS = [
  { label: '手动', value: 'manual' },
  { label: '测试', value: 'test' },
  { label: '系统', value: 'system' },
  { label: 'API', value: 'api' },
];

function StatusTag({ value }: Readonly<{ value: SendStatus }>) {
  const it = STATUS_OPTIONS.find((s) => s.value === value);
  return <Tag color={it?.color ?? 'grey'} type="light">{it?.label ?? value}</Tag>;
}

export default function EmailSendLogsPage() {
  const { hasPermission: can } = usePermission();

  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<EmailSendLog[]>([]);
  const [total, setTotal] = useState(0);
  interface SearchParams { keyword: string; toEmail: string; filterStatus: SendStatus | undefined; filterSource: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', toEmail: '', filterStatus: undefined, filterSource: undefined };
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;
  const [exportLoading, setExportLoading] = useState(false);
  const [exportCsvLoading, setExportCsvLoading] = useState(false);

  const [testVisible, setTestVisible] = useState(false);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<FormApi>(null);

  const fetchList = useCallback(
    async (p = page, ps = pageSize, params?: SearchParams) => {
      const { keyword: kw, toEmail: te, filterStatus: st, filterSource: src } = params ?? searchParamsRef.current;
      setLoading(true);
      try {
        const query = new URLSearchParams({ page: String(p), pageSize: String(ps) });
        if (kw) query.set('keyword', kw);
        if (te) query.set('toEmail', te);
        if (st) query.set('status', st);
        if (src) query.set('source', src);
        const res = await request.get<PaginatedResponse<EmailSendLog>>(`/api/email-send-logs?${query}`);
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

  const handleExport = async () => {
    setExportLoading(true);
    try {
      await request.download('/api/email-send-logs/export', '邮件发送记录.xlsx');
    } finally {
      setExportLoading(false);
    }
  };

  const handleExportCsv = async () => {
    setExportCsvLoading(true);
    try {
      await request.download('/api/email-send-logs/export/csv', '邮件发送记录.csv');
    } finally {
      setExportCsvLoading(false);
    }
  };

  const openTest = async () => {
    try {
      const res = await request.get<PaginatedResponse<EmailTemplate>>('/api/email-templates?page=1&pageSize=100&status=enabled');
      setTemplates(res.data?.list ?? []);
    } catch { /* ignore */ }
    setTestVisible(true);
  };

  const handleTest = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current?.validate())!; } catch { return; }
    setSubmitting(true);
    try {
      await request.post('/api/email-send-logs/test', values);
      Toast.success('测试邮件已发送');
      setTestVisible(false);
      void fetchList(1);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: '确定要删除该记录吗？',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await request.delete(`/api/email-send-logs/${id}`);
        Toast.success('删除成功');
        void fetchList();
      },
    });
  };

  const columns = [
    { title: '收件人', dataIndex: 'toEmail', width: 200 },
    { title: '邮件主题', dataIndex: 'subject', render: renderEllipsis },
    { title: '模板', dataIndex: 'templateName', width: 140, render: (v: string | null) => v || '—' },
    { title: '来源', dataIndex: 'source', width: 90, render: (v: string) => SOURCE_OPTIONS.find((s) => s.value === v)?.label ?? v },
    { title: '操作人', dataIndex: 'userName', width: 120, render: (v: string | null) => v || '—' },
    { title: 'IP', dataIndex: 'ip', width: 130, render: (v: string | null) => v || '—' },
    { title: '发送时间', dataIndex: 'sentAt', width: 180, render: (v: string | null) => v || '—' },
    { title: '错误信息', dataIndex: 'errorMsg', render: renderEllipsis },
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right' as const,
      render: (v: SendStatus) => <StatusTag value={v} />,
    },
    {
      title: '操作', key: 'actions', width: 90, fixed: 'right' as const,
      render: (_: unknown, record: EmailSendLog) =>
        can('system:email-send-log:delete') ? (
          <Button theme="borderless" type="danger" size="small" onClick={() => handleDelete(record.id)}>删除</Button>
        ) : null,
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input prefix={<Search size={14} />} placeholder="主题/内容关键词"
          value={searchParams.keyword} onChange={(v) => setSearchParams({ ...searchParams, keyword: v })} onEnterPress={handleSearch} showClear style={{ width: 200 }} />
        <Input placeholder="收件人邮箱" value={searchParams.toEmail} onChange={(v) => setSearchParams({ ...searchParams, toEmail: v })}
          onEnterPress={handleSearch} showClear style={{ width: 200 }} />
        <Select placeholder="状态" value={searchParams.filterStatus} onChange={(v) => setSearchParams({ ...searchParams, filterStatus: v as SendStatus | undefined })}
          optionList={STATUS_OPTIONS} showClear style={{ width: 110 }} />
        <Select placeholder="来源" value={searchParams.filterSource} onChange={(v) => setSearchParams({ ...searchParams, filterSource: v as string | undefined })}
          optionList={SOURCE_OPTIONS} showClear style={{ width: 110 }} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {can('system:email-send-log:export') && (
          <SplitButtonGroup>
            <Button type="primary" icon={<Download size={14} />} loading={exportLoading} onClick={handleExport}>导出</Button>
            <Dropdown
              trigger="click"
              position="bottomRight"
              clickToHide
              render={(
                <Dropdown.Menu>
                  <Dropdown.Item onClick={handleExport}>导出 Excel</Dropdown.Item>
                  <Dropdown.Item onClick={handleExportCsv}>导出 CSV</Dropdown.Item>
                </Dropdown.Menu>
              )}
            >
              <Button type="primary" icon={<ChevronDown size={14} />} loading={exportCsvLoading} />
            </Dropdown>
          </SplitButtonGroup>
        )}
        {can('system:email-send-log:send') && (
          <Button type="primary" icon={<Plus size={14} />} onClick={openTest}>测试发送</Button>
        )}
      </SearchToolbar>

      <ConfigurableTable bordered loading={loading} onRefresh={() => void fetchList()} refreshLoading={loading} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total, fetchList)}
        scroll={{ x: 1400 }} />

      <AppModal title="测试发送邮件" visible={testVisible} onOk={handleTest}
        onCancel={() => setTestVisible(false)} confirmLoading={submitting} width={560}>
        <Form key="test" getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
          labelPosition="left" labelWidth={90} initValues={{}}>
          <Form.Select field="templateId" label="模板" style={{ width: '100%' }} showClear
            optionList={templates.map((t) => ({ label: `${t.name} (${t.code})`, value: t.id }))} />
          <Form.Input field="toEmail" label="收件人" rules={[{ required: true, message: '请输入收件人邮箱' }]} />
          <Form.Input field="subject" label="邮件主题" rules={[{ required: true, message: '请输入邮件主题' }]} />
          <Form.TextArea field="content" label="邮件内容" rows={5} rules={[{ required: true, message: '请输入邮件内容' }]} />
          <Form.Input field="variables" label="变量" placeholder='如：{"username":"张三"}' />
        </Form>
      </AppModal>
    </div>
  );
}
