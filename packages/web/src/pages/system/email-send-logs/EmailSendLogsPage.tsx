import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Modal, Select, Tag,
  Toast } from '@douyinfe/semi-ui';
import { AppModal } from '@/components/AppModal';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type { EmailSendLog, SendStatus } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { renderEllipsis } from '../../../utils/table-columns';
import { useEmailTemplateList } from '@/hooks/queries/email-templates';
import {
  emailSendLogKeys,
  useDeleteEmailSendLog,
  useEmailSendLogList,
  useTestEmailSendLog,
} from '@/hooks/queries/email-send-logs';
import { SEND_LOG_STATUS_OPTIONS as STATUS_OPTIONS, SEND_SOURCE_OPTIONS as SOURCE_OPTIONS } from '../send-log-constants';

function StatusTag({ value }: Readonly<{ value: SendStatus }>) {
  const it = STATUS_OPTIONS.find((s) => s.value === value);
  return <Tag color={it?.color ?? 'grey'} type="light">{it?.label ?? value}</Tag>;
}

export default function EmailSendLogsPage() {
  const { hasPermission: can } = usePermission();
  const queryClient = useQueryClient();

  interface SearchParams { keyword: string; toEmail: string; filterStatus: SendStatus | undefined; filterSource: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', toEmail: '', filterStatus: undefined, filterSource: undefined };
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);

  const [testVisible, setTestVisible] = useState(false);
  const formRef = useRef<FormApi>(null);

  const listQuery = useEmailSendLogList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    toEmail: submittedParams.toEmail || undefined,
    status: submittedParams.filterStatus,
    source: submittedParams.filterSource || undefined,
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const templatesQuery = useEmailTemplateList({ page: 1, pageSize: 100, status: 'enabled' }, { enabled: testVisible });
  const templates = templatesQuery.data?.list ?? [];
  const testMutation = useTestEmailSendLog();
  const deleteMutation = useDeleteEmailSendLog();

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: emailSendLogKeys.lists });
  };
  const handleReset = () => {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: emailSendLogKeys.lists });
  };
  const buildExportQuery = () => ({
    ...(draftParams.keyword ? { keyword: draftParams.keyword } : {}),
    ...(draftParams.toEmail ? { toEmail: draftParams.toEmail } : {}),
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
    Toast.success('测试邮件已发送');
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
    createOperationColumn<EmailSendLog>({
      width: 90,
      actions: (record) => [
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !can('system:email-send-log:delete'),
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
            <Input prefix={<Search size={14} />} placeholder="主题/内容关键词"
              value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onEnterPress={handleSearch} showClear style={{ width: 200 }} />
            <Input placeholder="收件人邮箱" value={draftParams.toEmail} onChange={(v) => setDraftParams({ ...draftParams, toEmail: v })}
              onEnterPress={handleSearch} showClear style={{ width: 200 }} />
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
            {can('system:email-send-log:export') && (
              <ExportButton entity="system.email-send-logs" query={buildExportQuery()} />
            )}
            {can('system:email-send-log:send') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={openTest}>测试发送</Button>
            )}
          </>
        )}
        mobilePrimary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="主题/内容关键词"
              value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onEnterPress={handleSearch} showClear style={{ width: 200 }} />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            {can('system:email-send-log:send') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={openTest}>测试发送</Button>
            )}
          </>
        )}
        mobileFilters={(
          <>
            <Input placeholder="收件人邮箱" value={draftParams.toEmail} onChange={(v) => setDraftParams({ ...draftParams, toEmail: v })}
              onEnterPress={handleSearch} showClear style={{ width: 200 }} />
            <Select placeholder="状态" value={draftParams.filterStatus} onChange={(v) => setDraftParams({ ...draftParams, filterStatus: v as SendStatus | undefined })}
              optionList={STATUS_OPTIONS} showClear style={{ width: 110 }} />
            <Select placeholder="来源" value={draftParams.filterSource} onChange={(v) => setDraftParams({ ...draftParams, filterSource: v as string | undefined })}
              optionList={SOURCE_OPTIONS} showClear style={{ width: 110 }} />
          </>
        )}
        mobileActions={can('system:email-send-log:export') ? (
          <ExportButton entity="system.email-send-logs" query={buildExportQuery()} variant="flat" />
        ) : null}
        filterTitle="邮件发送日志筛选"
        actionTitle="邮件日志操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable bordered loading={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total)}
        scroll={{ x: 1400 }} />

      <AppModal title="测试发送邮件" visible={testVisible} onOk={handleTest}
        onCancel={() => setTestVisible(false)} confirmLoading={testMutation.isPending} width={560}>
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
