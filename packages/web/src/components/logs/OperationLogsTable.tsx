import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Button, JsonViewer, Modal, TabPane, Tabs, Tag } from '@douyinfe/semi-ui';
import type { ColumnProps, TableProps } from '@douyinfe/semi-ui/lib/es/table';
import type { OperationLog } from '@zenith/shared';
import ConfigurableTable from '@/components/ConfigurableTable';
import { formatDateTime } from '@/utils/date';
import './OperationLogsTable.css';

interface OperationLogsTableProps {
  readonly dataSource: OperationLog[];
  readonly loading?: boolean;
  readonly pagination?: TableProps<OperationLog>['pagination'];
  readonly scroll?: TableProps<OperationLog>['scroll'];
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
  scroll = { x: 1600 },
  columnSettings,
  columnSettingsKey,
}: OperationLogsTableProps) {
  const [detailLog, setDetailLog] = useState<OperationLog | null>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('basic');

  const columns = useMemo<ColumnProps<OperationLog>[]>(() => [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '操作人', dataIndex: 'username', width: 110, render: (v: string | null) => v ?? '-' },
    { title: '功能模块', dataIndex: 'module', width: 120, render: (v: string | null) => v ?? '-' },
    { title: '操作描述', dataIndex: 'description', width: 140 },
    { title: '请求方法', dataIndex: 'method', width: 90, render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: '请求路径', dataIndex: 'path', width: 180, ellipsis: true },
    { title: 'IP 地址', dataIndex: 'ip', width: 130, render: (v: string | null) => v ?? '-' },
    { title: '操作地点', dataIndex: 'location', width: 160, render: (v: string | null) => v ?? '-' },
    { title: '操作系统', dataIndex: 'os', width: 130, render: (v: string | null) => v ?? '-' },
    { title: '浏览器', dataIndex: 'browser', width: 150, render: (v: string | null) => v ?? '-' },
    {
      title: '耗时',
      dataIndex: 'durationMs',
      width: 90,
      render: (v: number | null) => v === null ? '-' : `${v} ms`,
    },
    {
      title: '状态',
      dataIndex: 'responseCode',
      width: 90,
      render: (v: number | null) => {
        const success = v != null && v >= 200 && v < 400;
        return <Tag color={success ? 'green' : 'red'}>{success ? '成功' : '失败'}</Tag>;
      },
    },
    {
      title: '操作时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '操作',
      key: 'operation',
      width: 80,
      fixed: 'right' as const,
      render: (_: unknown, record: OperationLog) => (
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
      <ConfigurableTable<OperationLog>
        bordered
        columns={columns}
        dataSource={dataSource}
        loading={loading}
        pagination={pagination}
        rowKey="id"
        scroll={scroll}
        columnSettings={columnSettings}
        columnSettingsKey={columnSettingsKey}
      />

      <Modal
        title="操作日志详情"
        visible={detailLog !== null}
        onCancel={() => { setDetailLog(null); setDetailActiveTab('basic'); }}
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
            <Tabs type="line" style={{ padding: '0 4px' }} activeKey={detailActiveTab} onChange={setDetailActiveTab}>
              <TabPane tab="基础信息" itemKey="basic">
                <div style={{ padding: '4px 0 8px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0 16px' }}>
                  <div style={detailItemStyle}>
                    <div style={detailLabelStyle}>ID</div>
                    <div style={detailValueStyle}>{detailLog.id}</div>
                  </div>
                  <div style={detailItemStyle}>
                    <div style={detailLabelStyle}>操作人</div>
                    <div style={detailValueStyle}>{detailLog.username ?? '-'}</div>
                  </div>
                  <div style={detailItemStyle}>
                    <div style={detailLabelStyle}>功能模块</div>
                    <div style={detailValueStyle}>{detailLog.module ?? '-'}</div>
                  </div>
                  <div style={detailItemStyle}>
                    <div style={detailLabelStyle}>操作描述</div>
                    <div style={detailValueStyle}>{detailLog.description}</div>
                  </div>
                  <div style={detailItemStyle}>
                    <div style={detailLabelStyle}>请求方法</div>
                    <div style={detailValueStyle}><Tag color="blue" size="small">{detailLog.method}</Tag></div>
                  </div>
                  <div style={detailItemStyle}>
                    <div style={detailLabelStyle}>响应状态</div>
                    <div style={detailValueStyle}><Tag color={resOk ? 'green' : 'red'} size="small">{resCode ?? '-'}</Tag></div>
                  </div>
                  <div style={detailItemStyle}>
                    <div style={detailLabelStyle}>耗时</div>
                    <div style={detailValueStyle}>{duration}</div>
                  </div>
                  <div style={detailItemStyle}>
                    <div style={detailLabelStyle}>操作时间</div>
                    <div style={detailValueStyle}>{formatDateTime(detailLog.createdAt)}</div>
                  </div>
                  <div style={detailItemStyle}>
                    <div style={detailLabelStyle}>IP 地址</div>
                    <div style={detailValueStyle}>{detailLog.ip ?? '-'}</div>
                  </div>
                  <div style={detailItemStyle}>
                    <div style={detailLabelStyle}>操作地点</div>
                    <div style={detailValueStyle}>{detailLog.location ?? '-'}</div>
                  </div>
                  <div style={detailItemStyle}>
                    <div style={detailLabelStyle}>操作系统</div>
                    <div style={detailValueStyle}>{detailLog.os ?? '-'}</div>
                  </div>
                  <div style={{ ...detailItemStyle, gridColumn: 'span 2' }}>
                    <div style={detailLabelStyle}>浏览器</div>
                    <div style={detailValueStyle}>{detailLog.browser ?? '-'}</div>
                  </div>
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
      </Modal>
    </>
  );
}

export default OperationLogsTable;
