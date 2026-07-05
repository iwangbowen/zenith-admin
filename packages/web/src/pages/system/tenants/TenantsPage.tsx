import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
  Divider,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw } from 'lucide-react';
import type { Tenant } from '@zenith/shared';
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
import { useAllTenantPackages } from '@/hooks/queries/tenant-packages';
import {
  useDeleteTenant,
  useSaveTenant,
  useTenantDetail,
  tenantKeys,
  useTenantList,
  useTenantStats,
} from '@/hooks/queries/tenants';

interface SearchParams {
  keyword: string;
  status: string;
}

const defaultSearchParams: SearchParams = { keyword: '', status: '' };

export default function TenantsPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);

  const listQuery = useTenantList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Tenant | null>(null);
  const detailQuery = useTenantDetail(editingRecord?.id, modalVisible);
  const editingTenant = editingRecord ? (detailQuery.data ?? editingRecord) : null;
  const modalDetailLoading = !!editingRecord && detailQuery.isFetching;
  const packageOptionsQuery = useAllTenantPackages();
  const packageOptions = (packageOptionsQuery.data ?? []).map((p) => ({ value: p.id, label: p.name }));
  const [statsVisible, setStatsVisible] = useState(false);
  const [statsTenant, setStatsTenant] = useState<Tenant | null>(null);
  const statsQuery = useTenantStats(statsTenant?.id, statsVisible);
  const stats = statsQuery.data ?? null;

  const saveMutation = useSaveTenant();
  const toggleStatusMutation = useSaveTenant();
  const deleteMutation = useDeleteTenant();
  const togglingStatusId = toggleStatusMutation.isPending ? (toggleStatusMutation.variables?.id ?? null) : null;

  function handleSearch() {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: tenantKeys.lists });
  }

  function handleReset() {
    setPage(1);
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    void queryClient.invalidateQueries({ queryKey: tenantKeys.lists });
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
    const saved = await saveMutation.mutateAsync({ id: editingRecord?.id, values: payload });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingRecord(null);
    if (!editingRecord && saved?.initialAdmin) {
      showInitialAdminModal(saved.name, saved.initialAdmin);
    }
  };

  /** 展示自动初始化的管理员账号（初始密码仅此一次可见） */
  function showInitialAdminModal(tenantName: string, admin: { username: string; email: string; password: string }) {
    Modal.success({
      title: `租户「${tenantName}」管理员已初始化`,
      width: 460,
      okText: '我已保存',
      content: (
        <div style={{ lineHeight: 2 }}>
          <div>用户名：<strong>{admin.username}</strong></div>
          <div>邮箱：<strong>{admin.email}</strong></div>
          <div>
            初始密码：<strong style={{ fontFamily: 'monospace' }}>{admin.password}</strong>
            <Button
              size="small"
              theme="borderless"
              style={{ marginLeft: 8 }}
              onClick={() => { void navigator.clipboard.writeText(admin.password).then(() => Toast.success('已复制')); }}
            >
              复制
            </Button>
          </div>
          <div style={{ color: 'var(--semi-color-warning)', marginTop: 8 }}>初始密码仅此一次展示，请妥善保存并及时修改。</div>
        </div>
      ),
    });
  }

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  };

  const handleToggleStatus = async (tenant: Tenant, newStatus: 'enabled' | 'disabled') => {
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
    toggleStatusMutation.mutate(
      { id: tenant.id, values: { status: newStatus } },
      { onSuccess: () => Toast.success(newStatus === 'enabled' ? '已启用' : '已禁用') },
    );
  };

  const openStats = (tenant: Tenant) => {
    setStatsTenant(tenant);
    setStatsVisible(true);
  };

  const openEdit = (tenant: Tenant) => {
    setEditingRecord(tenant);
    setModalVisible(true);
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
        { value: 'enabled', label: '正常' },
        { value: 'disabled', label: '停用' },
      ]}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const buildExportQuery = () => ({
    ...(submittedParams.keyword ? { keyword: submittedParams.keyword } : {}),
    ...(submittedParams.status ? { status: submittedParams.status } : {}),
  });
  const renderExportButtons = () => <ExportButton entity="system.tenants" query={buildExportQuery()} />;
  const renderMobileExportActions = () => <ExportButton entity="system.tenants" query={buildExportQuery()} variant="flat" />;
  const renderCreateButton = () => hasPermission('system:tenant:create') ? (
    <Button
      type="primary"
      icon={<Plus size={14} />}
      onClick={() => { setEditingRecord(null); setModalVisible(true); }}
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
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
      />

      <AppModal
        title={editingTenant ? '编辑租户' : '新增租户'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
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
          {!editingTenant && (
            <>
              <Divider margin={12} align="left">初始管理员（选填）</Divider>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Input field="adminUsername" label="管理员账号" placeholder="不填则跳过初始化" />
                </Col>
                <Col span={12}>
                  <Form.Input field="adminPassword" label="初始密码" mode="password" placeholder="不填则自动生成" />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Input field="adminNickname" label="管理员昵称" placeholder="默认：租户管理员" />
                </Col>
                <Col span={12}>
                  <Form.Input field="adminEmail" label="管理员邮箱" placeholder="不填则自动生成" />
                </Col>
              </Row>
            </>
          )}
        </Form>
        </Spin>
      </AppModal>

      <SideSheet
        title={`租户概览 — ${statsTenant?.name ?? ''}`}
        visible={statsVisible}
        onCancel={() => setStatsVisible(false)}
        width={420}
      >
        <Spin spinning={statsQuery.isFetching} wrapperClassName="modal-spin-wrapper">
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
