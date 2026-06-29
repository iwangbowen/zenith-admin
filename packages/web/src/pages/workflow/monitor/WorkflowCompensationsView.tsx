import { useCallback, useEffect, useState } from 'react';
import { Button, Input, Modal, Select, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { RotateCcw } from 'lucide-react';
import type { PaginatedResponse, WorkflowCompensation } from '@zenith/shared';
import { request } from '@/utils/request';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';

const STATUS: Record<string, { text: string; color: string }> = {
  pending: { text: '待修复', color: 'amber' },
  resolved: { text: '已放行', color: 'green' },
  terminated: { text: '已终止', color: 'red' },
};

export default function WorkflowCompensationsView() {
  const { hasPermission } = usePermission();
  const canOperate = hasPermission('workflow:engine:operate');
  const { page, pageSize, buildPagination } = usePagination();
  const [data, setData] = useState<PaginatedResponse<WorkflowCompensation> | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | undefined>('pending');

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (status) qs.set('status', status);
      const res = await request.get<PaginatedResponse<WorkflowCompensation>>(`/api/workflows/compensation/list?${qs}`);
      if (res.data) setData(res.data);
    } finally { setLoading(false); }
  }, [page, pageSize, status]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const resolve = (r: WorkflowCompensation, action: 'resolve' | 'terminate') => { Modal.confirm({
    title: action === 'resolve' ? '标记修复放行' : '终止流程',
    content: action === 'resolve' ? '确认异常已处理，流程继续？' : '将终止该实例并跳过待办，不可恢复',
    okButtonProps: action === 'terminate' ? { type: 'danger' } : undefined,
    onOk: async () => {     const res = await request.post(`/api/workflows/compensation/${r.id}/resolve`, { action }); if (res.code === 0) { Toast.success('已处理'); fetchList(); } },
  }); };

  const columns: ColumnProps<WorkflowCompensation>[] = [
    { title: '实例', dataIndex: 'instanceId', width: 90, render: (v: number) => `#${v}` },
    { title: '节点', dataIndex: 'nodeName', width: 120, render: renderEllipsis },
    { title: '错误', dataIndex: 'errorMessage', render: renderEllipsis },
    { title: '处理动作', dataIndex: 'action', width: 90 },
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (s: string) => <Tag color={STATUS[s]?.color as never}>{STATUS[s]?.text ?? s}</Tag> },
    createdAtColumn,
    createOperationColumn<WorkflowCompensation>({
      actions: (r) => [
        { key: 'resolve', label: '放行', hidden: !canOperate || r.status !== 'pending', onClick: () => resolve(r, 'resolve') },
        { key: 'terminate', label: '终止', danger: true, hidden: !canOperate || r.status !== 'pending', onClick: () => resolve(r, 'terminate') },
      ],
    }),
  ];

  return (
    <div>
      <SearchToolbar primary={(
        <Space>
          <Select value={status} onChange={(v) => setStatus(v as string)} placeholder="状态" style={{ width: 130 }} showClear
            optionList={[{ value: 'pending', label: '待修复' }, { value: 'resolved', label: '已放行' }, { value: 'terminated', label: '已终止' }]} />
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => fetchList()}>刷新</Button>
          <Typography.Text type="tertiary" size="small">异常捕获产生的人工修复工单</Typography.Text>
        </Space>
      )} />
      <ConfigurableTable bordered columns={columns} dataSource={data?.list ?? []} loading={loading} onRefresh={fetchList} refreshLoading={loading} rowKey="id" size="small" empty="暂无补偿工单" pagination={buildPagination(data?.total ?? 0, fetchList)} />
    </div>
  );
}
