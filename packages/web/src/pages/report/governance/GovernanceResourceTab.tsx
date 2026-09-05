import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Banner, Button, Col, Empty, Form, Row, Select, SideSheet, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { REPORT_RESOURCE_TYPES } from '@zenith/shared/report';
import type { ReportAclSubjectType, ReportFolderTreeNode, ReportResourceAcl, ReportResourceType } from '@zenith/shared/report';
import { Plus, Shield } from 'lucide-react';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { useReportAssetCatalog } from '@/hooks/queries/report-assets';
import {
  flattenReportFolders,
  useDeleteReportFolder,
  useReportFolderTree,
  useSaveReportFolder,
} from '@/hooks/queries/report-folders';
import {
  useGrantReportResourceAcl,
  useReportResourceAcls,
  useRevokeReportResourceAcl,
} from '@/hooks/queries/report-governance';
import { useAllUsers } from '@/hooks/queries/users';
import { formatDateTimeForApi } from '@/utils/date';
import { REPORT_RESOURCE_TYPE_OPTIONS, reportResourceTypeLabel } from '../report-platform-options';
import { aclRevokeWarning, normalizeAclGrantValues } from '../report-platform-utils';
import { CreateButton } from '@/components/toolbar-controls';
import { confirmDanger, confirmDelete } from '@/utils/confirm';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';

export default function GovernanceResourceTab() {
  const { hasPermission } = usePermission();
  const [searchParams] = useSearchParams();
  const initialType = searchParams.get('resourceType');
  const initialResourceId = Number(searchParams.get('resourceId'));
  const [resourceType, setResourceType] = useState<ReportResourceType>(
    REPORT_RESOURCE_TYPES.includes(initialType as ReportResourceType) ? initialType as ReportResourceType : 'dataset',
  );
  const [resourceId, setResourceId] = useState<number | undefined>(
    Number.isInteger(initialResourceId) && initialResourceId > 0 ? initialResourceId : undefined,
  );
  const [aclVisible, setAclVisible] = useState(false);
  const [subjectType, setSubjectType] = useState<ReportAclSubjectType>('user');

  const foldersQuery = useReportFolderTree({ resourceType });
  const folders = flattenReportFolders(foldersQuery.data ?? []);
  const assetsQuery = useReportAssetCatalog({ page: 1, pageSize: 100, types: resourceType });
  const usersQuery = useAllUsers();
  const aclsQuery = useReportResourceAcls({ resourceType, resourceId: resourceId ?? 0, inheritFromFolder: true }, aclVisible);
  const saveFolderMutation = useSaveReportFolder();
  const deleteFolderMutation = useDeleteReportFolder();
  const grantAclMutation = useGrantReportResourceAcl();
  const revokeAclMutation = useRevokeReportResourceAcl();

  const folderModal = useEditModal<ReportFolderTreeNode, Record<string, unknown>>({
    entityName: '资源目录',
    save: saveFolderMutation,
    defaults: { sort: 0, status: 'enabled' },
    beforeSave: (values, { isEdit }) => ({
      ...values,
      parentId: values.parentId || null,
      ownerId: values.ownerId || null,
      ...(isEdit ? {} : { resourceType }),
    }),
    successMessage: ({ isEdit }) => isEdit ? '目录已更新' : '目录已创建',
  });
  const openFolder = (record?: ReportFolderTreeNode) => {
    if (record) folderModal.openEdit(record);
    else folderModal.openCreate();
  };
  const openAcl = () => {
    if (!resourceId) {
      Toast.warning('请先选择要管理权限的资源');
      return;
    }
    setAclVisible(true);
  };
  const aclModal = useEditModal<ReportResourceAcl, Record<string, unknown>, Parameters<typeof grantAclMutation.mutateAsync>[0]>({
    save: {
      isPending: grantAclMutation.isPending,
      mutateAsync: ({ values }) => grantAclMutation.mutateAsync(values),
    },
    defaults: { subjectType: 'user', role: 'viewer', inheritFromFolder: false },
    beforeSave: (values) => ({ body: normalizeAclGrantValues(resourceType, resourceId!, {
        ...values,
        expiresAt: values.expiresAt ? formatDateTimeForApi(values.expiresAt as Date) : null,
    }) }),
    successMessage: () => '资源权限已授予',
  });
  const openGrantAcl = () => {
    setSubjectType('user');
    aclModal.openCreate();
  };

  const folderColumns: ColumnProps<ReportFolderTreeNode>[] = [
    { title: '目录名称', dataIndex: 'name', minWidth: 220, render: renderEllipsis },
    { title: '资源类型', dataIndex: 'resourceType', width: 130, render: (v) => reportResourceTypeLabel(v as ReportResourceType) },
    { title: '负责人', dataIndex: 'ownerName', width: 130, render: (v) => v || '—' },
    { title: '资源数', dataIndex: 'resourceCount', width: 90, align: 'right', render: (v) => v ?? 0 },
    { title: '排序', dataIndex: 'sort', width: 80 },
    dateTimeColumn('更新时间', 'updatedAt'),
    { title: '状态', dataIndex: 'status', width: 100, fixed: 'right', render: (v) => <Tag color={v === 'enabled' ? 'green' : 'grey'}>{v === 'enabled' ? '启用' : '停用'}</Tag> },
    createOperationColumn<ReportFolderTreeNode>({
      width: 120,
      desktopInlineKeys: ['edit'],
      actions: (record) => [
        { key: 'edit', label: '编辑', hidden: !hasPermission('report:folder:update'), onClick: () => openFolder(record) },
        {
          key: 'delete', label: '删除', danger: true, hidden: !hasPermission('report:folder:delete'),
          onClick: () => { confirmDelete({
            title: `删除目录「${record.name}」？`,
            content: '存在子目录或资源时无法删除。',
            onOk: async () => { await deleteFolderMutation.mutateAsync({ params: { id: record.id } }); Toast.success('目录已删除'); },
          }); },
        },
      ],
    }),
  ];
  const aclColumns: ColumnProps<ReportResourceAcl>[] = [
    { title: '主体类型', dataIndex: 'subjectType', width: 110 },
    { title: '主体 ID', dataIndex: 'subjectId', width: 100 },
    { title: '角色', dataIndex: 'role', width: 100, render: (v) => <Tag>{v}</Tag> },
    { title: '目录继承', dataIndex: 'inheritFromFolder', width: 100, render: (v) => v ? '是' : '否' },
    dateTimeColumn('到期时间', 'expiresAt', { empty: '永久' }),
    { title: '授权人', dataIndex: 'grantedByName', minWidth: 120, render: (v) => v || '—' },
    createOperationColumn<ReportResourceAcl>({
      width: 100,
      actions: (record) => [{
        key: 'revoke', label: '撤销', danger: true, hidden: !hasPermission('report:resource:acl'),
        onClick: () => { confirmDanger({
          title: '确认撤销该资源权限？',
          content: aclRevokeWarning(),
          onOk: async () => { await revokeAclMutation.mutateAsync({ params: { id: record.id } }); Toast.success('权限已撤销'); },
        }); },
      }],
    }),
  ];

  return (
    <>
      <SearchToolbar>
        <Select value={resourceType} optionList={REPORT_RESOURCE_TYPE_OPTIONS} style={{ width: 150 }} onChange={(v) => { setResourceType(v as ReportResourceType); setResourceId(undefined); }} />
        <Select
          placeholder="选择资源管理 ACL"
          filter
          showClear
          value={resourceId}
          optionList={(assetsQuery.data?.list ?? []).map((item) => ({ value: item.resourceId, label: item.name }))}
          style={{ width: 230 }}
          onChange={(v) => setResourceId(v as number | undefined)}
        />
        {hasPermission('report:resource:acl') ? <Button icon={<Shield size={14} />} onClick={openAcl}>权限管理</Button> : null}
        {hasPermission('report:folder:create') ? <CreateButton onClick={() => openFolder()}>新增目录</CreateButton> : null}
      </SearchToolbar>
      {foldersQuery.isError && <Banner type="danger" description="资源目录加载失败" />}
      <ConfigurableTable
        bordered
        rowKey="id"
        columns={folderColumns}
        dataSource={folders}
        loading={foldersQuery.isFetching}
        empty={<Empty title="暂无资源目录" />}
        pagination={false}
        onRefresh={() => void foldersQuery.refetch()}
        refreshLoading={foldersQuery.isFetching}
      />

      <AppModal {...folderModal.modalProps} width={560}>
        <Form key={folderModal.formKey} {...folderModal.formProps}>
          <Form.Input field="name" label="目录名称" rules={[{ required: true }]} />
          <Form.Select field="parentId" label="上级目录" showClear filter style={{ width: '100%' }} optionList={folders.filter((item) => item.id !== folderModal.editing?.id).map((item) => ({ value: item.id, label: item.name }))} />
          <Row gutter={16}>
            <Col xs={24} md={12}><Form.Select field="ownerId" label="负责人" showClear filter style={{ width: '100%' }} optionList={(usersQuery.data ?? []).map((user) => ({ value: user.id, label: user.nickname || user.username }))} /></Col>
            <Col xs={24} md={12}><Form.InputNumber field="sort" label="排序" style={{ width: '100%' }} /></Col>
          </Row>
          <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]} />
        </Form>
      </AppModal>

      <SideSheet title="资源权限管理" visible={aclVisible} width={760} onCancel={() => setAclVisible(false)}>
        {hasPermission('report:resource:acl') ? <Button type="primary" icon={<Plus size={14} />} style={{ marginBottom: 12 }} onClick={openGrantAcl}>授予权限</Button> : null}
        {aclsQuery.isError && <Banner type="danger" description="资源权限加载失败" />}
        <ConfigurableTable bordered rowKey="id" columns={aclColumns} dataSource={aclsQuery.data ?? []} loading={aclsQuery.isFetching} empty={<Empty title="暂无 ACL" />} pagination={false} onRefresh={() => void aclsQuery.refetch()} refreshLoading={aclsQuery.isFetching} />
      </SideSheet>

      <AppModal {...aclModal.modalProps} title="授予资源权限" width={560}>
        <Form key={aclModal.formKey} {...aclModal.formProps} onValueChange={(values) => values.subjectType && setSubjectType(values.subjectType as ReportAclSubjectType)}>
          <Form.Select field="subjectType" label="主体类型" style={{ width: '100%' }} optionList={[{ value: 'user', label: '用户' }, { value: 'role', label: '角色' }, { value: 'department', label: '部门' }, { value: 'user_group', label: '用户组' }]} rules={[{ required: true }]} />
          {subjectType === 'user'
            ? <Form.Select field="subjectId" label="主体" filter style={{ width: '100%' }} optionList={(usersQuery.data ?? []).map((user) => ({ value: user.id, label: user.nickname || user.username }))} rules={[{ required: true }]} />
            : <Form.InputNumber field="subjectId" label="主体 ID" min={1} style={{ width: '100%' }} rules={[{ required: true }]} />}
          <Form.Select field="role" label="访问角色" style={{ width: '100%' }} optionList={[{ value: 'viewer', label: '查看者' }, { value: 'editor', label: '编辑者' }, { value: 'owner', label: '所有者' }]} rules={[{ required: true }]} />
          <Form.DatePicker field="expiresAt" label="到期时间" type="dateTime" style={{ width: '100%' }} />
          <Form.Switch field="inheritFromFolder" label="目录继承" />
        </Form>
      </AppModal>
    </>
  );
}
