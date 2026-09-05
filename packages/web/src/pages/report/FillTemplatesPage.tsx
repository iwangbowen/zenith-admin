import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Button, Col, Form, Modal, Row, SideSheet, Space, Steps, TabPane, Tabs, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Copy, Eye } from 'lucide-react';
import { REPORT_FILL_TEMPLATE_STATUS_LABELS, REPORT_FILL_TEMPLATE_STATUS_OPTIONS } from '@zenith/shared/report';
import type { ReportFillTemplate } from '@zenith/shared/report';
import type { WorkflowFormField, WorkflowFormSettings } from '@zenith/shared/workflow';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { useAllUsers } from '@/hooks/queries/users';
import { flattenReportFolders, useReportFolderTree } from '@/hooks/queries/report-folders';
import { usePublishedWorkflowDefinitions } from '@/hooks/queries/workflow-definitions';
import {
  reportFillKeys,
  useChangeReportFillTemplateLifecycle,
  useCloneReportFillTemplate,
  useCreateReportFillTemplate,
  useDeleteReportFillTemplate,
  useReportFillTemplateList,
  useUpdateReportFillTemplate,
} from '@/hooks/queries/report-fill';
import { useQueryClient } from '@tanstack/react-query';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import FormDesigner from '@/pages/workflow/designer/components/FormDesigner';
import WorkflowFormRenderer from '@/pages/workflow/designer/components/WorkflowFormRenderer';
import { isRevisionConflict, validateFillTemplateInput } from './report-p2-utils';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { abortSubmit } from '@/lib/abort-submit';

interface SearchState {
  keyword: string;
  status?: ReportFillTemplate['status'];
  ownerId?: number;
  folderId?: number;
}

const DEFAULT_SEARCH: SearchState = { keyword: '' };
const DEFAULT_SCHEMA: { fields: WorkflowFormField[]; settings: WorkflowFormSettings } = {
  fields: [],
  settings: { labelPosition: 'top', submitButtonText: '提交' },
};

function templateStatusTag(status: ReportFillTemplate['status']) {
  const color = status === 'published' ? 'green' : status === 'disabled' ? 'orange' : 'grey';
  return <Tag size="small" color={color}>{REPORT_FILL_TEMPLATE_STATUS_LABELS[status]}</Tag>;
}

export default function FillTemplatesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draft, setDraft] = useState<SearchState>(DEFAULT_SEARCH);
  const [submitted, setSubmitted] = useState<SearchState>(DEFAULT_SEARCH);
  const [fields, setFields] = useState<WorkflowFormField[]>([]);
  const [settings, setSettings] = useState<WorkflowFormSettings>(DEFAULT_SCHEMA.settings);
  const [editorStep, setEditorStep] = useState(0);
  const [editorBasicValues, setEditorBasicValues] = useState<Record<string, unknown>>({ needReview: false });
  const [editorTab, setEditorTab] = useState('designer');
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  const listQuery = useReportFillTemplateList({
    page,
    pageSize,
    keyword: submitted.keyword || undefined,
    status: submitted.status,
    ownerId: submitted.ownerId,
    folderId: submitted.folderId,
  });
  const users = useAllUsers().data ?? [];
  const folders = flattenReportFolders(useReportFolderTree({ resourceType: 'fill_template' }).data ?? []);
  const definitions = (usePublishedWorkflowDefinitions().data ?? []).filter((definition) => definition.formType === 'external');
  const createMutation = useCreateReportFillTemplate();
  const updateMutation = useUpdateReportFillTemplate();
  const lifecycleMutation = useChangeReportFillTemplateLifecycle();
  const cloneMutation = useCloneReportFillTemplate();
  const deleteMutation = useDeleteReportFillTemplate();
  const templates = listQuery.data?.list ?? [];
  const editorModal = useEditModal<ReportFillTemplate, Record<string, unknown>>({
    entityName: '填报模板',
    save: {
      isPending: createMutation.isPending || updateMutation.isPending,
      mutateAsync: async () => { abortSubmit('editor-submit-is-handled-by-custom-footer'); },
    },
    defaults: { needReview: false },
    toValues: (template) => ({
      code: template.code,
      name: template.name,
      description: template.description,
      ownerId: template.ownerId,
      folderId: template.folderId,
      needReview: template.needReview,
      workflowDefinitionId: template.workflowDefinitionId,
    }),
  });
  const editing = editorModal.editing;
  const cloneModal = useEditModal<ReportFillTemplate, Record<string, unknown>>({
    save: {
      isPending: cloneMutation.isPending,
      mutateAsync: ({ id, values }) => cloneMutation.mutateAsync({
        params: { id: id! },
        body: {
          code: String(values.code),
          name: String(values.name),
          folderId: values.folderId ? Number(values.folderId) : null,
        },
      }),
    },
    labelWidth: 90,
    toValues: (template) => ({
      name: `${template.name} 副本`,
      code: `${template.code}_copy`,
      folderId: template.folderId,
    }),
    beforeSave: (values) => ({
      code: String(values.code).trim(),
      name: String(values.name).trim(),
      folderId: values.folderId ? Number(values.folderId) : null,
    }),
    successMessage: () => '模板克隆成功',
  });

  function handleSearch() {
    setPage(1);
    setSubmitted(draft);
    void queryClient.invalidateQueries({ queryKey: reportFillKeys.templateLists });
  }

  function handleReset() {
    setDraft(DEFAULT_SEARCH);
    setSubmitted(DEFAULT_SEARCH);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: reportFillKeys.templateLists });
  }

  function openEditor(template?: ReportFillTemplate) {
    setFields(template?.formSchema.fields ?? []);
    setSettings(template?.formSchema.settings ?? DEFAULT_SCHEMA.settings);
    setEditorStep(0);
    setEditorBasicValues(template ? {
      code: template.code,
      name: template.name,
      description: template.description,
      ownerId: template.ownerId,
      folderId: template.folderId,
      needReview: template.needReview,
      workflowDefinitionId: template.workflowDefinitionId,
    } : { needReview: false });
    setConflictMessage(null);
    setEditorTab('designer');
    if (template) editorModal.openEdit(template);
    else editorModal.openCreate();
  }

  async function goToDesignStep() {
    try {
      const values = await editorModal.formApi.current?.validate() as Record<string, unknown>;
      setEditorBasicValues(values);
      setEditorStep(1);
    } catch {
      // Semi Form 已在对应字段展示校验信息。
    }
  }

  async function saveTemplate() {
    const values = editorBasicValues;
    const formSchema = { fields, settings };
    const base = {
      folderId: values.folderId ? Number(values.folderId) : null,
      ownerId: values.ownerId ? Number(values.ownerId) : null,
      name: String(values.name ?? '').trim(),
      description: values.description ? String(values.description) : null,
      formSchema,
      workflowDefinitionId: values.needReview && values.workflowDefinitionId
        ? Number(values.workflowDefinitionId)
        : null,
      needReview: Boolean(values.needReview),
    };
    try {
      if (editing) {
        const payload = { ...base, expectedRevision: editing.revision };
        const validation = validateFillTemplateInput(payload, true);
        if (!validation.success) {
          Toast.error(validation.message);
          abortSubmit('validation');
        }
        await updateMutation.mutateAsync({ params: { id: editing.id }, body: payload });
      } else {
        const payload = { ...base, code: String(values.code ?? '').trim() };
        const validation = validateFillTemplateInput(payload, false);
        if (!validation.success) {
          Toast.error(validation.message);
          abortSubmit('validation');
        }
        await createMutation.mutateAsync({ body: payload });
      }
      Toast.success(editing ? '模板更新成功' : '模板创建成功');
      editorModal.close();
    } catch (error) {
      if (isRevisionConflict(error)) {
        setConflictMessage('模板已被其他人更新。当前设计不会自动覆盖，请关闭后刷新最新版本再继续。');
        void listQuery.refetch();
        return;
      }
      throw error;
    }
  }

  async function changeLifecycle(template: ReportFillTemplate, action: 'publish' | 'offline') {
    try {
      await lifecycleMutation.mutateAsync({
        params: { id: template.id },
        body: { action, expectedRevision: template.revision },
      });
      Toast.success(action === 'publish' ? '模板已发布' : '模板已下线');
    } catch (error) {
      if (isRevisionConflict(error)) {
        Modal.warning({
          title: '模板版本冲突',
          content: '模板状态或内容已变化，请刷新列表确认最新修订后重试。',
          onOk: () => void listQuery.refetch(),
        });
        return;
      }
      throw error;
    }
  }

  const columns: ColumnProps<ReportFillTemplate>[] = [
    { title: '模板名称', dataIndex: 'name', minWidth: 190, render: renderEllipsis },
    { title: '编码', dataIndex: 'code', width: 220, render: renderEllipsis },
    { title: '负责人', dataIndex: 'ownerName', width: 110, render: (value: string | null) => value || '—' },
    { title: '目录', dataIndex: 'folderName', width: 130, render: (value: string | null) => value || '—' },
    {
      title: '审核',
      dataIndex: 'needReview',
      width: 130,
      render: (_value: boolean, record) => record.needReview
        ? record.workflowDefinitionName || '人工审核'
        : '无需审核',
    },
    { title: '版本', dataIndex: 'revision', width: 72 },
    { title: '描述', dataIndex: 'description', width: 180, render: renderEllipsis },
    dateTimeColumn('更新时间', 'updatedAt'),
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right',
      render: (value: ReportFillTemplate['status']) => templateStatusTag(value),
    },
    createOperationColumn<ReportFillTemplate>({
      width: 210,
      desktopInlineKeys: ['entry', 'edit'],
      actions: (record) => [
        {
          key: 'entry',
          label: '填报入口',
          hidden: record.status !== 'published' || !hasPermission('report:fill:record:create'),
          onClick: () => navigate(`/report/fill/${encodeURIComponent(record.code)}`, { state: { tabTitle: `填报·${record.name}` } }),
        },
        {
          key: 'edit',
          label: '设计',
          hidden: !hasPermission('report:fill:template:update'),
          disabled: record.status === 'published',
          disabledReason: '请先下线模板再编辑',
          onClick: () => openEditor(record),
        },
        {
          key: 'publish',
          label: '发布',
          hidden: !hasPermission('report:fill:template:publish') || record.status === 'published',
          onClick: () => void changeLifecycle(record, 'publish'),
        },
        {
          key: 'offline',
          label: '下线',
          hidden: !hasPermission('report:fill:template:publish') || record.status !== 'published',
          onClick: () => void changeLifecycle(record, 'offline'),
        },
        {
          key: 'clone',
          label: '克隆',
          hidden: !hasPermission('report:fill:template:clone'),
          onClick: () => cloneModal.openEdit(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('report:fill:template:delete'),
          disabled: record.status === 'published',
          disabledReason: '请先下线模板再删除',
          onClick: () => {
            confirmDelete({
              title: `删除模板「${record.name}」？`,
              content: '已有填报记录的模板不能删除。',
              onOk: async () => {
                await deleteMutation.mutateAsync({ params: { id: record.id } });
                Toast.success('模板已删除');
              },
            });
          },
        },
      ],
    }),
  ];

  const keywordInput = (
    <KeywordInput placeholder="搜索模板名称/编码" value={draft.keyword} onChange={(value) => setDraft((current) => ({ ...current, keyword: value }))} onSearch={handleSearch} />
  );
  const filters = (
    <>
      <StatusSelect
        items={REPORT_FILL_TEMPLATE_STATUS_OPTIONS}
        value={draft.status}
        onChange={(value) => setDraft((current) => ({ ...current, status: value as ReportFillTemplate['status'] | undefined }))}
      />
      <FilterSelect
        placeholder="全部负责人"
        items={users.map((user) => ({ value: user.id, label: user.nickname || user.username }))}
        value={draft.ownerId}
        onChange={(value) => setDraft((current) => ({ ...current, ownerId: value }))}
        filter
        width={140}
      />
      <FilterSelect
        placeholder="全部目录"
        items={folders.map((folder) => ({ value: folder.id, label: folder.name }))}
        value={draft.folderId}
        onChange={(value) => setDraft((current) => ({ ...current, folderId: value }))}
        width={150}
        filter
      />
    </>
  );
  const editorSaving = createMutation.isPending || updateMutation.isPending;
  const editorFooter = (
    <Space>
      <Button disabled={editorSaving} onClick={editorModal.close}>取消</Button>
      {editorStep === 1 && (
        <Button disabled={editorSaving} onClick={() => setEditorStep(0)}>上一步</Button>
      )}
      <Button
        type="primary"
        loading={editorStep === 1 && editorSaving}
        onClick={() => editorStep === 0 ? void goToDesignStep() : void saveTemplate()}
      >
        {editorStep === 0 ? '下一步' : editing ? '保存修改' : '创建模板'}
      </Button>
    </Space>
  );

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {keywordInput}
            <SearchButton onClick={handleSearch} />
            <ResetButton onClick={handleReset} />
          </>
        )}
        filters={filters}
        actions={hasPermission('report:fill:template:create') ? (
          <CreateButton onClick={() => openEditor()} />
        ) : null}
        mobilePrimary={(
          <>
            {keywordInput}
            <SearchButton onClick={handleSearch} />
            {hasPermission('report:fill:template:create') && (
              <CreateButton onClick={() => openEditor()} />
            )}
          </>
        )}
        mobileFilters={filters}
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />
      <ConfigurableTable
        bordered
        rowKey="id"
        columns={columns}
        dataSource={templates}
        loading={listQuery.isFetching}
        pagination={buildPagination(listQuery.data?.total ?? 0)}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        columnSettingsKey="report-fill-templates"
      />

      <SideSheet
        title={editing ? `设计填报模板 · ${editing.name}` : '新增填报模板'}
        visible={editorModal.visible}
        placement="right"
        width={editorStep === 0 ? 760 : 'min(1280px, 95vw)'}
        bodyStyle={{
          padding: 16,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: editorStep === 0 ? 'auto' : 'hidden',
        }}
        onCancel={editorModal.close}
        footer={editorFooter}
        closeOnEsc
      >
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Steps type="basic" size="small" current={editorStep} style={{ flexShrink: 0 }}>
            <Steps.Step title="基本信息" description="配置模板属性与审核方式" />
            <Steps.Step title="字段设计" description="设计表单并预览效果" />
          </Steps>
          {conflictMessage && <Banner type="danger" closeIcon={null} description={conflictMessage} />}
          {editorStep === 0 ? (
            <Form
              key={editorModal.formKey} {...editorModal.formProps}
              initValues={editorBasicValues}
            >
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Input
                    field="code"
                    label="模板编码"
                    disabled={editorModal.isEdit}
                    rules={[{ required: true, message: '请输入模板编码' }]}
                    placeholder="字母开头，可含数字和下划线"
                  />
                </Col>
                <Col xs={24} md={12}>
                  <Form.Input field="name" label="模板名称" rules={[{ required: true, message: '请输入模板名称' }]} />
                </Col>
                <Col xs={24} md={12}>
                  <Form.Select
                    field="ownerId"
                    label="负责人"
                    filter
                    showClear
                    style={{ width: '100%' }}
                    optionList={users.map((user) => ({ value: user.id, label: user.nickname || user.username }))}
                  />
                </Col>
                <Col xs={24} md={12}>
                  <Form.Select
                    field="folderId"
                    label="资源目录"
                    filter
                    showClear
                    style={{ width: '100%' }}
                    optionList={folders.map((folder) => ({ value: folder.id, label: folder.name }))}
                  />
                </Col>
                <Col xs={24} md={12}>
                  <Form.Switch field="needReview" label="需要审核" />
                </Col>
                <Col xs={24} md={12}>
                  <Form.Select
                    field="workflowDefinitionId"
                    label="审核流程"
                    placeholder="可选：外部业务工作流"
                    style={{ width: '100%' }}
                    optionList={definitions.map((definition) => ({ value: definition.id, label: definition.name }))}
                    extraText="仅在开启“需要审核”时生效"
                    showClear
                  />
                </Col>
              </Row>
              <Form.TextArea field="description" label="模板说明" maxCount={1000} rows={3} />
            </Form>
          ) : (
            <Tabs
              collapsible="auto"
              type="line"
              activeKey={editorTab}
              onChange={setEditorTab}
              className="tabs-fill-height"
              style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
              contentStyle={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
            >
              <TabPane tab="字段设计" itemKey="designer" style={{ height: '100%' }}>
                <div style={{ height: '100%', minHeight: 0 }}>
                  <FormDesigner
                    fields={fields}
                    onChange={setFields}
                    settings={settings}
                    onSettingsChange={setSettings}
                  />
                </div>
              </TabPane>
              <TabPane tab={<Space><Eye size={14} />预览</Space>} itemKey="preview" style={{ height: '100%', overflow: 'auto' }}>
                {fields.length ? (
                  <WorkflowFormRenderer
                    fields={fields}
                    labelPosition={settings.labelPosition}
                    labelAlign={settings.labelAlign}
                    labelWidth={settings.labelWidth}
                    style={{ padding: 16 }}
                  />
                ) : (
                  <Banner type="warning" closeIcon={null} description="请先添加至少一个表单字段。" />
                )}
              </TabPane>
            </Tabs>
          )}
        </div>
      </SideSheet>

      <AppModal
        {...cloneModal.modalProps}
        title={`克隆模板 · ${cloneModal.editing?.name ?? ''}`}
        width={520}
      >
        <Form key={cloneModal.formKey} {...cloneModal.formProps}>
          <Form.Input field="name" label="模板名称" prefix={<Copy size={14} />} rules={[{ required: true, message: '请输入名称' }]} />
          <Form.Input field="code" label="模板编码" rules={[{ required: true, message: '请输入编码' }]} />
          <Form.Select
            field="folderId"
            label="资源目录"
            showClear
            filter
            style={{ width: '100%' }}
            optionList={folders.map((folder) => ({ value: folder.id, label: folder.name }))}
          />
        </Form>
      </AppModal>
    </div>
  );
}
