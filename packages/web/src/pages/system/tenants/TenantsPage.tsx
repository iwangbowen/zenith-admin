import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Button,
  Input,
  Select,
  Modal,
  Form,
  Toast,
  Row,
  Col,
  Spin,
  Switch,
  SideSheet,
  Progress,
  Descriptions,
  Tag,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw } from 'lucide-react';
import type { Tenant, TenantStats } from '@zenith/shared';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { createOperationColumn } from '@/components/ResponsiveTableActions';

export default function TenantsPage() {
  const { hasPermission } = usePermission();

  interface SearchParams {
    keyword: string;
    status: string;
  }

  const defaultSearchParams: SearchParams = { keyword: '', status: '' };
  const formApi = useRef<FormApi | null>(null);
  const [data, setData] = useState<Tenant[]>([]);
  const [total, setTotal] = useState(0);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [loading, setLoading] = useState(false);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [modalDetailLoading, setModalDetailLoading] = useState(false);
  const [packageOptions, setPackageOptions] = useState<{ value: number; label: string }[]>([]);
  const [statsVisible, setStatsVisible] = useState(false);
  const [statsTenant, setStatsTenant] = useState<Tenant | null>(null);
  const [stats, setStats] = useState<TenantStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

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
      const res = await request.get<{ list: Tenant[]; total: number }>(`/api/tenants?${query}`);
      if (res.code === 0) {
        setData(res.data.list);
        setTotal(res.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  useEffect(() => {
    void (async () => {
      const res = await request.get<{ id: number; name: string; status: string }[]>('/api/tenant-packages/all');
      if (res.code === 0) {
        setPackageOptions(res.data.map((p) => ({ value: p.id, label: p.name })));
      }
    })();
  }, []);

  function handleSearch() {
    setPage(1);
    void fetchData(1, pageSize);
  }

  function handleReset() {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchData(1, pageSize, defaultSearchParams);
  }

  const handleModalOk = async () => {
    let values;
    try {
      values = await formApi.current!.validate();
    } catch {
      throw new Error('validation');
    }
    const payload = {
      ...values,
      expireAt: values.expireAt ? formatDateTimeForApi(values.expireAt) : null,
      packageId: values.packageId ?? null,
    };
    const res = editingTenant
      ? await request.put(`/api/tenants/${editingTenant.id}`, payload)
      : await request.post('/api/tenants', payload);
    if (res.code === 0) {
      Toast.success(editingTenant ? '更新成功' : '创建成功');
      setModalVisible(false);
      fetchData();
    } else {
      throw new Error(res.message);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/tenants/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      fetchData();
    }
  };

  const [togglingStatusId, setTogglingStatusId] = useState<number | null>(null);

  const handleToggleStatus = useCallback(async (tenant: Tenant, newStatus: 'enabled' | 'disabled') => {
    if (newStatus === 'disabled') {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: `确认禁用租户「${tenant.name}」？`,
          content: '禁用后该租户下的用户将无法登录。',
          okButtonProps: { type: 'danger', theme: 'solid' },
          okText: '确认禁用',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }
    setTogglingStatusId(tenant.id);
    try {
      const res = await request.put(`/api/tenants/${tenant.id}`, { status: newStatus });
      if (res.code === 0) {
        Toast.success(newStatus === 'enabled' ? '已启用' : '已禁用');
        fetchData();
      } else {
        Toast.error(res.message || '操作失败');
      }
    } finally {
      setTogglingStatusId(null);
    }
  }, [fetchData]);

  const openStats = async (tenant: Tenant) => {
    setStatsTenant(tenant);
    setStats(null);
    setStatsVisible(true);
    setStatsLoading(true);
    try {
      const res = await request.get<TenantStats>(`/api/tenants/${tenant.id}/stats`);
      if (res.code === 0) setStats(res.data);
    } finally {
      setStatsLoading(false);
    }
  };

  const openEdit = async (tenant: Tenant) => {
    setEditingTenant(tenant);
    setModalVisible(true);
    setModalDetailLoading(true);
    const res = await request.get<Tenant>(`/api/tenants/${tenant.id}`);
    setModalDetailLoading(false);
    if (res.code === 0 && res.data) {
      setEditingTenant(res.data);
    } else {
      Toast.error(res.message || '获取租户信息失败');
    }
  };

  function renderExpiry(days: number | null, expireAt: string | null) {
    if (days === null) return '永不过期';
    if (days < 0) return <Tag color="red">已过期 {-days} 天</Tag>;
    if (days <= 7) return <Tag color="orange">剩 {days} 天</Tag>;
    return <span>剩 {days} 天{expireAt ? `（${expireAt}）` : ''}</span>;
  }

  const columns: ColumnProps<Tenant>[] = [
    { title: '租户名称', dataIndex: 'name', width: 160, render: renderEllipsis },
    { title: '租户编码', dataIndex: 'code', width: 140, render: renderEllipsis },
    { title: '联系人', dataIndex: 'contactName', width: 120, render: renderEllipsis },
    { title: '联系电话', dataIndex: 'contactPhone', width: 140, render: renderEllipsis },
    { title: '用户数', dataIndex: 'userCount', width: 150, render: (v: number | undefined, record: Tenant) => {
        const used = v ?? 0;
        const max = record.maxUsers;
        if (max == null) return <span>{used} / 不限</span>;
        const percent = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
        const stroke = percent >= 100 ? 'var(--semi-color-danger)' : percent >= 80 ? 'var(--semi-color-warning)' : undefined;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 12 }}>{used} / {max}</span>
            <Progress percent={percent} stroke={stroke} size="small" aria-label="用户数占用" />
          </div>
        );
      },
    },
    { title: '套餐', dataIndex: 'packageName', width: 140, render: (v) => renderEllipsis(v || '未分配') },
    {
      title: '到期时间',
      dataIndex: 'expireAt',
      width: 180,
      render: (v) => renderEllipsis(v ? formatDateTime(v) : '永不过期'),
    },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      align: 'center',
      fixed: 'right',
      render: (v: string, record: Tenant) => (
        <Switch
          size="small"
          checked={v === 'enabled'}
          loading={togglingStatusId === record.id}
          disabled={!hasPermission('system:tenant:update')}
          onChange={(checked: boolean) => void handleToggleStatus(record, checked ? 'enabled' : 'disabled')}
        />
      ),
    },
    createOperationColumn<Tenant>({
      width: 210,
      desktopInlineKeys: ['stats', 'edit', 'delete'],
      actions: (row) => [
        {
          key: 'stats',
          label: '概览',
          onClick: () => { void openStats(row); },
        },
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('system:tenant:update'),
          onClick: () => { void openEdit(row); },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('system:tenant:delete'),
          onClick: () => {
            Modal.confirm({
              title: '确认删除此租户？',
              content: '删除后该租户下的所有数据将不可访问',
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
      placeholder="搜索租户名称/编码"
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
  const buildExportQuery = () => ({
    ...(searchParams.keyword ? { keyword: searchParams.keyword } : {}),
    ...(searchParams.status ? { status: searchParams.status } : {}),
  });
  const renderExportButtons = () => <ExportButton entity="system.tenants" query={buildExportQuery()} />;
  const renderMobileExportActions = () => <ExportButton entity="system.tenants" query={buildExportQuery()} variant="flat" />;
  const renderCreateButton = () => hasPermission('system:tenant:create') ? (
    <Button
      type="primary"
      icon={<Plus size={14} />}
      onClick={() => { setEditingTenant(null); setModalVisible(true); }}
    >
      新增
    </Button>
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
        mobileFilters={renderStatusFilter()}
        mobileActions={renderMobileExportActions()}
        filterTitle="租户筛选"
        actionTitle="租户操作"
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
        pagination={buildPagination(total, fetchData)}
      />

      <AppModal
        title={editingTenant ? '编辑租户' : '新增租户'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditingTenant(null); setModalDetailLoading(false); }}
        onOk={handleModalOk}
        okButtonProps={{ disabled: modalDetailLoading }}
        width={660}

      >
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
        <Form
          getFormApi={(api) => (formApi.current = api)}
          allowEmpty
          initValues={editingTenant ?? { status: 'enabled' }}
          labelPosition="left"
          labelWidth={90}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="name" label="租户名称" placeholder="请输入租户名称" rules={[{ required: true, message: '请输入租户名称' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="code" label="租户编码" placeholder="请输入租户编码" rules={[{ required: true, message: '请输入租户编码' }]} disabled={!!editingTenant} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="contactName" label="联系人" placeholder="请输入联系人" />
            </Col>
            <Col span={12}>
              <Form.Input field="contactPhone" label="联系电话" placeholder="请输入联系电话" />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.InputNumber field="maxUsers" label="最大用户数" min={1} placeholder="不填则不限" style={{ width: '100%' }} />
            </Col>
            <Col span={12}>
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
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.DatePicker field="expireAt" label="到期时间" type="dateTime" placeholder="不填则永不过期" style={{ width: '100%' }} />
            </Col>
            <Col span={12}>
              <Form.Select
                field="packageId"
                label="租户套餐"
                style={{ width: '100%' }}
                placeholder="不绑定则不限制功能"
                optionList={packageOptions}
                showClear
                filter
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.TextArea field="remark" label="备注" placeholder="请输入备注" rows={3} />
            </Col>
          </Row>
        </Form>
        </Spin>
      </AppModal>

      <SideSheet
        title={`租户概览 — ${statsTenant?.name ?? ''}`}
        visible={statsVisible}
        onCancel={() => setStatsVisible(false)}
        width={420}
      >
        <Spin spinning={statsLoading} wrapperClassName="modal-spin-wrapper">
          {stats ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={{ marginBottom: 6, color: 'var(--semi-color-text-2)', fontSize: 13 }}>用户用量</div>
                {stats.maxUsers == null ? (
                  <div style={{ fontSize: 20, fontWeight: 600 }}>
                    {stats.userCount}
                    <span style={{ fontSize: 13, color: 'var(--semi-color-text-2)', fontWeight: 400 }}> / 不限</span>
                  </div>
                ) : (
                  <>
                    <Progress
                      percent={stats.maxUsers > 0 ? Math.min(100, Math.round((stats.userCount / stats.maxUsers) * 100)) : 0}
                      stroke={stats.userCount >= stats.maxUsers ? 'var(--semi-color-danger)' : stats.userCount / stats.maxUsers >= 0.8 ? 'var(--semi-color-warning)' : undefined}
                      showInfo
                      aria-label="用户用量"
                    />
                    <div style={{ marginTop: 4, fontSize: 13 }}>{stats.userCount} / {stats.maxUsers}</div>
                  </>
                )}
              </div>
              <Descriptions
                row
                size="small"
                data={[
                  { key: '状态', value: <Tag color={stats.status === 'enabled' ? 'green' : 'grey'}>{stats.status === 'enabled' ? '正常' : '停用'}</Tag> },
                  { key: '租户编码', value: stats.code },
                  { key: '所用套餐', value: stats.packageName ?? '未分配' },
                  { key: '套餐菜单数', value: stats.packageMenuCount },
                  { key: '部门数', value: stats.departmentCount },
                  { key: '角色数', value: stats.roleCount },
                  { key: '岗位数', value: stats.positionCount },
                  { key: '到期', value: renderExpiry(stats.daysToExpire, stats.expireAt) },
                ]}
              />
            </div>
          ) : null}
        </Spin>
      </SideSheet>
    </div>
  );
}
