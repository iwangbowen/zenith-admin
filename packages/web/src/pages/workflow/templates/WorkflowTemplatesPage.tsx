import { useMemo, useState } from 'react';
import { Space, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { LayoutTemplate } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { WorkflowTemplate } from '@zenith/shared/workflow';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { KeywordInput } from '@/components/search-filters';
import WorkflowTemplateFormModal, { type WorkflowTemplateFormValues } from '../components/WorkflowTemplateFormModal';
import {
  useCloneWorkflowTemplate,
  useDeleteWorkflowTemplate,
  useUpdateWorkflowTemplate,
  useWorkflowTemplates,
  workflowTemplateKeys,
} from '@/hooks/queries/workflow-templates';

export default function WorkflowTemplatesPage() {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const canEdit = hasPermission('workflow:definition:edit');
  const canCreate = hasPermission('workflow:definition:create');

  // 全量模板在客户端过滤：只取草稿 / 已提交双状态与「查询 / 重置必回源」
  const { bindKeyword, submittedParams, handleSearch, handleReset } = useListSearch<{ keyword: string }>({
    defaults: { keyword: '' },
    listKey: workflowTemplateKeys.lists,
  });

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<WorkflowTemplate | null>(null);
  const templatesQuery = useWorkflowTemplates();
  const updateMutation = useUpdateWorkflowTemplate();
  const deleteMutation = useDeleteWorkflowTemplate();
  const cloneMutation = useCloneWorkflowTemplate();
  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);
  const saving = updateMutation.isPending;
  const cloningId = cloneMutation.isPending ? (cloneMutation.variables?.params.id ?? null) : null;

  const filtered = useMemo(() => {
    const kw = submittedParams.keyword.trim().toLowerCase();
    if (!kw) return templates;
    return templates.filter((t) =>
      [t.name, t.code, t.description, t.categoryName]
        .some((v) => (v ?? '').toLowerCase().includes(kw)),
    );
  }, [templates, submittedParams.keyword]);

  const openEdit = (record: WorkflowTemplate) => {
    setEditing(record);
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setEditing(null);
  };

  const handleSubmit = async (values: WorkflowTemplateFormValues) => {
    if (!editing) return;
    await updateMutation.mutateAsync({
      params: { id: editing.id },
      body: {
        name: values.name,
        code: values.code?.trim() ? values.code.trim() : null,
        description: values.description?.trim() ? values.description.trim() : null,
        categoryName: values.categoryName?.trim() ? values.categoryName.trim() : null,
        icon: values.icon?.trim() ? values.icon.trim() : null,
        color: values.color?.trim() ? values.color.trim() : null,
        sort: values.sort ?? 0,
      },
    });
    Toast.success('已更新');
    closeModal();
  };


  const handleCloneToDefinition = async (record: WorkflowTemplate) => {
    const res = await cloneMutation.mutateAsync({ params: { id: record.id }, body: {} });
    Toast.success('已从模板创建流程');
    navigate(`/workflow/designer/${res.id}`);
  };

  const columns: ColumnProps<WorkflowTemplate>[] = [
    {
      title: '模板名称',
      dataIndex: 'name',
      width: 220,
      render: (name: string, record: WorkflowTemplate) => (
        <Space spacing={8} align="center">
          {record.color ? (
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: record.color, flexShrink: 0 }} />
          ) : (
            <LayoutTemplate size={14} style={{ color: 'var(--semi-color-primary)', flexShrink: 0 }} />
          )}
          <span>{name}</span>
        </Space>
      ),
    },
    {
      title: '编码',
      dataIndex: 'code',
      width: 140,
      render: (v: string | null) => v || <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>,
    },
    {
      title: '分类',
      dataIndex: 'categoryName',
      width: 120,
      render: (v: string | null) => v || <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>,
    },
    {
      title: '描述',
      dataIndex: 'description',
      minWidth: 240,
      render: renderEllipsis,
    },
    {
      title: '排序',
      dataIndex: 'sort',
      width: 70,
    },
    {
      title: '来源',
      dataIndex: 'builtin',
      width: 100,
      render: (builtin: boolean) => (
        <Tag color={builtin ? 'blue' : 'grey'}>{builtin ? '系统内置' : '自定义'}</Tag>
      ),
    },
    dateTimeColumn('更新时间', 'updatedAt'),
    createOperationColumn<WorkflowTemplate>({
      width: 250,
      desktopInlineKeys: ['clone', 'edit', 'delete'],
      actions: (record) => [
        {
          key: 'clone',
          label: '从模板新建',
          hidden: !canCreate,
          loading: cloningId === record.id,
          disabled: cloningId !== null,
          onClick: () => void handleCloneToDefinition(record),
        },
        {
          key: 'edit',
          label: '编辑',
          hidden: !canEdit,
          onClick: () => openEdit(record),
        },
        deleteAction({
          hidden: !canEdit,
          disabled: record.builtin,
          disabledReason: '系统内置模板不可删除',
          title: '确定要删除该模板吗？',
          run: () => deleteMutation.mutateAsync({ params: { id: record.id } }),
          successMessage: '已删除',
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索名称 / 编码 / 描述" {...bindKeyword('keyword')} width={240} />}
        onSearch={handleSearch}
        onReset={handleReset}
      />

      <ConfigurableTable<WorkflowTemplate>
        columns={columns}
        {...listTableProps({ ...templatesQuery, data: filtered })}
        pagination={{ pageSize: 10 }}
      />

      <WorkflowTemplateFormModal
        title="编辑模板"
        visible={modalVisible}
        formKey={editing?.id ?? 'edit'}
        showCategorySort
        confirmLoading={saving}
        onCancel={closeModal}
        onSubmit={handleSubmit}
        initValues={{
          name: editing?.name ?? '',
          code: editing?.code ?? '',
          description: editing?.description ?? '',
          categoryName: editing?.categoryName ?? '',
          icon: editing?.icon ?? '',
          color: editing?.color ?? '',
          sort: editing?.sort ?? 0,
        }}
      />
    </div>
  );
}
