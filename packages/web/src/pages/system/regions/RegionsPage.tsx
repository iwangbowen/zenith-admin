import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Form, Spin, Toast, Switch } from '@douyinfe/semi-ui';
import type { CascaderData } from '@douyinfe/semi-ui/lib/es/cascader';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import type { CreateRegionInput, Region } from '@zenith/shared/platform';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { useDictItems } from '@/hooks/useDictItems';
import { createdAtColumn } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { regionKeys, useDeleteRegion, useFlatRegions, useRegionDetail, useRegionTree, useSaveRegion } from '@/hooks/queries/regions';
import { useEditModal } from '@/hooks/useEditModal';
import { useListSearch } from '@/hooks/useListSearch';
import { useTreeExpansion } from '@/hooks/useTreeExpansion';
import { REGION_LEVELS, REGION_LEVEL_LABELS } from '@zenith/shared/platform';
import { enumValueOf, USER_STATUSES } from '@zenith/shared/core';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDelete, confirmDangerAsync } from '@/utils/confirm';

const LEVEL_LABELS: Record<string, string> = REGION_LEVEL_LABELS;

const LEVEL_OPTIONS = (Object.keys(REGION_LEVEL_LABELS) as Array<keyof typeof REGION_LEVEL_LABELS>).map((value) => ({ value, label: REGION_LEVEL_LABELS[value] }));

interface SearchParams {
  keyword: string;
  status?: string;
  level?: string;
}

const defaultSearchParams: SearchParams = { keyword: '', status: undefined, level: '' };

export default function RegionsPage() {
  const { hasPermission } = usePermission();

  const {
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: regionKeys.trees });
  const [editingLevel, setEditingLevel] = useState<string>('province');
  const [tableHeight, setTableHeight] = useState(500);
  const tableWrapperRef = useRef<HTMLDivElement>(null);

  const { items: statusItems } = useDictItems('common_status');
  const treeQuery = useRegionTree({
    keyword: submittedParams.keyword || undefined,
    status: enumValueOf(USER_STATUSES, submittedParams.status),
    level: enumValueOf(REGION_LEVELS, submittedParams.level),
  });
  const data = useMemo(() => treeQuery.data ?? [], [treeQuery.data]);
  const flatQuery = useFlatRegions();
  const flatData = useMemo(() => flatQuery.data ?? [], [flatQuery.data]);
  const saveMutation = useSaveRegion();
  const regionModal = useEditModal<Region, Record<string, unknown>, Partial<CreateRegionInput>>({
    entityName: '地区',
    save: saveMutation,
    useDetail: useRegionDetail,
    defaults: { level: 'province', sort: 0, status: 'enabled' },
    toValues: (region) => ({
      code: region.code,
      name: region.name,
      level: region.level,
      parentCode: buildCascaderPath(region.parentCode),
      sort: region.sort,
      status: region.status,
    }),
    beforeSave: (values) => {
      const parentCodeArr = Array.isArray(values.parentCode) ? values.parentCode : [];
      return {
        ...values,
        parentCode: values.level === 'province' ? null : (parentCodeArr.at(-1) ?? null),
      } as Partial<CreateRegionInput>;
    },
  });
  const toggleStatusMutation = useSaveRegion();
  const deleteMutation = useDeleteRegion();
  const togglingStatusId = toggleStatusMutation.isPending ? (toggleStatusMutation.variables?.id ?? null) : null;

  useEffect(() => {
    const el = tableWrapperRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setTableHeight(Math.floor(entry.contentRect.height));
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (regionModal.visible && regionModal.editing) setEditingLevel(regionModal.editing.level);
  }, [regionModal.visible, regionModal.editing]);

  const { expandedRowKeys, isAllExpanded, toggleExpandAll, onExpandedRowsChange } = useTreeExpansion(data);

  function openCreate() {
    setEditingLevel('province');
    regionModal.openCreate();
  }

  function openEdit(record: Region) {
    setEditingLevel(record.level);
    regionModal.openEdit(record);
  }

  // 构建 Cascader 树数据：省→市 两级
  const cascaderTreeData = useMemo<CascaderData[]>(() => {
    const provinces = flatData.filter((r) => r.level === 'province');
    const cities = flatData.filter((r) => r.level === 'city');
    return provinces.map((prov) => ({
      value: prov.code,
      label: `${prov.name}（${prov.code}）`,
      children: cities
        .filter((c) => c.parentCode === prov.code)
        .map((c) => ({ value: c.code, label: `${c.name}（${c.code}）` })),
    }));
  }, [flatData]);

  // 根据 editingLevel 决定展示的 treeData（市级只需一层省，县级需省→市两层）
  const parentTreeData = useMemo<CascaderData[]>(() => {
    if (editingLevel === 'city') {
      return cascaderTreeData.map(({ children: _c, ...rest }) => rest);
    }
    return cascaderTreeData;
  }, [cascaderTreeData, editingLevel]);

  // 从 parentCode 反推 Cascader 路径（用于编辑回显）
  function buildCascaderPath(parentCode: string | null | undefined): string[] {
    if (!parentCode) return [];
    const target = flatData.find((r) => r.code === parentCode);
    if (!target) return [parentCode];
    if (target.level === 'province') return [target.code];
    if (target.level === 'city' && target.parentCode) return [target.parentCode, target.code];
    return [parentCode];
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync({ params: { id } });
    Toast.success('删除成功');
  }

  const handleToggleStatus = useCallback(async (region: Region, newStatus: 'enabled' | 'disabled') => {
    if (newStatus === 'disabled') {
      const confirmed = await confirmDangerAsync({
        title: `确认禁用「${region.name}」？`,
        okText: '确认禁用',
      });
      if (!confirmed) return;
    }
    toggleStatusMutation.mutate(
      { id: region.id, values: { status: newStatus } },
      { onSuccess: () => Toast.success(newStatus === 'enabled' ? '已启用' : '已禁用') },
    );
  }, [toggleStatusMutation]);

  const columns: ColumnProps<Region>[] = [
    {
      title: '地区名称',
      dataIndex: 'name',
      minWidth: 400,
    },
    {
      title: '区划代码',
      dataIndex: 'code',
      width: 140,
    },
    {
      title: '级别',
      dataIndex: 'level',
      width: 90,
      render: (val: string) => LEVEL_LABELS[val] ?? val,
    },
    {
      title: '父级代码',
      dataIndex: 'parentCode',
      width: 120,
      render: (val: string | null) => val ?? '—',
    },
    {
      title: '排序',
      dataIndex: 'sort',
      width: 70,
      align: 'center',
    },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      align: 'center',
      fixed: 'right',
      render: (v: string, record: Region) => (
        <Switch
          size="small"
          checked={v === 'enabled'}
          loading={togglingStatusId === record.id}
          disabled={!hasPermission('system:region:update')}
          onChange={(checked: boolean) => void handleToggleStatus(record, checked ? 'enabled' : 'disabled')}
        />
      ),
    },
    createOperationColumn<Region>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('system:region:update'),
          onClick: () => { void openEdit(record); },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('system:region:delete'),
          onClick: () => {
            confirmDelete({
              title: '确定要删除该地区吗？',
              content: '若有子地区，需先删除子地区',
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="搜索名称或代码..." value={draftParams.keyword} onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} onSearch={handleSearch} />
  );

  const renderLevelFilter = () => (
    <FilterSelect
      placeholder="全部级别"
      items={LEVEL_OPTIONS}
      value={draftParams.level}
      onChange={(v) => setDraftParams((p) => ({ ...p, level: v }))}
    />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={statusItems}
      value={draftParams.status}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))}
    />
  );

  const renderSearchButton = () => <SearchButton onClick={handleSearch} />;
  const renderResetButton = () => <ResetButton onClick={handleReset} />;
  const renderExpandButton = () => (
    <Button
      type="primary"
      icon={isAllExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
      onClick={toggleExpandAll}
    >
      {isAllExpanded ? '全部折叠' : '全部展开'}
    </Button>
  );
  const buildExportQuery = () => ({
    ...(submittedParams.keyword ? { keyword: submittedParams.keyword } : {}),
    ...(submittedParams.status ? { status: submittedParams.status } : {}),
    ...(submittedParams.level ? { level: submittedParams.level } : {}),
  });
  const renderExportButtons = () => hasPermission('system:region:export') ? (
    <ExportButton entity="system.regions" query={buildExportQuery()} />
  ) : null;
  const renderMobileExportActions = () => hasPermission('system:region:export') ? (
    <ExportButton entity="system.regions" query={buildExportQuery()} variant="flat" />
  ) : null;
  const renderCreateButton = () => hasPermission('system:region:create') ? (
    <CreateButton onClick={openCreate} />
  ) : null;

  return (
    <div className="page-container regions-page" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderLevelFilter()}
            {renderStatusFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderExpandButton()}
            {renderExportButtons()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderLevelFilter()}
            {renderStatusFilter()}
          </>
        )}
        mobileActions={(
          <>
            {renderExpandButton()}
            {renderMobileExportActions()}
          </>
        )}
        filterTitle="地区筛选"
        actionTitle="地区操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <div ref={tableWrapperRef} style={{ flex: 1, minHeight: 0 }}>
        <ConfigurableTable
          bordered
          columns={columns}
          dataSource={data}
          loading={treeQuery.isFetching}
          onRefresh={() => void treeQuery.refetch()}
          refreshLoading={treeQuery.isFetching}
          rowKey="id"
          size="small"
        expandedRowKeys={expandedRowKeys}
        onExpandedRowsChange={onExpandedRowsChange}
        childrenRecordName="children"
        pagination={false}
        virtualized
        scroll={{ y: tableHeight }}
      />
      </div>

      <AppModal {...regionModal.modalProps} width={520}>
        <Spin spinning={regionModal.detailLoading} wrapperClassName="modal-spin-wrapper">
        <Form key={regionModal.formKey} {...regionModal.formProps}>
          <Form.Select
            field="level"
            label="级别"
            optionList={LEVEL_OPTIONS}
            rules={[{ required: true, message: '请选择级别' }]}
            onChange={(v) => setEditingLevel(v as string)}
            placeholder="请选择级别"
            style={{ width: '100%' }}
          />
          {editingLevel !== 'province' && (
            <Form.Cascader
              field="parentCode"
              label="父级地区"
              placeholder={flatQuery.isFetching ? '加载父级地区中...' : '请选择父级地区'}
              treeData={parentTreeData}
              changeOnSelect
              filterTreeNode
              showClear
              disabled={flatQuery.isFetching}
              rules={[{ required: true, message: '请选择父级地区' }]}
              style={{ width: '100%' }}
            />
          )}
          <Form.Input
            field="code"
            label="区划代码"
            placeholder="请输入区划代码"
            rules={[{ required: true, message: '区划代码不能为空' }]}
          />
          <Form.Input
            field="name"
            label="地区名称"
            placeholder="请输入地区名称"
            rules={[{ required: true, message: '名称不能为空' }]}
          />
          <Form.InputNumber
            field="sort"
            label="排序"
            placeholder="排序值"
            min={0}
            style={{ width: '100%' }}
          />
          <Form.Select
            field="status"
            label="状态"
            optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
            rules={[{ required: true, message: '请选择状态' }]}
            placeholder="请选择状态"
            style={{ width: '100%' }}
          />
        </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
