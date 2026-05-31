import { useMemo, useState } from 'react';
import { Button, Modal, Tag } from '@douyinfe/semi-ui';
import type { ColumnProps, TableProps } from '@douyinfe/semi-ui/lib/es/table';
import type { LoginLog } from '@zenith/shared';
import ConfigurableTable from '@/components/ConfigurableTable';
import { formatDateTime } from '@/utils/date';

interface LoginLogsTableProps {
  readonly dataSource: LoginLog[];
  readonly loading?: boolean;
  readonly pagination?: TableProps<LoginLog>['pagination'];
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
          <div style={{ padding: '4px 0' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              {([
                ['ID', String(detailLog.id)],
                ['用户名', detailLog.username],
                ['状态', null],
                ['登录信息', detailLog.message ?? '-'],
                ['IP 地址', detailLog.ip ?? '-'],
                ['登录地点', detailLog.location ?? '-'],
                ['浏览器', detailLog.browser ?? '-'],
                ['操作系统', detailLog.os ?? '-'],
                ['登录时间', formatDateTime(detailLog.createdAt)],
              ] as const).map(([label, value]) => (
                <div key={label} style={{ padding: '8px 0', borderBottom: '1px solid var(--semi-color-border)' }}>
                  <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 13, wordBreak: 'break-all' }}>
                    {label === '状态'
                      ? <LoginStatusTag status={detailLog.status} size="small" />
                      : value}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: '8px 0', borderBottom: '1px solid var(--semi-color-border)' }}>
              <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12, marginBottom: 2 }}>User-Agent</div>
              <div style={{ fontSize: 13, wordBreak: 'break-all' }}>{detailLog.userAgent ?? '-'}</div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

export default LoginLogsTable;
