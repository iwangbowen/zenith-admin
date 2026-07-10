import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Banner,
  Button,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  TabPane,
  Tabs,
  Tag,
  Toast,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Copy, Eye, Plus, RotateCcw, Search } from 'lucide-react';
import {
  REPORT_FILL_TEMPLATE_STATUS_LABELS,
  REPORT_FILL_TEMPLATE_STATUS_OPTIONS,
  type ReportFillTemplate,
  type WorkflowFormField,
  type WorkflowFormSettings,
} from '@zenith/shared';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
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
import { formatDateTime } from '@/utils/date';
import { renderEllipsis } from '@/utils/table-columns';
import FormDesigner from '@/pages/workflow/designer/components/FormDesigner';
import WorkflowFormRenderer from '@/pages/workflow/designer/components/WorkflowFormRenderer';
import { isRevisionConflict, validateFillTemplateInput } from './report-p2-utils';

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
  const [editorVisible, setEditorVisible] = useState(false);
  const [editing, setEditing] = useState<ReportFillTemplate | null>(null);
  const [fields, setFields] = useState<WorkflowFormField[]>([]);
  const [settings, setSettings] = useState<WorkflowFormSettings>(DEFAULT_SCHEMA.settings);
  const [editorTab, setEditorTab] = useState('designer');
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [cloneTarget, setCloneTarget] = useState<ReportFillTemplate | null>(null);
  const editorFormApi = useRef<FormApi | null>(null);
  const cloneFormApi = useRef<FormApi | null>(null);

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
    setEditing(template ?? null);
    setFields(template?.formSchema.fields ?? []);
    setSettings(template?.formSchema.settings ?? DEFAULT_SCHEMA.settings);
    setConflictMessage(null);
    setEditorTab('designer');
    setEditorVisible(true);
  }

  async function saveTemplate() {
    const values = await editorFormApi.current?.validate() as Record<string, unknown>;
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
          throw new Error('validation');
        }
        await updateMutation.mutateAsync({ id: editing.id, values: payload });
      } else {
        const payload = { ...base, code: String(values.code ?? '').trim() };
        const validation = validateFillTemplateInput(payload, false);
        if (!validation.success) {
          Toast.error(validation.message);
          throw new Error('validation');
        }
        await createMutation.mutateAsync(payload);
      }
      Toast.success(editing ? '模板更新成功' : '模板创建成功');
      setEditorVisible(false);
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
        id: template.id,
        values: { action, expectedRevision: template.revision },
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

  async function handleClone() {
    if (!cloneTarget) return;
    const values = await cloneFormApi.current?.validate() as Record<string, unknown>;
    await cloneMutation.mutateAsync({
      id: cloneTarget.id,
      values: {
        code: String(values.code).trim(),
        name: String(values.name).trim(),
        folderId: values.folderId ? Number(values.folderId) : null,
      },
    });
    Toast.success('模板克隆成功');
    setCloneTarget(null);
  }

  const columns: ColumnProps<ReportFillTemplate>[] = [
    { title: '模板名称', dataIndex: 'name', width: 190 },
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
    { title: '更新时间', dataIndex: 'updatedAt', width: 190, render: (value: string) => formatDateTime(value) },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right',
      render: (value: ReportFillTemplate['status']) => templateStatusTag(value),
    },
    createOperationColumn<ReportFillTemplate>({
      width: 190,
      desktopInlineKeys: ['entry', 'edit'],
      actions: (record) => [
        {
          key: 'entry',
          label: '填报入口',
          hidden: record.status !== 'published' || !hasPermission('report:fill:record:create'),
          onClick: () => navigate(`/report/fill/${encodeURIComponent(record.code)}`),
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
          onClick: () => setCloneTarget(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('report:fill:template:delete'),
          disabled: record.status === 'published',
          disabledReason: '请先下线模板再删除',
          onClick: () => {
            Modal.confirm({
              title: `删除模板「${record.name}」？`,
              content: '已有填报记录的模板不能删除。',
              onOk: async () => {
                await deleteMutation.mutateAsync(record.id);
                Toast.success('模板已删除');
              },
            });
          },
        },
      ],
    }),
  ];

  const keywordInput = (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索模板名称/编码"
      value={draft.keyword}
      onChange={(value) => setDraft((current) => ({ ...current, keyword: value }))}
      onEnterPress={handleSearch}
      showClear
      style={{ width: 220 }}
    />
  );
  const filters = (
    <>
      <Select
        placeholder="全部状态"
        value={draft.status}
        optionList={REPORT_FILL_TEMPLATE_STATUS_OPTIONS}
        onChange={(value) => setDraft((current) => ({ ...current, status: value as ReportFillTemplate['status'] }))}
        showClear
        style={{ width: 120 }}
      />
      <Select
        placeholder="全部负责人"
        value={draft.ownerId}
        optionList={users.map((user) => ({ value: user.id, label: user.nickname || user.username }))}
        onChange={(value) => setDraft((current) => ({ ...current, ownerId: value ? Number(value) : undefined }))}
        filter
        showClear
        style={{ width: 140 }}
      />
      <Select
        placeholder="全部目录"
        value={draft.folderId}
        optionList={folders.map((folder) => ({ value: folder.id, label: folder.name }))}
        onChange={(value) => setDraft((current) => ({ ...current, folderId: value ? Number(value) : undefined }))}
        filter
        showClear
        style={{ width: 150 }}
      />
    </>
  );

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {keywordInput}
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          </>
        )}
        filters={filters}
        actions={hasPermission('report:fill:template:create') ? (
          <Button type="primary" icon={<Plus size={14} />} onClick={() => openEditor()}>新增</Button>
        ) : null}
        mobilePrimary={(
          <>
            {keywordInput}
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            {hasPermission('report:fill:template:create') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={() => openEditor()}>新增</Button>
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
        scroll={{ x: 1250 }}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        columnSettingsKey="report-fill-templates"
      />

      <AppModal
        title={editing ? `设计填报模板 · ${editing.name}` : '新增填报模板'}
        visible={editorVisible}
        width={1080}
        bodyStyle={{ height: '70vh', overflow: 'hidden' }}
        onCancel={() => setEditorVisible(false)}
        onOk={() => void saveTemplate()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {conflictMessage && <Banner type="danger" closeIcon={null} description={conflictMessage} />}
          <Form
            key={editing?.id ?? 'new'}
            labelPosition="left"
            labelWidth={90}
            initValues={editing ? {
              code: editing.code,
              name: editing.name,
              description: editing.description,
              ownerId: editing.ownerId,
              folderId: editing.folderId,
              needReview: editing.needReview,
              workflowDefinitionId: editing.workflowDefinitionId,
            } : { needReview: false }}
            getFormApi={(api) => { editorFormApi.current = api; }}
          >
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input
                  field="code"
                  label="模板编码"
                  disabled={Boolean(editing)}
                  rules={[{ required: true, message: '请输入模板编码' }]}
                  placeholder="字母开头，可含数字和下划线"
                />
              </Col>
              <Col span={12}>
                <Form.Input field="name" label="模板名称" rules={[{ required: true, message: '请输入模板名称' }]} />
              </Col>
              <Col span={12}>
                <Form.Select
                  field="ownerId"
                  label="负责人"
                  filter
                  showClear
                  optionList={users.map((user) => ({ value: user.id, label: user.nickname || user.username }))}
                />
              </Col>
              <Col span={12}>
                <Form.Select
                  field="folderId"
                  label="资源目录"
                  filter
                  showClear
                  optionList={folders.map((folder) => ({ value: folder.id, label: folder.name }))}
                />
              </Col>
              <Col span={12}>
                <Form.Switch field="needReview" label="需要审核" />
              </Col>
              <Col span={12}>
                <Form.Select
                  field="workflowDefinitionId"
                  label="审核流程"
                  placeholder="可选：外部业务工作流"
                  optionList={definitions.map((definition) => ({ value: definition.id, label: definition.name }))}
                  extraText="仅在开启“需要审核”时生效"
                  showClear
                />
              </Col>
            </Row>
            <Form.TextArea field="description" label="模板说明" maxCount={1000} rows={2} />
          </Form>
          <Tabs
            type="line"
            activeKey={editorTab}
            onChange={setEditorTab}
            style={{ flex: 1, minHeight: 0 }}
            contentStyle={{ height: 'calc(100% - 46px)', overflow: 'hidden' }}
          >
            <TabPane tab="字段设计" itemKey="designer" style={{ height: '100%' }}>
              <div style={{ height: '100%', minHeight: 340 }}>
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
        </div>
      </AppModal>

      <AppModal
        title={`克隆模板 · ${cloneTarget?.name ?? ''}`}
        visible={Boolean(cloneTarget)}
        width={520}
        onCancel={() => setCloneTarget(null)}
        onOk={() => void handleClone()}
        confirmLoading={cloneMutation.isPending}
      >
        <Form
          key={cloneTarget?.id}
          labelPosition="left"
          labelWidth={90}
          initValues={{
            name: cloneTarget ? `${cloneTarget.name} 副本` : '',
            code: cloneTarget ? `${cloneTarget.code}_copy` : '',
            folderId: cloneTarget?.folderId,
          }}
          getFormApi={(api) => { cloneFormApi.current = api; }}
        >
          <Form.Input field="name" label="模板名称" prefix={<Copy size={14} />} rules={[{ required: true, message: '请输入名称' }]} />
          <Form.Input field="code" label="模板编码" rules={[{ required: true, message: '请输入编码' }]} />
          <Form.Select
            field="folderId"
            label="资源目录"
            showClear
            filter
            optionList={folders.map((folder) => ({ value: folder.id, label: folder.name }))}
          />
        </Form>
      </AppModal>
    </div>
  );
}
