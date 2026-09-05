import { Col, Form, Row, Spin, Tag, Toast, Switch } from '@douyinfe/semi-ui';
import { enumValueOf, USER_STATUSES } from '@zenith/shared/core';
import type { CreateInAppTemplateInput, InAppMessageType, InAppTemplate } from '@zenith/shared/messaging';
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
  inAppTemplateKeys,
  useDeleteInAppTemplate,
  useInAppTemplateDetail,
  useInAppTemplateList,
  useSaveInAppTemplate,
} from '@/hooks/queries/in-app-templates';
import { IN_APP_MESSAGE_TYPE_OPTIONS_WITH_COLOR as TYPE_OPTIONS } from '../in-app-message-constants';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDelete, confirmDangerAsync } from '@/utils/confirm';

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
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
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
  const togglingStatusId = toggleStatusMutation.isPending ? (toggleStatusMutation.variables?.id ?? null) : null;

  const handleDelete = (id: number) => {
    confirmDelete({
      title: '确定要删除该站内信模板吗？',
      onOk: async () => {
        await deleteMutation.mutateAsync([id]);
        Toast.success('删除成功');
      },
    });
  };

  const handleToggleStatus = async (tpl: InAppTemplate, newStatus: 'enabled' | 'disabled') => {
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
    { title: '标题', dataIndex: 'title', render: renderEllipsis },
    {
      title: '类型', dataIndex: 'type', width: 90,
      render: (v: InAppMessageType) => {
        const it = TYPE_OPTIONS.find((t) => t.value === v);
        return <Tag color={it?.color ?? 'grey'} type="light">{it?.label ?? v}</Tag>;
      },
    },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 90, align: 'center' as const, fixed: 'right' as const,
      render: (v: string, record: InAppTemplate) => (
        <Switch
          size="small"
          checked={v === 'enabled'}
          loading={togglingStatusId === record.id}
          disabled={!can('system:in-app-template:update')}
          onChange={(checked: boolean) => void handleToggleStatus(record, checked ? 'enabled' : 'disabled')}
        />
      ),
    },
    createOperationColumn<InAppTemplate>({
      width: 150,
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !can('system:in-app-template:update'),
          onClick: () => modal.openEdit(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !can('system:in-app-template:delete'),
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
            <KeywordInput placeholder="搜索模板名称/编码/标题" value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onSearch={handleSearch} width={240} />
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
            <SearchButton onClick={handleSearch} />
            <ResetButton onClick={handleReset} />
            {can('system:in-app-template:create') && (
              <CreateButton onClick={modal.openCreate} />
            )}
          </>
        )}
        mobilePrimary={(
          <>
            <KeywordInput placeholder="搜索模板名称/编码/标题" value={draftParams.keyword} onChange={(v) => setDraftParams({ ...draftParams, keyword: v })} onSearch={handleSearch} width={240} />
            <SearchButton onClick={handleSearch} />
            {can('system:in-app-template:create') && (
              <CreateButton onClick={modal.openCreate} />
            )}
          </>
        )}
        mobileFilters={(
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
        filterTitle="站内信模板筛选"
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
              <Form.Input field="code" label="模板编码" disabled={modal.isEdit} placeholder="请输入模板编码"
                rules={[{ required: true, message: '请输入模板编码' }]} />
            </Col>
          </Row>
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
