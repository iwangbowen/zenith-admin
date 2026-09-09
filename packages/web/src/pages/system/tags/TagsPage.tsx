import { useEffect, useState, useRef } from 'react';
import { Form, Input, Space, Spin, Typography } from '@douyinfe/semi-ui';
import { Tags } from 'lucide-react';
import type { CreateTagInput, Tag } from '@zenith/shared/platform';
import { enumValueOf, USER_STATUSES } from '@zenith/shared/core';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { useEditModal } from '@/hooks/useEditModal';
import { useListSearch } from '@/hooks/useListSearch';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { confirmAndDelete, deleteAction, ListSearchToolbar, listTableProps, useStatusToggle } from '@/components/list-page';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import {
  tagKeys,
  useDeleteTags,
  useSaveTag,
  useTagDetail,
  useTagGroups,
  useTagList,
  useUpdateTagStatus,
} from '@/hooks/queries/tags';
import { BatchDeleteButton, CreateButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';

const { Text } = Typography;

function ColorDot({ color }: { color: string | null }) {
  return color ? (
    <span
      style={{
        display: 'inline-block',
        width: 12,
        height: 12,
        borderRadius: '50%',
        backgroundColor: color,
        border: '1px solid rgba(0,0,0,0.12)',
        verticalAlign: 'middle',
        marginRight: 6,
        flexShrink: 0,
      }}
    />
  ) : (
    <Tags size={12} style={{ color: 'var(--semi-color-text-3)', marginRight: 6, verticalAlign: 'middle' }} />
  );
}

function ColorInput({ value, onChange }: { readonly value?: string; readonly onChange?: (v: string) => void }) {
  const [text, setText] = useState(value ?? '');
  const nativeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setText(value ?? ''); }, [value]);

  const isValidHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

  const handleTextChange = (v: string) => {
    setText(v);
    if (isValidHex(v) || v === '') onChange?.(v);
  };

  const handleNativeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const c = e.target.value;
    setText(c);
    onChange?.(c);
  };

  return (
    <Input
      value={text}
      onChange={handleTextChange}
      placeholder="#2563eb（留空则无颜色）"
      prefix={
        <button
          type="button"
          title="点击选色"
          style={{
            display: 'inline-flex',
            width: 16,
            height: 16,
            borderRadius: 'var(--semi-border-radius-small)',
            background: isValidHex(text) ? text : '#e5e7eb',
            border: '1px solid rgba(0,0,0,0.15)',
            cursor: 'pointer',
            overflow: 'hidden',
            position: 'relative',
            padding: 0,
            flexShrink: 0,
          }}
          onClick={() => nativeRef.current?.click()}
        >
          <input
            ref={nativeRef}
            type="color"
            value={isValidHex(text) ? text : '#2563eb'}
            onChange={handleNativeChange}
            style={{
              position: 'absolute',
              width: '300%',
              height: '300%',
              top: '-100%',
              left: '-100%',
              opacity: 0,
              cursor: 'pointer',
              border: 'none',
              padding: 0,
            }}
          />
        </button>
      }
    />
  );
}

export default function TagsPage() {
  const { hasPermission: can } = usePermission();
  const { items: statusItems, options: statusOptions } = useDictItems('common_status');

  interface SearchParams { keyword: string; filterStatus: string | undefined; filterGroup: string | undefined; }
  const defaultSearchParams: SearchParams = { keyword: '', filterStatus: undefined, filterGroup: undefined };
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: tagKeys.lists });

  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

  const [colorValue, setColorValue] = useState('');

  const listQuery = useTagList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: enumValueOf(USER_STATUSES, submittedParams.filterStatus),
    groupName: submittedParams.filterGroup || undefined,
  });
  const groupsQuery = useTagGroups();
  const saveMutation = useSaveTag();
  const tagModal = useEditModal<Tag, Partial<CreateTagInput>>({
    entityName: '标签',
    save: saveMutation,
    useDetail: useTagDetail,
    defaults: { status: 'enabled', sortOrder: 0 },
    toValues: (tag) => ({
      name: tag.name,
      groupName: tag.groupName ?? undefined,
      description: tag.description ?? undefined,
      status: tag.status,
      sortOrder: tag.sortOrder,
    }),
    beforeSave: (values) => ({ ...values, color: colorValue || undefined }),
  });
  const deleteMutation = useDeleteTags();
  const toggleStatusMutation = useUpdateTagStatus();
  const status = useStatusToggle<Tag>({
    toggle: (tag, enabled) => toggleStatusMutation.mutateAsync({ params: { id: tag.id }, body: { status: enabled ? 'enabled' : 'disabled' } }),
    confirmDisable: (tag) => ({ danger: true, title: `确认禁用标签「${tag.name}」？`, okText: '确认禁用' }),
    disabled: !can('system:tag:update'),
    messages: { disabled: '已禁用' },
  });

  useEffect(() => {
    if (tagModal.visible && tagModal.editing) setColorValue(tagModal.editing.color ?? '');
  }, [tagModal.visible, tagModal.editing]);

  const openCreate = () => {
    setColorValue('');
    tagModal.openCreate();
  };

  const openEdit = (record: Tag) => {
    setColorValue(record.color ?? '');
    tagModal.openEdit(record);
  };

  const handleBatchDelete = () => {
    if (!selectedRowKeys.length) return;
    confirmAndDelete({
      title: `确认删除选中的 ${selectedRowKeys.length} 条标签？`,
      content: '删除后无法恢复，请谨慎操作。',
      run: () => deleteMutation.mutateAsync(selectedRowKeys),
      successMessage: `已删除 ${selectedRowKeys.length} 条标签`,
      onDeleted: () => setSelectedRowKeys([]),
    });
  };

  const columns = [
    {
      title: '标签名称',
      dataIndex: 'name',
      render: (_: unknown, record: Tag) => (
        <Space align="center" spacing={0}>
          <ColorDot color={record.color} />
          <span>{record.name}</span>
        </Space>
      ),
    },
    {
      title: '所属分组',
      dataIndex: 'groupName',
      render: (v: string | null) =>
        v ? <Text>{v}</Text> : <Text type="quaternary">—</Text>,
    },
    {
      title: '描述',
      dataIndex: 'description',
      render: renderEllipsis,
    },
    {
      title: '排序',
      dataIndex: 'sortOrder',
      width: 80,
    },
    createdAtColumn,
    status.column(),
    createOperationColumn<Tag>({
      width: 150,
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !can('system:tag:update'),
          onClick: () => openEdit(record),
        },
        deleteAction({
          hidden: !can('system:tag:delete'),
          title: '确定要删除该标签吗？',
          run: () => deleteMutation.mutateAsync([record.id]),
          onDeleted: () => setSelectedRowKeys((keys) => keys.filter((k) => k !== record.id)),
        }),
      ],
    }),
  ];

  const groupOptions = (groupsQuery.data ?? []).map((g) => ({ label: g, value: g }));

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索标签名称或描述" {...bindKeyword('keyword')} width={200} />}
        filters={(
          <>
            <FilterSelect
              placeholder="全部所属分组"
              items={groupOptions}
              {...bind('filterGroup')}
              width={160}
            />
            <StatusSelect
              items={statusItems}
              {...bind('filterStatus')}
            />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={can('system:tag:create') && <CreateButton onClick={openCreate} />}
        actions={can('system:tag:delete') && selectedRowKeys.length > 0 && <BatchDeleteButton count={selectedRowKeys.length} onClick={handleBatchDelete} />}
        filterTitle="标签筛选"
        actionTitle="标签操作"
      />

      <ConfigurableTable<Tag>
        columns={columns}
        {...listTableProps(listQuery, {
          pagination: buildPagination,
          rowSelection: can('system:tag:delete')
            ? {
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys((keys ?? []) as number[]),
              }
            : undefined,
        })}
      />

      <AppModal
        {...tagModal.modalProps}
        afterClose={() => { setColorValue(''); }}
        width={520}

      >
        <Spin spinning={tagModal.detailLoading} wrapperClassName="modal-spin-wrapper">
        <Form key={tagModal.formKey} {...tagModal.formProps}>
          <Form.Input
            field="name"
            label="标签名称"
            placeholder="请输入标签名称"
            rules={[{ required: true, message: '标签名称不能为空' }]}
          />
          <Form.Slot label="颜色">
            <ColorInput value={colorValue} onChange={setColorValue} />
          </Form.Slot>
          <Form.Input
            field="groupName"
            label="所属分组"
            placeholder="请输入分组名称（选填）"
          />
          <Form.TextArea
            field="description"
            label="描述"
            placeholder="请输入标签描述（选填）"
            rows={3}
          />
          <Form.Select
            field="status"
            label="状态"
            placeholder="请选择状态"
            style={{ width: '100%' }}
            optionList={statusOptions}
          />
          <Form.InputNumber
            field="sortOrder"
            label="排序"
            min={0}
            max={9999}
            innerButtons
            style={{ width: '100%' }}
          />
        </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
