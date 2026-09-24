import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Form, SideSheet, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ChevronsDownUp, ChevronsUpDown, FolderTree, List as ListIcon, ListTree } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn, renderEllipsis, renderEnabledStatusTag } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { useTreeExpansion, type TreeRowKey } from '@/hooks/useTreeExpansion';
import { useListSearch } from '@/hooks/useListSearch';
import { usePagination } from '@/hooks/usePagination';
import {
  useCmsFriendLinkList, useSaveCmsFriendLink, useDeleteCmsFriendLinks, cmsFriendLinkKeys,
  useAllCmsFriendLinkGroups, useCmsFriendLinkGroupList, useSaveCmsFriendLinkGroup, useDeleteCmsFriendLinkGroup,
} from '@/hooks/queries/cms';
import type { CmsFriendLink, CmsFriendLinkGroup } from '@zenith/shared/cms';
import { CmsSiteSelect } from './CmsSiteSelect';
import { CreateButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { abortSubmit } from '@/lib/abort-submit';
import { deleteAction, ListSearchToolbar, listTableProps, useCrudOperationColumn } from '@/components/list-page';
import { FormStatusRadioGroup } from '@/components/FormStatusRadioGroup';
import { useFilterQuery } from '@/hooks/useFilterQuery';
import { EditFormModal } from '@/components/EditFormModal';

interface SearchParams { keyword: string; groupId?: number }
const defaultSearch: SearchParams = { keyword: '', groupId: undefined };

export default function FriendLinksPage() {
  const { hasPermission } = usePermission();
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const {
    page, pageSize, setPage, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: cmsFriendLinkKeys.lists });
  const [groupSheetVisible, setGroupSheetVisible] = useState(false);
  const [groupView, setGroupView] = useState(false);
  const groupOptionsData = useAllCmsFriendLinkGroups(siteId).data;
  const groupOptions = useMemo(() => groupOptionsData ?? [], [groupOptionsData]);

  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useFilterQuery({
    keyword: submittedParams.keyword,
    groupId: submittedParams.groupId,
  });
  const listQuery = useCmsFriendLinkList({
    page, pageSize, siteId: siteId ?? 0,
    ...filterQuery,
  }, siteId !== undefined && !groupView);
  // 分组视图不分页（同服务商配置页惯例）：一次取全量（接口上限 200），按分组聚合展示
  const groupListQuery = useCmsFriendLinkList({
    page: 1, pageSize: 200, siteId: siteId ?? 0,
    ...filterQuery,
  }, siteId !== undefined && groupView);
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

  // 分组视图：按分组排序（分组下拉源顺序，未分组沉底），组内按排序 → id
  const groupOrder = useMemo(() => {
    const order = new Map<number, number>();
    groupOptions.forEach((group, index) => order.set(group.id, index));
    return order;
  }, [groupOptions]);
  const groupedData = useMemo(() => {
    const list = groupListQuery.data?.list ?? [];
    const orderOf = (groupId: number | null) => (groupId == null ? Number.MAX_SAFE_INTEGER : (groupOrder.get(groupId) ?? Number.MAX_SAFE_INTEGER));
    return [...list].sort((a, b) => orderOf(a.groupId) - orderOf(b.groupId) || a.sort - b.sort || a.id - b.id);
  }, [groupListQuery.data, groupOrder]);

  const {
    expandedRowKeys, allRowKeys: allGroupKeys,
    isAllExpanded, toggleExpandAll, setExpandedRowKeys, onExpandedRowsChange,
  } = useTreeExpansion(groupedData, {
    // 展开态的 key 是组 key（groupId，未分组为 0）；onExpandedRowsChange 回传 { groupKey } 行
    collectKeys: (rows) => [...new Set(rows.map((row) => row.groupId ?? 0))],
    getRowKey: (row) => (row && typeof row === 'object' && 'groupKey' in row
      ? (row as { groupKey: TreeRowKey }).groupKey
      : undefined),
  });

  // 首次出现的分组自动展开；已见过的分组保持用户展开/折叠状态，避免刷新时弹回展开
  const seenGroupKeysRef = useRef<Set<TreeRowKey>>(new Set());
  useEffect(() => {
    const newKeys = allGroupKeys.filter((key) => !seenGroupKeysRef.current.has(key));
    if (newKeys.length === 0) return;
    newKeys.forEach((key) => seenGroupKeysRef.current.add(key));
    setExpandedRowKeys((prev) => [...prev, ...newKeys]);
  }, [allGroupKeys, setExpandedRowKeys]);

  const groupNameMap = useMemo(() => new Map(groupOptions.map((group) => [group.id, group.name] as const)), [groupOptions]);
  const groupCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const item of groupedData) {
      const key = item.groupId ?? 0;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [groupedData]);
  const groupNameOf = (key: number): string => {
    if (key === 0) return '未分组';
    return groupNameMap.get(key) ?? groupedData.find((item) => item.groupId === key)?.groupName ?? `分组 #${key}`;
  };

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
        deleteAction({
          hidden: !hasPermission('cms:link:delete'),
          title: '确定要删除该友链吗？',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ],
    }),
  ];

  // 分组视图下分组名已展示在组头，分组列不再重复
  const viewColumns = groupView ? columns.filter((column) => column.dataIndex !== 'groupName') : columns;

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={(
          <>
            <CmsSiteSelect value={siteId} onChange={(v) => { setSiteId(v); setPage(1); }} width={180} />
            <KeywordInput placeholder="搜索名称..." {...bindKeyword('keyword')} width={200} />
          </>
        )}
        filters={(
          <FilterSelect
            placeholder="全部分组"
            items={[
              { value: 0, label: '未分组' },
              ...groupOptions.map((g) => ({ value: g.id, label: g.name })),
            ]}
            {...bind('groupId')}
            width={160}
            disabled={!siteId}
          />
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={<CreateButton permission="cms:link:create" onClick={linkModal.openCreate} />}
        actions={(
          <>
            <Button
              type="tertiary"
              icon={groupView ? <ListIcon size={14} /> : <ListTree size={14} />}
              onClick={() => { setGroupView((value) => !value); setPage(1); }}
            >
              {groupView ? '列表视图' : '分组视图'}
            </Button>
            {groupView ? (
              <Button
                type="tertiary"
                icon={isAllExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
                onClick={toggleExpandAll}
              >
                {isAllExpanded ? '全部折叠' : '全部展开'}
              </Button>
            ) : null}
            <Button icon={<FolderTree size={14} />} disabled={!siteId} onClick={() => setGroupSheetVisible(true)}>分组管理</Button>
          </>
        )}
      />

      {groupView ? (
        // 与列表视图不同 key：Semi Table 会把 expandedRowKeys 存内部 state，
        // 同实例切回列表视图时旧展开 key 残留，第一行会多出一个展开图标
        <ConfigurableTable<CmsFriendLink>
          key="grouped"
          columns={viewColumns}
          {...listTableProps(groupListQuery, { empty: '暂无友情链接' })}
          dataSource={groupedData}
          groupBy={(record?: CmsFriendLink) => record?.groupId ?? 0}
          clickGroupedRowToExpand
          renderGroupSection={(groupKey) => {
            const key = Number(groupKey ?? 0);
            return (
              <>
                <strong>{groupNameOf(key)}</strong>
                <Typography.Text type="tertiary" size="small" style={{ marginLeft: 8 }}>
                  {groupCounts.get(key) ?? 0} 个链接
                </Typography.Text>
              </>
            );
          }}
          expandedRowKeys={expandedRowKeys}
          onExpandedRowsChange={onExpandedRowsChange}
        />
      ) : (
        <ConfigurableTable<CmsFriendLink>
          key="list"
          columns={viewColumns}
          {...listTableProps(listQuery, { pagination: buildPagination, empty: '暂无友情链接' })}
        />
      )}

      <EditFormModal modal={linkModal} width={520}>
        <Form.Input field="name" label="链接名称" rules={[{ required: true, message: '请输入链接名称' }]} />
        <Form.Input field="url" label="链接地址" placeholder="https://..." rules={[{ required: true, message: '请输入链接地址' }]} />
        <Form.Select field="groupId" label="所属分组" showClear style={{ width: '100%' }} placeholder="未分组"
          optionList={groupOptions.map((g) => ({ value: g.id, label: g.name }))} />
        <Form.Input field="logo" label="Logo URL" />
        <Form.InputNumber field="sort" label="排序" style={{ width: 160 }} />
        <FormStatusRadioGroup />
        <Form.Input field="remark" label="备注" />
      </EditFormModal>

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

  const operationColumn = useCrudOperationColumn<CmsFriendLinkGroup>({
    permission: 'cms:link',
    edit: groupModal,
    remove: (record) => deleteMutation.mutateAsync({ params: { id: record.id } }),
    title: '删除后组内友链将转为未分组，确定删除？',
    width: 150,
  });

  const columns: ColumnProps<CmsFriendLinkGroup>[] = [
    { title: '分组名称', dataIndex: 'name', minWidth: 140 },
    { title: '标识', dataIndex: 'code', width: 180, render: renderEllipsis },
    { title: '友链数', dataIndex: 'linkCount', width: 80, align: 'right' },
    { title: '排序', dataIndex: 'sort', width: 70 },
    operationColumn,
  ];

  return (
    <SideSheet title="友链分组管理" visible={visible} onCancel={onClose} width={620}>
      <div style={{ marginBottom: 12 }}>
        <CreateButton permission="cms:link:create" onClick={groupModal.openCreate}>新增分组</CreateButton>
      </div>
      <ConfigurableTable<CmsFriendLinkGroup>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination, empty: '暂无分组' })}
      />
      <EditFormModal modal={groupModal} width={480}>
        <Form.Input field="name" label="分组名称" rules={[{ required: true, message: '请输入分组名称' }]} />
        <Form.Input field="code" label="分组标识" placeholder="如 tech" disabled={groupModal.isEdit}
          extraText="主题按组取数的稳定引用，创建后不可修改"
          rules={[{ required: true, message: '请输入分组标识' }, { pattern: /^[a-z0-9-]+$/, message: '仅支持小写字母、数字、中划线' }]} />
        <Form.InputNumber field="sort" label="排序" style={{ width: 160 }} />
        <FormStatusRadioGroup />
        <Form.Input field="remark" label="备注" />
      </EditFormModal>
    </SideSheet>
  );
}
