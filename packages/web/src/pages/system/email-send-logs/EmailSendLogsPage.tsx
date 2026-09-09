import { Button, Form, Input } from '@douyinfe/semi-ui';
import { AppModal } from '@/components/AppModal';
import { Plus } from 'lucide-react';
import { enumValueOf } from '@zenith/shared/core';
import { SEND_SOURCES } from '@zenith/shared/messaging';
import type { EmailSendLog, SendEmailInput, SendStatus } from '@zenith/shared/messaging';
import { usePermission } from '@/hooks/usePermission';
import ExportButton from '@/components/ExportButton';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
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
import { parseTemplateVariables } from '../send-log-constants';
import { KeywordInput } from '@/components/search-filters';
import { SendLogStatusSourceFilters } from '../send-log-ui';
import { sendLogErrorColumn, sendLogOperatorColumn, sendLogSourceColumn, sendLogStatusColumn } from '../send-log-columns';
import { compactQuery } from '@/lib/query';

/** 测试发送表单值：变量以 JSON 文本输入 */
interface TestEmailFormValues {
  templateId?: number;
  toEmail: string;
  subject?: string;
  content?: string;
  variables?: string;
}

export default function EmailSendLogsPage() {
  const { hasPermission: can } = usePermission();

  interface SearchParams { keyword: string; toEmail: string; filterStatus: SendStatus | undefined; filterSource: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', toEmail: '', filterStatus: undefined, filterSource: undefined };
  const {
    page, pageSize, buildPagination,
    draftParams, setField, submittedParams,
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

  const buildExportQuery = () => compactQuery({
    keyword: draftParams.keyword,
    toEmail: draftParams.toEmail,
    status: draftParams.filterStatus,
    source: draftParams.filterSource,
  });


  const columns = [
    { title: '收件人', dataIndex: 'toEmail', width: 200 },
    { title: '邮件主题', dataIndex: 'subject', render: renderEllipsis },
    { title: '模板', dataIndex: 'templateName', width: 140, render: (v: string | null) => v || '—' },
    sendLogSourceColumn<EmailSendLog>(),
    sendLogOperatorColumn<EmailSendLog>(),
    { title: 'IP', dataIndex: 'ip', width: 130, render: (v: string | null) => v || '—' },
    dateTimeColumn('发送时间', 'sentAt'),
    sendLogErrorColumn<EmailSendLog>(),
    sendLogStatusColumn<EmailSendLog>(),
    createOperationColumn<EmailSendLog>({
      width: 100,
      actions: (record) => [
        deleteAction({
          hidden: !can('system:email-send-log:delete'),
          title: '确定要删除该记录吗？',
          run: () => deleteMutation.mutateAsync({ params: { id: record.id } }),
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="主题/内容关键词" value={draftParams.keyword} onChange={setField('keyword')} onSearch={handleSearch} width={200} />}
        filters={(
          <>
            <Input placeholder="收件人邮箱" value={draftParams.toEmail} onChange={setField('toEmail')}
              onEnterPress={handleSearch} showClear style={{ width: 200 }} />
            <SendLogStatusSourceFilters
              status={draftParams.filterStatus}
              source={draftParams.filterSource}
              onStatusChange={setField('filterStatus')}
              onSourceChange={setField('filterSource')}
            />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={can('system:email-send-log:send') && (
          <Button type="primary" icon={<Plus size={14} />} onClick={testModal.openCreate}>测试发送</Button>
        )}
        actions={can('system:email-send-log:export') && (
          <ExportButton entity="system.email-send-logs" query={buildExportQuery()} />
        )}
        mobileActions={can('system:email-send-log:export') ? (
          <ExportButton entity="system.email-send-logs" query={buildExportQuery()} variant="flat" />
        ) : null}
        filterTitle="邮件发送日志筛选"
        actionTitle="邮件日志操作"
      />

      <ConfigurableTable<EmailSendLog>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

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
