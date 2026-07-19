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
import { useCmsSensitiveWordList, useSaveCmsSensitiveWord, useDeleteCmsSensitiveWord, cmsSensitiveWordKeys } from '@/hooks/queries/cms';
import type { CmsSensitiveWord } from '@zenith/shared';

export default function SensitiveWordsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CmsSensitiveWord | null>(null);

  const listQuery = useCmsSensitiveWordList({ page, pageSize, keyword: submittedKeyword || undefined });
  const saveMutation = useSaveCmsSensitiveWord();
  const deleteMutation = useDeleteCmsSensitiveWord();
  const canManage = hasPermission('cms:sensitive:manage');

  function handleSearch() {
    setPage(1);
    setSubmittedKeyword(draftKeyword);
    void queryClient.invalidateQueries({ queryKey: cmsSensitiveWordKeys.lists });
  }

  function handleReset() {
    setPage(1);
    setDraftKeyword('');
    setSubmittedKeyword('');
    void queryClient.invalidateQueries({ queryKey: cmsSensitiveWordKeys.lists });
  }

  async function handleModalOk() {
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      throw new Error('validation');
    }
    if (!values.replaceWith) values.replaceWith = null;
    await saveMutation.mutateAsync({ id: editingRecord?.id, values });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingRecord(null);
  }

  const columns: ColumnProps<CmsSensitiveWord>[] = [
    { title: '敏感词', dataIndex: 'word', width: 180 },
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
      render: (v: string) => (v === 'enabled' ? <Tag color="green" size="small">启用</Tag> : <Tag color="red" size="small">停用</Tag>),
    },
    createOperationColumn<CmsSensitiveWord>({
      width: 160,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => canManage ? [
        { key: 'edit', label: '编辑', onClick: () => { setEditingRecord(record); setModalVisible(true); } },
        {
          key: 'delete', label: '删除', danger: true,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该敏感词吗？',
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
      <Banner type="info" closeIcon={null} style={{ marginBottom: 12 }} description="敏感词库全局生效，作用于前台评论与自定义表单提交：拦截模式命中直接拒绝提交，替换模式命中替换为指定文本。" />
      <SearchToolbar>
        <Input prefix={<Search size={14} />} placeholder="搜索敏感词..." value={draftKeyword} onChange={setDraftKeyword} showClear style={{ width: 220 }} onEnterPress={handleSearch} />
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
        empty="暂无敏感词"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(listQuery.data?.total ?? 0)}
      />

      <AppModal
        title={editingRecord ? '编辑敏感词' : '新增敏感词'}
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
            ? { word: editingRecord.word, replaceWith: editingRecord.replaceWith ?? '', status: editingRecord.status }
            : { status: 'enabled' }}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input field="word" label="敏感词" rules={[{ required: true, message: '请输入敏感词' }]} />
          <Form.Input field="replaceWith" label="替换为" placeholder="留空 = 拦截模式（命中直接拒绝提交）" />
          <Form.RadioGroup field="status" label="状态">
            <Form.Radio value="enabled">启用</Form.Radio>
            <Form.Radio value="disabled">停用</Form.Radio>
          </Form.RadioGroup>
        </Form>
      </AppModal>
    </div>
  );
}
