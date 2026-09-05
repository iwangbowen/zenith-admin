import { Col, Form, Row, Spin, Toast, Switch } from '@douyinfe/semi-ui';
import { enumValueOf, USER_STATUSES } from '@zenith/shared/core';
import type { CreateEmailTemplateInput, EmailTemplate } from '@zenith/shared/messaging';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { useListSearch } from '@/hooks/useListSearch';
import { useEditModal } from '@/hooks/useEditModal';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import {
  emailTemplateKeys,
  useDeleteEmailTemplate,
  useEmailTemplateDetail,
  useEmailTemplateList,
  useSaveEmailTemplate,
} from '@/hooks/queries/email-templates';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDelete, confirmDangerAsync } from '@/utils/confirm';

export default function EmailTemplatesPage() {
  const { hasPermission: can } = usePermission();
  const { items: statusItems } = useDictItems('common_status');

  interface SearchParams { keyword: string; filterStatus: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', filterStatus: undefined };
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: emailTemplateKeys.lists });

  const listQuery = useEmailTemplateList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: enumValueOf(USER_STATUSES, submittedParams.filterStatus),
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
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
  const togglingStatusId = toggleStatusMutation.isPending ? (toggleStatusMutation.variables?.id ?? null) : null;

  const handleDelete = (id: number) => {
    confirmDelete({
      title: '确定要删除该邮件模板吗？',
      onOk: async () => {
        await deleteMutation.mutateAsync([id]);
        Toast.success('删除成功');
      },
    });
  };

  const handleToggleStatus = async (tpl: EmailTemplate, newStatus: 'enabled' | 'disabled') => {
    if (newStatus === 'disabled') {
      const confirmed = await confirmDangerAsync({
        title: `确认禁用模板「${tpl.name}」？`,
        okText: '确认禁用',
      });
      if (!confirmed) return;
    }
    await toggleStatusMutation.mutateAsync({ id: tpl.id, values: { status: newStatus } });
    Toast.success(newStatus === 'enabled' ? '已启用' : '已禁用');
  };

  const columns = [
    { title: '模板名称', dataIndex: 'name', width: 160 },
    { title: '模板编码', dataIndex: 'code', width: 180 },
    { title: '邮件主题', dataIndex: 'subject', render: renderEllipsis },
    { title: '变量', dataIndex: 'variables', width: 200, render: renderEllipsis },
    { title: '备注', dataIndex: 'remark', render: renderEllipsis },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 90, align: 'center' as const, fixed: 'right' as const,
      render: (v: string, record: EmailTemplate) => (
        <Switch
          size="small"
          checked={v === 'enabled'}
          loading={togglingStatusId === record.id}
          disabled={!can('system:email-template:update')}
          onChange={(checked: boolean) => void handleToggleStatus(record, checked ? 'enabled' : 'disabled')}
        />
      ),
    },
    createOperationColumn<EmailTemplate>({
      width: 150,
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !can('system:email-template:update'),
          onClick: () => modal.openEdit(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !can('system:email-template:delete'),
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
            <KeywordInput placeholder="搜索模板名称/编码/主题" value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onSearch={handleSearch} />
            <StatusSelect
              items={statusItems}
              value={draftParams.filterStatus}
              onChange={(v) => setDraftParams({ ...draftParams, filterStatus: v as string | undefined })}
            />
            <SearchButton onClick={handleSearch} />
            <ResetButton onClick={handleReset} />
            {can('system:email-template:create') && (
              <CreateButton onClick={modal.openCreate} />
            )}
          </>
        )}
        mobilePrimary={(
          <>
            <KeywordInput placeholder="搜索模板名称/编码/主题" value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onSearch={handleSearch} />
            <SearchButton onClick={handleSearch} />
            {can('system:email-template:create') && (
              <CreateButton onClick={modal.openCreate} />
            )}
          </>
        )}
        mobileFilters={(
          <StatusSelect
            items={statusItems}
            value={draftParams.filterStatus}
            onChange={(v) => setDraftParams({ ...draftParams, filterStatus: v as string | undefined })}
          />
        )}
        filterTitle="邮件模板筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable bordered loading={listQuery.isFetching} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} columns={columns} dataSource={list} rowKey="id"
        pagination={buildPagination(total)} />

      <AppModal {...modal.modalProps} width={720}>
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
        <Form key={modal.formKey} {...modal.formProps}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="name" label="模板名称" placeholder="请输入模板名称"
                rules={[{ required: true, message: '请输入模板名称' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="code" label="模板编码" disabled={modal.isEdit} placeholder="如：welcome_email"
                rules={[{ required: true, message: '请输入模板编码' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="subject" label="邮件主题" placeholder="请输入邮件主题"
                rules={[{ required: true, message: '请输入邮件主题' }]} />
            </Col>
            <Col span={12}>
              <Form.Select field="status" label="状态" style={{ width: '100%' }} placeholder="请选择状态"
                optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.TextArea field="content" label="邮件内容" rows={6} placeholder="请输入邮件内容"
                rules={[{ required: true, message: '请输入邮件内容' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Input field="variables" label="变量" placeholder='如：{"username":"用户名"}' />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.TextArea field="remark" label="备注" rows={2} placeholder="请输入备注" />
            </Col>
          </Row>
        </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
