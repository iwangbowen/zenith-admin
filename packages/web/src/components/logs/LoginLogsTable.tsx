import { useMemo, useState } from 'react';
import { Button, Descriptions, Modal, Tag } from '@douyinfe/semi-ui';
import type { ColumnProps, TableProps } from '@douyinfe/semi-ui/lib/es/table';
import type { LoginLog } from '@zenith/shared';
import ConfigurableTable from '@/components/ConfigurableTable';
import { formatDateTime } from '@/utils/date';

interface LoginLogsTableProps {
  readonly dataSource: LoginLog[];
  readonly loading?: boolean;
  readonly pagination?: TableProps<LoginLog>['pagination'];
  readonly onRefresh?: () => void;
  readonly columnSettings?: boolean;
  readonly columnSettingsKey?: string;
}

function LoginStatusTag({ status, size }: Readonly<{ status: LoginLog['status']; size?: 'small' | 'default' | 'large' }>) {
  return (
    <Tag color={status === 'success' ? 'green' : 'red'} size={size}>
      {status === 'success' ? '成功' : '失败'}
    </Tag>
  );
}

export function LoginLogsTable({
  dataSource,
  loading,
  pagination,
  onRefresh,
  columnSettings,
  columnSettingsKey,
}: LoginLogsTableProps) {
  const [detailLog, setDetailLog] = useState<LoginLog | null>(null);

  const columns = useMemo<ColumnProps<LoginLog>[]>(() => [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '用户名', dataIndex: 'username', width: 120 },
    { title: '登录信息', dataIndex: 'message', width: 150, render: (v: string | null) => v ?? '-' },
    { title: 'IP 地址', dataIndex: 'ip', width: 150, render: (v: string | null) => v ?? '-' },
    { title: '登录地点', dataIndex: 'location', width: 180, render: (v: string | null) => v ?? '-' },
    { title: '浏览器', dataIndex: 'browser', width: 150, render: (v: string | null) => v ?? '-' },
    { title: '操作系统', dataIndex: 'os', width: 150, render: (v: string | null) => v ?? '-' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status: LoginLog['status']) => <LoginStatusTag status={status} />,
    },
    {
      title: '登录时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '操作',
      key: 'operation',
      width: 80,
      fixed: 'right' as const,
      render: (_: unknown, record: LoginLog) => (
        <Button
          theme="borderless"
          type="primary"
          size="small"
          onClick={() => setDetailLog(record)}
        >
          详情
        </Button>
      ),
    },
  ], []);

  return (
    <>
      <ConfigurableTable<LoginLog>
        bordered
        columns={columns}
        dataSource={dataSource}
        loading={loading}
        pagination={pagination}
        rowKey="id"
        onRefresh={onRefresh}
        columnSettings={columnSettings}
        columnSettingsKey={columnSettingsKey}
      />

      <Modal
        title="登录日志详情"
        visible={detailLog !== null}
        onCancel={() => setDetailLog(null)}
        footer={null}
        width={560}
        style={{ top: 40 }}
      >
        {detailLog && (
          <Descriptions
            data={[
              { key: 'ID', value: String(detailLog.id) },
              { key: '用户名', value: detailLog.username },
              {
                key: '状态',
                value: <LoginStatusTag status={detailLog.status} size="small" />,
              },
              { key: '登录信息', value: detailLog.message ?? '-' },
              { key: 'IP 地址', value: detailLog.ip ?? '-' },
              { key: '登录地点', value: detailLog.location ?? '-' },
              { key: '浏览器', value: detailLog.browser ?? '-' },
              { key: '操作系统', value: detailLog.os ?? '-' },
              { key: 'User-Agent', value: detailLog.userAgent ?? '-', span: 2 },
              { key: '登录时间', value: formatDateTime(detailLog.createdAt) },
              ...(detailLog.screenWidth && detailLog.screenHeight ? [
                { key: '屏幕分辨率', value: [detailLog.screenWidth, ' × ', detailLog.screenHeight, detailLog.devicePixelRatio && detailLog.devicePixelRatio !== '1' ? ` (${detailLog.devicePixelRatio}x)` : ''].join('') },
              ] : []),
              ...(detailLog.gpu ? [{ key: 'GPU', value: detailLog.gpu, span: 2 }] : []),
              ...(detailLog.cpuCores ? [{ key: 'CPU 核心数', value: String(detailLog.cpuCores) }] : []),
              ...(detailLog.memoryGb ? [{ key: '内存', value: `${detailLog.memoryGb} GB` }] : []),
            ]}
            column={2}
            layout="horizontal"
            align="left"
          />
        )}
      </Modal>
    </>
  );
}

export default LoginLogsTable;
