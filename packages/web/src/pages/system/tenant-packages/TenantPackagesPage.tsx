import { useEffect, useState } from 'react';
import { Form, Toast, Spin, CheckboxGroup, Tag, Space } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { CreateTenantPackageInput, TenantPackage } from '@zenith/shared/identity';
import { USER_STATUSES, enumValueOf } from '@zenith/shared/core';
import { LICENSE_FEATURES, LICENSE_FEATURE_LABELS, LICENSE_FEATURE_OPTIONS, type LicenseFeatureKey } from '@zenith/shared/licensing';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { useDictItems } from '@/hooks/useDictItems';
import { useListSearch } from '@/hooks/useListSearch';
import {
  tenantPackageKeys,
  useAssignTenantPackageFeatures,
  useDeleteTenantPackages,
  useSaveTenantPackage,
  useTenantPackageDetail,
  useTenantPackageList,
} from '@/hooks/queries/tenant-packages';
import { createdAtColumn, renderEllipsis } from '../../../utils/table-columns';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { BatchDeleteButton, CreateButton } from '@/components/toolbar-controls';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmAndDelete, deleteAction, ListSearchToolbar, listTableProps, useStatusToggle } from '@/components/list-page';

interface SearchParams {
  keyword: string;
  status?: string;
}

const defaultSearchParams: SearchParams = { keyword: '', status: '' };

export default function TenantPackagesPage() {
  const { hasPermission } = usePermission();
  const { items: statusItems } = useDictItems('common_status');

  // draft：搜索区输入中的条件；submitted：点击查询后实际生效的条件（进入 query key）
  const {
    page, pageSize, buildPagination,
    draftParams, setField, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: tenantPackageKeys.lists });
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

  const listQuery = useTenantPackageList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: enumValueOf(USER_STATUSES, submittedParams.status),
  });

  // 新增/编辑弹窗：详情到达时由 useEditModal 自动重挂载表单
  const saveMutation = useSaveTenantPackage();
  const modal = useEditModal<TenantPackage, Partial<CreateTenantPackageInput>>({
    entityName: '套餐',
    save: saveMutation,
    useDetail: useTenantPackageDetail,
    defaults: { status: 'enabled' },
    // 记录里的 null 备注在表单中视为未填
    toValues: (pkg) => ({ name: pkg.name, status: pkg.status, quotas: pkg.quotas ?? undefined, remark: pkg.remark ?? undefined }),
    labelWidth: 90,
  });

  // 分配功能弹窗
  const [featureModalVisible, setFeatureModalVisible] = useState(false);
  const [featurePackage, setFeaturePackage] = useState<TenantPackage | null>(null);
  const [checkedFeatures, setCheckedFeatures] = useState<LicenseFeatureKey[]>([]);
  const featureDetailQuery = useTenantPackageDetail(featurePackage?.id, featureModalVisible);

  useEffect(() => {
    if (featureModalVisible) setCheckedFeatures((featureDetailQuery.data?.features ?? []).flatMap((key) => enumValueOf(LICENSE_FEATURES, key) ?? []));
  }, [featureModalVisible, featureDetailQuery.data]);

  const toggleStatusMutation = useSaveTenantPackage();
  const deleteMutation = useDeleteTenantPackages();
  const assignFeaturesMutation = useAssignTenantPackageFeatures();

  const status = useStatusToggle<TenantPackage>({
    toggle: (pkg, enabled) => toggleStatusMutation.mutateAsync({ id: pkg.id, values: { status: enabled ? 'enabled' : 'disabled' } }),
    disabled: !hasPermission('system:tenant-package:update'),
      messages: { disabled: '已禁用' },
    });

  const handleBatchDelete = () => {
    if (!selectedRowKeys.length) return;
    confirmAndDelete({
      title: `确认删除选中的 ${selectedRowKeys.length} 个套餐？`,
      content: '删除后无法恢复，已绑定该套餐的租户将解除关联。',
      run: () => deleteMutation.mutateAsync(selectedRowKeys),
      successMessage: '批量删除成功',
      onDeleted: () => setSelectedRowKeys([]),
    });
  };

  function openFeatureModal(pkg: TenantPackage) {
    setFeaturePackage(pkg);
    setFeatureModalVisible(true);
  }

  const handleAssignFeatures = async () => {
    if (!featurePackage) return;
    await assignFeaturesMutation.mutateAsync({ params: { id: featurePackage.id }, body: { features: checkedFeatures } });
    Toast.success('套餐功能已更新');
    setFeatureModalVisible(false);
  };

  const columns: ColumnProps<TenantPackage>[] = [
    { title: '套餐名称', dataIndex: 'name', width: 180, render: renderEllipsis },
    {
      title: '已授权功能',
      dataIndex: 'features',
      width: 320,
      render: (features?: string[]) => {
        if (!features || features.length === 0) return <span style={{ color: 'var(--semi-color-text-2)' }}>仅核心功能</span>;
        const shown = features.slice(0, 3);
        return (
          <Space spacing={4} wrap>
            {shown.map((f) => (
              <Tag key={f} size="small" color="blue">{LICENSE_FEATURE_LABELS[f as keyof typeof LICENSE_FEATURE_LABELS] ?? f}</Tag>
            ))}
            {features.length > shown.length && <Tag size="small">+{features.length - shown.length}</Tag>}
          </Space>
        );
      },
    },
    { title: '席位上限', dataIndex: 'quotas', width: 100, align: 'center', render: (q?: { maxUsers?: number } | null) => q?.maxUsers ?? '不限' },
    { title: '备注', dataIndex: 'remark', minWidth: 200, render: renderEllipsis },
    createdAtColumn,
    status.column(),
    createOperationColumn<TenantPackage>({
      width: 240,
      desktopInlineKeys: ['edit', 'features', 'delete'],
      actions: (row) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('system:tenant-package:update'),
          onClick: () => modal.openEdit(row),
        },
        {
          key: 'features',
          label: '分配功能',
          hidden: !hasPermission('system:tenant-package:assign'),
          onClick: () => openFeatureModal(row),
        },
        deleteAction({
          hidden: !hasPermission('system:tenant-package:delete'),
          title: '确认删除此套餐？',
          content: '删除后已绑定该套餐的租户将解除关联。',
          run: () => deleteMutation.mutateAsync([row.id]),
        }),
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="搜索套餐名称" value={draftParams.keyword} onChange={setField('keyword')} onSearch={handleSearch} />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={statusItems}
      value={draftParams.status}
      onChange={setField('status')}
    />
  );

  const renderCreateButton = () => hasPermission('system:tenant-package:create') ? (
    <CreateButton onClick={modal.openCreate} />
  ) : null;

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={renderKeywordSearch()}
        filters={renderStatusFilter()}
        onSearch={handleSearch}
        onReset={handleReset}
        create={renderCreateButton()}
        actions={selectedRowKeys.length > 0 && hasPermission('system:tenant-package:delete') && <BatchDeleteButton count={selectedRowKeys.length} onClick={handleBatchDelete} />}
        filterTitle="套餐筛选"
        actionTitle="套餐操作"
      />

      <ConfigurableTable<TenantPackage>
        columns={columns}
        {...listTableProps(listQuery, {
          pagination: buildPagination,
          rowSelection: {
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys((keys ?? []) as number[]),
          },
        })}
      />

      <AppModal {...modal.modalProps} width={520}>
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}>
            <Form.Input field="name" label="套餐名称" placeholder="请输入套餐名称" rules={[{ required: true, message: '请输入套餐名称' }]} />
            <Form.InputNumber
              field="quotas.maxUsers"
              label="席位上限"
              placeholder="留空表示不限制"
              min={1}
              style={{ width: '100%' }}
            />
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
        title={`分配功能 — ${featurePackage?.name ?? ''}`}
        visible={featureModalVisible}
        onCancel={() => setFeatureModalVisible(false)}
        onOk={handleAssignFeatures}
        okButtonProps={{ disabled: !featureDetailQuery.isSuccess, loading: assignFeaturesMutation.isPending }}
        width={560}
      >
        <Spin spinning={featureDetailQuery.isFetching}>
          <div style={{ marginBottom: 12, color: 'var(--semi-color-text-2)', fontSize: 13 }}>
            核心功能（组织架构、系统管理、消息、文件、任务等）始终可用，无需分配；此处勾选的是可按套餐授权的增值功能模块。
          </div>
          <CheckboxGroup
            options={LICENSE_FEATURE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={checkedFeatures}
            onChange={(values) => setCheckedFeatures(((values ?? []) as string[]).flatMap((key) => enumValueOf(LICENSE_FEATURES, key) ?? []))}
            direction="horizontal"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}
          />
        </Spin>
      </AppModal>
    </div>
  );
}
