import { Banner, Form, Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import AppModal from '@/components/AppModal';
import { createdAtColumn, renderEnabledStatusTag } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { useListSearch } from '@/hooks/useListSearch';
import { useCmsSensitiveWordList, useSaveCmsSensitiveWord, useDeleteCmsSensitiveWords, cmsSensitiveWordKeys } from '@/hooks/queries/cms';
import type { CmsSensitiveWord } from '@zenith/shared/cms';
import { CreateButton } from '@/components/toolbar-controls';
import { KeywordInput } from '@/components/search-filters';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { FormStatusRadioGroup } from '@/components/FormStatusRadioGroup';

interface SearchParams { keyword: string }
const defaultSearch: SearchParams = { keyword: '' };

export default function SensitiveWordsPage() {
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: cmsSensitiveWordKeys.lists });
  const listQuery = useCmsSensitiveWordList({ page, pageSize, keyword: submittedParams.keyword || undefined });
  const saveMutation = useSaveCmsSensitiveWord();
  const modal = useEditModal<CmsSensitiveWord, Partial<CmsSensitiveWord>, Record<string, unknown>>({
    entityName: '敏感词',
    save: saveMutation,
    defaults: { status: 'enabled' },
    toValues: (record) => ({ word: record.word, replaceWith: record.replaceWith ?? '', status: record.status }),
    beforeSave: (values) => ({ ...values, replaceWith: values.replaceWith || null }),
  });
  const deleteMutation = useDeleteCmsSensitiveWords();
  const canManage = hasPermission('cms:sensitive:manage');

  const columns: ColumnProps<CmsSensitiveWord>[] = [
    { title: '敏感词', dataIndex: 'word', minWidth: 180 },
    {
      title: '处理方式',
      dataIndex: 'replaceWith',
      width: 200,
      render: (v: string | null) => (v
        ? <Tag size="small" color="orange">替换为「{v}」</Tag>
        : <Tag size="small" color="red">拦截提交</Tag>),
    },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: renderEnabledStatusTag,
    },
    createOperationColumn<CmsSensitiveWord>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => canManage ? [
        { key: 'edit', label: '编辑', onClick: () => modal.openEdit(record) },
        deleteAction({
          title: '确定要删除该敏感词吗？',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ] : [],
    }),
  ];

  return (
    <div className="page-container">
      <Banner type="info" closeIcon={null} style={{ marginBottom: 12 }} description="敏感词库全局生效，作用于前台评论与自定义表单提交：拦截模式命中直接拒绝提交，替换模式命中替换为指定文本。" />
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索敏感词..." value={draftParams.keyword} onChange={(keyword) => setDraftParams({ keyword })} onSearch={handleSearch} />}
        onSearch={handleSearch}
        onReset={handleReset}
        create={canManage ? <CreateButton onClick={modal.openCreate} /> : null}
      />

      <ConfigurableTable<CmsSensitiveWord>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination, empty: '暂无敏感词' })}
      />

      <AppModal {...modal.modalProps} width={480}>
        <Form key={modal.formKey} {...modal.formProps}>
          <Form.Input field="word" label="敏感词" rules={[{ required: true, message: '请输入敏感词' }]} />
          <Form.Input field="replaceWith" label="替换为" placeholder="留空 = 拦截模式（命中直接拒绝提交）" />
          <FormStatusRadioGroup />
        </Form>
      </AppModal>
    </div>
  );
}
