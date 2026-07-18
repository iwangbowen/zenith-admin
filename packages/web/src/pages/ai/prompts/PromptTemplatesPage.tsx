import { useRef, useState } from 'react';
import { Button, Col, Form, Input, Modal, Row, Select, SideSheet, Space, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Plus, RotateCcw, Search } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { AiPromptTemplate, AiPromptScope, CreateAiPromptTemplateInput } from '@zenith/shared';
import { AppModal } from '@/components/AppModal';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import {
  aiPromptKeys,
  useAiPromptDetail,
  useAiPromptList,
  useDeleteAiPrompt,
  useSaveAiPrompt,
} from '@/hooks/queries/ai-prompts';
import { useAiPromptVersions, useRestoreAiPromptVersion } from '@/hooks/queries/ai-extras';

interface SearchParams {
  keyword: string;
  scope: AiPromptScope | '';
}

interface PromptTemplateFormValues {
  name: string;
  content: string;
  description?: string | null;
  category?: string | null;
  scope: AiPromptScope;
  sort: number;
  isEnabled: boolean;
}

const defaultSearchParams: SearchParams = { keyword: '', scope: '' };

const scopeFormOptions = [
  { value: 'system', label: '系统级' },
  { value: 'user', label: '用户私有' },
];

const scopeSearchOptions = [{ value: '', label: '全部' }, ...scopeFormOptions];

function scopeTag(scope: AiPromptScope) {
  return scope === 'system'
    ? <Tag color="blue" size="small">系统级</Tag>
    : <Tag color="green" size="small">用户私有</Tag>;
}

function statusTag(enabled: boolean) {
  return enabled
    ? <Tag color="green" size="small">启用</Tag>
    : <Tag color="grey" size="small">禁用</Tag>;
}

function normalizeNullable(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text : null;
}

export default function PromptTemplatesPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi | null>(null);
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const [versionTemplate, setVersionTemplate] = useState<AiPromptTemplate | null>(null);
  const versionsQuery = useAiPromptVersions(versionTemplate?.id ?? null);
  const restoreVersionMutation = useRestoreAiPromptVersion();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<AiPromptTemplate | null>(null);
  const listQuery = useAiPromptList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    scope: submittedParams.scope || undefined,
  });
  const data = listQuery.data ?? null;
  const detailQuery = useAiPromptDetail(editingTemplate?.id, modalVisible);
  const editing = editingTemplate ? (detailQuery.data ?? editingTemplate) : null;
  const modalDetailLoading = !!editingTemplate && detailQuery.isFetching;
  const saveMutation = useSaveAiPrompt();
  const deleteMutation = useDeleteAiPrompt();

  function handleSearch() {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: aiPromptKeys.lists });
  }

  function handleReset() {
    setPage(1);
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    void queryClient.invalidateQueries({ queryKey: aiPromptKeys.lists });
  }

  function openCreate() {
    setEditingTemplate(null);
    setModalVisible(true);
  }

  function openEdit(record: AiPromptTemplate) {
    setEditingTemplate(record);
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    setEditingTemplate(null);
  }

  const formInitValues: PromptTemplateFormValues = editing
    ? {
        name: editing.name,
        content: editing.content,
        description: editing.description ?? '',
        category: editing.category ?? '',
        scope: editing.scope,
        sort: editing.sort,
        isEnabled: editing.isEnabled,
      }
    : {
        name: '',
        content: '',
        description: '',
        category: '',
        scope: 'system',
        sort: 0,
        isEnabled: true,
      };

  async function handleModalOk() {
    let values: PromptTemplateFormValues;
    try {
      values = (await formApi.current?.validate()) as PromptTemplateFormValues;
    } catch {
      throw new Error('validation');
    }

    const payload: CreateAiPromptTemplateInput = {
      name: values.name.trim(),
      content: values.content.trim(),
      description: normalizeNullable(values.description),
      category: normalizeNullable(values.category),
      scope: values.scope ?? 'system',
      sort: Number(values.sort ?? 0),
      isEnabled: Boolean(values.isEnabled),
    };

    await saveMutation.mutateAsync({ id: editingTemplate?.id, values: payload });
    Toast.success(editingTemplate ? '更新成功' : '创建成功');
    closeModal();
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  }

  const columns: ColumnProps<AiPromptTemplate>[] = [
    { title: '名称', dataIndex: 'name', width: 180, render: renderEllipsis },
    { title: '分类', dataIndex: 'category', width: 120, render: renderEllipsis },
    { title: '范围', dataIndex: 'scope', width: 100, render: (scope: AiPromptScope) => scopeTag(scope) },
    { title: '内容', dataIndex: 'content', width: 360, render: renderEllipsis },
    { title: '使用次数', dataIndex: 'usageCount', width: 90 },
    { title: '排序', dataIndex: 'sort', width: 80 },
    createdAtColumn as ColumnProps<AiPromptTemplate>,
    {
      title: '状态',
      dataIndex: 'isEnabled',
      width: 90,
      fixed: 'right',
      render: (enabled: boolean) => statusTag(enabled),
    },
    createOperationColumn<AiPromptTemplate>({
      width: 180,
      desktopInlineKeys: ['edit', 'versions', 'delete'],
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('ai:prompt:edit'),
          onClick: () => openEdit(record),
        },
        {
          key: 'versions',
          label: '版本',
          onClick: () => setVersionTemplate(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('ai:prompt:delete') || record.isBuiltin,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该提示词模板吗？',
              content: '删除后不可恢复',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索名称/描述"
      value={draftParams.keyword}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, keyword: String(value ?? '') }))}
      onEnterPress={handleSearch}
      showClear
      style={{ width: 220 }}
    />
  );

  const renderScopeFilter = () => (
    <Select
      value={draftParams.scope}
      optionList={scopeSearchOptions}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, scope: (value as AiPromptScope | undefined) ?? '' }))}
      showClear
      style={{ width: 140 }}
    />
  );

  const renderSearchButton = () => (
    <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>
      查询
    </Button>
  );

  const renderResetButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>
      重置
    </Button>
  );

  const renderCreateButton = () => hasPermission('ai:prompt:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>
      新增
    </Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderScopeFilter()}
            {renderSearchButton()}
            {renderResetButton()}
          </>
        )}
        actions={renderCreateButton()}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={renderScopeFilter()}
        filterTitle="提示词筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无提示词模板"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(data?.total ?? 0)}
      />

      <AppModal
        title={editing ? '编辑提示词模板' : '新增提示词模板'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ loading: saveMutation.isPending, disabled: modalDetailLoading }}
        width={660}
        closeOnEsc
      >
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
          <Form
            key={editing?.id ?? 'new'}
            getFormApi={(api) => {
              formApi.current = api;
            }}
            initValues={formInitValues}
            labelPosition="left"
            labelWidth={90}
          >
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="name" label="名称" placeholder="请输入名称" rules={[{ required: true, message: '请输入名称' }]} />
              </Col>
              <Col span={12}>
                <Form.Input field="category" label="分类" placeholder="请输入分类" />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Select
                  field="scope"
                  label="范围"
                  optionList={scopeFormOptions}
                  style={{ width: '100%' }}
                  rules={[{ required: true, message: '请选择范围' }]}
                />
              </Col>
              <Col span={12}>
                <Form.InputNumber field="sort" label="排序" min={0} style={{ width: '100%' }} />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Switch field="isEnabled" label="启用" />
              </Col>
            </Row>
            <Form.Input field="description" label="描述" placeholder="请输入描述（可选）" maxLength={300} />
            <Form.TextArea
              field="content"
              label="内容"
              rows={6}
              style={{ width: '100%' }}
              placeholder="请输入提示词内容，支持 {{变量}} 占位符（应用时弹出表单填充，如：请把以下内容翻译成{{目标语言}}）"
              rules={[{ required: true, message: '请输入提示词内容' }]}
            />
          </Form>
        </Spin>
      </AppModal>
      <SideSheet
        title={`版本历史 — ${versionTemplate?.name ?? ''}`}
        visible={versionTemplate !== null}
        onCancel={() => setVersionTemplate(null)}
        width={560}
      >
        {versionsQuery.isLoading ? (
          <Spin style={{ margin: '48px auto', display: 'block' }} />
        ) : (versionsQuery.data ?? []).length === 0 ? (
          <Typography.Text type="tertiary">暂无历史版本（编辑内容保存后自动留档）</Typography.Text>
        ) : (
          <Space vertical align="start" style={{ width: '100%' }} spacing={12}>
            {(versionsQuery.data ?? []).map((v) => (
              <div key={v.id} style={{ width: '100%', padding: 12, borderRadius: 'var(--semi-border-radius-medium)', border: '1px solid var(--semi-color-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Space>
                    <Tag color="blue" size="small">v{v.version}</Tag>
                    <Typography.Text type="tertiary" size="small">{v.creatorName ?? '—'} · {v.createdAt}</Typography.Text>
                  </Space>
                  {hasPermission('ai:prompt:edit') && (
                    <Button
                      theme="borderless"
                      size="small"
                      loading={restoreVersionMutation.isPending}
                      onClick={() => {
                        Modal.confirm({
                          title: `恢复到 v${v.version}？`,
                          content: '当前内容会自动留档为新版本',
                          onOk: async () => {
                            await restoreVersionMutation.mutateAsync({ templateId: versionTemplate!.id, versionId: v.id });
                            Toast.success('已恢复');
                            void queryClient.invalidateQueries({ queryKey: aiPromptKeys.all });
                          },
                        });
                      }}
                    >恢复此版本</Button>
                  )}
                </div>
                <Typography.Paragraph
                  style={{ fontSize: 13, whiteSpace: 'pre-wrap', margin: 0 }}
                  ellipsis={{ rows: 6, expandable: true, collapsible: true, collapseText: '收起', expandText: '展开' }}
                >
                  {v.content}
                </Typography.Paragraph>
              </div>
            ))}
          </Space>
        )}
      </SideSheet>
    </div>
  );
}
