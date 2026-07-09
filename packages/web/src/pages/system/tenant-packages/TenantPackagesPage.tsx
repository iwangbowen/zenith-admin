import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Input,
  Select,
  Modal,
  Form,
  Toast,
  Spin,
  Switch,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { TenantPackage } from '@zenith/shared';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { MenuPermissionPanel } from '@/components/permissions/MenuPermissionPanel';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useDictItems } from '@/hooks/useDictItems';
import { useMenuTree } from '@/hooks/queries/menus';
import { useQueryClient } from '@tanstack/react-query';
import {
  tenantPackageKeys,
  useAssignTenantPackageMenus,
  useDeleteTenantPackages,
  useSaveTenantPackage,
  useTenantPackageDetail,
  useTenantPackageList,
} from '@/hooks/queries/tenant-packages';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import { createOperationColumn } from '@/components/ResponsiveTableActions';

interface SearchParams {
  keyword: string;
  status: string;
}

const defaultSearchParams: SearchParams = { keyword: '', status: '' };

export default function TenantPackagesPage() {
  const { hasPermission } = usePermission();
  const { items: statusItems } = useDictItems('common_status');
  const formApi = useRef<FormApi | null>(null);
  const queryClient = useQueryClient();

  const { page, pageSize, setPage, buildPagination } = usePagination();
  // draft：搜索区输入中的条件；submitted：点击查询后实际生效的条件（进入 query key）
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

  const listQuery = useTenantPackageList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  // 新增/编辑弹窗
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<TenantPackage | null>(null);
  const detailQuery = useTenantPackageDetail(editingRecord?.id, modalVisible);
  const editing = editingRecord ? (detailQuery.data ?? editingRecord) : null;
  const modalDetailLoading = !!editingRecord && detailQuery.isFetching;

  // 分配菜单弹窗
  const [menuModalVisible, setMenuModalVisible] = useState(false);
  const [menuPackage, setMenuPackage] = useState<TenantPackage | null>(null);
  const [checkedMenuIds, setCheckedMenuIds] = useState<number[]>([]);
  const menuTreeQuery = useMenuTree({ enabled: menuModalVisible });
  const menuDetailQuery = useTenantPackageDetail(menuPackage?.id, menuModalVisible);

  useEffect(() => {
    if (menuModalVisible) setCheckedMenuIds(menuDetailQuery.data?.menuIds ?? []);
  }, [menuModalVisible, menuDetailQuery.data]);

  const saveMutation = useSaveTenantPackage();
  const toggleStatusMutation = useSaveTenantPackage();
  const deleteMutation = useDeleteTenantPackages();
  const assignMenusMutation = useAssignTenantPackageMenus();

  const togglingStatusId = toggleStatusMutation.isPending ? (toggleStatusMutation.variables?.id ?? null) : null;

  function handleSearch() {
    setPage(1);
    setSubmittedParams(draftParams);
    // 条件未变化时 query key 不变，显式失效以保证点击「查询」必定回源刷新
    void queryClient.invalidateQueries({ queryKey: tenantPackageKeys.lists });
  }

  function handleReset() {
    setPage(1);
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    void queryClient.invalidateQueries({ queryKey: tenantPackageKeys.lists });
  }

  function openCreate() {
    setEditingRecord(null);
    setModalVisible(true);
  }

  function openEdit(record: TenantPackage) {
    setEditingRecord(record);
    setModalVisible(true);
  }

  const handleModalOk = async () => {
    let values;
    try {
      values = await formApi.current!.validate();
    } catch {
      throw new Error('validation');
    }
    await saveMutation.mutateAsync({ id: editingRecord?.id, values });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingRecord(null);
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync([id]);
    Toast.success('删除成功');
  };

  const handleBatchDelete = () => {
    Modal.confirm({
      title: `确认删除选中的 ${selectedRowKeys.length} 个套餐？`,
      content: '删除后无法恢复，已绑定该套餐的租户将解除关联。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(selectedRowKeys);
        Toast.success('批量删除成功');
        setSelectedRowKeys([]);
      },
    });
  };

  const handleToggleStatus = (pkg: TenantPackage, newStatus: 'enabled' | 'disabled') => {
    toggleStatusMutation.mutate(
      { id: pkg.id, values: { status: newStatus } },
      { onSuccess: () => Toast.success(newStatus === 'enabled' ? '已启用' : '已禁用') },
    );
  };

  function openMenuModal(pkg: TenantPackage) {
    setMenuPackage(pkg);
    setMenuModalVisible(true);
  }

  const handleAssignMenus = async () => {
    if (!menuPackage) return;
    await assignMenusMutation.mutateAsync({ id: menuPackage.id, menuIds: checkedMenuIds });
    Toast.success('套餐菜单已更新');
    setMenuModalVisible(false);
  };

  const columns: ColumnProps<TenantPackage>[] = [
    { title: '套餐名称', dataIndex: 'name', width: 180, render: renderEllipsis },
    { title: '菜单数', dataIndex: 'menuCount', width: 100, align: 'center', render: (v) => v ?? 0 },
    { title: '备注', dataIndex: 'remark', width: 240, render: renderEllipsis },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      align: 'center',
      fixed: 'right',
      render: (v: string, record: TenantPackage) => (
        <Switch
          size="small"
          checked={v === 'enabled'}
          loading={togglingStatusId === record.id}
          disabled={!hasPermission('system:tenant-package:update')}
          onChange={(checked: boolean) => handleToggleStatus(record, checked ? 'enabled' : 'disabled')}
        />
      ),
    },
    createOperationColumn<TenantPackage>({
      width: 200,
      desktopInlineKeys: ['edit', 'menus', 'delete'],
      actions: (row) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('system:tenant-package:update'),
          onClick: () => openEdit(row),
        },
        {
          key: 'menus',
          label: '分配菜单',
          hidden: !hasPermission('system:tenant-package:assign'),
          onClick: () => openMenuModal(row),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('system:tenant-package:delete'),
          onClick: () => {
            Modal.confirm({
              title: '确认删除此套餐？',
              content: '删除后已绑定该套餐的租户将解除关联。',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(row.id),
            });
          },
        },
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索套餐名称"
      value={draftParams.keyword}
      onChange={(v) => setDraftParams((prev) => ({ ...prev, keyword: v }))}
      onEnterPress={handleSearch}
      style={{ width: 220, maxWidth: '100%' }}
      showClear
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="请选择状态"
      value={draftParams.status || undefined}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, status: (value as string) ?? '' }))}
      style={{ width: 140, maxWidth: '100%' }}
      optionList={[
        { value: '', label: '全部状态' },
        ...statusItems.map((item) => ({ value: item.value, label: item.label })),
      ]}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderBatchDeleteButton = () => selectedRowKeys.length > 0 && hasPermission('system:tenant-package:delete') ? (
    <Button type="danger" theme="light" icon={<Trash2 size={14} />} onClick={handleBatchDelete}>
      批量删除 ({selectedRowKeys.length})
    </Button>
  ) : null;
  const renderCreateButton = () => hasPermission('system:tenant-package:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderStatusFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderBatchDeleteButton()}
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
        mobileFilters={renderStatusFilter()}
        mobileActions={renderBatchDeleteButton()}
        filterTitle="套餐筛选"
        actionTitle="套餐操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys((keys as number[]) ?? []),
        }}
        pagination={buildPagination(total)}
      />

      <AppModal
        title={editing ? '编辑套餐' : '新增套餐'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        onOk={handleModalOk}
        okButtonProps={{ disabled: modalDetailLoading }}
        width={520}
      >
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
          <Form
            getFormApi={(api) => (formApi.current = api)}
            allowEmpty
            initValues={editing ?? { status: 'enabled' }}
            labelPosition="left"
            labelWidth={72}
          >
            <Form.Input field="name" label="套餐名称" placeholder="请输入套餐名称" rules={[{ required: true, message: '请输入套餐名称' }]} />
            <Form.Select
              field="status"
              label="状态"
              style={{ width: '100%' }}
              optionList={statusItems.map((item) => ({ value: item.value, label: item.label }))}
              placeholder="请选择状态"
            />
            <Form.TextArea field="remark" label="备注" placeholder="请输入备注" rows={3} />
          </Form>
        </Spin>
      </AppModal>

      <AppModal
        title={`分配菜单 — ${menuPackage?.name ?? ''}`}
        visible={menuModalVisible}
        onCancel={() => setMenuModalVisible(false)}
        onOk={handleAssignMenus}
        width={480}
      >
        <MenuPermissionPanel
          allMenus={menuTreeQuery.data ?? []}
          checkedMenuIds={checkedMenuIds}
          onChange={setCheckedMenuIds}
          loading={menuTreeQuery.isFetching || menuDetailQuery.isFetching}
        />
      </AppModal>
    </div>
  );
}
