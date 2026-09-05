import { useState } from 'react';
import { Button, Col, Form, Modal, Row, SideSheet, Space, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { useQueryClient } from '@tanstack/react-query';
import type { AiPromptTemplate, AiPromptScope, CreateAiPromptTemplateInput } from '@zenith/shared/ai';
import { AppModal } from '@/components/AppModal';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePermission } from '@/hooks/usePermission';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import {
  aiPromptKeys,
  useAiPromptDetail,
  useAiPromptList,
  useDeleteAiPrompts,
  useSaveAiPrompt,
} from '@/hooks/queries/ai-prompts';
import { useAiPromptVersions, useRestoreAiPromptVersion } from '@/hooks/queries/ai-extras';
import { useListSearch } from '@/hooks/useListSearch';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { useEditModal } from '@/hooks/useEditModal';

interface SearchParams {
  keyword: string;
  scope?: AiPromptScope;
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

const defaultSearchParams: SearchParams = { keyword: '', scope: undefined };

const scopeFormOptions = [
  { value: 'system', label: '系统级' },
  { value: 'user', label: '用户私有' },
];

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
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: aiPromptKeys.lists });
  const [versionTemplate, setVersionTemplate] = useState<AiPromptTemplate | null>(null);
  const versionsQuery = useAiPromptVersions(versionTemplate?.id ?? null);
  const restoreVersionMutation = useRestoreAiPromptVersion();
  const listQuery = useAiPromptList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    scope: submittedParams.scope || undefined,
  });
  const data = listQuery.data ?? null;
  const saveMutation = useSaveAiPrompt();
  const deleteMutation = useDeleteAiPrompts();

  const promptModal = useEditModal<AiPromptTemplate, PromptTemplateFormValues, CreateAiPromptTemplateInput>({
    entityName: '提示词模板',
    save: saveMutation,
    useDetail: useAiPromptDetail,
    defaults: { name: '', content: '', description: '', category: '', scope: 'system', sort: 0, isEnabled: true },
    toValues: (record) => ({
      name: record.name, content: record.content, description: record.description ?? '', category: record.category ?? '',
      scope: record.scope, sort: record.sort, isEnabled: record.isEnabled,
    }),
    beforeSave: (values) => ({
      name: values.name.trim(),
      content: values.content.trim(),
      description: normalizeNullable(values.description),
      category: normalizeNullable(values.category),
      scope: values.scope ?? 'system',
      sort: Number(values.sort ?? 0),
      isEnabled: Boolean(values.isEnabled),
    }),
  });
  const openEdit = promptModal.openEdit;

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync([id]);
    Toast.success('删除成功');
  }

  const columns: ColumnProps<AiPromptTemplate>[] = [
    { title: '名称', dataIndex: 'name', width: 180, render: renderEllipsis },
    { title: '分类', dataIndex: 'category', width: 120, render: renderEllipsis },
    { title: '范围', dataIndex: 'scope', width: 100, render: (scope: AiPromptScope) => scopeTag(scope) },
    { title: '内容', dataIndex: 'content', minWidth: 360, render: renderEllipsis },
    { title: '使用次数', dataIndex: 'usageCount', width: 90, align: 'right' },
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
      width: 210,
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
            confirmDelete({
              title: '确定要删除该提示词模板吗？',
              content: '删除后不可恢复',
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="搜索名称/描述" value={draftParams.keyword} onChange={(value) => setDraftParams((prev) => ({ ...prev, keyword: String(value ?? '') }))} onSearch={handleSearch} />
  );

  const renderScopeFilter = () => (
    <FilterSelect
      placeholder="全部作用域"
      items={scopeFormOptions}
      value={draftParams.scope}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, scope: value as AiPromptScope | undefined }))}
      width={140}
    />
  );

  const renderSearchButton = () => (
    <SearchButton onClick={handleSearch} />
  );

  const renderResetButton = () => (
    <ResetButton onClick={handleReset} />
  );

  const renderCreateButton = () => hasPermission('ai:prompt:create') ? (
    <CreateButton onClick={promptModal.openCreate} />
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
        {...promptModal.modalProps}
        width={660}
        closeOnEsc
      >
        <Spin spinning={promptModal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form
            key={promptModal.formKey} {...promptModal.formProps}
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
                            await restoreVersionMutation.mutateAsync({ params: { id: versionTemplate!.id, versionId: v.id } });
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
