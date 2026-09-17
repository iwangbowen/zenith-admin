import { useState } from 'react';
import { Form, Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { wikiTagContract, type CreateWikiTagInput, type WikiTag } from '@zenith/shared/wiki';
import ConfigurableTable from '@/components/ConfigurableTable';
import { SwatchColorPicker } from '@/components/SwatchColorPicker';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar } from '@/components/list-page';
import { CreateButton } from '@/components/toolbar-controls';
import { createdAtColumn } from '@/utils/table-columns';
import { useEditModal } from '@/hooks/useEditModal';
import { usePermission } from '@/hooks/usePermission';
import { useDeleteWikiTags, useSaveWikiTag, useWikiTagList } from '@/hooks/queries/wiki-tags';
import { useListPage } from '@/hooks/useListPage';
import { EditFormModal } from '@/components/EditFormModal';

const TAG_COLOR_PRESETS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#64748b'];

/** 知识标签色板：8 个固定预设打头，存档值为 hex；其余经自定义取色器选择 */
const TAG_COLOR_OPTIONS = TAG_COLOR_PRESETS.map((color) => ({ key: color, label: color, color }));

export default function WikiTagsPage() {
  const { hasPermission } = usePermission();

  const page = useListPage({
    contract: wikiTagContract,
    useList: useWikiTagList,
  });
  const { tableProps } = page;

  const [colorValue, setColorValue] = useState('');

  const modal = useEditModal<WikiTag, Partial<CreateWikiTagInput>>({
    entityName: '标签',
    save: useSaveWikiTag(),
    defaults: {},
    // 记录里的 null 在表单中归一为未填
    toValues: (r) => ({ name: r.name }),
    beforeSave: (values) => ({ ...values, color: colorValue || undefined }),
    labelWidth: 72,
  });

  const openCreate = () => {
    setColorValue('');
    modal.openCreate();
  };

  const openEdit = (record: WikiTag) => {
    setColorValue(record.color ?? '');
    modal.openEdit(record);
  };

  const deleteMutation = useDeleteWikiTags();

  const columns: ColumnProps<WikiTag>[] = [
    {
      title: '标签', dataIndex: 'name', minWidth: 200,
      render: (_: unknown, record: WikiTag) => (
        <Tag style={record.color ? { backgroundColor: record.color, color: '#fff' } : undefined}>{record.name}</Tag>
      ),
    },
    { title: '关联文档数', dataIndex: 'docCount', width: 120, align: 'right' },
    createdAtColumn,
    createOperationColumn<WikiTag>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        ...(hasPermission('wiki:tag:edit') ? [{
          key: 'edit', label: '编辑', onClick: () => openEdit(record),
        }] : []),
        deleteAction({
          hidden: !hasPermission('wiki:tag:delete'),
          title: `确定要删除标签「${record.name}」吗？`,
          content: '删除后关联文档的该标签将被移除',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        page={page}
        filters={['keyword']}
        create={<CreateButton permission="wiki:tag:create" onClick={openCreate} />}
      />

      <ConfigurableTable<WikiTag>
        columns={columns}
        empty="暂无标签"
        {...tableProps}
      />

      <EditFormModal modal={modal} afterClose={() => { setColorValue(''); }} width={480}>
        <Form.Input field="name" label="名称" placeholder="请输入标签名称"
          rules={[{ required: true, message: '标签名称不能为空' }]} />
        <Form.Slot label="颜色">
          <SwatchColorPicker
            value={colorValue}
            onChange={setColorValue}
            options={TAG_COLOR_OPTIONS}
            allowClear
            clearTitle="无颜色"
          />
        </Form.Slot>
      </EditFormModal>
    </div>
  );
}
