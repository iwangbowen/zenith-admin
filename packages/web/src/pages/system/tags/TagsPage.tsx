import { useEffect, useState } from 'react';
import { Form, Space, Typography } from '@douyinfe/semi-ui';
import { Tags } from 'lucide-react';
import { tagContract, type CreateTagInput, type Tag } from '@zenith/shared/platform';
import { usePermission } from '@/hooks/usePermission';
import { useDictItems } from '@/hooks/useDictItems';
import { useEditModal } from '@/hooks/useEditModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { SwatchColorPicker } from '@/components/SwatchColorPicker';
import { THEME_COLOR_PRESETS } from '@/lib/theme-color';
import { confirmAndDelete, ListSearchToolbar, useStatusToggle, useRowSelection, useCrudOperationColumn } from '@/components/list-page';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import {
  useDeleteTags,
  useSaveTag,
  useTagDetail,
  useTagGroups,
  useTagList,
  useUpdateTagStatus,
} from '@/hooks/queries/tags';
import { BatchDeleteButton, CreateButton } from '@/components/toolbar-controls';
import { FilterSelect } from '@/components/search-filters';
import { useListPage } from '@/hooks/useListPage';
import { EditFormModal } from '@/components/EditFormModal';

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

/** 标签色板选项：存档值为 hex，与个人偏好主题色同款色板交互 */
const TAG_COLOR_OPTIONS = THEME_COLOR_PRESETS.map((preset) => ({
  key: preset.light.primary,
  label: preset.name,
  color: preset.light.primary,
}));

export default function TagsPage() {
  const { hasPermission: can } = usePermission();
  const { options: statusOptions } = useDictItems('common_status');

  const { selectedRowKeys, setSelectedRowKeys, clear: clearSelection, rowSelection } = useRowSelection();
  const page = useListPage({
    contract: tagContract,
    useList: useTagList,
    table: { rowSelection: can('system:tag:delete') ? rowSelection : undefined },
  });
  const { tableProps } = page;

  const [colorValue, setColorValue] = useState('');

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
      onDeleted: clearSelection,
    });
  };

  const operationColumn = useCrudOperationColumn<Tag>({
    permission: 'system:tag',
    edit: openEdit,
    remove: deleteMutation,
    title: '确定要删除该标签吗？',
    onDeleted: (record) => setSelectedRowKeys((keys) => keys.filter((k) => k !== record.id)),
    width: 150,
  });

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
    operationColumn,
  ];

  const groupOptions = (groupsQuery.data ?? []).map((g) => ({ label: g, value: g }));

  return (
    <div className="page-container">
      <ListSearchToolbar
        page={page}
        filters={['keyword', 'groupName', 'status']}
        overrides={{
          groupName: (p) => (
            <FilterSelect
              placeholder="全部所属分组"
              items={groupOptions}
              {...p.bind('groupName')}
              width={160}
            />
          ),
        }}
        create={<CreateButton permission="system:tag:create" onClick={openCreate} />}
        actions={can('system:tag:delete') && selectedRowKeys.length > 0 && <BatchDeleteButton count={selectedRowKeys.length} onClick={handleBatchDelete} />}
        filterTitle="标签筛选"
        actionTitle="标签操作"
      />

      <ConfigurableTable<Tag>
        columns={columns}
        {...tableProps}
      />

      <EditFormModal modal={tagModal} afterClose={() => { setColorValue(''); }} width={640}>
        <Form.Input
          field="name"
          label="标签名称"
          placeholder="请输入标签名称"
          rules={[{ required: true, message: '标签名称不能为空' }]}
        />
        <Form.Slot label="颜色">
          <SwatchColorPicker
            value={colorValue}
            onChange={setColorValue}
            options={TAG_COLOR_OPTIONS}
            allowClear
            clearTitle="无颜色（留空则无颜色）"
          />
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
      </EditFormModal>
    </div>
  );
}
