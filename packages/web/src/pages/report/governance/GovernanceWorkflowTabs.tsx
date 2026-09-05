import { useState } from 'react';
import { Banner, Button, Col, Empty, Form, Modal, Row, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { ReportApprovalStatus, ReportPublishApproval, ReportResourceTransfer, ReportResourceType, ReportTransferStatus } from '@zenith/shared/report';
import { Plus } from 'lucide-react';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { useReportAssetCatalog } from '@/hooks/queries/report-assets';
import {
  useCancelReportApproval,
  useCancelReportTransfer,
  useCreateReportApproval,
  useCreateReportTransfer,
  useDecideReportApproval,
  useDecideReportTransfer,
  useReportApprovalList,
  useReportTransferList,
} from '@/hooks/queries/report-governance';
import { useAllUsers } from '@/hooks/queries/users';
import { approvalConflictMessage, parseJsonObject } from '../report-platform-utils';
import { REPORT_RESOURCE_TYPE_OPTIONS, reportResourceTypeLabel } from '../report-platform-options';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { confirmDanger } from '@/utils/confirm';
import { FilterSelect } from '@/components/search-filters';

const approvalStatuses = ['pending', 'approved', 'rejected', 'cancelled'] as const;
const transferStatuses = ['pending', 'accepted', 'rejected', 'cancelled'] as const;
const statusColor: Record<string, 'grey' | 'green' | 'red' | 'orange'> = {
  pending: 'orange', approved: 'green', accepted: 'green', rejected: 'red', cancelled: 'grey',
};

export function GovernanceApprovalTab() {
  const { hasPermission } = usePermission();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [status, setStatus] = useState<ReportApprovalStatus | undefined>();
  const [resourceType, setResourceType] = useState<ReportResourceType | undefined>();
  const listQuery = useReportApprovalList({ page, pageSize, status, resourceType });
  const assetsQuery = useReportAssetCatalog({ page: 1, pageSize: 100, types: resourceType });
  const createMutation = useCreateReportApproval();
  const decideMutation = useDecideReportApproval();
  const cancelMutation = useCancelReportApproval();

  const approvalModal = useEditModal<ReportPublishApproval, Record<string, unknown>, Parameters<typeof createMutation.mutateAsync>[0]>({
    save: {
      isPending: createMutation.isPending,
      mutateAsync: ({ values }) => createMutation.mutateAsync(values),
    },
    defaults: { action: 'publish', requestedRevision: 1, snapshot: '{}' },
    labelWidth: 95,
    beforeSave: (values) => ({ body: {
        resourceType: values.resourceType as ReportResourceType,
        resourceId: Number(values.resourceId),
        action: values.action as 'publish' | 'promote' | 'deprecate',
        requestedRevision: Number(values.requestedRevision),
        snapshot: parseJsonObject(String(values.snapshot), '发布快照'),
        note: values.note ? String(values.note) : undefined,
    } }),
    successMessage: () => '发布审批已提交',
  });
  const decide = (record: ReportPublishApproval, decision: 'approved' | 'rejected') => {
    Modal.confirm({
      title: decision === 'approved' ? '通过该发布审批？' : '拒绝该发布审批？',
      content: `资源：${record.resourceName ?? `${record.resourceType} #${record.resourceId}`}，申请修订：${record.requestedRevision}`,
      okButtonProps: decision === 'rejected' ? { type: 'danger', theme: 'solid' } : undefined,
      onOk: async () => {
        try {
          await decideMutation.mutateAsync({ params: { id: record.id }, body: { decision } });
          Toast.success(decision === 'approved' ? '审批已通过' : '审批已拒绝');
        } catch (error) {
          Toast.error(approvalConflictMessage(error) ?? (error instanceof Error ? error.message : '审批处理失败'));
        }
      },
    });
  };

  const columns: ColumnProps<ReportPublishApproval>[] = [
    { title: '资源', dataIndex: 'resourceName', minWidth: 200, render: (v, r) => renderEllipsis(v || `${reportResourceTypeLabel(r.resourceType)} #${r.resourceId}`) },
    { title: '动作', dataIndex: 'action', width: 100 },
    { title: '修订', dataIndex: 'requestedRevision', width: 80 },
    { title: '申请人', dataIndex: 'requestedByName', width: 120, render: (v) => v || '—' },
    dateTimeColumn('申请时间', 'requestedAt'),
    { title: '处理人', dataIndex: 'decidedByName', width: 120, render: (v) => v || '—' },
    { title: '状态', dataIndex: 'status', width: 100, fixed: 'right', render: (v) => <Tag color={statusColor[v]}>{v}</Tag> },
    createOperationColumn<ReportPublishApproval>({
      width: 120,
      desktopInlineKeys: ['approve'],
      actions: (record) => [
        { key: 'approve', label: '通过', hidden: !hasPermission('report:approval:approve') || record.status !== 'pending', onClick: () => decide(record, 'approved') },
        { key: 'reject', label: '拒绝', danger: true, hidden: !hasPermission('report:approval:approve') || record.status !== 'pending', onClick: () => decide(record, 'rejected') },
        {
          key: 'cancel', label: '取消申请', danger: true, hidden: !hasPermission('report:approval:request') || record.status !== 'pending',
          onClick: () => { confirmDanger({
            title: '取消该发布审批申请？',
            onOk: async () => { await cancelMutation.mutateAsync({ params: { id: record.id }, body: {} }); Toast.success('审批申请已取消'); },
          }); },
        },
      ],
    }),
  ];

  return (
    <>
      <SearchToolbar>
        <FilterSelect
          placeholder="全部审批状态"
          items={approvalStatuses.map((value) => ({ value, label: value }))}
          value={status}
          onChange={(v) => { setPage(1); setStatus(v as ReportApprovalStatus | undefined); }}
          width={140}
        />
        <FilterSelect
          placeholder="全部资源类型"
          items={REPORT_RESOURCE_TYPE_OPTIONS}
          value={resourceType}
          onChange={(v) => { setPage(1); setResourceType(v as ReportResourceType | undefined); }}
          width={150}
        />
        {hasPermission('report:approval:request') ? <Button type="primary" icon={<Plus size={14} />} onClick={approvalModal.openCreate}>申请发布</Button> : null}
      </SearchToolbar>
      {listQuery.isError && <Banner type="danger" description="发布审批加载失败" />}
      <ConfigurableTable bordered rowKey="id" columns={columns} dataSource={listQuery.data?.list ?? []} loading={listQuery.isFetching} empty={<Empty title="暂无发布审批" />} pagination={buildPagination(listQuery.data?.total ?? 0)} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} />
      <AppModal {...approvalModal.modalProps} title="申请发布审批" width={640}>
        <Form key={approvalModal.formKey} {...approvalModal.formProps}>
          <Row gutter={16}>
            <Col xs={24} md={12}><Form.Select field="resourceType" label="资源类型" style={{ width: '100%' }} optionList={REPORT_RESOURCE_TYPE_OPTIONS} rules={[{ required: true }]} onChange={(v) => setResourceType(v as ReportResourceType)} /></Col>
            <Col xs={24} md={12}><Form.Select field="resourceId" label="资源" filter style={{ width: '100%' }} optionList={(assetsQuery.data?.list ?? []).map((item) => ({ value: item.resourceId, label: item.name }))} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.Select field="action" label="发布动作" style={{ width: '100%' }} optionList={[{ value: 'publish', label: '发布' }, { value: 'promote', label: '环境晋级' }, { value: 'deprecate', label: '废弃' }]} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.InputNumber field="requestedRevision" label="申请修订" min={1} style={{ width: '100%' }} rules={[{ required: true }]} /></Col>
          </Row>
          <Form.TextArea field="snapshot" label="发布快照" autosize rows={6} rules={[{ required: true }]} />
          <Form.TextArea field="note" label="申请说明" autosize rows={2} />
        </Form>
      </AppModal>
    </>
  );
}

export function GovernanceTransferTab() {
  const { hasPermission } = usePermission();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [status, setStatus] = useState<ReportTransferStatus | undefined>();
  const [resourceType, setResourceType] = useState<ReportResourceType | undefined>();
  const listQuery = useReportTransferList({ page, pageSize, status, resourceType });
  const assetsQuery = useReportAssetCatalog({ page: 1, pageSize: 100, types: resourceType });
  const usersQuery = useAllUsers();
  const createMutation = useCreateReportTransfer();
  const decideMutation = useDecideReportTransfer();
  const cancelMutation = useCancelReportTransfer();

  const transferModal = useEditModal<ReportResourceTransfer, Record<string, unknown>, Parameters<typeof createMutation.mutateAsync>[0]>({
    save: {
      isPending: createMutation.isPending,
      mutateAsync: ({ values }) => createMutation.mutateAsync(values),
    },
    labelWidth: 95,
    beforeSave: (values) => ({ body: {
        resourceType: values.resourceType as ReportResourceType,
        resourceId: Number(values.resourceId),
        toOwnerId: Number(values.toOwnerId),
        reason: values.reason ? String(values.reason) : undefined,
    } }),
    successMessage: () => '所有权转移已申请',
  });
  const decide = (record: ReportResourceTransfer, decision: 'accepted' | 'rejected') => {
    Modal.confirm({
      title: decision === 'accepted' ? '接受该所有权转移？' : '拒绝该所有权转移？',
      content: `${record.fromOwnerName ?? '当前负责人'} → ${record.toOwnerName ?? `用户 #${record.toOwnerId}`}`,
      okButtonProps: decision === 'rejected' ? { type: 'danger', theme: 'solid' } : undefined,
      onOk: async () => {
        await decideMutation.mutateAsync({ params: { id: record.id }, body: { decision } });
        Toast.success(decision === 'accepted' ? '所有权已转移' : '转移已拒绝');
      },
    });
  };
  const columns: ColumnProps<ReportResourceTransfer>[] = [
    { title: '资源', dataIndex: 'resourceName', width: 200, render: (v, r) => renderEllipsis(v || `${reportResourceTypeLabel(r.resourceType)} #${r.resourceId}`) },
    { title: '原负责人', dataIndex: 'fromOwnerName', width: 130, render: (v) => v || '未分配' },
    { title: '新负责人', dataIndex: 'toOwnerName', width: 130, render: (v, r) => v || `用户 #${r.toOwnerId}` },
    { title: '原因', dataIndex: 'reason', minWidth: 220, render: renderEllipsis },
    dateTimeColumn('申请时间', 'createdAt'),
    { title: '状态', dataIndex: 'status', width: 100, fixed: 'right', render: (v) => <Tag color={statusColor[v]}>{v}</Tag> },
    createOperationColumn<ReportResourceTransfer>({
      width: 120,
      desktopInlineKeys: ['accept'],
      actions: (record) => [
        { key: 'accept', label: '接受', hidden: !hasPermission('report:resource:transfer') || record.status !== 'pending', onClick: () => decide(record, 'accepted') },
        { key: 'reject', label: '拒绝', danger: true, hidden: !hasPermission('report:resource:transfer') || record.status !== 'pending', onClick: () => decide(record, 'rejected') },
        {
          key: 'cancel', label: '取消申请', danger: true, hidden: !hasPermission('report:resource:transfer') || record.status !== 'pending',
          onClick: () => { confirmDanger({
            title: '取消该所有权转移申请？',
            onOk: async () => { await cancelMutation.mutateAsync({ params: { id: record.id }, body: {} }); Toast.success('转移申请已取消'); },
          }); },
        },
      ],
    }),
  ];
  return (
    <>
      <SearchToolbar>
        <FilterSelect
          placeholder="全部转移状态"
          items={transferStatuses.map((value) => ({ value, label: value }))}
          value={status}
          onChange={(v) => { setPage(1); setStatus(v as ReportTransferStatus | undefined); }}
          width={140}
        />
        <FilterSelect
          placeholder="全部资源类型"
          items={REPORT_RESOURCE_TYPE_OPTIONS}
          value={resourceType}
          onChange={(v) => { setPage(1); setResourceType(v as ReportResourceType | undefined); }}
          width={150}
        />
        {hasPermission('report:resource:transfer') ? <Button type="primary" icon={<Plus size={14} />} onClick={transferModal.openCreate}>申请转移</Button> : null}
      </SearchToolbar>
      {listQuery.isError && <Banner type="danger" description="所有权转移列表加载失败" />}
      <ConfigurableTable bordered rowKey="id" columns={columns} dataSource={listQuery.data?.list ?? []} loading={listQuery.isFetching} empty={<Empty title="暂无所有权转移" />} pagination={buildPagination(listQuery.data?.total ?? 0)} onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} />
      <AppModal {...transferModal.modalProps} title="申请所有权转移" width={600}>
        <Form key={transferModal.formKey} {...transferModal.formProps}>
          <Row gutter={16}>
            <Col xs={24} md={12}><Form.Select field="resourceType" label="资源类型" style={{ width: '100%' }} optionList={REPORT_RESOURCE_TYPE_OPTIONS} rules={[{ required: true }]} onChange={(v) => setResourceType(v as ReportResourceType)} /></Col>
            <Col xs={24} md={12}><Form.Select field="resourceId" label="资源" filter style={{ width: '100%' }} optionList={(assetsQuery.data?.list ?? []).map((item) => ({ value: item.resourceId, label: item.name }))} rules={[{ required: true }]} /></Col>
          </Row>
          <Form.Select field="toOwnerId" label="新负责人" filter style={{ width: '100%' }} optionList={(usersQuery.data ?? []).map((user) => ({ value: user.id, label: user.nickname || user.username }))} rules={[{ required: true }]} />
          <Form.TextArea field="reason" label="转移原因" autosize rows={3} />
        </Form>
      </AppModal>
    </>
  );
}
