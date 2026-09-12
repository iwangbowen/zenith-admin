import { useEffect, useMemo, useState } from 'react';
import { Button, Form, Spin } from '@douyinfe/semi-ui';
import type { CascaderData } from '@douyinfe/semi-ui/lib/es/cascader';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import type { CreateRegionInput, Region } from '@zenith/shared/platform';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { useDictItems } from '@/hooks/useDictItems';
import { createdAtColumn, EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import ExportButton from '@/components/ExportButton';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { regionKeys, useDeleteRegion, useFlatRegions, useRegionDetail, useRegionTree, useSaveRegion } from '@/hooks/queries/regions';
import { useEditModal } from '@/hooks/useEditModal';
import { useElementSize } from '@/hooks/useElementSize';
import { useListSearch } from '@/hooks/useListSearch';
import { useTreeExpansion } from '@/hooks/useTreeExpansion';
import { REGION_LEVELS, REGION_LEVEL_LABELS } from '@zenith/shared/platform';
import { enumValueOf, USER_STATUSES } from '@zenith/shared/core';
import { CreateButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { deleteAction, ListSearchToolbar, listTableProps, useStatusToggle } from '@/components/list-page';
import { compactParams } from '@/lib/query';

const LEVEL_LABELS: Record<string, string> = REGION_LEVEL_LABELS;

const LEVEL_OPTIONS = (Object.keys(REGION_LEVEL_LABELS) as Array<keyof typeof REGION_LEVEL_LABELS>).map((value) => ({ value, label: REGION_LEVEL_LABELS[value] }));

interface SearchParams {
  keyword: string;
  status?: string;
  level?: string;
}

const defaultSearchParams: SearchParams = { keyword: '', status: undefined, level: undefined };

export default function RegionsPage() {
  const { hasPermission } = usePermission();

  const {
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: regionKeys.trees });
  const [editingLevel, setEditingLevel] = useState<string>('province');
  const { ref: tableWrapperRef, height: tableHeight } = useElementSize<HTMLDivElement>({ height: 500 });

  const { items: statusItems, options: statusOptions } = useDictItems('common_status');
  // 已提交筛选 → 契约查询参数：树列表与导出共用同一份映射
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword,
    status: enumValueOf(USER_STATUSES, submittedParams.status),
    level: enumValueOf(REGION_LEVELS, submittedParams.level),
  }), [submittedParams]);
  const treeQuery = useRegionTree(filterQuery);
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
  const status = useStatusToggle<Region>({
    toggle: (region, enabled) => toggleStatusMutation.mutateAsync({ id: region.id, values: { status: enabled ? 'enabled' : 'disabled' } }),
    confirmDisable: (region) => ({ danger: true, title: `确认禁用「${region.name}」？`, okText: '确认禁用' }),
    disabled: !hasPermission('system:region:update'),
  });

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
      render: (val: string | null) => val ?? EMPTY_PLACEHOLDER,
    },
    {
      title: '排序',
      dataIndex: 'sort',
      width: 70,
      align: 'center',
    },
    createdAtColumn,
    status.column(),
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
        deleteAction({
          hidden: !hasPermission('system:region:delete'),
          title: '确定要删除该地区吗？',
          content: '若有子地区，需先删除子地区',
          run: () => deleteMutation.mutateAsync({ params: { id: record.id } }),
        }),
      ],
    }),
  ];

  const renderExpandButton = () => (
    <Button
      type="primary"
      icon={isAllExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
      onClick={toggleExpandAll}
    >
      {isAllExpanded ? '全部折叠' : '全部展开'}
    </Button>
  );

  return (
    <div className="page-container regions-page" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索名称或代码..." {...bindKeyword('keyword')} />}
        filters={(
          <>
            <FilterSelect
              placeholder="全部级别"
              items={LEVEL_OPTIONS}
              {...bind('level')}
            />
            <StatusSelect
              items={statusItems}
              {...bind('status')}
            />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={(
          hasPermission('system:region:create') ? (
            <CreateButton onClick={openCreate} />
          ) : null
        )}
        actions={(
          <>
            {renderExpandButton()}
            {<ExportButton entity="system.regions" query={filterQuery} permission="system:region:export" />}
          </>
        )}
        mobileActions={(
          <>
            {renderExpandButton()}
            {<ExportButton entity="system.regions" query={filterQuery} variant="flat" permission="system:region:export" />}
          </>
        )}
        filterTitle="地区筛选"
        actionTitle="地区操作"
      />

      <div ref={tableWrapperRef} style={{ flex: 1, minHeight: 0 }}>
        <ConfigurableTable
          columns={columns}
          {...listTableProps(treeQuery)}
          expandedRowKeys={expandedRowKeys}
          onExpandedRowsChange={onExpandedRowsChange}
          childrenRecordName="children"
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
            optionList={statusOptions}
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
