import { useState } from 'react';
import { Button, Form, SideSheet, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { FolderTree } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { createdAtColumn, renderEnabledStatusTag } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { useListSearch } from '@/hooks/useListSearch';
import { usePagination } from '@/hooks/usePagination';
import {
  useCmsFriendLinkList, useSaveCmsFriendLink, useDeleteCmsFriendLinks, cmsFriendLinkKeys,
  useAllCmsFriendLinkGroups, useCmsFriendLinkGroupList, useSaveCmsFriendLinkGroup, useDeleteCmsFriendLinkGroup,
} from '@/hooks/queries/cms';
import type { CmsFriendLink, CmsFriendLinkGroup } from '@zenith/shared/cms';
import { CmsSiteSelect } from './CmsSiteSelect';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { abortSubmit } from '@/lib/abort-submit';

interface SearchParams { keyword: string; groupId?: number }
const defaultSearch: SearchParams = { keyword: '', groupId: undefined };

export default function FriendLinksPage() {
  const { hasPermission } = usePermission();
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const {
    page, pageSize, setPage, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: cmsFriendLinkKeys.lists });
  const [groupSheetVisible, setGroupSheetVisible] = useState(false);
  const groupOptions = useAllCmsFriendLinkGroups(siteId).data ?? [];

  const listQuery = useCmsFriendLinkList({
    page, pageSize, siteId: siteId ?? 0,
    keyword: submittedParams.keyword || undefined,
    groupId: submittedParams.groupId,
  }, siteId !== undefined);
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const saveMutation = useSaveCmsFriendLink();
  const linkModal = useEditModal<CmsFriendLink, Partial<CmsFriendLink>, Record<string, unknown>>({
    entityName: '友链',
    save: saveMutation,
    defaults: { sort: 0, status: 'enabled' },
    toValues: (record) => ({ name: record.name, url: record.url, logo: record.logo ?? '', groupId: record.groupId ?? null, sort: record.sort, status: record.status, remark: record.remark ?? '' }),
    beforeSave: (values, { isEdit }) => {
      if (!isEdit && !siteId) abortSubmit('validation');
      return {
        ...values,
        // Semi's clearable Select yields undefined; retain an explicit null so
        // the PATCH removes the previous group instead of omitting the field.
        groupId: values.groupId == null ? null : values.groupId,
        ...(!isEdit ? { siteId } : {}),
      };
    },
  });
  const deleteMutation = useDeleteCmsFriendLinks();

  const columns: ColumnProps<CmsFriendLink>[] = [
    { title: '链接名称', dataIndex: 'name', width: 180 },
    {
      title: '分组', dataIndex: 'groupName', width: 120,
      render: (v: string | null) => v ?? <Typography.Text type="tertiary">未分组</Typography.Text>,
    },
    {
      title: '链接地址',
      dataIndex: 'url',
      minWidth: 300,
      render: (v: string) => <a href={v} target="_blank" rel="noopener noreferrer">{v}</a>,
    },
    { title: '排序', dataIndex: 'sort', width: 80 },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      fixed: 'right',
      render: renderEnabledStatusTag,
    },
    createOperationColumn<CmsFriendLink>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        ...(hasPermission('cms:link:update') ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => linkModal.openEdit(record),
        }] : []),
        ...(hasPermission('cms:link:delete') ? [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            confirmDelete({
              title: '确定要删除该友链吗？',
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
        <KeywordInput placeholder="搜索名称..." value={draftParams.keyword} onChange={(keyword) => setDraftParams((current) => ({ ...current, keyword }))} onSearch={handleSearch} width={200} />
        <FilterSelect
          placeholder="全部分组"
          items={[
            { value: 0, label: '未分组' },
            ...groupOptions.map((g) => ({ value: g.id, label: g.name })),
          ]}
          value={draftParams.groupId}
          onChange={(v) => setDraftParams((current) => ({ ...current, groupId: v }))}
          width={160}
          disabled={!siteId}
        />
        <SearchButton onClick={handleSearch} />
        <ResetButton onClick={handleReset} />
        {hasPermission('cms:link:create') ? (
          <CreateButton onClick={linkModal.openCreate} />
        ) : null}
        <Button icon={<FolderTree size={14} />} disabled={!siteId} onClick={() => setGroupSheetVisible(true)}>分组管理</Button>
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

      <AppModal {...linkModal.modalProps} width={520}>
        <Form key={linkModal.formKey} {...linkModal.formProps}>
          <Form.Input field="name" label="链接名称" rules={[{ required: true, message: '请输入链接名称' }]} />
          <Form.Input field="url" label="链接地址" placeholder="https://..." rules={[{ required: true, message: '请输入链接地址' }]} />
          <Form.Select field="groupId" label="所属分组" showClear style={{ width: '100%' }} placeholder="未分组"
            optionList={groupOptions.map((g) => ({ value: g.id, label: g.name }))} />
          <Form.Input field="logo" label="Logo URL" />
          <Form.InputNumber field="sort" label="排序" style={{ width: 160 }} />
          <Form.RadioGroup field="status" label="状态">
            <Form.Radio value="enabled">启用</Form.Radio>
            <Form.Radio value="disabled">停用</Form.Radio>
          </Form.RadioGroup>
          <Form.Input field="remark" label="备注" />
        </Form>
      </AppModal>

      <FriendLinkGroupSheet
        siteId={siteId}
        visible={groupSheetVisible}
        onClose={() => setGroupSheetVisible(false)}
      />
    </div>
  );
}

/** 友链分组管理：独立抽屉内做分组 CRUD，避免主列表页承载两套实体的表单 */
function FriendLinkGroupSheet({ siteId, visible, onClose }: Readonly<{
  siteId: number | undefined; visible: boolean; onClose: () => void;
}>) {
  const { hasPermission } = usePermission();
  const { page, pageSize, buildPagination } = usePagination();
  const listQuery = useCmsFriendLinkGroupList({ page, pageSize, siteId: siteId ?? 0 }, visible && siteId !== undefined);
  const saveMutation = useSaveCmsFriendLinkGroup();
  const groupModal = useEditModal<CmsFriendLinkGroup, Partial<CmsFriendLinkGroup>, Record<string, unknown>>({
    entityName: '分组',
    save: saveMutation,
    defaults: { sort: 0, status: 'enabled' },
    toValues: (record) => ({ name: record.name, code: record.code, sort: record.sort, status: record.status, remark: record.remark ?? '' }),
    beforeSave: (values, { isEdit }) => {
      if (!isEdit && !siteId) abortSubmit('validation');
      return { ...values, ...(!isEdit ? { siteId } : {}) };
    },
  });
  const deleteMutation = useDeleteCmsFriendLinkGroup();

  const columns: ColumnProps<CmsFriendLinkGroup>[] = [
    { title: '分组名称', dataIndex: 'name', minWidth: 140 },
    { title: '标识', dataIndex: 'code', width: 120 },
    { title: '友链数', dataIndex: 'linkCount', width: 80, align: 'right' },
    { title: '排序', dataIndex: 'sort', width: 70 },
    createOperationColumn<CmsFriendLinkGroup>({
      width: 150,
      actions: (record) => [
        { key: 'edit', label: '编辑', hidden: !hasPermission('cms:link:update'), onClick: () => groupModal.openEdit(record) },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('cms:link:delete'),
          confirm: { title: '删除后组内友链将转为未分组，确定删除？' },
          onClick: async () => { await deleteMutation.mutateAsync(record.id); Toast.success('删除成功'); },
        },
      ],
    }),
  ];

  return (
    <SideSheet title="友链分组管理" visible={visible} onCancel={onClose} width={620}>
      <div style={{ marginBottom: 12 }}>
        {hasPermission('cms:link:create') ? (
          <CreateButton onClick={groupModal.openCreate}>新增分组</CreateButton>
        ) : null}
      </div>
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={listQuery.data?.list ?? []}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无分组"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(listQuery.data?.total ?? 0)}
      />
      <AppModal {...groupModal.modalProps} width={480}>
        <Form key={groupModal.formKey} {...groupModal.formProps}>
          <Form.Input field="name" label="分组名称" rules={[{ required: true, message: '请输入分组名称' }]} />
          <Form.Input field="code" label="分组标识" placeholder="如 tech" disabled={groupModal.isEdit}
            extraText="主题按组取数的稳定引用，创建后不可修改"
            rules={[{ required: true, message: '请输入分组标识' }, { pattern: /^[a-z0-9-]+$/, message: '仅支持小写字母、数字、中划线' }]} />
          <Form.InputNumber field="sort" label="排序" style={{ width: 160 }} />
          <Form.RadioGroup field="status" label="状态">
            <Form.Radio value="enabled">启用</Form.Radio>
            <Form.Radio value="disabled">停用</Form.Radio>
          </Form.RadioGroup>
          <Form.Input field="remark" label="备注" />
        </Form>
      </AppModal>
    </SideSheet>
  );
}
