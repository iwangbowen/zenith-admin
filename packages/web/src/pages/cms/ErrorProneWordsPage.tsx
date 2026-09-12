import { Banner, Form, Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import AppModal from '@/components/AppModal';
import { createdAtColumn, renderEllipsis, renderEnabledStatusTag } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { useListSearch } from '@/hooks/useListSearch';
import { useCmsErrorProneWordList, useSaveCmsErrorProneWord, useDeleteCmsErrorProneWords, cmsErrorProneWordKeys } from '@/hooks/queries/cms';
import type { CmsErrorProneWord } from '@zenith/shared/cms';
import { CreateButton } from '@/components/toolbar-controls';
import { KeywordInput } from '@/components/search-filters';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { FormStatusRadioGroup } from '@/components/FormStatusRadioGroup';

interface SearchParams { keyword: string }
const defaultSearch: SearchParams = { keyword: '' };

export default function ErrorProneWordsPage() {
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: cmsErrorProneWordKeys.lists });
  const listQuery = useCmsErrorProneWordList({ page, pageSize, keyword: submittedParams.keyword || undefined });
  const saveMutation = useSaveCmsErrorProneWord();
  const modal = useEditModal<CmsErrorProneWord, Partial<CmsErrorProneWord>, Record<string, unknown>>({
    entityName: '易错词',
    save: saveMutation,
    defaults: { status: 'enabled' },
    toValues: (record) => ({ word: record.word, correction: record.correction, remark: record.remark ?? '', status: record.status }),
    beforeSave: (values) => ({ ...values, remark: values.remark || null }),
  });
  const deleteMutation = useDeleteCmsErrorProneWords();
  const canManage = hasPermission('cms:word:manage');

  const columns: ColumnProps<CmsErrorProneWord>[] = [
    { title: '易错词', dataIndex: 'word', width: 180 },
    {
      title: '正确写法',
      dataIndex: 'correction',
      width: 200,
      render: (v: string) => <Tag size="small" color="green">{v}</Tag>,
    },
    { title: '备注', dataIndex: 'remark', minWidth: 220, render: renderEllipsis },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: renderEnabledStatusTag,
    },
    createOperationColumn<CmsErrorProneWord>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => canManage ? [
        { key: 'edit', label: '编辑', onClick: () => modal.openEdit(record) },
        deleteAction({
          title: '确定要删除该易错词吗？',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ] : [],
    }),
  ];

  return (
    <div className="page-container">
      <Banner type="info" closeIcon={null} style={{ marginBottom: 12 }} description="易错词库用于内容编辑辅助：在内容编辑页点击「内容检查」可标出正文中的易错词，并支持一键替换为正确写法。" />
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索易错词/正确写法..." {...bindKeyword('keyword')} />}
        onSearch={handleSearch}
        onReset={handleReset}
        create={canManage ? <CreateButton onClick={modal.openCreate} /> : null}
      />

      <ConfigurableTable<CmsErrorProneWord>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination, empty: '暂无易错词' })}
      />

      <AppModal {...modal.modalProps} width={480}>
        <Form key={modal.formKey} {...modal.formProps}>
          <Form.Input field="word" label="易错词" rules={[{ required: true, message: '请输入易错词' }]} />
          <Form.Input field="correction" label="正确写法" rules={[{ required: true, message: '请输入正确写法' }]} />
          <Form.Input field="remark" label="备注" placeholder="可选" />
          <FormStatusRadioGroup />
        </Form>
      </AppModal>
    </div>
  );
}
