import { useEffect, useState } from 'react';
import { Form, Toast, Spin, CheckboxGroup } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { tenantPackageContract, type CreateTenantPackageInput, type TenantPackage } from '@zenith/shared/identity';
import { enumValueOf } from '@zenith/shared/core';
import { LICENSE_FEATURES, LICENSE_FEATURE_LABELS, LICENSE_FEATURE_OPTIONS, type LicenseFeatureKey } from '@zenith/shared/licensing';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { useDictItems } from '@/hooks/useDictItems';
import { useListPage } from '@/hooks/useListPage';
import {
  useAssignTenantPackageFeatures,
  useDeleteTenantPackages,
  useSaveTenantPackage,
  useTenantPackageDetail,
  useTenantPackageList,
} from '@/hooks/queries/tenant-packages';
import { createdAtColumn, overflowTagColumn, renderEllipsis } from '@/utils/table-columns';
import { BatchDeleteButton, CreateButton } from '@/components/toolbar-controls';
import { confirmAndDelete, ListSearchToolbar, useRowSelection, useStatusToggle, useCrudOperationColumn } from '@/components/list-page';
import { EditFormModal } from '@/components/EditFormModal';

export default function TenantPackagesPage() {
  const { hasPermission } = usePermission();
  const { options: statusOptions } = useDictItems('common_status');

  const { selectedRowKeys, hasSelection, clear: clearSelection, rowSelection } = useRowSelection();
  // 搜索状态 → 已提交筛选映射 → 列表查询 → 表格接线，一次接好
  const page = useListPage({
    contract: tenantPackageContract,
    useList: useTenantPackageList,
    table: { rowSelection },
  });
  const { tableProps } = page;

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
      onDeleted: clearSelection,
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

  const operationColumn = useCrudOperationColumn<TenantPackage>({
    permission: 'system:tenant-package',
    edit: modal,
    remove: deleteMutation,
    title: '确认删除此套餐？',
    content: '删除后已绑定该套餐的租户将解除关联。',
    extraBetween: (row) => [
      {
        key: 'features',
        label: '分配功能',
        hidden: !hasPermission('system:tenant-package:assign'),
        onClick: () => openFeatureModal(row),
      },
    ],
    width: 240,
    desktopInlineKeys: ['edit', 'features', 'delete'],
  });

  const FEATURE_TAG_CONTENT_WIDTH = 288;
  const columns: ColumnProps<TenantPackage>[] = [
    { title: '套餐名称', dataIndex: 'name', width: 180, render: renderEllipsis },
    overflowTagColumn<TenantPackage>({
      title: '已授权功能',
      dataIndex: 'features',
      width: 320,
      contentWidth: FEATURE_TAG_CONTENT_WIDTH,
      getItems: (features) => ((features as string[] | undefined) ?? []).map((feature) => ({
        key: feature,
        label: LICENSE_FEATURE_LABELS[feature as keyof typeof LICENSE_FEATURE_LABELS] ?? feature,
      })),
      tagColor: 'blue',
      tagSize: 'small',
      popoverWidth: 280,
      popoverTrigger: 'hover',
      empty: <span style={{ color: 'var(--semi-color-text-2)' }}>仅核心功能</span>,
    }),
    { title: '席位上限', dataIndex: 'quotas', width: 100, align: 'center', render: (q?: { maxUsers?: number } | null) => q?.maxUsers ?? '不限' },
    { title: '备注', dataIndex: 'remark', minWidth: 200, render: renderEllipsis },
    createdAtColumn,
    status.column(),
    operationColumn,
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        page={page}
        filters={['keyword', 'status']}
        create={<CreateButton permission="system:tenant-package:create" onClick={modal.openCreate} />}
        actions={hasSelection && hasPermission('system:tenant-package:delete') && <BatchDeleteButton count={selectedRowKeys.length} onClick={handleBatchDelete} />}
        filterTitle="套餐筛选"
        actionTitle="套餐操作"
      />

      <ConfigurableTable<TenantPackage>
        columns={columns}
        {...tableProps}
      />

      <EditFormModal modal={modal} width={520}>
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
          optionList={statusOptions}
          placeholder="请选择状态"
        />
        <Form.TextArea field="remark" label="备注" placeholder="请输入备注" rows={3} />
      </EditFormModal>

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
