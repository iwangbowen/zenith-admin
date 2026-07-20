import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Form, Input, Tag, Toast, Modal } from '@douyinfe/semi-ui';
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
import { useCmsErrorProneWordList, useSaveCmsErrorProneWord, useDeleteCmsErrorProneWord, cmsErrorProneWordKeys } from '@/hooks/queries/cms';
import type { CmsErrorProneWord } from '@zenith/shared';

export default function ErrorProneWordsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CmsErrorProneWord | null>(null);

  const listQuery = useCmsErrorProneWordList({ page, pageSize, keyword: submittedKeyword || undefined });
  const saveMutation = useSaveCmsErrorProneWord();
  const deleteMutation = useDeleteCmsErrorProneWord();
  const canManage = hasPermission('cms:word:manage');

  function handleSearch() {
    setPage(1);
    setSubmittedKeyword(draftKeyword);
    void queryClient.invalidateQueries({ queryKey: cmsErrorProneWordKeys.lists });
  }

  function handleReset() {
    setPage(1);
    setDraftKeyword('');
    setSubmittedKeyword('');
    void queryClient.invalidateQueries({ queryKey: cmsErrorProneWordKeys.lists });
  }

  async function handleModalOk() {
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      throw new Error('validation');
    }
    if (!values.remark) values.remark = null;
    await saveMutation.mutateAsync({ id: editingRecord?.id, values });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingRecord(null);
  }

  const columns: ColumnProps<CmsErrorProneWord>[] = [
    { title: '易错词', dataIndex: 'word', width: 180 },
    {
      title: '正确写法',
      dataIndex: 'correction',
      width: 200,
      render: (v: string) => <Tag size="small" color="green">{v}</Tag>,
    },
    { title: '备注', dataIndex: 'remark', width: 220, render: (v: string | null) => v ?? '-' },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (v: string) => (v === 'enabled' ? <Tag color="green" size="small">启用</Tag> : <Tag color="red" size="small">停用</Tag>),
    },
    createOperationColumn<CmsErrorProneWord>({
      width: 160,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => canManage ? [
        { key: 'edit', label: '编辑', onClick: () => { setEditingRecord(record); setModalVisible(true); } },
        {
          key: 'delete', label: '删除', danger: true,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该易错词吗？',
              onOk: async () => {
                await deleteMutation.mutateAsync(record.id);
                Toast.success('删除成功');
              },
            });
          },
        },
      ] : [],
    }),
  ];

  return (
    <div className="page-container">
      <Banner type="info" closeIcon={null} style={{ marginBottom: 12 }} description="易错词库用于内容编辑辅助：在内容编辑页点击「内容检查」可标出正文中的易错词，并支持一键替换为正确写法。" />
      <SearchToolbar>
        <Input prefix={<Search size={14} />} placeholder="搜索易错词/正确写法..." value={draftKeyword} onChange={setDraftKeyword} showClear style={{ width: 220 }} onEnterPress={handleSearch} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {canManage ? <Button type="primary" icon={<Plus size={14} />} onClick={() => { setEditingRecord(null); setModalVisible(true); }}>新增</Button> : null}
      </SearchToolbar>

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={listQuery.data?.list ?? []}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无易错词"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(listQuery.data?.total ?? 0)}
      />

      <AppModal
        title={editingRecord ? '编辑易错词' : '新增易错词'}
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
          initValues={editingRecord
            ? { word: editingRecord.word, correction: editingRecord.correction, remark: editingRecord.remark ?? '', status: editingRecord.status }
            : { status: 'enabled' }}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input field="word" label="易错词" rules={[{ required: true, message: '请输入易错词' }]} />
          <Form.Input field="correction" label="正确写法" rules={[{ required: true, message: '请输入正确写法' }]} />
          <Form.Input field="remark" label="备注" placeholder="可选" />
          <Form.RadioGroup field="status" label="状态">
            <Form.Radio value="enabled">启用</Form.Radio>
            <Form.Radio value="disabled">停用</Form.Radio>
          </Form.RadioGroup>
        </Form>
      </AppModal>
    </div>
  );
}
