import { Col, Form, Row, Spin, Tag } from '@douyinfe/semi-ui';
import { enumValueOf, USER_STATUSES } from '@zenith/shared/core';
import type { CreateInAppTemplateInput, InAppMessageType, InAppTemplate } from '@zenith/shared/messaging';
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
  inAppTemplateKeys,
  useDeleteInAppTemplate,
  useInAppTemplateDetail,
  useInAppTemplateList,
  useSaveInAppTemplate,
} from '@/hooks/queries/in-app-templates';
import { IN_APP_MESSAGE_TYPE_OPTIONS_WITH_COLOR as TYPE_OPTIONS } from '../in-app-message-constants';
import { CreateButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { TemplateNameCodeRow, TemplateVariablesRemarkRows } from '../message-template-form';

export default function InAppTemplatesPage() {
  const { hasPermission: can } = usePermission();
  const { items: statusItems } = useDictItems('common_status');

  interface SearchParams { keyword: string; filterType: InAppMessageType | undefined; filterStatus: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', filterType: undefined, filterStatus: undefined };
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: inAppTemplateKeys.lists });

  const listQuery = useInAppTemplateList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    type: submittedParams.filterType,
    status: enumValueOf(USER_STATUSES, submittedParams.filterStatus),
  });
  const saveMutation = useSaveInAppTemplate();
  const modal = useEditModal<InAppTemplate, Partial<CreateInAppTemplateInput>>({
    entityName: '站内信模板',
    save: saveMutation,
    useDetail: useInAppTemplateDetail,
    defaults: { status: 'enabled', type: 'info' },
    toValues: (r) => ({
      name: r.name,
      code: r.code,
      title: r.title,
      content: r.content,
      type: r.type,
      variables: r.variables ?? undefined,
      status: r.status,
      remark: r.remark ?? undefined,
    }),
    labelWidth: 120,
  });
  const toggleStatusMutation = useSaveInAppTemplate();
  const deleteMutation = useDeleteInAppTemplate();
  const status = useStatusToggle<InAppTemplate>({
    toggle: (record, enabled) => toggleStatusMutation.mutateAsync({ id: record.id, values: { status: enabled ? 'enabled' : 'disabled' } }),
    confirmDisable: (record) => ({ danger: true, title: `确认禁用模板「${record.name}」？`, okText: '确认禁用' }),
    disabled: !can('system:in-app-template:update'),
    messages: { disabled: '已禁用' },
  });


  const columns = [
    { title: '模板名称', dataIndex: 'name', width: 160 },
    { title: '模板编码', dataIndex: 'code', width: 180 },
    { title: '标题', dataIndex: 'title', render: renderEllipsis },
    {
      title: '类型', dataIndex: 'type', width: 90,
      render: (v: InAppMessageType) => {
        const it = TYPE_OPTIONS.find((t) => t.value === v);
        return <Tag color={it?.color ?? 'grey'} type="light">{it?.label ?? v}</Tag>;
      },
    },
    createdAtColumn,
    status.column(),
    createOperationColumn<InAppTemplate>({
      width: 150,
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !can('system:in-app-template:update'),
          onClick: () => modal.openEdit(record),
        },
        deleteAction({
          hidden: !can('system:in-app-template:delete'),
          title: '确定要删除该站内信模板吗？',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索模板名称/编码/标题" value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onSearch={handleSearch} width={240} />}
        filters={(
          <>
            <FilterSelect
              placeholder="全部类型"
              items={TYPE_OPTIONS}
              value={draftParams.filterType}
              onChange={(v) => setDraftParams({ ...draftParams, filterType: v as InAppMessageType | undefined })}
            />
            <StatusSelect
              items={statusItems}
              value={draftParams.filterStatus}
              onChange={(v) => setDraftParams({ ...draftParams, filterStatus: v as string | undefined })}
            />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={can('system:in-app-template:create') && (
          <CreateButton onClick={modal.openCreate} />
        )}
        filterTitle="站内信模板筛选"
      />

      <ConfigurableTable<InAppTemplate>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <AppModal {...modal.modalProps} width={720}>
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
        <Form key={modal.formKey} {...modal.formProps}>
          <TemplateNameCodeRow isEdit={modal.isEdit} />
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="type" label="类型" style={{ width: '100%' }} optionList={TYPE_OPTIONS}
                placeholder="请选择类型"
                rules={[{ required: true, message: '请选择类型' }]} />
            </Col>
            <Col span={12}>
              <Form.Select field="status" label="状态" style={{ width: '100%' }} placeholder="请选择状态"
                optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Input field="title" label="标题" placeholder="请输入标题"
                rules={[{ required: true, message: '请输入标题' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.TextArea field="content" label="内容" rows={5} placeholder="请输入内容"
                rules={[{ required: true, message: '请输入内容' }]} />
            </Col>
          </Row>
          <TemplateVariablesRemarkRows />
        </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
