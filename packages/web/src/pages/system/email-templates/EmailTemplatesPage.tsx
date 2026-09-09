import { Col, Form, Row, Spin } from '@douyinfe/semi-ui';
import { enumValueOf, USER_STATUSES } from '@zenith/shared/core';
import type { CreateEmailTemplateInput, EmailTemplate } from '@zenith/shared/messaging';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { useListSearch } from '@/hooks/useListSearch';
import { useEditModal } from '@/hooks/useEditModal';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar, listTableProps, useStatusToggle } from '@/components/list-page';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import {
  emailTemplateKeys,
  useDeleteEmailTemplate,
  useEmailTemplateDetail,
  useEmailTemplateList,
  useSaveEmailTemplate,
} from '@/hooks/queries/email-templates';
import { CreateButton } from '@/components/toolbar-controls';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { TemplateNameCodeRow, TemplateVariablesRemarkRows } from '../message-template-form';

export default function EmailTemplatesPage() {
  const { hasPermission: can } = usePermission();
  const { items: statusItems, options: statusOptions } = useDictItems('common_status');

  interface SearchParams { keyword: string; filterStatus: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', filterStatus: undefined };
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: emailTemplateKeys.lists });

  const listQuery = useEmailTemplateList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: enumValueOf(USER_STATUSES, submittedParams.filterStatus),
  });
  const saveMutation = useSaveEmailTemplate();
  const modal = useEditModal<EmailTemplate, Partial<CreateEmailTemplateInput>>({
    entityName: '邮件模板',
    save: saveMutation,
    useDetail: useEmailTemplateDetail,
    defaults: { status: 'enabled' },
    toValues: (r) => ({
      name: r.name,
      code: r.code,
      subject: r.subject,
      content: r.content,
      variables: r.variables ?? undefined,
      status: r.status,
      remark: r.remark ?? undefined,
    }),
    labelWidth: 120,
  });

  const toggleStatusMutation = useSaveEmailTemplate();
  const deleteMutation = useDeleteEmailTemplate();
  const status = useStatusToggle<EmailTemplate>({
    toggle: (record, enabled) => toggleStatusMutation.mutateAsync({ id: record.id, values: { status: enabled ? 'enabled' : 'disabled' } }),
    confirmDisable: (record) => ({ danger: true, title: `确认禁用模板「${record.name}」？`, okText: '确认禁用' }),
    disabled: !can('system:email-template:update'),
    messages: { disabled: '已禁用' },
  });


  const columns = [
    { title: '模板名称', dataIndex: 'name', width: 160 },
    { title: '模板编码', dataIndex: 'code', width: 180 },
    { title: '邮件主题', dataIndex: 'subject', render: renderEllipsis },
    { title: '变量', dataIndex: 'variables', width: 200, render: renderEllipsis },
    { title: '备注', dataIndex: 'remark', render: renderEllipsis },
    createdAtColumn,
    status.column(),
    createOperationColumn<EmailTemplate>({
      width: 150,
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !can('system:email-template:update'),
          onClick: () => modal.openEdit(record),
        },
        deleteAction({
          hidden: !can('system:email-template:delete'),
          title: '确定要删除该邮件模板吗？',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索模板名称/编码/主题" {...bindKeyword('keyword')} />}
        filters={(
          <StatusSelect
            items={statusItems}
            {...bind('filterStatus')}
          />
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={can('system:email-template:create') && (
          <CreateButton onClick={modal.openCreate} />
        )}
        filterTitle="邮件模板筛选"
      />

      <ConfigurableTable<EmailTemplate>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <AppModal {...modal.modalProps} width={720}>
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
        <Form key={modal.formKey} {...modal.formProps}>
          <TemplateNameCodeRow isEdit={modal.isEdit} codePlaceholder="如：welcome_email" />
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="subject" label="邮件主题" placeholder="请输入邮件主题"
                rules={[{ required: true, message: '请输入邮件主题' }]} />
            </Col>
            <Col span={12}>
              <Form.Select field="status" label="状态" style={{ width: '100%' }} placeholder="请选择状态"
                optionList={statusOptions} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.TextArea field="content" label="邮件内容" rows={6} placeholder="请输入邮件内容"
                rules={[{ required: true, message: '请输入邮件内容' }]} />
            </Col>
          </Row>
          <TemplateVariablesRemarkRows />
        </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
