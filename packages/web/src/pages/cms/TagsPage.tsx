import { useRef, useState } from 'react';
import { Form, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { createdAtColumn } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { useListSearch } from '@/hooks/useListSearch';
import { useCmsTagList, useSaveCmsTag, useDeleteCmsTags, cmsTagKeys } from '@/hooks/queries/cms';
import type { CmsTag, CreateCmsTagInput } from '@zenith/shared/cms';
import { CmsSiteSelect } from './CmsSiteSelect';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { KeywordInput } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { slugifyName } from '@/utils/slug';
import { abortSubmit } from '@/lib/abort-submit';

interface SearchParams { keyword: string }
const defaultSearch: SearchParams = { keyword: '' };

export default function TagsPage() {
  const { hasPermission } = usePermission();
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const {
    page, pageSize, setPage, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: cmsTagKeys.lists });

  const listQuery = useCmsTagList({
    page, pageSize, siteId: siteId ?? 0, keyword: submittedParams.keyword || undefined,
  }, siteId !== undefined);
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const saveMutation = useSaveCmsTag();
  const modal = useEditModal<CmsTag, Partial<CmsTag>, Partial<CreateCmsTagInput>>({
    entityName: '标签',
    save: saveMutation,
    toValues: (record) => ({ name: record.name, slug: record.slug, groupName: record.groupName ?? '' }),
    beforeSave: (values, { isEdit }) => {
      if (!isEdit && !siteId) abortSubmit('validation');
      return {
        ...values,
        ...(!isEdit ? { siteId } : {}),
        groupName: typeof values.groupName === 'string' && values.groupName.trim() === '' ? null : values.groupName,
      };
    },
  });
  const deleteMutation = useDeleteCmsTags();

  // 新建时按名称自动生成拼音 slug；用户手改过（当前值 ≠ 上次自动值）则不再覆盖
  const lastAutoSlug = useRef('');
  const handleNameChange = (value: string) => {
    if (modal.isEdit) return;
    const api = modal.formApi.current;
    if (!api) return;
    const current = (api.getValue('slug') as string | undefined) ?? '';
    if (current && current !== lastAutoSlug.current) return;
    const next = slugifyName(value, 100);
    lastAutoSlug.current = next;
    api.setValue('slug', next);
  };

  const columns: ColumnProps<CmsTag>[] = [
    { title: '标签名称', dataIndex: 'name', minWidth: 180 },
    { title: 'URL 标识', dataIndex: 'slug', width: 160 },
    { title: '分组', dataIndex: 'groupName', width: 130, render: (v: string | null) => v ?? '-' },
    { title: '关联内容数', dataIndex: 'contentCount', width: 120, align: 'right' },
    createdAtColumn,
    createOperationColumn<CmsTag>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        ...(hasPermission('cms:tag:update') ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => modal.openEdit(record),
        }] : []),
        ...(hasPermission('cms:tag:delete') ? [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            confirmDelete({
              title: '确定要删除该标签吗？',
              content: '删除后关联内容的打标关系将一并移除',
              onOk: async () => {
                await deleteMutation.mutateAsync([record.id]);
                Toast.success('删除成功');
              },
            });
          },
        }] : []),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={(v) => { setSiteId(v); setPage(1); }} width={180} />
        <KeywordInput placeholder="搜索标签名称/标识..." value={draftParams.keyword} onChange={(keyword) => setDraftParams({ keyword })} onSearch={handleSearch} width={200} />
        <SearchButton onClick={handleSearch} />
        <ResetButton onClick={handleReset} />
        {hasPermission('cms:tag:create') ? (
          <CreateButton onClick={modal.openCreate} />
        ) : null}
      </SearchToolbar>

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={list}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无标签"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
      />

      <AppModal {...modal.modalProps} width={480}>
        <Form key={modal.formKey} {...modal.formProps}>
          <Form.Input field="name" label="标签名称" onChange={(v) => handleNameChange(String(v ?? ''))} rules={[{ required: true, message: '请输入标签名称' }]} />
          <Form.Input field="slug" label="URL 标识" placeholder="输入名称自动生成，可修改" rules={[{ required: true, message: '请输入 URL 标识' }]} />
          <Form.Input field="groupName" label="分组" placeholder="可选，如「产品」「行业」，便于归类管理" maxLength={50} />
        </Form>
      </AppModal>
    </div>
  );
}
