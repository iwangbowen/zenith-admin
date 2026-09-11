import { useRef, useState } from 'react';
import ModalFooter from '@/components/ModalFooter';
import { Button, Modal, Form, Row, Col, Spin, SideSheet, Descriptions, Tag, Divider } from '@douyinfe/semi-ui';
import { USER_STATUSES, enumValueOf } from '@zenith/shared/core';
import type { CreateTenantInput, Tenant } from '@zenith/shared/identity';
import ExportButton from '@/components/ExportButton';
import ConfigurableTable from '@/components/ConfigurableTable';
import { formatDateTimeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { useSensitiveFormFields } from '@/hooks/useSensitiveFormFields';
import { SensitiveFormInput, SensitiveText } from '@/components/sensitive';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { createdAtColumn, dateTimeColumn, renderEllipsis } from '../../../utils/table-columns';
import { useDictItems } from '@/hooks/useDictItems';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { MetricMeter, type MetricMeterTone } from '@/components/data-viz/MetricMeter';
import { useAllTenantPackages } from '@/hooks/queries/tenant-packages';
import { useListSearch } from '@/hooks/useListSearch';
import {
  useDeleteTenants,
  useSaveTenant,
  useTenantDetail,
  tenantKeys,
  useTenantList,
  useTenantStats,
} from '@/hooks/queries/tenants';
import { CreateButton } from '@/components/toolbar-controls';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { deleteAction, ListSearchToolbar, listTableProps, useStatusToggle } from '@/components/list-page';
import { copyTextWithToast } from '@/utils/clipboard';
import { compactQuery } from '@/lib/query';

interface SearchParams {
  keyword: string;
  status?: string;
}

const defaultSearchParams: SearchParams = { keyword: '', status: undefined };

/** 租户表单值：`expireAt` 在表单里是 Date，提交前由 beforeSave 转成接口格式；记录里的 null 在提交时归一为未填 */
interface TenantFormValues extends Partial<Omit<CreateTenantInput, 'expireAt' | 'contactName' | 'contactPhone' | 'logo' | 'remark'>> {
  expireAt?: Date | string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  logo?: string | null;
  remark?: string | null;
}

export default function TenantsPage() {
  const { hasPermission } = usePermission();
  const { items: statusItems, options: statusOptions } = useDictItems('common_status');
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: tenantKeys.lists });

  const listQuery = useTenantList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: enumValueOf(USER_STATUSES, submittedParams.status),
  });

  const saveMutation = useSaveTenant();
  // 联系电话是契约敏感字段：对非豁免用户是掩码，编辑时锁定、未修改则不提交
  const sensitiveFieldsRef = useRef<ReturnType<typeof useSensitiveFormFields<Tenant>> | null>(null);
  const tenantModal = useEditModal<Tenant, TenantFormValues, Partial<CreateTenantInput>>({
    entityName: '租户',
    save: saveMutation,
    useDetail: useTenantDetail,
    defaults: { status: 'enabled' },
    beforeSave: (rawValues) => {
      const control = sensitiveFieldsRef.current;
      const values = (control ? control.strip(rawValues as unknown as Record<string, unknown>) : rawValues) as TenantFormValues;
      const payload: Partial<CreateTenantInput> = {
        ...values,
        contactName: values.contactName ?? undefined,
        contactPhone: values.contactPhone ?? undefined,
        logo: values.logo ?? undefined,
        remark: values.remark ?? undefined,
        expireAt: values.expireAt ? formatDateTimeForApi(values.expireAt) : null,
        packageId: values.packageId ?? null,
      };
      if (!('contactPhone' in values)) delete payload.contactPhone;
      return payload;
    },
    onSaved: (saved, { isEdit }) => {
      // 初始密码仅此一次可见，必须在保存成功后立刻展示
      if (!isEdit && saved?.initialAdmin) showInitialAdminModal(saved.name, saved.initialAdmin);
    },
  });
  const editingTenant = tenantModal.editing;
  const sensitiveFields = useSensitiveFormFields<Tenant>({ entity: 'Tenant', fields: ['contactPhone'], record: editingTenant });
  sensitiveFieldsRef.current = sensitiveFields;

  const packageOptionsQuery = useAllTenantPackages();
  const packageOptions = (packageOptionsQuery.data ?? []).map((p) => ({ value: p.id, label: p.name }));
  const [statsVisible, setStatsVisible] = useState(false);
  const [statsTenant, setStatsTenant] = useState<Tenant | null>(null);
  const statsQuery = useTenantStats(statsTenant?.id, statsVisible);
  const stats = statsQuery.data ?? null;
  const statsUserPercent = stats?.maxUsers && stats.maxUsers > 0
    ? Math.min(100, Math.round((stats.userCount / stats.maxUsers) * 100))
    : 0;

  const toggleStatusMutation = useSaveTenant();
  const deleteMutation = useDeleteTenants();
  const status = useStatusToggle<Tenant>({
    toggle: (tenant, enabled) => toggleStatusMutation.mutateAsync({ id: tenant.id, values: { status: enabled ? 'enabled' : 'disabled' } }),
    confirmDisable: (tenant) => ({ danger: true, title: `确认禁用租户「${tenant.name}」？`, content: '禁用后该租户下的用户将无法登录。', okText: '确认禁用' }),
    disabled: !hasPermission('system:tenant:update'),
  });

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
              onClick={() => { void copyTextWithToast(admin.password); }}
            >
              复制
            </Button>
          </div>
          <div style={{ color: 'var(--semi-color-warning)', marginTop: 8 }}>初始密码仅此一次展示，请妥善保存并及时修改。</div>
        </div>
      ),
    });
  }

  const openStats = (tenant: Tenant) => {
    setStatsTenant(tenant);
    setStatsVisible(true);
  };

  function renderExpiry(days: number | null, expireAt: string | null) {
    if (days === null) return '永不过期';
    if (days < 0) return <Tag color="red">已过期 {-days} 天</Tag>;
    if (days <= 7) return <Tag color="orange">剩 {days} 天</Tag>;
    return <span>剩 {days} 天{expireAt ? `（${expireAt}）` : ''}</span>;
  }

  const columns: ColumnProps<Tenant>[] = [
    { title: '租户名称', dataIndex: 'name', minWidth: 160, render: renderEllipsis },
    { title: '租户编码', dataIndex: 'code', width: 140, render: renderEllipsis },
    { title: '联系人', dataIndex: 'contactName', width: 120, render: renderEllipsis },
    { title: '联系电话', dataIndex: 'contactPhone', width: 160, render: (v: string | null | undefined, record: Tenant) => <SensitiveText entity="Tenant" id={record.id} field="contactPhone" value={v} /> },
    { title: '用户数', dataIndex: 'userCount', width: 150, align: 'right', render: (v: number | undefined, record: Tenant) => {
        const used = v ?? 0;
        const max = record.maxUsers;
        if (max == null) return <span>{used} / 不限</span>;
        const percent = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
        const tone: MetricMeterTone = percent >= 100 ? 'danger' : percent >= 80 ? 'warning' : 'primary';
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 12 }}>{used} / {max}</span>
            <MetricMeter value={percent} label="用户数占用" valueText={`${used} / ${max}，${percent}%`} tone={tone} height={6} />
          </div>
        );
      },
    },
    { title: '套餐', dataIndex: 'packageName', width: 140, render: (v) => renderEllipsis(v || '未分配') },
    dateTimeColumn('到期时间', 'expireAt', { empty: '永不过期' }),
    createdAtColumn,
    status.column(),
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
          onClick: () => { tenantModal.openEdit(row); },
        },
        deleteAction({
          hidden: !hasPermission('system:tenant:delete'),
          title: '确认删除此租户？',
          content: '删除后该租户下的所有数据将不可访问',
          run: () => deleteMutation.mutateAsync([row.id]),
        }),
      ],
    }),
  ];

  const buildExportQuery = () => compactQuery({
    keyword: submittedParams.keyword,
    status: submittedParams.status,
  });

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索租户名称/编码" {...bindKeyword('keyword')} />}
        filters={(
          <StatusSelect
            items={statusItems}
            {...bind('status')}
          />
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={(
          hasPermission('system:tenant:create') ? (
            <CreateButton onClick={tenantModal.openCreate} />
          ) : null
        )}
        actions={<ExportButton entity="system.tenants" query={buildExportQuery()} />}
        mobileActions={<ExportButton entity="system.tenants" query={buildExportQuery()} variant="flat" />}
        filterTitle="租户筛选"
        actionTitle="租户操作"
      />

      <ConfigurableTable<Tenant>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <SideSheet
        title={tenantModal.modalProps.title}
        visible={tenantModal.visible}
        onCancel={tenantModal.close}
        closeOnEsc
        width={660}
        footer={<ModalFooter {...tenantModal.footerProps} okText="保存" />}
      >
        <Spin spinning={tenantModal.detailLoading} wrapperClassName="modal-spin-wrapper">
        <Form key={tenantModal.formKey} {...tenantModal.formProps}>
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
              <SensitiveFormInput control={sensitiveFields} field="contactPhone" label="联系电话" placeholder="请输入联系电话" />
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
                optionList={statusOptions}
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
      </SideSheet>

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
                    <MetricMeter
                      value={statsUserPercent}
                      label="用户用量"
                      valueText={`${stats.userCount} / ${stats.maxUsers}，${statsUserPercent}%`}
                      tone={statsUserPercent >= 100 ? 'danger' : statsUserPercent >= 80 ? 'warning' : 'primary'}
                    />
                    <div style={{ marginTop: 4, fontSize: 13 }}>{stats.userCount} / {stats.maxUsers} · {statsUserPercent}%</div>
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
                  { key: '套餐功能数', value: stats.packageFeatureCount },
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
