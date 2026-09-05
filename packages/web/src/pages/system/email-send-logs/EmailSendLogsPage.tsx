import { Button, Form, Input, Tag, Toast } from '@douyinfe/semi-ui';
import { AppModal } from '@/components/AppModal';
import { Plus } from 'lucide-react';
import { enumValueOf } from '@zenith/shared/core';
import { SEND_SOURCES } from '@zenith/shared/messaging';
import type { EmailSendLog, SendEmailInput, SendStatus } from '@zenith/shared/messaging';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { dateTimeColumn, renderEllipsis } from '../../../utils/table-columns';
import { useEmailTemplateList } from '@/hooks/queries/email-templates';
import { useListSearch } from '@/hooks/useListSearch';
import { useEditModal } from '@/hooks/useEditModal';
import {
  emailSendLogKeys,
  useDeleteEmailSendLog,
  useEmailSendLogList,
  useTestEmailSendLog,
} from '@/hooks/queries/email-send-logs';
import { SEND_LOG_STATUS_OPTIONS as STATUS_OPTIONS, SEND_SOURCE_OPTIONS as SOURCE_OPTIONS, parseTemplateVariables } from '../send-log-constants';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';

/** 测试发送表单值：变量以 JSON 文本输入 */
interface TestEmailFormValues {
  templateId?: number;
  toEmail: string;
  subject?: string;
  content?: string;
  variables?: string;
}

function StatusTag({ value }: Readonly<{ value: SendStatus }>) {
  const it = STATUS_OPTIONS.find((s) => s.value === value);
  return <Tag color={it?.color ?? 'grey'} type="light">{it?.label ?? value}</Tag>;
}

export default function EmailSendLogsPage() {
  const { hasPermission: can } = usePermission();

  interface SearchParams { keyword: string; toEmail: string; filterStatus: SendStatus | undefined; filterSource: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', toEmail: '', filterStatus: undefined, filterSource: undefined };
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: emailSendLogKeys.lists });

  const listQuery = useEmailSendLogList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    toEmail: submittedParams.toEmail || undefined,
    status: submittedParams.filterStatus,
    source: enumValueOf(SEND_SOURCES, submittedParams.filterSource),
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const testMutation = useTestEmailSendLog();
  const testModal = useEditModal<{ id: number }, TestEmailFormValues, SendEmailInput>({
    save: {
      isPending: testMutation.isPending,
      mutateAsync: async ({ values }) => {
        await testMutation.mutateAsync({ body: values });
        return { id: 0 };
      },
    },
    defaults: {},
    beforeSave: (values) => ({ ...values, variables: parseTemplateVariables(values.variables) }),
    successMessage: () => '测试邮件已发送',
  });
  const templatesQuery = useEmailTemplateList({ page: 1, pageSize: 100, status: 'enabled' }, testModal.visible);
  const templates = templatesQuery.data?.list ?? [];
  const deleteMutation = useDeleteEmailSendLog();

  const buildExportQuery = () => ({
    ...(draftParams.keyword ? { keyword: draftParams.keyword } : {}),
    ...(draftParams.toEmail ? { toEmail: draftParams.toEmail } : {}),
    ...(draftParams.filterStatus ? { status: draftParams.filterStatus } : {}),
    ...(draftParams.filterSource ? { source: draftParams.filterSource } : {}),
  });

  const handleDelete = (id: number) => {
    confirmDelete({
      title: '确定要删除该记录吗？',
      onOk: async () => {
        await deleteMutation.mutateAsync({ params: { id } });
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
    dateTimeColumn('发送时间', 'sentAt'),
    { title: '错误信息', dataIndex: 'errorMsg', render: renderEllipsis },
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right' as const,
      render: (v: SendStatus) => <StatusTag value={v} />,
    },
    createOperationColumn<EmailSendLog>({
      width: 100,
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
            <KeywordInput placeholder="主题/内容关键词" value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onSearch={handleSearch} width={200} />
            <Input placeholder="收件人邮箱" value={draftParams.toEmail} onChange={(v) => setDraftParams({ ...draftParams, toEmail: v })}
              onEnterPress={handleSearch} showClear style={{ width: 200 }} />
            <StatusSelect
              items={STATUS_OPTIONS}
              value={draftParams.filterStatus}
              onChange={(v) => setDraftParams({ ...draftParams, filterStatus: v as SendStatus | undefined })}
            />
            <FilterSelect
              placeholder="全部来源"
              items={SOURCE_OPTIONS}
              value={draftParams.filterSource}
              onChange={(v) => setDraftParams({ ...draftParams, filterSource: v as string | undefined })}
            />
            <SearchButton onClick={handleSearch} />
            <ResetButton onClick={handleReset} />
          </>
        )}
        actions={(
          <>
            {can('system:email-send-log:export') && (
              <ExportButton entity="system.email-send-logs" query={buildExportQuery()} />
            )}
            {can('system:email-send-log:send') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={testModal.openCreate}>测试发送</Button>
            )}
          </>
        )}
        mobilePrimary={(
          <>
            <KeywordInput placeholder="主题/内容关键词" value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onSearch={handleSearch} width={200} />
            <SearchButton onClick={handleSearch} />
            {can('system:email-send-log:send') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={testModal.openCreate}>测试发送</Button>
            )}
          </>
        )}
        mobileFilters={(
          <>
            <Input placeholder="收件人邮箱" value={draftParams.toEmail} onChange={(v) => setDraftParams({ ...draftParams, toEmail: v })}
              onEnterPress={handleSearch} showClear style={{ width: 200 }} />
            <StatusSelect
              items={STATUS_OPTIONS}
              value={draftParams.filterStatus}
              onChange={(v) => setDraftParams({ ...draftParams, filterStatus: v as SendStatus | undefined })}
            />
            <FilterSelect
              placeholder="全部来源"
              items={SOURCE_OPTIONS}
              value={draftParams.filterSource}
              onChange={(v) => setDraftParams({ ...draftParams, filterSource: v as string | undefined })}
            />
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
        pagination={buildPagination(total)} />

      <AppModal {...testModal.modalProps} title="测试发送邮件" width={560}>
        <Form key={testModal.formKey} {...testModal.formProps}>
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
