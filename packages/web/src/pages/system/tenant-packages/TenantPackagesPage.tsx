import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Button,
  Input,
  Select,
  Space,
  Modal,
  Form,
  Toast,
  Spin,
  Switch,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { TenantPackage, Menu } from '@zenith/shared';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { MenuPermissionPanel } from '@/components/permissions/MenuPermissionPanel';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';

interface SearchParams {
  keyword: string;
  status: string;
}

const defaultSearchParams: SearchParams = { keyword: '', status: '' };

export default function TenantPackagesPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);

  const [data, setData] = useState<TenantPackage[]>([]);
  const [total, setTotal] = useState(0);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [loading, setLoading] = useState(false);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

  // 新增/编辑弹窗
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<TenantPackage | null>(null);
  const [modalDetailLoading, setModalDetailLoading] = useState(false);

  // 分配菜单弹窗
  const [menuModalVisible, setMenuModalVisible] = useState(false);
  const [menuPackage, setMenuPackage] = useState<TenantPackage | null>(null);
  const [allMenus, setAllMenus] = useState<Menu[]>([]);
  const [checkedMenuIds, setCheckedMenuIds] = useState<number[]>([]);
  const [menuLoading, setMenuLoading] = useState(false);

  const [togglingStatusId, setTogglingStatusId] = useState<number | null>(null);

  const fetchData = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const activeParams = params ?? searchParamsRef.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(activeParams.keyword ? { keyword: activeParams.keyword } : {}),
        ...(activeParams.status ? { status: activeParams.status } : {}),
      }).toString();
      const res = await request.get<{ list: TenantPackage[]; total: number }>(`/api/tenant-packages?${query}`);
      if (res.code === 0) {
        setData(res.data.list);
        setTotal(res.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  function handleSearch() {
    setPage(1);
    void fetchData(1, pageSize);
  }

  function handleReset() {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchData(1, pageSize, defaultSearchParams);
  }

  function openCreate() {
    setEditing(null);
    setModalVisible(true);
  }

  async function openEdit(record: TenantPackage) {
    setEditing(record);
    setModalVisible(true);
    setModalDetailLoading(true);
    const res = await request.get<TenantPackage>(`/api/tenant-packages/${record.id}`);
    setModalDetailLoading(false);
    if (res.code === 0 && res.data) setEditing(res.data);
    else Toast.error(res.message || '获取套餐信息失败');
  }

  const handleModalOk = async () => {
    let values;
    try {
      values = await formApi.current!.validate();
    } catch {
      throw new Error('validation');
    }
    const res = editing
      ? await request.put(`/api/tenant-packages/${editing.id}`, values)
      : await request.post('/api/tenant-packages', values);
    if (res.code === 0) {
      Toast.success(editing ? '更新成功' : '创建成功');
      setModalVisible(false);
      setEditing(null);
      void fetchData();
    } else {
      throw new Error(res.message);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/tenant-packages/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchData();
    }
  };

  const handleBatchDelete = () => {
    Modal.confirm({
      title: `确认删除选中的 ${selectedRowKeys.length} 个套餐？`,
      content: '删除后无法恢复，已绑定该套餐的租户将解除关联。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete<null>('/api/tenant-packages/batch', { ids: selectedRowKeys });
        if (res.code === 0) {
          Toast.success('批量删除成功');
          setSelectedRowKeys([]);
          void fetchData();
        }
      },
    });
  };

  const handleToggleStatus = useCallback(async (pkg: TenantPackage, newStatus: 'enabled' | 'disabled') => {
    setTogglingStatusId(pkg.id);
    try {
      const res = await request.put(`/api/tenant-packages/${pkg.id}`, { status: newStatus });
      if (res.code === 0) {
        Toast.success(newStatus === 'enabled' ? '已启用' : '已禁用');
        void fetchData();
      } else {
        Toast.error(res.message || '操作失败');
      }
    } finally {
      setTogglingStatusId(null);
    }
  }, [fetchData]);

  const openMenuModal = async (pkg: TenantPackage) => {
    setMenuPackage(pkg);
    setMenuModalVisible(true);
    setMenuLoading(true);
    try {
      const [menusRes, pkgRes] = await Promise.all([
        request.get<Menu[]>('/api/menus'),
        request.get<TenantPackage>(`/api/tenant-packages/${pkg.id}`),
      ]);
      if (menusRes.code === 0) setAllMenus(menusRes.data);
      if (pkgRes.code === 0) setCheckedMenuIds(pkgRes.data.menuIds ?? []);
    } finally {
      setMenuLoading(false);
    }
  };

  const handleAssignMenus = async () => {
    if (!menuPackage) return;
    const res = await request.put(`/api/tenant-packages/${menuPackage.id}/menus`, { menuIds: checkedMenuIds });
    if (res.code === 0) {
      Toast.success('套餐菜单已更新');
      setMenuModalVisible(false);
      void fetchData();
    } else {
      throw new Error(res.message);
    }
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
          onChange={(checked: boolean) => void handleToggleStatus(record, checked ? 'enabled' : 'disabled')}
        />
      ),
    },
    {
      title: '操作',
      fixed: 'right',
      width: 200,
      align: 'center',
      render: (_v, row) => (
        <Space>
          {hasPermission('system:tenant-package:update') && (
            <Button theme="borderless" size="small" onClick={() => void openEdit(row)}>编辑</Button>
          )}
          {hasPermission('system:tenant-package:assign') && (
            <Button theme="borderless" size="small" onClick={() => void openMenuModal(row)}>分配菜单</Button>
          )}
          {hasPermission('system:tenant-package:delete') && (
            <Button
              theme="borderless"
              size="small"
              type="danger"
              onClick={() => {
                Modal.confirm({
                  title: '确认删除此套餐？',
                  content: '删除后已绑定该套餐的租户将解除关联。',
                  okButtonProps: { type: 'danger', theme: 'solid' },
                  onOk: () => handleDelete(row.id),
                });
              }}
            >
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索套餐名称"
      value={searchParams.keyword}
      onChange={(v) => setSearchParams((prev) => ({ ...prev, keyword: v }))}
      onEnterPress={handleSearch}
      style={{ width: 220, maxWidth: '100%' }}
      showClear
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="请选择状态"
      value={searchParams.status || undefined}
      onChange={(value) => setSearchParams((prev) => ({ ...prev, status: (value as string) ?? '' }))}
      style={{ width: 140, maxWidth: '100%' }}
      optionList={[
        { value: '', label: '全部状态' },
        { value: 'enabled', label: '正常' },
        { value: 'disabled', label: '停用' },
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
        loading={loading}
        onRefresh={fetchData}
        refreshLoading={loading}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys((keys as number[]) ?? []),
        }}
        pagination={buildPagination(total, fetchData)}
      />

      <AppModal
        title={editing ? '编辑套餐' : '新增套餐'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditing(null); setModalDetailLoading(false); }}
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
              optionList={[
                { value: 'enabled', label: '正常' },
                { value: 'disabled', label: '停用' },
              ]}
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
          allMenus={allMenus}
          checkedMenuIds={checkedMenuIds}
          onChange={setCheckedMenuIds}
          loading={menuLoading}
        />
      </AppModal>
    </div>
  );
}
