import { useMemo } from 'react';
import { Form, Spin, Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { CreateWikiTagInput, WikiTag } from '@zenith/shared/wiki';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { KeywordInput } from '@/components/search-filters';
import { CreateButton } from '@/components/toolbar-controls';
import AppModal from '@/components/AppModal';
import { createdAtColumn } from '@/utils/table-columns';
import { useEditModal } from '@/hooks/useEditModal';
import { usePermission } from '@/hooks/usePermission';
import { compactParams } from '@/lib/query';
import { useListSearch } from '@/hooks/useListSearch';
import { useDeleteWikiTags, useSaveWikiTag, useWikiTagList, wikiTagKeys } from '@/hooks/queries/wiki-tags';

interface SearchParams {
  keyword: string;
}

const defaultSearchParams: SearchParams = { keyword: '' };

const TAG_COLOR_PRESETS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#64748b'];

export default function WikiTagsPage() {
  const { hasPermission } = usePermission();

  const {
    page, pageSize, buildPagination,
    bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: wikiTagKeys.lists });

  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useMemo(() => compactParams({ keyword: submittedParams.keyword }), [submittedParams]);

  const listQuery = useWikiTagList({ page, pageSize, ...filterQuery });

  const modal = useEditModal<WikiTag, Partial<CreateWikiTagInput>>({
    entityName: '标签',
    save: useSaveWikiTag(),
    defaults: {},
    // 记录里的 null 在表单中归一为未填
    toValues: (r) => ({ name: r.name, color: r.color ?? undefined }),
    labelWidth: 72,
  });

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
          key: 'edit', label: '编辑', onClick: () => modal.openEdit(record),
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
        keyword={(
          <KeywordInput
            placeholder="搜索标签名称..."
            {...bindKeyword('keyword')}
          />
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={(
          hasPermission('wiki:tag:create')
            ? <CreateButton onClick={modal.openCreate} /> : null
        )}
      />

      <ConfigurableTable<WikiTag>
        columns={columns}
        empty="暂无标签"
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <AppModal {...modal.modalProps} width={480}>
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}>
            <Form.Input field="name" label="名称" placeholder="请输入标签名称"
              rules={[{ required: true, message: '标签名称不能为空' }]} />
            <Form.RadioGroup field="color" label="颜色" type="pureCard" direction="horizontal">
              {TAG_COLOR_PRESETS.map((c) => (
                <Form.Radio key={c} value={c} style={{ padding: 4 }}>
                  <span style={{ display: 'inline-block', width: 22, height: 22, borderRadius: 'var(--semi-border-radius-small)', backgroundColor: c }} />
                </Form.Radio>
              ))}
            </Form.RadioGroup>
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
