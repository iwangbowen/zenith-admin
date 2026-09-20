import { useEffect, useState } from 'react';
import { Button, Descriptions, Empty, Progress, Select, SideSheet, Space, Spin, Table, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { ErrorEvent, ErrorLevel, ErrorStatus } from '@zenith/shared/analytics';
import { ANALYTICS_ENVIRONMENT_LABELS, ERROR_LEVEL_OPTIONS, ERROR_STATUS_OPTIONS } from '@zenith/shared/analytics';
import { CodeBlock, ErrorLevelTag, ErrorStatusTag, ErrorTypeIcon, ErrorTypeTag, TrendSparkline } from '@/components/error-tracking';
import UserSelect from '@/components/UserSelect';
import { useExceptionGroupDetail, useUpdateExceptionGroup } from '@/hooks/queries/exception-logs';
import { usePermission } from '@/hooks/usePermission';
import { formatDateTime } from '@/utils/date';
import { dateTimeColumn, renderCodeEllipsis, renderEllipsis } from '@/utils/table-columns';

const { Paragraph, Text, Title } = Typography;

interface HandleForm {
  status: ErrorStatus;
  level: ErrorLevel;
  assigneeId: number | null;
  note: string;
}

function DistributionList<T extends { value: number }>({ title, data, labelOf }: Readonly<{ title: string; data: readonly T[]; labelOf: (item: T) => string }>) {
  const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
  return (
    <div style={{ flex: 1, minWidth: 220 }}>
      <Title heading={6} style={{ marginBottom: 8 }}>{title}</Title>
      {data.length === 0 ? <Text type="tertiary">暂无数据</Text> : (
        <Space vertical align="start" spacing={6} style={{ width: '100%' }}>
          {data.map((item, index) => (
            <div key={`${labelOf(item)}-${index}`} style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '75%' }} size="small">{labelOf(item)}</Text>
                <Text size="small" type="tertiary">{item.value}</Text>
              </div>
              <Progress percent={Math.round((item.value / total) * 100)} showInfo={false} size="small" aria-label={`${labelOf(item)} 占比`} />
            </div>
          ))}
        </Space>
      )}
    </div>
  );
}

export interface ExceptionIssueDetailSheetProps {
  readonly groupId: number | undefined;
  readonly onClose: () => void;
  readonly onOpenEvent: (event: ErrorEvent) => void;
}

/** 异常分组详情：处理表单 → 最新堆栈 → 趋势与分布 → 最近事件 */
export function ExceptionIssueDetailSheet({ groupId, onClose, onOpenEvent }: ExceptionIssueDetailSheetProps) {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('system:exception-log:manage');
  const detailQuery = useExceptionGroupDetail(groupId, groupId !== undefined);
  const detail = detailQuery.data ?? null;
  const updateMutation = useUpdateExceptionGroup();
  const [form, setForm] = useState<HandleForm>({ status: 'unresolved', level: 'error', assigneeId: null, note: '' });

  useEffect(() => {
    if (detail) {
      setForm({ status: detail.group.status, level: detail.group.level, assigneeId: detail.group.assigneeId, note: detail.group.note ?? '' });
    }
  }, [detail]);

  const save = async () => {
    if (groupId === undefined) return;
    await updateMutation.mutateAsync({ params: { id: groupId }, body: { status: form.status, level: form.level, assigneeId: form.assigneeId, note: form.note.trim() || null } });
    Toast.success('已保存处理结果');
  };

  const latest = detail?.recentEvents[0] ?? null;

  const eventColumns: ColumnProps<ErrorEvent>[] = [
    dateTimeColumn('时间', 'createdAt'),
    { title: '级别', dataIndex: 'level', width: 80, render: (_v, record) => <ErrorLevelTag level={record.level} /> },
    {
      title: '路由 / 作业',
      dataIndex: 'route',
      minWidth: 180,
      render: (_v, record) => renderCodeEllipsis(
        record.route
          ? `${record.httpMethod ?? ''} ${record.route}`.trim()
          : record.jobType ? `${record.jobType}${record.jobId ? ` #${record.jobId}` : ''}` : null,
      ),
    },
    { title: '主机', dataIndex: 'hostname', width: 190, render: (v: string | null, record) => renderEllipsis(v ? `${v}${record.processRole ? ` · ${record.processRole}` : ''}` : null) },
    { title: '用户', dataIndex: 'username', width: 90, render: (v: string | null, record) => renderEllipsis(v ?? (record.userId ? `#${record.userId}` : null)) },
    {
      title: '操作',
      dataIndex: 'id',
      width: 80,
      fixed: 'right',
      render: (_v, record) => <Button size="small" theme="borderless" type="primary" onClick={() => onOpenEvent(record)}>详情</Button>,
    },
  ];

  return (
    <SideSheet
      title={detail ? <Space spacing={8}><ErrorTypeIcon type={detail.group.errorType} /><span>异常 Issue #{detail.group.id}</span></Space> : '异常 Issue'}
      visible={groupId !== undefined}
      onCancel={onClose}
      width={860}
      closeOnEsc
    >
      <Spin spinning={detailQuery.isLoading}>
        {/* paddingBottom：抽屉底部无内边距，内容以表格结尾时最后一行会贴着边缘（与 global.css 给 Modal 补的同类间距一致） */}
        {detail ? (
          <Space vertical align="start" spacing={16} style={{ width: '100%', paddingBottom: 16 }}>
            <Space spacing={8} wrap>
              <ErrorTypeTag type={detail.group.errorType} />
              <ErrorLevelTag level={detail.group.level} />
              <ErrorStatusTag status={detail.group.status} />
              <Text type="tertiary" size="small">{ANALYTICS_ENVIRONMENT_LABELS[detail.group.environment] ?? detail.group.environment}</Text>
              {detail.group.release && <Text type="tertiary" size="small">v{detail.group.release}</Text>}
            </Space>
            <Paragraph style={{ margin: 0, wordBreak: 'break-word' }}>{detail.group.message}</Paragraph>

            <Descriptions
              row
              size="small"
              data={[
                { key: '发生次数', value: detail.group.count },
                { key: '影响用户', value: detail.group.affectedUsers },
                { key: '首次', value: formatDateTime(detail.group.firstSeenAt) },
                { key: '最近', value: formatDateTime(detail.group.lastSeenAt) },
                { key: '14 日趋势', value: <TrendSparkline data={detail.trend.map((t) => t.count)} /> },
              ]}
            />

            <div style={{ width: '100%' }}>
              <Title heading={6} style={{ marginBottom: 8 }}>处理</Title>
              <div className="auto-grid" style={{ ['--auto-grid-cols' as string]: 2, ['--auto-grid-gap' as string]: '12px' }}>
                <Select value={form.status} optionList={ERROR_STATUS_OPTIONS} onChange={(v) => setForm((prev) => ({ ...prev, status: v as ErrorStatus }))} prefix="状态" disabled={!canManage} style={{ width: '100%' }} />
                <Select value={form.level} optionList={ERROR_LEVEL_OPTIONS} onChange={(v) => setForm((prev) => ({ ...prev, level: v as ErrorLevel }))} prefix="级别" disabled={!canManage} style={{ width: '100%' }} />
                <UserSelect value={form.assigneeId ?? undefined} onChange={(v) => setForm((prev) => ({ ...prev, assigneeId: typeof v === 'number' ? v : null }))} placeholder="指派处理人" disabled={!canManage} style={{ width: '100%' }} />
                <TextArea value={form.note} onChange={(v) => setForm((prev) => ({ ...prev, note: v }))} placeholder="处理备注" maxLength={2000} autosize={{ minRows: 1, maxRows: 4 }} disabled={!canManage} />
              </div>
              {canManage && (
                <div style={{ marginTop: 12 }}>
                  <Button type="primary" loading={updateMutation.isPending} onClick={() => void save()}>保存处理结果</Button>
                </div>
              )}
            </div>

            <div style={{ width: '100%' }}>
              <Title heading={6} style={{ marginBottom: 8 }}>最新堆栈</Title>
              {latest?.stack ? <CodeBlock maxHeight={320}>{latest.stack}</CodeBlock> : <Empty title="没有堆栈信息" style={{ padding: 12 }} />}
            </div>

            <div style={{ display: 'flex', gap: 24, width: '100%', flexWrap: 'wrap' }}>
              <DistributionList title="路由 / 作业分布" data={detail.routes} labelOf={(item: { name: string }) => item.name} />
              <DistributionList title="主机分布" data={detail.hosts} labelOf={(item: { name: string }) => item.name} />
              <DistributionList title="受影响租户" data={detail.affectedTenants} labelOf={(item: { tenantId: number | null }) => (item.tenantId === null ? '平台 / 无租户' : `租户 #${item.tenantId}`)} />
            </div>

            <div style={{ width: '100%' }}>
              <Title heading={6} style={{ marginBottom: 8 }}>最近事件</Title>
              <Table<ErrorEvent> size="small" bordered columns={eventColumns} dataSource={detail.recentEvents} rowKey="id" pagination={false} empty="暂无事件" />
            </div>
          </Space>
        ) : (
          !detailQuery.isLoading && <Empty title="分组不存在或已删除" style={{ padding: 24 }} />
        )}
      </Spin>
    </SideSheet>
  );
}
