import { useMemo, useState } from 'react';
import { Button, Descriptions, Tag } from '@douyinfe/semi-ui';
import AppModal from '@/components/AppModal';
import type { ColumnProps, TableProps } from '@douyinfe/semi-ui/lib/es/table';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag';
import { LOGIN_EVENT_TYPE_LABELS, type LoginEventType, type LoginLog } from '@zenith/shared/identity';
import ConfigurableTable from '@/components/ConfigurableTable';
import { formatDateTime } from '@/utils/date';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { UserDisplayCell, formatUserLabel } from '@/components/UserDisplay';

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

const LOGIN_EVENT_TYPE_COLORS: Record<LoginEventType, TagColor> = {
  login: 'cyan',
  logout: 'blue',
  impersonate: 'orange',
  impersonate_end: 'grey',
  kicked: 'red',
};

function LoginEventTypeTag({ eventType, size }: Readonly<{ eventType?: LoginLog['eventType']; size?: 'small' | 'default' | 'large' }>) {
  const normalized: LoginEventType = eventType ?? 'login';
  return (
    <Tag color={LOGIN_EVENT_TYPE_COLORS[normalized]} size={size}>
      {LOGIN_EVENT_TYPE_LABELS[normalized]}
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
    { title: '用户', dataIndex: 'username', width: 160, render: (v: string, r: LoginLog) => <UserDisplayCell username={v} nickname={r.nickname} /> },
    {
      title: '事件',
      dataIndex: 'eventType',
      width: 110,
      render: (eventType: LoginLog['eventType']) => <LoginEventTypeTag eventType={eventType} />,
    },
    { title: '事件信息', dataIndex: 'message', minWidth: 160, render: (v: string | null) => v ?? '-' },
    { title: 'IP 地址', dataIndex: 'ip', width: 150, render: (v: string | null) => v ?? '-' },
    { title: '地点', dataIndex: 'location', width: 180, render: (v: string | null) => v ?? '-' },
    { title: '浏览器', dataIndex: 'browser', width: 150, render: (v: string | null) => renderEllipsis(v ?? '-') },
    { title: '操作系统', dataIndex: 'os', width: 180, render: (v: string | null) => renderEllipsis(v ?? '-') },
    dateTimeColumn('操作时间', 'createdAt'),
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right' as const,
      render: (status: LoginLog['status']) => <LoginStatusTag status={status} />,
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

      <AppModal
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
              {
                key: '状态',
                value: <LoginStatusTag status={detailLog.status} size="small" />,
              },
              { key: '用户', value: formatUserLabel(detailLog.username, detailLog.nickname), span: 2 },
              { key: '事件', value: <LoginEventTypeTag eventType={detailLog.eventType} size="small" /> },
              { key: '事件信息', value: detailLog.message ?? '-' },
              { key: 'IP 地址', value: detailLog.ip ?? '-' },
              { key: '地点', value: detailLog.location ?? '-' },
              { key: '浏览器', value: detailLog.browser ?? '-' },
              { key: '操作系统', value: detailLog.os ?? '-' },
              { key: '操作时间', value: formatDateTime(detailLog.createdAt), span: 2 },
              { key: 'User-Agent', value: detailLog.userAgent ?? '-', span: 2 },
              ...(detailLog.screenWidth && detailLog.screenHeight ? [
                { key: '屏幕分辨率', value: [detailLog.screenWidth, ' × ', detailLog.screenHeight, detailLog.devicePixelRatio && detailLog.devicePixelRatio !== '1' ? ` (${detailLog.devicePixelRatio}x)` : ''].join(''), span: 2 },
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
      </AppModal>
    </>
  );
}

export default LoginLogsTable;
