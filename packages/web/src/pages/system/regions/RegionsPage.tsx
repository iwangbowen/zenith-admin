import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Form,
  Input,
  Modal,
  Select,
  Spin,
  Toast,
  Switch,
} from '@douyinfe/semi-ui';
import type { CascaderData } from '@douyinfe/semi-ui/lib/es/cascader';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import type { Region } from '@zenith/shared';
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
import { REGION_LEVEL_LABELS } from '@zenith/shared';

const LEVEL_LABELS: Record<string, string> = REGION_LEVEL_LABELS;

const LEVEL_OPTIONS = (Object.keys(REGION_LEVEL_LABELS) as Array<keyof typeof REGION_LEVEL_LABELS>).map((value) => ({ value, label: REGION_LEVEL_LABELS[value] }));

interface SearchParams {
  keyword: string;
  status: string;
  level: string;
}

const defaultSearchParams: SearchParams = { keyword: '', status: '', level: '' };

export default function RegionsPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi | null>(null);

  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRegion, setEditingRegion] = useState<Region | null>(null);
  const [editingLevel, setEditingLevel] = useState<string>('province');
  const [expandedRowKeys, setExpandedRowKeys] = useState<(string | number)[]>([]);
  const [tableHeight, setTableHeight] = useState(500);
  const [tableWidth, setTableWidth] = useState(0);
  const tableWrapperRef = useRef<HTMLDivElement>(null);

  const { items: statusItems } = useDictItems('common_status');
  const treeQuery = useRegionTree({
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
    level: submittedParams.level || undefined,
  });
  const data = useMemo(() => treeQuery.data ?? [], [treeQuery.data]);
  const flatQuery = useFlatRegions({ enabled: modalVisible });
  const flatData = useMemo(() => flatQuery.data ?? [], [flatQuery.data]);
  const detailQuery = useRegionDetail(editingRegion?.id, modalVisible && !!editingRegion);
  const activeRegion = editingRegion ? (detailQuery.data ?? editingRegion) : null;
  const modalDetailLoading = !!editingRegion && detailQuery.isFetching;
  const saveMutation = useSaveRegion();
  const toggleStatusMutation = useSaveRegion();
  const deleteMutation = useDeleteRegion();
  const togglingStatusId = toggleStatusMutation.isPending ? (toggleStatusMutation.variables?.id ?? null) : null;

  useEffect(() => {
    const el = tableWrapperRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setTableHeight(Math.floor(entry.contentRect.height));
        setTableWidth(Math.floor(entry.contentRect.width));
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const detail = detailQuery.data;
    if (!detail || !modalVisible || !editingRegion || detail.id !== editingRegion.id) return;
    setEditingRegion(detail);
    setEditingLevel(detail.level);
  }, [detailQuery.data, editingRegion, modalVisible]);

  function handleSearch() {
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: regionKeys.trees });
  }

  function handleReset() {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    void queryClient.invalidateQueries({ queryKey: regionKeys.trees });
  }

  // 递归收集所有节点 ID
  const allRowKeys = useMemo(() => {
    const keys: number[] = [];
    function collect(items: Region[]) {
      for (const item of items) {
        keys.push(item.id);
        if (item.children?.length) collect(item.children);
      }
    }
    collect(data);
    return keys;
  }, [data]);

  const isAllExpanded = expandedRowKeys.length > 0 && expandedRowKeys.length >= allRowKeys.length;

  function toggleExpandAll() {
    setExpandedRowKeys(isAllExpanded ? [] : allRowKeys);
  }

  function openCreate() {
    setEditingRegion(null);
    setEditingLevel('province');
    setModalVisible(true);
  }

  function openEdit(record: Region) {
    setEditingRegion(record);
    setEditingLevel(record.level);
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    setEditingRegion(null);
    setEditingLevel('province');
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

  const formInitValues = activeRegion
    ? {
        code: activeRegion.code,
        name: activeRegion.name,
        level: activeRegion.level,
        parentCode: buildCascaderPath(activeRegion.parentCode),
        sort: activeRegion.sort,
        status: activeRegion.status,
      }
    : { level: 'province', sort: 0, status: 'enabled' };

  async function handleModalOk() {
    let values;
    try {
      values = await formApi.current?.validate();
    } catch {
      throw new Error('validation');
    }
    if (!values) throw new Error('validation');

    const parentCodeArr = Array.isArray(values.parentCode) ? values.parentCode : [];
    const payload = {
      ...values,
      parentCode: values.level === 'province' ? null : (parentCodeArr.at(-1) ?? null),
    };

    await saveMutation.mutateAsync({ id: editingRegion?.id, values: payload });
    Toast.success(editingRegion ? '更新成功' : '创建成功');
    closeModal();
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  }

  const handleToggleStatus = useCallback(async (region: Region, newStatus: 'enabled' | 'disabled') => {
    if (newStatus === 'disabled') {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: `确认禁用「${region.name}」？`,
          okButtonProps: { type: 'danger', theme: 'solid' },
          okText: '确认禁用',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }
    toggleStatusMutation.mutate(
      { id: region.id, values: { status: newStatus } },
      { onSuccess: () => Toast.success(newStatus === 'enabled' ? '已启用' : '已禁用') },
    );
  }, [toggleStatusMutation]);

  const FIXED_COLS_WIDTH = 140 + 90 + 120 + 70 + 180 + 90 + 160; // 其他列总宽
  // 地区名列宽度：不动态自适应容器，保持固定最小宽度，这样内容宽度 (total) 能超出容器，使 fixed:right 生效
  const nameColWidth = Math.max(400, tableWidth - FIXED_COLS_WIDTH);
  const totalTableWidth = nameColWidth + FIXED_COLS_WIDTH;

  const columns: ColumnProps<Region>[] = [
    {
      title: '地区名称',
      dataIndex: 'name',
      width: nameColWidth,
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
      width: 160,
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
            Modal.confirm({
              title: '确定要删除该地区吗？',
              content: '若有子地区，需先删除子地区',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索名称或代码..."
      value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))}
      showClear
      style={{ width: 220, maxWidth: '100%' }}
      onEnterPress={handleSearch}
    />
  );

  const renderLevelFilter = () => (
    <Select
      placeholder="全部级别"
      value={draftParams.level || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, level: (v as string) ?? '' }))}
      showClear
      style={{ width: 110, maxWidth: '100%' }}
      optionList={LEVEL_OPTIONS}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="全部状态"
      value={draftParams.status || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: (v as string) ?? '' }))}
      showClear
      style={{ width: 110, maxWidth: '100%' }}
      optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
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
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>
      新增
    </Button>
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
        onExpandedRowsChange={(rows) => setExpandedRowKeys(rows?.filter((r): r is Region => 'id' in r).map((r) => r.id) ?? [])}
        childrenRecordName="children"
        pagination={false}
        virtualized
        scroll={{ y: tableHeight, x: tableWidth || totalTableWidth }}
      />
      </div>

      <AppModal
        title={editingRegion ? '编辑地区' : '新增地区'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ disabled: modalDetailLoading }}
        width={520}
      >
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
        <Form
          key={editingRegion?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={90}
        >
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
