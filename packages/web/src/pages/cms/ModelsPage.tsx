import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Tag, Toast, Modal, ArrayField, Row, Col } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus, Trash2 } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useCmsModelList, useCmsModelDetail, useSaveCmsModel, useDeleteCmsModel, cmsModelKeys } from '@/hooks/queries/cms';
import { CMS_FIELD_TYPES, CMS_FIELD_TYPE_LABELS } from '@zenith/shared';
import type { CmsModel } from '@zenith/shared';

const FIELD_TYPE_OPTIONS = CMS_FIELD_TYPES.map((t) => ({ value: t, label: CMS_FIELD_TYPE_LABELS[t] }));

export default function ModelsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const queryClient = useQueryClient();

  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');

  const listQuery = useCmsModelList({ page, pageSize, keyword: submittedKeyword || undefined });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CmsModel | null>(null);
  const detailQuery = useCmsModelDetail(editingRecord?.id, modalVisible);
  const editingModel = editingRecord ? (detailQuery.data ?? editingRecord) : null;
  const saveMutation = useSaveCmsModel();
  const deleteMutation = useDeleteCmsModel();

  function handleSearch() {
    setPage(1);
    setSubmittedKeyword(draftKeyword);
    void queryClient.invalidateQueries({ queryKey: cmsModelKeys.lists });
  }

  function handleReset() {
    setPage(1);
    setDraftKeyword('');
    setSubmittedKeyword('');
    void queryClient.invalidateQueries({ queryKey: cmsModelKeys.lists });
  }

  function openCreate() {
    setEditingRecord(null);
    setModalVisible(true);
  }

  function openEdit(record: CmsModel) {
    setEditingRecord(record);
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    setEditingRecord(null);
  }

  const formInitValues = editingModel
    ? {
        name: editingModel.name,
        code: editingModel.code,
        description: editingModel.description ?? '',
        status: editingModel.status,
        fields: (editingModel.fields ?? []).map((f) => ({
          name: f.name,
          label: f.label,
          fieldType: f.fieldType,
          required: f.required,
          searchable: f.searchable,
          showInList: f.showInList,
          placeholder: f.placeholder ?? '',
        })),
      }
    : { status: 'enabled', fields: [] };

  async function handleModalOk() {
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      throw new Error('validation');
    }
    const fields = ((values.fields as Record<string, unknown>[]) ?? []).map((f, i) => ({ ...f, sort: i }));
    await saveMutation.mutateAsync({ id: editingRecord?.id, values: { ...values, fields } });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    closeModal();
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  }

  const columns: ColumnProps<CmsModel>[] = [
    {
      title: '模型名称',
      dataIndex: 'name',
      width: 160,
      render: (v: string, record) => (
        <span>
          {v}
          {record.isSystem ? <Tag size="small" style={{ marginLeft: 6 }}>内置</Tag> : null}
        </span>
      ),
    },
    { title: '标识', dataIndex: 'code', width: 120 },
    {
      title: '自定义字段',
      dataIndex: 'fields',
      width: 300,
      render: (fields: CmsModel['fields']) => (fields && fields.length > 0
        ? fields.map((f) => <Tag key={f.name} size="small" style={{ marginRight: 4 }}>{f.label}</Tag>)
        : <span style={{ color: 'var(--semi-color-text-2)' }}>无（仅基础字段）</span>),
    },
    { title: '描述', dataIndex: 'description', width: 220, render: renderEllipsis },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      fixed: 'right',
      render: (v: string) => (v === 'enabled' ? <Tag color="green" size="small">启用</Tag> : <Tag color="red" size="small">停用</Tag>),
    },
    createOperationColumn<CmsModel>({
      width: 160,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        ...(hasPermission('cms:model:update') ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => openEdit(record),
        }] : []),
        ...(hasPermission('cms:model:delete') && !record.isSystem ? [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({ title: '确定要删除该模型吗？', content: '被栏目或内容引用时不可删除', onOk: () => handleDelete(record.id) });
          },
        }] : []),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input
          prefix={<Search size={14} />}
          placeholder="搜索模型名称/标识..."
          value={draftKeyword}
          onChange={setDraftKeyword}
          showClear
          style={{ width: 220 }}
          onEnterPress={handleSearch}
        />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {hasPermission('cms:model:create') ? (
          <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
        ) : null}
      </SearchToolbar>

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={list}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无内容模型"
        scroll={{ x: 1220 }}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
      />

      <AppModal
        title={editingRecord ? '编辑模型' : '新增模型'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ loading: saveMutation.isPending, disabled: !!editingRecord && detailQuery.isFetching }}
        width={860}
        closeOnEsc
      >
        <Form
          key={editingRecord?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={90}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="name" label="模型名称" rules={[{ required: true, message: '请输入模型名称' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="code" label="模型标识" disabled={!!editingRecord} placeholder="如 article" rules={[{ required: true, message: '请输入模型标识' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="description" label="描述" />
            </Col>
            <Col span={12}>
              <Form.RadioGroup field="status" label="状态">
                <Form.Radio value="enabled">启用</Form.Radio>
                <Form.Radio value="disabled">停用</Form.Radio>
              </Form.RadioGroup>
            </Col>
          </Row>
          <Form.Section text="自定义字段（基础字段：标题/摘要/正文/封面/作者等已内置，此处配置扩展字段）">
            <ArrayField field="fields">
              {({ add, arrayFields }) => (
                <>
                  {arrayFields.map(({ field, key, remove }) => (
                    <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
                      <Form.Input field={`${field}[name]`} noLabel placeholder="字段标识（英文）" style={{ width: 140 }}
                        rules={[{ required: true, message: '必填' }, { pattern: /^[a-z][a-z0-9_]*$/, message: '小写字母开头' }]} />
                      <Form.Input field={`${field}[label]`} noLabel placeholder="字段名称" style={{ width: 120 }}
                        rules={[{ required: true, message: '必填' }]} />
                      <Form.Select field={`${field}[fieldType]`} noLabel initValue="text" style={{ width: 120 }} optionList={FIELD_TYPE_OPTIONS} />
                      <Form.Input field={`${field}[placeholder]`} noLabel placeholder="提示文案" style={{ width: 150 }} />
                      <Form.Checkbox field={`${field}[required]`} noLabel>必填</Form.Checkbox>
                      <Form.Checkbox field={`${field}[searchable]`} noLabel>检索</Form.Checkbox>
                      <Form.Checkbox field={`${field}[showInList]`} noLabel>列表显示</Form.Checkbox>
                      <Button type="danger" theme="borderless" icon={<Trash2 size={14} />} onClick={() => remove()} style={{ marginTop: 4 }} />
                    </div>
                  ))}
                  <Button icon={<Plus size={14} />} onClick={() => add()}>添加字段</Button>
                </>
              )}
            </ArrayField>
          </Form.Section>
        </Form>
      </AppModal>
    </div>
  );
}
