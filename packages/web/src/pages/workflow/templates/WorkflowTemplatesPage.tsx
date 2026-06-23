import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Col, Form, Input, Popconfirm, Row, Space, Tag, Toast } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { LayoutTemplate, RotateCcw, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { WorkflowTemplate, WorkflowDefinition } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { usePermission } from '@/hooks/usePermission';
import { renderEllipsis } from '@/utils/table-columns';

interface FormValues extends Record<string, unknown> {
  name?: string;
  code?: string;
  description?: string;
  categoryName?: string;
  icon?: string;
  color?: string;
  sort?: number;
}

export default function WorkflowTemplatesPage() {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const canEdit = hasPermission('workflow:definition:edit');
  const canCreate = hasPermission('workflow:definition:create');

  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [activeKeyword, setActiveKeyword] = useState('');

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<WorkflowTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const formApi = useRef<FormApi | null>(null);
  const [cloningId, setCloningId] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<WorkflowTemplate[]>('/api/workflows/templates');
      if (res.code === 0) setTemplates(res.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    const kw = activeKeyword.trim().toLowerCase();
    if (!kw) return templates;
    return templates.filter((t) =>
      [t.name, t.code, t.description, t.categoryName]
        .some((v) => (v ?? '').toLowerCase().includes(kw)),
    );
  }, [templates, activeKeyword]);

  const handleSearch = () => setActiveKeyword(keyword);
  const handleReset = () => { setKeyword(''); setActiveKeyword(''); };

  const openEdit = (record: WorkflowTemplate) => {
    setEditing(record);
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setEditing(null);
  };

  const handleSubmit = async (values: FormValues) => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await request.put<WorkflowTemplate>(`/api/workflows/templates/${editing.id}`, {
        name: values.name,
        code: values.code?.trim() ? values.code.trim() : null,
        description: values.description?.trim() ? values.description.trim() : null,
        categoryName: values.categoryName?.trim() ? values.categoryName.trim() : null,
        icon: values.icon?.trim() ? values.icon.trim() : null,
        color: values.color?.trim() ? values.color.trim() : null,
        sort: values.sort ?? 0,
      });
      if (res.code === 0) {
        Toast.success('已更新');
        closeModal();
        void fetchData();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/workflows/templates/${id}`);
    if (res.code === 0) {
      Toast.success('已删除');
      void fetchData();
    }
  };

  const handleCloneToDefinition = async (record: WorkflowTemplate) => {
    setCloningId(record.id);
    try {
      const res = await request.post<WorkflowDefinition>(`/api/workflows/templates/${record.id}/clone`, {});
      if (res.code === 0) {
        Toast.success('已从模板创建流程');
        navigate(`/workflow/designer/${res.data.id}`);
      }
    } finally {
      setCloningId(null);
    }
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
      width: 240,
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
      width: 90,
      render: (builtin: boolean) => (
        <Tag color={builtin ? 'blue' : 'grey'}>{builtin ? '系统内置' : '自定义'}</Tag>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '操作',
      dataIndex: 'op',
      width: 240,
      fixed: 'right',
      render: (_v: unknown, record: WorkflowTemplate) => (
        <Space>
          {canCreate && (
            <Button
              theme="borderless"
              size="small"
              loading={cloningId === record.id}
              disabled={cloningId !== null}
              onClick={() => void handleCloneToDefinition(record)}
            >
              从模板新建
            </Button>
          )}
          {canEdit && (
            <Button theme="borderless" size="small" onClick={() => openEdit(record)}>
              编辑
            </Button>
          )}
          {canEdit && (
            record.builtin ? (
              <Button theme="borderless" type="danger" size="small" disabled>
                删除
              </Button>
            ) : (
              <Popconfirm title="确定要删除该模板吗？" onConfirm={() => void handleDelete(record.id)}>
                <Button theme="borderless" type="danger" size="small">
                  删除
                </Button>
              </Popconfirm>
            )
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input
          prefix={<Search size={14} />}
          placeholder="搜索名称 / 编码 / 描述"
          value={keyword}
          onChange={setKeyword}
          onEnterPress={handleSearch}
          showClear
          style={{ width: 240 }}
        />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
      </SearchToolbar>

      <ConfigurableTable<WorkflowTemplate>
        bordered
        loading={loading}
        onRefresh={() => void fetchData()}
        refreshLoading={loading}
        rowKey="id"
        dataSource={filtered}
        columns={columns}
        pagination={{ pageSize: 10 }}
      />

      <AppModal
        title="编辑模板"
        visible={modalVisible}
        onCancel={closeModal}
        onOk={() => formApi.current?.submitForm()}
        confirmLoading={saving}
        okText="保存"
        width={680}
      >
        <Form<FormValues>
          key={editing?.id ?? 'edit'}
          getFormApi={(api) => { formApi.current = api; }}
          onSubmit={handleSubmit}
          labelPosition="left"
          labelWidth={90}
          initValues={{
            name: editing?.name ?? '',
            code: editing?.code ?? '',
            description: editing?.description ?? '',
            categoryName: editing?.categoryName ?? '',
            icon: editing?.icon ?? '',
            color: editing?.color ?? '',
            sort: editing?.sort ?? 0,
          }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input
                field="name"
                label="模板名称"
                placeholder="请输入模板名称"
                rules={[{ required: true, message: '请输入模板名称' }]}
              />
            </Col>
            <Col span={12}>
              <Form.Input field="code" label="模板编码" placeholder="选填，唯一标识" />
            </Col>
            <Col span={12}>
              <Form.Input field="categoryName" label="分类" placeholder="选填" />
            </Col>
            <Col span={12}>
              <Form.InputNumber field="sort" label="排序" min={0} style={{ width: '100%' }} />
            </Col>
            <Col span={12}>
              <Form.Input field="icon" label="图标" placeholder="选填，lucide 图标名" />
            </Col>
            <Col span={12}>
              <Form.Input field="color" label="颜色" placeholder="选填，如 #1677ff" />
            </Col>
          </Row>
          <Form.TextArea field="description" label="描述" placeholder="选填" autosize rows={2} />
        </Form>
      </AppModal>
    </div>
  );
}
