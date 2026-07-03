import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Modal, Select, Tag,
  Toast } from '@douyinfe/semi-ui';
import { AppModal } from '@/components/AppModal';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type { SendStatus, SmsSendLog } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { renderEllipsis } from '../../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { useSmsTemplateList } from '@/hooks/queries/sms-templates';
import {
  smsSendLogKeys,
  useDeleteSmsSendLog,
  useSmsSendLogList,
  useTestSmsSendLog,
} from '@/hooks/queries/sms-send-logs';

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
  const queryClient = useQueryClient();

  interface SearchParams { keyword: string; phone: string; filterStatus: SendStatus | undefined; filterSource: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', phone: '', filterStatus: undefined, filterSource: undefined };
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);

  const [testVisible, setTestVisible] = useState(false);
  const formRef = useRef<FormApi>(null);

  const listQuery = useSmsSendLogList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    phone: submittedParams.phone || undefined,
    status: submittedParams.filterStatus,
    source: submittedParams.filterSource || undefined,
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const templatesQuery = useSmsTemplateList({ page: 1, pageSize: 100, status: 'enabled' }, { enabled: testVisible });
  const templates = templatesQuery.data?.list ?? [];
  const testMutation = useTestSmsSendLog();
  const deleteMutation = useDeleteSmsSendLog();

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: smsSendLogKeys.lists });
  };
  const handleReset = () => {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: smsSendLogKeys.lists });
  };
  const buildExportQuery = () => ({
    ...(draftParams.keyword ? { keyword: draftParams.keyword } : {}),
    ...(draftParams.phone ? { phone: draftParams.phone } : {}),
    ...(draftParams.filterStatus ? { status: draftParams.filterStatus } : {}),
    ...(draftParams.filterSource ? { source: draftParams.filterSource } : {}),
  });

  const openTest = () => {
    setTestVisible(true);
  };

  const handleTest = async () => {
    let values: Awaited<ReturnType<FormApi['validate']>>;
    try { values = (await formRef.current!.validate())!; } catch { throw new Error('validation'); }
    await testMutation.mutateAsync(values);
    Toast.success('测试短信已发送');
    setTestVisible(false);
  };

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: '确定要删除该记录吗？',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(id);
        Toast.success('删除成功');
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
    createOperationColumn<SmsSendLog>({
      width: 90,
      actions: (record) => [
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !can('system:sms-send-log:delete'),
          onClick: () => handleDelete(record.id),
        },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="内容关键词"
              value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onEnterPress={handleSearch} showClear style={{ width: 180 }} />
            <Input placeholder="手机号" value={draftParams.phone} onChange={(v) => setDraftParams({ ...draftParams, phone: v })}
              onEnterPress={handleSearch} showClear style={{ width: 160 }} />
            <Select placeholder="状态" value={draftParams.filterStatus} onChange={(v) => setDraftParams({ ...draftParams, filterStatus: v as SendStatus | undefined })}
              optionList={STATUS_OPTIONS} showClear style={{ width: 110 }} />
            <Select placeholder="来源" value={draftParams.filterSource} onChange={(v) => setDraftParams({ ...draftParams, filterSource: v as string | undefined })}
              optionList={SOURCE_OPTIONS} showClear style={{ width: 110 }} />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          </>
        )}
        actions={(
          <>
            {can('system:sms-send-log:export') && (
              <ExportButton entity="system.sms-send-logs" query={buildExportQuery()} />
            )}
            {can('system:sms-send-log:send') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={openTest}>测试发送</Button>
            )}
          </>
        )}
        mobilePrimary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="内容关键词"
              value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onEnterPress={handleSearch} showClear style={{ width: 180 }} />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            {can('system:sms-send-log:send') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={openTest}>测试发送</Button>
            )}
          </>
        )}
        mobileFilters={(
          <>
            <Input placeholder="手机号" value={draftParams.phone} onChange={(v) => setDraftParams({ ...draftParams, phone: v })}
              onEnterPress={handleSearch} showClear style={{ width: 160 }} />
            <Select placeholder="状态" value={draftParams.filterStatus} onChange={(v) => setDraftParams({ ...draftParams, filterStatus: v as SendStatus | undefined })}
              optionList={STATUS_OPTIONS} showClear style={{ width: 110 }} />
            <Select placeholder="来源" value={draftParams.filterSource} onChange={(v) => setDraftParams({ ...draftParams, filterSource: v as string | undefined })}
              optionList={SOURCE_OPTIONS} showClear style={{ width: 110 }} />
          </>
        )}
        mobileActions={can('system:sms-send-log:export') ? (
          <ExportButton entity="system.sms-send-logs" query={buildExportQuery()} variant="flat" />
        ) : null}
        filterTitle="短信发送日志筛选"
        actionTitle="短信日志操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable bordered loading={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total)}
        scroll={{ x: 1400 }} />

      <AppModal title="测试发送短信" visible={testVisible} onOk={handleTest}
        onCancel={() => setTestVisible(false)} confirmLoading={testMutation.isPending} width={520}>
        <Form key="test" getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
          labelPosition="left" labelWidth={90} initValues={{}}>
          <Form.Select field="templateId" label="模板" style={{ width: '100%' }}
            optionList={templates.map((t) => ({ label: `${t.name} (${t.code})`, value: t.id }))}
            rules={[{ required: true, message: '请选择模板' }]} />
          <Form.Input field="phone" label="手机号" rules={[{ required: true, message: '请输入手机号' }]} />
          <Form.Input field="variables" label="变量" placeholder='如：{"code":"1234"}' />
        </Form>
      </AppModal>
    </div>
  );
}
