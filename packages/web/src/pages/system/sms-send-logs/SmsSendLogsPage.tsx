import { useEffect, useState, useCallback, useRef } from 'react';
import { Button, Form, Input, Modal, Select, Tag,
  Toast } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Download, Plus, RotateCcw, Search } from 'lucide-react';
import type { PaginatedResponse, SendStatus, SmsSendLog, SmsTemplate } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { renderEllipsis } from '../../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';

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

const PROVIDER_OPTIONS = [
  { label: '阿里云', value: 'aliyun' },
  { label: '腾讯云', value: 'tencent' },
];

function StatusTag({ value }: Readonly<{ value: SendStatus }>) {
  const it = STATUS_OPTIONS.find((s) => s.value === value);
  return <Tag color={it?.color ?? 'grey'} type="light">{it?.label ?? value}</Tag>;
}

export default function SmsSendLogsPage() {
  const { hasPermission: can } = usePermission();

  interface SearchParams { keyword: string; phone: string; filterStatus: SendStatus | undefined; filterSource: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', phone: '', filterStatus: undefined, filterSource: undefined };
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<SmsSendLog[]>([]);
  const [total, setTotal] = useState(0);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;
  const [exportLoading, setExportLoading] = useState(false);

  const [testVisible, setTestVisible] = useState(false);
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<FormApi>(null);

  const fetchList = useCallback(
    async (p = page, ps = pageSize, params?: SearchParams) => {
      const { keyword: kw, phone: ph, filterStatus: st, filterSource: src } = params ?? searchParamsRef.current;
      setLoading(true);
      try {
        const query = new URLSearchParams({ page: String(p), pageSize: String(ps) });
        if (kw) query.set('keyword', kw);
        if (ph) query.set('phone', ph);
        if (st) query.set('status', st);
        if (src) query.set('source', src);
        const res = await request.get<PaginatedResponse<SmsSendLog>>(`/api/sms-send-logs?${query}`);
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
    try { await request.download('/api/sms-send-logs/export', '短信发送记录.xlsx'); }
    finally { setExportLoading(false); }
  };

  const openTest = async () => {
    try {
      const res = await request.get<PaginatedResponse<SmsTemplate>>('/api/sms-templates?page=1&pageSize=100&status=enabled');
      setTemplates(res.data?.list ?? []);
    } catch { /* ignore */ }
    setTestVisible(true);
  };

  const handleTest = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current?.validate())!; } catch { return; }
    setSubmitting(true);
    try {
      await request.post('/api/sms-send-logs/test', values);
      Toast.success('测试短信已发送');
      setTestVisible(false);
      void fetchList(1, pageSize);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: '确定要删除该记录吗？',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await request.delete(`/api/sms-send-logs/${id}`);
        Toast.success('删除成功');
        void fetchList();
      },
    });
  };

  const columns = [
    { title: '手机号', dataIndex: 'phone', width: 130 },
    { title: '模板', dataIndex: 'templateName', width: 140, render: (v: string | null) => v || '—' },
    {
      title: '服务商', dataIndex: 'provider', width: 100,
      render: (v: string) => PROVIDER_OPTIONS.find((p) => p.value === v)?.label ?? v,
    },
    { title: '内容', dataIndex: 'content', render: renderEllipsis },
    { title: '来源', dataIndex: 'source', width: 90, render: (v: string) => SOURCE_OPTIONS.find((s) => s.value === v)?.label ?? v },
    { title: '操作人', dataIndex: 'userName', width: 120, render: (v: string | null) => v || '—' },
    { title: '发送时间', dataIndex: 'sentAt', width: 180, render: (v: string | null) => v || '—' },
    { title: '错误信息', dataIndex: 'errorMsg', render: renderEllipsis },
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right' as const,
      render: (v: SendStatus) => <StatusTag value={v} />,
    },
    {
      title: '操作', key: 'actions', width: 90, fixed: 'right' as const,
      render: (_: unknown, record: SmsSendLog) =>
        can('system:sms-send-log:delete') ? (
          <Button theme="borderless" type="danger" size="small" onClick={() => handleDelete(record.id)}>删除</Button>
        ) : null,
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input prefix={<Search size={14} />} placeholder="内容关键词"
          value={searchParams.keyword} onChange={(v) => setSearchParams({ ...searchParams, keyword: v })} onEnterPress={handleSearch} showClear style={{ width: 180 }} />
        <Input placeholder="手机号" value={searchParams.phone} onChange={(v) => setSearchParams({ ...searchParams, phone: v })}
          onEnterPress={handleSearch} showClear style={{ width: 160 }} />
        <Select placeholder="状态" value={searchParams.filterStatus} onChange={(v) => setSearchParams({ ...searchParams, filterStatus: v as SendStatus | undefined })}
          optionList={STATUS_OPTIONS} showClear style={{ width: 110 }} />
        <Select placeholder="来源" value={searchParams.filterSource} onChange={(v) => setSearchParams({ ...searchParams, filterSource: v as string | undefined })}
          optionList={SOURCE_OPTIONS} showClear style={{ width: 110 }} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {can('system:sms-send-log:export') && (
          <Button type="primary" icon={<Download size={14} />} loading={exportLoading} onClick={handleExport}>导出</Button>
        )}
        {can('system:sms-send-log:send') && (
          <Button type="primary" icon={<Plus size={14} />} onClick={openTest}>测试发送</Button>
        )}
      </SearchToolbar>

      <ConfigurableTable bordered loading={loading} onRefresh={() => void fetchList()} refreshLoading={loading} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total, fetchList)}
        scroll={{ x: 1400 }} />

      <Modal title="测试发送短信" visible={testVisible} onOk={handleTest}
        onCancel={() => setTestVisible(false)} confirmLoading={submitting} width={520}>
        <Form key="test" getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
          labelPosition="left" labelWidth={90} initValues={{}}>
          <Form.Select field="templateId" label="模板" style={{ width: '100%' }}
            optionList={templates.map((t) => ({ label: `${t.name} (${t.code})`, value: t.id }))}
            rules={[{ required: true, message: '请选择模板' }]} />
          <Form.Input field="phone" label="手机号" rules={[{ required: true, message: '请输入手机号' }]} />
          <Form.Input field="variables" label="变量" placeholder='如：{"code":"1234"}' />
        </Form>
      </Modal>
    </div>
  );
}
