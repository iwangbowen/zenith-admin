import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Tag, Toast, Modal } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useCmsFragmentList, useSaveCmsFragment, useDeleteCmsFragment, cmsFragmentKeys } from '@/hooks/queries/cms';
import { CMS_FRAGMENT_TYPES, CMS_FRAGMENT_TYPE_LABELS } from '@zenith/shared';
import type { CmsFragment } from '@zenith/shared';
import { CmsSiteSelect } from './CmsSiteSelect';

export default function FragmentsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const queryClient = useQueryClient();

  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');

  const listQuery = useCmsFragmentList({
    page, pageSize, siteId: siteId ?? 0, keyword: submittedKeyword || undefined,
  }, siteId !== undefined);
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CmsFragment | null>(null);
  const saveMutation = useSaveCmsFragment();
  const deleteMutation = useDeleteCmsFragment();

  function handleSearch() {
    setPage(1);
    setSubmittedKeyword(draftKeyword);
    void queryClient.invalidateQueries({ queryKey: cmsFragmentKeys.lists });
  }

  function handleReset() {
    setPage(1);
    setDraftKeyword('');
    setSubmittedKeyword('');
    void queryClient.invalidateQueries({ queryKey: cmsFragmentKeys.lists });
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
    await saveMutation.mutateAsync({ id: editingRecord?.id, values });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingRecord(null);
  }

  const columns: ColumnProps<CmsFragment>[] = [
    { title: '碎片名称', dataIndex: 'name', width: 160 },
    {
      title: '引用标识',
      dataIndex: 'code',
      width: 150,
      render: (v: string) => <Tag size="small">{v}</Tag>,
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      render: (v: CmsFragment['type']) => CMS_FRAGMENT_TYPE_LABELS[v],
    },
    { title: '内容预览', dataIndex: 'content', width: 300, render: renderEllipsis },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      fixed: 'right',
      render: (v: string) => (v === 'enabled' ? <Tag color="green" size="small">启用</Tag> : <Tag color="red" size="small">停用</Tag>),
    },
    createOperationColumn<CmsFragment>({
      width: 160,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        ...(hasPermission('cms:fragment:update') ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => { setEditingRecord(record); setModalVisible(true); },
        }] : []),
        ...(hasPermission('cms:fragment:delete') ? [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该碎片吗？',
              content: '模板中引用该碎片的区域将不再显示',
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
          placeholder="搜索名称/标识..."
          value={draftKeyword}
          onChange={setDraftKeyword}
          showClear
          style={{ width: 200 }}
          onEnterPress={handleSearch}
        />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {hasPermission('cms:fragment:create') ? (
          <Button type="primary" icon={<Plus size={14} />} onClick={() => { setEditingRecord(null); setModalVisible(true); }}>新增</Button>
        ) : null}
      </SearchToolbar>

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={list}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无碎片"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
      />

      <AppModal
        title={editingRecord ? '编辑碎片' : '新增碎片'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={640}
        closeOnEsc
      >
        <Form
          key={editingRecord?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={editingRecord
            ? { code: editingRecord.code, name: editingRecord.name, type: editingRecord.type, content: editingRecord.content ?? '', status: editingRecord.status, remark: editingRecord.remark ?? '' }
            : { type: 'html', status: 'enabled' }}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input field="name" label="碎片名称" rules={[{ required: true, message: '请输入碎片名称' }]} />
          <Form.Input field="code" label="引用标识" disabled={!!editingRecord} placeholder="模板中通过该标识引用，如 home-banner" rules={[{ required: true, message: '请输入引用标识' }]} />
          <Form.Select field="type" label="类型" style={{ width: 200 }}
            optionList={CMS_FRAGMENT_TYPES.map((t) => ({ value: t, label: CMS_FRAGMENT_TYPE_LABELS[t] }))} />
          <Form.TextArea field="content" label="内容" rows={6} placeholder="html 类型填 HTML 片段；image 类型填图片 URL；json 类型填 JSON" />
          <Form.RadioGroup field="status" label="状态">
            <Form.Radio value="enabled">启用</Form.Radio>
            <Form.Radio value="disabled">停用</Form.Radio>
          </Form.RadioGroup>
          <Form.Input field="remark" label="备注" />
        </Form>
      </AppModal>
    </div>
  );
}
