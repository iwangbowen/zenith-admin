import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { Button, Descriptions, JsonViewer, TabPane, Tabs, Tag, Tooltip, Typography } from '@douyinfe/semi-ui';
import AppModal from '@/components/AppModal';
import type { ColumnProps, TableProps } from '@douyinfe/semi-ui/lib/es/table';
import type { OperationLog } from '@zenith/shared/platform';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { formatDateTime } from '@/utils/date';
import './OperationLogsTable.css';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { UserDisplayCell, formatUserLabel } from '@/components/UserDisplay';
import { usePermission } from '@/hooks/usePermission';
import { useOperationLogDetail } from '@/hooks/queries/operation-logs';
import { entityRelationColumn } from '@/components/entity-relations/entity-relation-columns';
import EntityRelationButton from '@/components/entity-relations/EntityRelationButton';

interface OperationLogsTableProps {
  readonly dataSource: OperationLog[];
  readonly loading?: boolean;
  readonly pagination?: TableProps<OperationLog>['pagination'];
  readonly onRefresh?: () => void;
  readonly columnSettings?: boolean;
  readonly columnSettingsKey?: string;
}

const detailLabelStyle: CSSProperties = { color: 'var(--semi-color-text-2)', fontSize: 12, marginBottom: 2 };
const detailValueStyle: CSSProperties = { fontSize: 13, wordBreak: 'break-all' };
const detailItemStyle: CSSProperties = { padding: '8px 0', borderBottom: '1px solid var(--semi-color-border)' };

function DetailField({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div style={detailItemStyle}>
      <div style={detailLabelStyle}>{label}</div>
      <div style={detailValueStyle}>{children}</div>
    </div>
  );
}

function DataDiff({ beforeData, afterData }: Readonly<{ beforeData: string | null; afterData: string | null }>) {
  const parseSafe = (s: string | null): Record<string, unknown> | null => {
    if (!s) return null;
    try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; }
  };
  const before = parseSafe(beforeData);
  const after = parseSafe(afterData);

  if (!before && !after) {
    return <span style={{ color: 'var(--semi-color-text-2)' }}>无变更数据</span>;
  }

  const allKeys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]));
  const changedKeys = allKeys.filter((k) => {
    const bv = JSON.stringify(before?.[k]);
    const av = JSON.stringify(after?.[k]);
    return bv !== av;
  });

  if (changedKeys.length === 0 && before && after) {
    return <span style={{ color: 'var(--semi-color-text-2)' }}>数据未发生变化</span>;
  }

  const displayKeys = changedKeys.length > 0 ? changedKeys : allKeys;
  const fmtVal = (v: unknown): string | null => {
    if (v == null) return null;
    if (typeof v === 'object') return JSON.stringify(v);
    return `${v as string | number | boolean}`;
  };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ background: 'var(--semi-color-fill-0)' }}>
          <th style={{ padding: '4px 8px', textAlign: 'left', width: '30%' }}>字段</th>
          <th style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--semi-color-danger)' }}>变更前</th>
          <th style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--semi-color-success)' }}>变更后</th>
        </tr>
      </thead>
      <tbody>
        {displayKeys.map((k) => {
          const bv = before?.[k];
          const av = after?.[k];
          const changed = JSON.stringify(bv) !== JSON.stringify(av);
          return (
            <tr key={k} style={{ background: changed ? 'var(--semi-color-warning-light-default)' : undefined }}>
              <td style={{ padding: '3px 8px', fontWeight: 500 }}>{k}</td>
              <td style={{ padding: '3px 8px', color: changed ? 'var(--semi-color-danger)' : undefined }}>
                {fmtVal(bv) == null ? <span style={{ opacity: 0.4 }}>—</span> : fmtVal(bv)}
              </td>
              <td style={{ padding: '3px 8px', color: changed ? 'var(--semi-color-success)' : undefined }}>
                {fmtVal(av) == null ? <span style={{ opacity: 0.4 }}>—</span> : fmtVal(av)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function OperationLogsTable({
  dataSource,
  loading,
  pagination,
  onRefresh,
  columnSettings,
  columnSettingsKey,
}: OperationLogsTableProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const operationLogParam = searchParams.get('operationLogId');
  const linkedOperationLogId = operationLogParam && /^[1-9]\d*$/.test(operationLogParam) && Number.isSafeInteger(Number(operationLogParam)) ? Number(operationLogParam) : undefined;
  const [detailLog, setDetailLog] = useState<OperationLog | null>(null);
  const linkedDetailQuery = useOperationLogDetail(linkedOperationLogId, linkedOperationLogId !== undefined);
  const [detailActiveTab, setDetailActiveTab] = useState('basic');
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  useEffect(() => {
    if (!linkedOperationLogId || !linkedDetailQuery.data) return;
    setDetailLog(linkedDetailQuery.data);
    const next = new URLSearchParams(searchParams); next.delete('operationLogId'); setSearchParams(next, { replace: true });
  }, [linkedOperationLogId, linkedDetailQuery.data, searchParams, setSearchParams]);

  const closeDetail = () => {
    setDetailLog(null); setDetailActiveTab('basic');
    if (!searchParams.has('operationLogId')) return;
    const next = new URLSearchParams(searchParams); next.delete('operationLogId'); setSearchParams(next, { replace: true });
  };

  const columns = useMemo<ColumnProps<OperationLog>[]>(() => [
    { title: 'ID', dataIndex: 'id', width: 70 },
    {
      title: '操作人',
      dataIndex: 'username',
      width: 200,
      render: (v: string | null, r: OperationLog) => (
        <span className="operation-log-actor">
          <UserDisplayCell username={v} nickname={r.nickname} />
          {r.impersonatorName && (
            <Tooltip content={`模拟登录：实际由 ${r.impersonatorName} 操作`}>
              <Tag size="small" color="orange" style={{ marginLeft: 6 }}>由 {r.impersonatorName} 模拟</Tag>
            </Tooltip>
          )}
        </span>
      ),
    },
    { title: '功能模块', dataIndex: 'module', width: 180, ellipsis: { showTitle: false }, render: (v: string | null) => v ? <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{v}</Typography.Text> : '-' },
    { title: '操作描述', dataIndex: 'description', width: 220, ellipsis: true },
    { title: '请求方法', dataIndex: 'method', width: 90, render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: '请求路径', dataIndex: 'path', minWidth: 180, ellipsis: true },
    { title: 'IP 地址', dataIndex: 'ip', width: 130, render: (v: string | null) => v ?? '-' },
    { title: '操作地点', dataIndex: 'location', width: 160, render: (v: string | null) => v ?? '-' },
    { title: '操作系统', dataIndex: 'os', width: 130, render: (v: string | null) => v ?? '-' },
    { title: '浏览器', dataIndex: 'browser', width: 150, render: (v: string | null) => renderEllipsis(v ?? '-') },
    {
      title: '耗时',
      align: 'right',
      dataIndex: 'durationMs',
      width: 120,
      render: (v: number | null) => v === null ? '-' : `${v} ms`,
    },
    dateTimeColumn('操作时间', 'createdAt'),
    entityRelationColumn<OperationLog>('platform.operation-log', undefined, { fixed: 'right' }),
    {
      title: '状态',
      dataIndex: 'responseCode',
      width: 90,
      fixed: 'right' as const,
      render: (v: number | null) => {
        const success = v != null && v >= 200 && v < 400;
        return <Tag color={success ? 'green' : 'red'}>{success ? '成功' : '失败'}</Tag>;
      },
    },
    createOperationColumn<OperationLog>({
      width: 100,
      actions: (record) => [{ key: 'detail', label: '详情', onClick: () => setDetailLog(record) }],
    }),
  ], []);

  return (
    <>
      <ConfigurableTable<OperationLog>
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
        title="操作日志详情"
        visible={detailLog !== null}
        onCancel={closeDetail}
        footer={null}
        width={700}
        style={{ top: 40 }}
        bodyStyle={{ padding: '0 0 4px' }}
      >
        {detailLog && (() => {
          const resCode = detailLog.responseCode;
          const resOk = resCode != null && resCode >= 200 && resCode < 400;
          const duration = detailLog.durationMs == null ? '-' : `${detailLog.durationMs} ms`;
          const hasDataDiff = !!(detailLog.beforeData ?? detailLog.afterData);
          return (
            <Tabs collapsible="auto" type="line" style={{ padding: '0 4px' }} activeKey={detailActiveTab} onChange={setDetailActiveTab}>
              <TabPane tab="基础信息" itemKey="basic">
                <Descriptions
                  data={[
                    { key: 'ID', value: detailLog.id },
                    { key: '操作人', value: formatUserLabel(detailLog.username, detailLog.nickname) },
                    ...(detailLog.impersonatorName
                      ? [{ key: '实际操作人', value: <Tag color="orange" size="small">{detailLog.impersonatorName}（模拟登录）</Tag> }]
                      : []),
                    { key: '功能模块', value: detailLog.module ?? '-' },
                    { key: '操作描述', value: detailLog.description },
                    {
                      key: '请求方法',
                      value: <Tag color="blue" size="small">{detailLog.method}</Tag>,
                    },
                    {
                      key: '响应状态',
                      value: <Tag color={resOk ? 'green' : 'red'} size="small">{resCode ?? '-'}</Tag>,
                    },
                    { key: '耗时', value: duration },
                    { key: '操作时间', value: formatDateTime(detailLog.createdAt) },
                    { key: 'IP 地址', value: detailLog.ip ?? '-' },
                    { key: '操作地点', value: detailLog.location ?? '-' },
                    { key: '浏览器', value: detailLog.browser ?? '-', span: 2 },
                    { key: '操作系统', value: detailLog.os ?? '-' },
                    {
                      key: '链路 ID',
                      span: 2,
                      value: detailLog.requestId
                        ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <Typography.Text copyable size="small">{detailLog.requestId}</Typography.Text>
                              {hasPermission('system:trace:view') && (
                                <Button
                                  size="small"
                                  theme="borderless"
                                  type="primary"
                                  onClick={() => navigate(`/system/trace?traceId=${encodeURIComponent(detailLog.requestId!)}`)}
                                >
                                  查看链路
                                </Button>
                              )}
                            </span>
                          )
                        : '-',
                    },
                  ]}
                  column={2}
                  layout="horizontal"
                  align="left"
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                  <EntityRelationButton entityRef={{ type: 'platform.operation-log', key: String(detailLog.id) }} />
                </div>
              </TabPane>
              <TabPane tab="请求详情" itemKey="request">
                <div style={{ padding: '4px 0 8px' }}>
                  <DetailField label="请求路径">{detailLog.path}</DetailField>
                  {detailLog.userAgent && (
                    <DetailField label="User-Agent">{detailLog.userAgent}</DetailField>
                  )}
                  {detailLog.requestBody ? (
                    <DetailField label="请求体">
                      {detailActiveTab === 'request' && (
                        <JsonViewer
                          className="operation-log-json-viewer"
                          key={detailLog.id}
                          value={(() => { try { return JSON.stringify(JSON.parse(detailLog.requestBody), null, 2); } catch { return detailLog.requestBody; } })()}
                          height={220}
                          width="100%"
                          options={{ readOnly: true, autoWrap: true, formatOptions: { tabSize: 2, insertSpaces: true } }}
                        />
                      )}
                    </DetailField>
                  ) : (
                    <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--semi-color-text-2)', fontSize: 13 }}>无请求体</div>
                  )}
                </div>
              </TabPane>
              {hasDataDiff && (
                <TabPane tab="数据变更" itemKey="diff">
                  <div style={{ padding: '4px 0 8px' }}>
                    <DataDiff beforeData={detailLog.beforeData} afterData={detailLog.afterData} />
                  </div>
                </TabPane>
              )}
              <TabPane tab="响应详情" itemKey="response">
                <div style={{ padding: '4px 0 8px' }}>
                  {detailLog.responseBody ? (
                    <DetailField label="完整响应体">
                      {detailActiveTab === 'response' && (
                        <JsonViewer
                          className="operation-log-json-viewer"
                          key={`res-${detailLog.id}`}
                          value={(() => { try { return JSON.stringify(JSON.parse(detailLog.responseBody), null, 2); } catch { return detailLog.responseBody; } })()}
                          height={360}
                          width="100%"
                          options={{ readOnly: true, autoWrap: true, formatOptions: { tabSize: 2, insertSpaces: true } }}
                        />
                      )}
                    </DetailField>
                  ) : (
                    <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--semi-color-text-2)', fontSize: 13 }}>无响应体</div>
                  )}
                </div>
              </TabPane>
            </Tabs>
          );
        })()}
      </AppModal>
    </>
  );
}

export default OperationLogsTable;
