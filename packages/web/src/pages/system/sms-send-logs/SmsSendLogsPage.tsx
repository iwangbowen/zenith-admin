import { Button, Form, Input, Tag, Toast } from '@douyinfe/semi-ui';
import { AppModal } from '@/components/AppModal';
import { Plus } from 'lucide-react';
import { enumValueOf } from '@zenith/shared/core';
import { SEND_SOURCES, SMS_PROVIDER_OPTIONS } from '@zenith/shared/messaging';
import type { SendSmsInput, SendStatus, SmsSendLog } from '@zenith/shared/messaging';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { dateTimeColumn, renderEllipsis } from '../../../utils/table-columns';
import { useSmsTemplateList } from '@/hooks/queries/sms-templates';
import { useListSearch } from '@/hooks/useListSearch';
import {
  smsSendLogKeys,
  useDeleteSmsSendLog,
  useSmsSendLogList,
  useTestSmsSendLog,
} from '@/hooks/queries/sms-send-logs';
import { SEND_LOG_STATUS_OPTIONS as STATUS_OPTIONS, SEND_SOURCE_OPTIONS as SOURCE_OPTIONS, parseTemplateVariables } from '../send-log-constants';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';

/** 测试发送表单值：变量以 JSON 文本输入 */
interface TestSmsFormValues {
  templateId: number;
  phone: string;
  variables?: string;
}

function StatusTag({ value }: Readonly<{ value: SendStatus }>) {
  const it = STATUS_OPTIONS.find((s) => s.value === value);
  return <Tag color={it?.color ?? 'grey'} type="light">{it?.label ?? value}</Tag>;
}

export default function SmsSendLogsPage() {
  const { hasPermission: can } = usePermission();

  interface SearchParams { keyword: string; phone: string; filterStatus: SendStatus | undefined; filterSource: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', phone: '', filterStatus: undefined, filterSource: undefined };
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: smsSendLogKeys.lists });

  const listQuery = useSmsSendLogList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    phone: submittedParams.phone || undefined,
    status: submittedParams.filterStatus,
    source: enumValueOf(SEND_SOURCES, submittedParams.filterSource),
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
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

  const buildExportQuery = () => ({
    ...(draftParams.keyword ? { keyword: draftParams.keyword } : {}),
    ...(draftParams.phone ? { phone: draftParams.phone } : {}),
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
    { title: '手机号', dataIndex: 'phone', width: 130 },
    { title: '模板', dataIndex: 'templateName', width: 140, render: (v: string | null) => v || '—' },
    {
      title: '服务商', dataIndex: 'provider', width: 100,
      render: (v: string) => SMS_PROVIDER_OPTIONS.find((p) => p.value === v)?.label ?? v,
    },
    { title: '内容', dataIndex: 'content', render: renderEllipsis },
    { title: '来源', dataIndex: 'source', width: 90, render: (v: string) => SOURCE_OPTIONS.find((s) => s.value === v)?.label ?? v },
    { title: '操作人', dataIndex: 'userName', width: 120, render: (v: string | null) => v || '—' },
    dateTimeColumn('发送时间', 'sentAt'),
    { title: '错误信息', dataIndex: 'errorMsg', render: renderEllipsis },
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right' as const,
      render: (v: SendStatus) => <StatusTag value={v} />,
    },
    createOperationColumn<SmsSendLog>({
      width: 100,
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
            <KeywordInput placeholder="内容关键词" value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onSearch={handleSearch} width={180} />
            <Input placeholder="手机号" value={draftParams.phone} onChange={(v) => setDraftParams({ ...draftParams, phone: v })}
              onEnterPress={handleSearch} showClear style={{ width: 160 }} />
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
            {can('system:sms-send-log:export') && (
              <ExportButton entity="system.sms-send-logs" query={buildExportQuery()} />
            )}
            {can('system:sms-send-log:send') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={testModal.openCreate}>测试发送</Button>
            )}
          </>
        )}
        mobilePrimary={(
          <>
            <KeywordInput placeholder="内容关键词" value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onSearch={handleSearch} width={180} />
            <SearchButton onClick={handleSearch} />
            {can('system:sms-send-log:send') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={testModal.openCreate}>测试发送</Button>
            )}
          </>
        )}
        mobileFilters={(
          <>
            <Input placeholder="手机号" value={draftParams.phone} onChange={(v) => setDraftParams({ ...draftParams, phone: v })}
              onEnterPress={handleSearch} showClear style={{ width: 160 }} />
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
        mobileActions={can('system:sms-send-log:export') ? (
          <ExportButton entity="system.sms-send-logs" query={buildExportQuery()} variant="flat" />
        ) : null}
        filterTitle="短信发送日志筛选"
        actionTitle="短信日志操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable bordered loading={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total)} />

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
