import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Col, Form, Input, Popconfirm, Row, Select, Space, Spin, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type { AiPromptTemplate, AiPromptScope, CreateAiPromptTemplateInput, PaginatedResponse } from '@zenith/shared';
import { AppModal } from '@/components/AppModal';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { request } from '@/utils/request';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';

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
  const formApi = useRef<FormApi | null>(null);
  const [data, setData] = useState<PaginatedResponse<AiPromptTemplate> | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<AiPromptTemplate | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [modalDetailLoading, setModalDetailLoading] = useState(false);

  searchParamsRef.current = searchParams;

  const fetchTemplates = useCallback(
    async (p = page, ps = pageSize, params?: SearchParams) => {
      const activeParams = params ?? searchParamsRef.current;
      setLoading(true);
      try {
        const queryObj: Record<string, string> = {
          page: String(p),
          pageSize: String(ps),
        };
        if (activeParams.keyword) queryObj.keyword = activeParams.keyword;
        if (activeParams.scope) queryObj.scope = activeParams.scope;
        const query = new URLSearchParams(queryObj).toString();
        const res = await request.get<PaginatedResponse<AiPromptTemplate>>(`/api/ai/prompt-templates?${query}`);
        if (res.code === 0) {
          setData(res.data);
          setPage(res.data.page);
          setPageSize(res.data.pageSize);
        }
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, pageSize],
  );

  useEffect(() => {
    void fetchTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearch() {
    setPage(1);
    void fetchTemplates(1, pageSize);
  }

  function handleReset() {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchTemplates(1, pageSize, defaultSearchParams);
  }

  function openCreate() {
    setEditingTemplate(null);
    setModalVisible(true);
  }

  async function openEdit(record: AiPromptTemplate) {
    setEditingTemplate(record);
    setModalVisible(true);
    setModalDetailLoading(true);
    try {
      const res = await request.get<AiPromptTemplate>(`/api/ai/prompt-templates/${record.id}`);
      if (res.code === 0 && res.data) {
        setEditingTemplate(res.data);
      } else {
        Toast.error(res.message || '获取模板详情失败');
      }
    } finally {
      setModalDetailLoading(false);
    }
  }

  function closeModal() {
    setModalVisible(false);
    setEditingTemplate(null);
    setModalDetailLoading(false);
  }

  const formInitValues: PromptTemplateFormValues = editingTemplate
    ? {
        name: editingTemplate.name,
        content: editingTemplate.content,
        description: editingTemplate.description ?? '',
        category: editingTemplate.category ?? '',
        scope: editingTemplate.scope,
        sort: editingTemplate.sort,
        isEnabled: editingTemplate.isEnabled,
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

    setSubmitting(true);
    try {
      const res = editingTemplate
        ? await request.put<AiPromptTemplate>(`/api/ai/prompt-templates/${editingTemplate.id}`, payload)
        : await request.post<AiPromptTemplate>('/api/ai/prompt-templates', payload);
      if (res.code === 0) {
        Toast.success(editingTemplate ? '更新成功' : '创建成功');
        closeModal();
        void fetchTemplates();
      } else {
        throw new Error(res.message || '保存失败');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: number) {
    const res = await request.delete<null>(`/api/ai/prompt-templates/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchTemplates();
    }
  }

  const columns: ColumnProps<AiPromptTemplate>[] = [
    { title: '名称', dataIndex: 'name', width: 180, render: renderEllipsis },
    { title: '分类', dataIndex: 'category', width: 120, render: renderEllipsis },
    { title: '范围', dataIndex: 'scope', width: 100, render: (scope: AiPromptScope) => scopeTag(scope) },
    { title: '内容', dataIndex: 'content', width: 360, render: renderEllipsis },
    { title: '排序', dataIndex: 'sort', width: 80 },
    createdAtColumn as ColumnProps<AiPromptTemplate>,
    {
      title: '状态',
      dataIndex: 'isEnabled',
      width: 90,
      fixed: 'right',
      render: (enabled: boolean) => statusTag(enabled),
    },
    {
      title: '操作',
      dataIndex: 'operation',
      width: 150,
      fixed: 'right',
      render: (_: unknown, record) => (
        <Space>
          {hasPermission('ai:prompt:edit') && (
            <Button theme="borderless" size="small" onClick={() => void openEdit(record)}>
              编辑
            </Button>
          )}
          {hasPermission('ai:prompt:delete') && !record.isBuiltin && (
            <Popconfirm title="确定要删除该提示词模板吗？" content="删除后不可恢复" onConfirm={() => void handleDelete(record.id)}>
              <Button theme="borderless" type="danger" size="small">
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索名称/描述"
      value={searchParams.keyword}
      onChange={(value) => setSearchParams((prev) => ({ ...prev, keyword: String(value ?? '') }))}
      onEnterPress={handleSearch}
      showClear
      style={{ width: 220 }}
    />
  );

  const renderScopeFilter = () => (
    <Select
      value={searchParams.scope}
      optionList={scopeSearchOptions}
      onChange={(value) => setSearchParams((prev) => ({ ...prev, scope: (value as AiPromptScope | undefined) ?? '' }))}
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
        loading={loading}
        rowKey="id"
        size="small"
        empty="暂无提示词模板"
        onRefresh={() => void fetchTemplates()}
        refreshLoading={loading}
        pagination={buildPagination(data?.total ?? 0, fetchTemplates)}
      />

      <AppModal
        title={editingTemplate ? '编辑提示词模板' : '新增提示词模板'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ loading: submitting, disabled: modalDetailLoading }}
        width={660}
        closeOnEsc
      >
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
          <Form
            key={editingTemplate?.id ?? 'new'}
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
              placeholder="请输入提示词内容"
              rules={[{ required: true, message: '请输入提示词内容' }]}
            />
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
