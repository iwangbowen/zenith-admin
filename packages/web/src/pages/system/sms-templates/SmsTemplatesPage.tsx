import { Col, Form, Row, Spin } from '@douyinfe/semi-ui';
import { enumValueOf, USER_STATUSES } from '@zenith/shared/core';
import { SMS_PROVIDER_OPTIONS } from '@zenith/shared/messaging';
import type { CreateSmsTemplateInput, SmsProvider, SmsTemplate } from '@zenith/shared/messaging';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { useEditModal } from '@/hooks/useEditModal';
import InsertShortLinkButton from '@/components/short-link/InsertShortLinkButton';
import { useListSearch } from '@/hooks/useListSearch';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar, listTableProps, useStatusToggle } from '@/components/list-page';
import { createdAtColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '../../../utils/table-columns';
import {
  smsTemplateKeys,
  useDeleteSmsTemplate,
  useSaveSmsTemplate,
  useSmsTemplateDetail,
  useSmsTemplateList,
} from '@/hooks/queries/sms-templates';
import { CreateButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { TemplateNameCodeRow, TemplateVariablesRemarkRows } from '../message-template-form';

export default function SmsTemplatesPage() {
  const { hasPermission: can } = usePermission();
  const { items: statusItems, options: statusOptions } = useDictItems('common_status');

  interface SearchParams { keyword: string; filterProvider: SmsProvider | undefined; filterStatus: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', filterProvider: undefined, filterStatus: undefined };
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: smsTemplateKeys.lists });

  const listQuery = useSmsTemplateList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    provider: submittedParams.filterProvider,
    status: enumValueOf(USER_STATUSES, submittedParams.filterStatus),
  });

  const saveMutation = useSaveSmsTemplate();
  const templateModal = useEditModal<SmsTemplate, Partial<CreateSmsTemplateInput>>({
    entityName: '短信模板',
    save: saveMutation,
    useDetail: useSmsTemplateDetail,
    defaults: { status: 'enabled', provider: 'aliyun' },
    toValues: (r) => ({
      name: r.name,
      code: r.code,
      templateCode: r.templateCode,
      signName: r.signName ?? undefined,
      content: r.content,
      variables: r.variables ?? undefined,
      provider: r.provider,
      status: r.status,
      remark: r.remark ?? undefined,
    }),
    labelWidth: 120,
  });
  const toggleStatusMutation = useSaveSmsTemplate();
  const deleteMutation = useDeleteSmsTemplate();
  const status = useStatusToggle<SmsTemplate>({
    toggle: (record, enabled) => toggleStatusMutation.mutateAsync({ id: record.id, values: { status: enabled ? 'enabled' : 'disabled' } }),
    confirmDisable: (record) => ({ danger: true, title: `确认禁用模板「${record.name}」？`, okText: '确认禁用' }),
    disabled: !can('system:sms-template:update'),
    messages: { disabled: '已禁用' },
  });


  const columns = [
    { title: '模板名称', dataIndex: 'name', width: 160 },
    { title: '模板编码', dataIndex: 'code', width: 180 },
    { title: '服务商模板号', dataIndex: 'templateCode', width: 180, render: renderEllipsis },
    { title: '签名', dataIndex: 'signName', width: 120, render: (v: string | null) => v || EMPTY_PLACEHOLDER },
    {
      title: '服务商', dataIndex: 'provider', width: 100,
      render: (v: string) => SMS_PROVIDER_OPTIONS.find((p) => p.value === v)?.label ?? v,
    },
    { title: '内容', dataIndex: 'content', render: renderEllipsis },
    createdAtColumn,
    status.column(),
    createOperationColumn<SmsTemplate>({
      width: 150,
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !can('system:sms-template:update'),
          onClick: () => templateModal.openEdit(record),
        },
        deleteAction({
          hidden: !can('system:sms-template:delete'),
          title: '确定要删除该短信模板吗？',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索模板名称/编码" {...bindKeyword('keyword')} />}
        filters={(
          <>
            <FilterSelect
              placeholder="全部服务商"
              items={SMS_PROVIDER_OPTIONS}
              {...bind('filterProvider')}
              width={140}
            />
            <StatusSelect
              items={statusItems}
              {...bind('filterStatus')}
            />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={can('system:sms-template:create') && (
          <CreateButton onClick={templateModal.openCreate} />
        )}
        filterTitle="短信模板筛选"
      />

      <ConfigurableTable<SmsTemplate>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <AppModal {...templateModal.modalProps} width={720}>
        <Spin spinning={templateModal.detailLoading} wrapperClassName="modal-spin-wrapper">
        <Form key={templateModal.formKey} {...templateModal.formProps}>
          <TemplateNameCodeRow isEdit={templateModal.isEdit} codePlaceholder="如：order_paid" />
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="templateCode" label="服务商模板号" placeholder="请输入服务商模板号"
                rules={[{ required: true, message: '请输入服务商模板号' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="signName" label="短信签名" placeholder="可选" />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="provider" label="服务商" style={{ width: '100%' }} optionList={SMS_PROVIDER_OPTIONS}
                placeholder="请选择服务商" rules={[{ required: true, message: '请选择服务商' }]} />
            </Col>
            <Col span={12}>
              <Form.Select field="status" label="状态" style={{ width: '100%' }} placeholder="请选择状态"
                optionList={statusOptions} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.TextArea field="content" label="模板内容" rows={4} placeholder="请输入模板内容"
                rules={[{ required: true, message: '请输入模板内容' }]}
                extraText={(
                  <InsertShortLinkButton
                    onInsert={(url) => {
                      const api = templateModal.formApi.current;
                      if (!api) return;
                      const current = (api.getValue('content') as string | undefined) ?? '';
                      api.setValue('content', current ? `${current} ${url}` : url);
                    }}
                  />
                )} />
            </Col>
          </Row>
          <TemplateVariablesRemarkRows variablesPlaceholder='如：{"code":"验证码"}' />
        </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
