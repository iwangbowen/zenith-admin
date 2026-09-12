import { useMemo } from 'react';
import { Button, Form } from '@douyinfe/semi-ui';
import { AppModal } from '@/components/AppModal';
import { Plus } from 'lucide-react';
import type { EmailSendLog, SendEmailInput, SendSource, SendStatus } from '@zenith/shared/messaging';
import { usePermission } from '@/hooks/usePermission';
import ExportButton from '@/components/ExportButton';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '../../../utils/table-columns';
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
import { compactParams } from '@/lib/query';

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

  interface SearchParams { keyword: string; toEmail: string; filterStatus?: SendStatus; filterSource?: SendSource }
  const defaultSearchParams: SearchParams = { keyword: '', toEmail: '', filterStatus: undefined, filterSource: undefined };
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: emailSendLogKeys.lists });

  // 已提交筛选 → 契约查询参数：列表与导出共用同一份映射
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword,
    toEmail: submittedParams.toEmail,
    status: submittedParams.filterStatus,
    source: submittedParams.filterSource,
  }), [submittedParams]);
  const listQuery = useEmailSendLogList({ page, pageSize, ...filterQuery });
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


  const columns = [
    { title: '收件人', dataIndex: 'toEmail', width: 200 },
    { title: '邮件主题', dataIndex: 'subject', render: renderEllipsis },
    { title: '模板', dataIndex: 'templateName', width: 140, render: (v: string | null) => v || EMPTY_PLACEHOLDER },
    sendLogSourceColumn<EmailSendLog>(),
    sendLogOperatorColumn<EmailSendLog>(),
    { title: 'IP', dataIndex: 'ip', width: 130, render: (v: string | null) => v || EMPTY_PLACEHOLDER },
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
        keyword={<KeywordInput placeholder="主题/内容关键词" {...bindKeyword('keyword')} width={200} />}
        filters={(
          <>
            <KeywordInput placeholder="收件人邮箱" {...bindKeyword('toEmail')} width={200} />
            <SendLogStatusSourceFilters status={bind('filterStatus')} source={bind('filterSource')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={can('system:email-send-log:send') && (
          <Button type="primary" icon={<Plus size={14} />} onClick={testModal.openCreate}>测试发送</Button>
        )}
        actions={(
          <ExportButton entity="system.email-send-logs" query={filterQuery} permission="system:email-send-log:export" />
        )}
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
