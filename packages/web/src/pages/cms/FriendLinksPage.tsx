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
import { createdAtColumn } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useCmsFriendLinkList, useSaveCmsFriendLink, useDeleteCmsFriendLink, cmsFriendLinkKeys } from '@/hooks/queries/cms';
import type { CmsFriendLink } from '@zenith/shared';
import { CmsSiteSelect } from './CmsSiteSelect';

export default function FriendLinksPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const queryClient = useQueryClient();

  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');

  const listQuery = useCmsFriendLinkList({
    page, pageSize, siteId: siteId ?? 0, keyword: submittedKeyword || undefined,
  }, siteId !== undefined);
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CmsFriendLink | null>(null);
  const saveMutation = useSaveCmsFriendLink();
  const deleteMutation = useDeleteCmsFriendLink();

  function handleSearch() {
    setPage(1);
    setSubmittedKeyword(draftKeyword);
    void queryClient.invalidateQueries({ queryKey: cmsFriendLinkKeys.lists });
  }

  function handleReset() {
    setPage(1);
    setDraftKeyword('');
    setSubmittedKeyword('');
    void queryClient.invalidateQueries({ queryKey: cmsFriendLinkKeys.lists });
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

  const columns: ColumnProps<CmsFriendLink>[] = [
    { title: '链接名称', dataIndex: 'name', width: 180 },
    {
      title: '链接地址',
      dataIndex: 'url',
      width: 300,
      render: (v: string) => <a href={v} target="_blank" rel="noopener noreferrer">{v}</a>,
    },
    { title: '排序', dataIndex: 'sort', width: 80 },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      fixed: 'right',
      render: (v: string) => (v === 'enabled' ? <Tag color="green" size="small">启用</Tag> : <Tag color="red" size="small">停用</Tag>),
    },
    createOperationColumn<CmsFriendLink>({
      width: 160,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        ...(hasPermission('cms:link:update') ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => { setEditingRecord(record); setModalVisible(true); },
        }] : []),
        ...(hasPermission('cms:link:delete') ? [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该友链吗？',
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
          placeholder="搜索名称..."
          value={draftKeyword}
          onChange={setDraftKeyword}
          showClear
          style={{ width: 200 }}
          onEnterPress={handleSearch}
        />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {hasPermission('cms:link:create') ? (
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
        empty="暂无友情链接"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
      />

      <AppModal
        title={editingRecord ? '编辑友链' : '新增友链'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={520}
        closeOnEsc
      >
        <Form
          key={editingRecord?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={editingRecord
            ? { name: editingRecord.name, url: editingRecord.url, logo: editingRecord.logo ?? '', sort: editingRecord.sort, status: editingRecord.status, remark: editingRecord.remark ?? '' }
            : { sort: 0, status: 'enabled' }}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input field="name" label="链接名称" rules={[{ required: true, message: '请输入链接名称' }]} />
          <Form.Input field="url" label="链接地址" placeholder="https://..." rules={[{ required: true, message: '请输入链接地址' }]} />
          <Form.Input field="logo" label="Logo URL" />
          <Form.InputNumber field="sort" label="排序" style={{ width: 160 }} />
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
