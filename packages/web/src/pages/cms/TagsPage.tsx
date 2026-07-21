import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Toast, Modal } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { createdAtColumn } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useCmsTagList, useSaveCmsTag, useDeleteCmsTag, cmsTagKeys } from '@/hooks/queries/cms';
import type { CmsTag } from '@zenith/shared';
import { CmsSiteSelect } from './CmsSiteSelect';

export default function TagsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const queryClient = useQueryClient();

  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');

  const listQuery = useCmsTagList({
    page, pageSize, siteId: siteId ?? 0, keyword: submittedKeyword || undefined,
  }, siteId !== undefined);
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CmsTag | null>(null);
  const saveMutation = useSaveCmsTag();
  const deleteMutation = useDeleteCmsTag();

  function handleSearch() {
    setPage(1);
    setSubmittedKeyword(draftKeyword);
    void queryClient.invalidateQueries({ queryKey: cmsTagKeys.lists });
  }

  function handleReset() {
    setPage(1);
    setDraftKeyword('');
    setSubmittedKeyword('');
    void queryClient.invalidateQueries({ queryKey: cmsTagKeys.lists });
  }

  function openCreate() {
    setEditingRecord(null);
    setModalVisible(true);
  }

  function openEdit(record: CmsTag) {
    setEditingRecord(record);
    setModalVisible(true);
  }

  async function handleModalOk() {
    if (!siteId) return;
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      throw new Error('validation');
    }
    if (!editingRecord) values.siteId = siteId;
    if (typeof values.groupName === 'string' && values.groupName.trim() === '') values.groupName = null;
    await saveMutation.mutateAsync({ id: editingRecord?.id, values });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingRecord(null);
  }

  const columns: ColumnProps<CmsTag>[] = [
    { title: '标签名称', dataIndex: 'name', width: 180 },
    { title: 'URL 标识', dataIndex: 'slug', width: 160 },
    { title: '分组', dataIndex: 'groupName', width: 130, render: (v: string | null) => v ?? '-' },
    { title: '关联内容数', dataIndex: 'contentCount', width: 120 },
    createdAtColumn,
    createOperationColumn<CmsTag>({
      width: 160,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        ...(hasPermission('cms:tag:update') ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => openEdit(record),
        }] : []),
        ...(hasPermission('cms:tag:delete') ? [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该标签吗？',
              content: '删除后关联内容的打标关系将一并移除',
              onOk: async () => {
                await deleteMutation.mutateAsync(record.id);
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
        <Input
          prefix={<Search size={14} />}
          placeholder="搜索标签名称/标识..."
          value={draftKeyword}
          onChange={setDraftKeyword}
          showClear
          style={{ width: 200 }}
          onEnterPress={handleSearch}
        />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {hasPermission('cms:tag:create') ? (
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
        empty="暂无标签"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
      />

      <AppModal
        title={editingRecord ? '编辑标签' : '新增标签'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={480}
        closeOnEsc
      >
        <Form
          key={editingRecord?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={editingRecord ? { name: editingRecord.name, slug: editingRecord.slug, groupName: editingRecord.groupName ?? '' } : {}}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input field="name" label="标签名称" rules={[{ required: true, message: '请输入标签名称' }]} />
          <Form.Input field="slug" label="URL 标识" placeholder="小写字母/数字/中划线" rules={[{ required: true, message: '请输入 URL 标识' }]} />
          <Form.Input field="groupName" label="分组" placeholder="可选，如「产品」「行业」，便于归类管理" maxLength={50} />
        </Form>
      </AppModal>
    </div>
  );
}
