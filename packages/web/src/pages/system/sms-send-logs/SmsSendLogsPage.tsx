import { useMemo } from 'react';
import { Button, Form } from '@douyinfe/semi-ui';
import { AppModal } from '@/components/AppModal';
import { Plus } from 'lucide-react';
import { SMS_PROVIDER_OPTIONS } from '@zenith/shared/messaging';
import type { SendSmsInput, SendSource, SendStatus, SmsSendLog } from '@zenith/shared/messaging';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import ExportButton from '@/components/ExportButton';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '../../../utils/table-columns';
import { useSmsTemplateList } from '@/hooks/queries/sms-templates';
import { useListSearch } from '@/hooks/useListSearch';
import {
  smsSendLogKeys,
  useDeleteSmsSendLog,
  useSmsSendLogList,
  useTestSmsSendLog,
} from '@/hooks/queries/sms-send-logs';
import { parseTemplateVariables } from '../send-log-constants';
import { KeywordInput } from '@/components/search-filters';
import { SendLogStatusSourceFilters } from '../send-log-ui';
import { sendLogErrorColumn, sendLogOperatorColumn, sendLogSourceColumn, sendLogStatusColumn } from '../send-log-columns';
import { compactParams } from '@/lib/query';

/** 测试发送表单值：变量以 JSON 文本输入 */
interface TestSmsFormValues {
  templateId: number;
  phone: string;
  variables?: string;
}

export default function SmsSendLogsPage() {
  const { hasPermission: can } = usePermission();

  interface SearchParams { keyword: string; phone: string; filterStatus?: SendStatus; filterSource?: SendSource }
  const defaultSearchParams: SearchParams = { keyword: '', phone: '', filterStatus: undefined, filterSource: undefined };
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: smsSendLogKeys.lists });

  // 已提交筛选 → 契约查询参数：列表与导出共用同一份映射
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword,
    phone: submittedParams.phone,
    status: submittedParams.filterStatus,
    source: submittedParams.filterSource,
  }), [submittedParams]);
  const listQuery = useSmsSendLogList({ page, pageSize, ...filterQuery });
  const testMutation = useTestSmsSendLog();
  const testModal = useEditModal<{ id: number }, TestSmsFormValues, SendSmsInput>({
    save: {
      mutateAsync: async ({ values }) => {
        await testMutation.mutateAsync({ body: values });
        return { id: 0 };
      },
      isPending: testMutation.isPending,
    },
    beforeSave: (values) => ({ ...values, variables: parseTemplateVariables(values.variables) }),
    successMessage: () => '测试短信已发送',
  });
  const templatesQuery = useSmsTemplateList({ page: 1, pageSize: 100, status: 'enabled' }, testModal.visible);
  const templates = templatesQuery.data?.list ?? [];
  const deleteMutation = useDeleteSmsSendLog();


  const columns = [
    { title: '手机号', dataIndex: 'phone', width: 130 },
    { title: '模板', dataIndex: 'templateName', width: 140, render: (v: string | null) => v || EMPTY_PLACEHOLDER },
    {
      title: '服务商', dataIndex: 'provider', width: 100,
      render: (v: string) => SMS_PROVIDER_OPTIONS.find((p) => p.value === v)?.label ?? v,
    },
    { title: '内容', dataIndex: 'content', render: renderEllipsis },
    sendLogSourceColumn<SmsSendLog>(),
    sendLogOperatorColumn<SmsSendLog>(),
    dateTimeColumn('发送时间', 'sentAt'),
    sendLogErrorColumn<SmsSendLog>(),
    sendLogStatusColumn<SmsSendLog>(),
    createOperationColumn<SmsSendLog>({
      width: 100,
      actions: (record) => [
        deleteAction({
          hidden: !can('system:sms-send-log:delete'),
          title: '确定要删除该记录吗？',
          run: () => deleteMutation.mutateAsync({ params: { id: record.id } }),
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="内容关键词" {...bindKeyword('keyword')} width={180} />}
        filters={(
          <>
            <KeywordInput placeholder="手机号" {...bindKeyword('phone')} width={160} />
            <SendLogStatusSourceFilters status={bind('filterStatus')} source={bind('filterSource')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={can('system:sms-send-log:send') && (
          <Button type="primary" icon={<Plus size={14} />} onClick={testModal.openCreate}>测试发送</Button>
        )}
        actions={(
          <ExportButton entity="system.sms-send-logs" query={filterQuery} permission="system:sms-send-log:export" />
        )}
        filterTitle="短信发送日志筛选"
        actionTitle="短信日志操作"
      />

      <ConfigurableTable<SmsSendLog>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <AppModal {...testModal.modalProps} title="测试发送短信" width={520}>
        <Form key={testModal.formKey} {...testModal.formProps}>
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
