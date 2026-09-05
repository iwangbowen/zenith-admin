import { useEffect, useState } from 'react';
import {
  Banner, Button, Empty, Modal, Space, Spin, Switch, Table, Tabs, TabPane,
  Tag, Toast, Tooltip, Typography,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { RefreshCw, Activity, Wrench, KeyRound, GitCompare } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { confirmDanger } from '@/utils/confirm';
import { copyTextWithToast } from '@/utils/clipboard';
import { EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';
import { MetricMeter } from '@/components/data-viz/MetricMeter';
import {
  useDbAdminActivity,
  useDbAdminActivityAction,
  useDbAdminIndexHealth,
  useDbAdminMaintenance,
  useDbAdminRunMaintenance,
  useDbAdminSchemaDrift,
} from '@/hooks/queries/db-admin';
import type {
  DbAdminActivityConnection,
  DbAdminColumnDiff,
  DbAdminIndexInfo as DbAdminIndexInfoRow,
  DbAdminTableDrift,
  DbAdminTableMaintenance,
} from '@zenith/shared/ops';

const { Text } = Typography;

// ─── 类型 ──────────────────────────────────────────────────────────────────────
type ActivityConnection = DbAdminActivityConnection;
type TableMaintenance = DbAdminTableMaintenance;
type IndexInfoRow = DbAdminIndexInfoRow;
type ColumnDiff = DbAdminColumnDiff;
type TableDrift = DbAdminTableDrift;

function fmtDuration(seconds: number | null): string {
  if (seconds == null) return EMPTY_PLACEHOLDER;
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m${s}s`;
}

function stateColor(state: string | null): 'green' | 'amber' | 'grey' | 'red' {
  switch (state) {
    case 'active': return 'green';
    case 'idle in transaction':
    case 'idle in transaction (aborted)': return 'red';
    case 'idle': return 'grey';
    default: return 'amber';
  }
}

/**
 * 定宽列里的标签：内容长度不可控（等待事件名、阻塞 PID 列表、连接状态）时按列宽截断并以 Tooltip 展示全文。
 * Semi Tag 只对字符串 children 套省略样式，且单元格没有 overflow: hidden——不限宽的标签会直接挤进相邻列。
 */
function renderEllipsisTag(text: string, color: 'green' | 'amber' | 'grey' | 'red'): React.ReactNode {
  return (
    <Tooltip content={text}>
      <Tag size="small" color={color} style={{ maxWidth: '100%' }}>{text}</Tag>
    </Tooltip>
  );
}

const renderEmpty = () => <Text type="tertiary">{EMPTY_PLACEHOLDER}</Text>;

/** 加粗的标识符名（表 / 索引）：弹性主列在窄屏下按列宽截断 + Tooltip，不换行也不挤占相邻列 */
function renderStrongEllipsis(text: string): React.ReactNode {
  return <Text strong ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{text}</Text>;
}

const qualifiedName = (schema: string, name: string) => (schema === 'public' ? name : `${schema}.${name}`);

// ─── 活动连接 ────────────────────────────────────────────────────────────────────
function ActivityPanel({ canMaintain }: Readonly<{ canMaintain: boolean }>) {
  const [auto, setAuto] = useState(false);
  const activityQuery = useDbAdminActivity(auto);
  const actionMutation = useDbAdminActivityAction();
  const list = activityQuery.data ?? [];
  const loading = activityQuery.isFetching;

  const act = async (pid: number, action: 'cancel' | 'terminate') => {
    const res = await actionMutation.mutateAsync({ pid, action });
    Toast.success(res.ok ? (action === 'cancel' ? '已请求取消查询' : '已终止连接') : '操作未生效（连接可能已结束）');
  };

  const blockingPids = new Set(list.flatMap((c) => c.blockedBy));
  const activeCount = list.filter((c) => c.state === 'active').length;
  const blockedCount = list.filter((c) => c.blockedBy.length > 0).length;

  // 各定宽列按最宽的常见内容配宽（单元格左右 padding 32），可变长内容一律截断 + Tooltip，禁止换行或挤占相邻列
  const columns: ColumnProps<ActivityConnection>[] = [
    // PID（最长 7 位）+ 一个标记同行放得下；「本会话」与「阻塞源」同时出现极罕见，此时允许换到第二行
    { title: 'PID', dataIndex: 'pid', width: 150, render: (v: number, r) => (
      <Space spacing={4} wrap>
        <Text strong>{v}</Text>
        {r.isCurrent && <Tag size="small" color="blue">本会话</Tag>}
        {blockingPids.has(v) && <Tooltip content="正在阻塞其他查询"><Tag size="small" color="red">阻塞源</Tag></Tooltip>}
      </Space>
    )},
    // 容纳 "idle in transaction"；"idle in transaction (aborted)" 等更长状态截断显示
    { title: '状态', dataIndex: 'state', width: 180, render: (v: string | null) => v ? renderEllipsisTag(v, stateColor(v)) : renderEmpty() },
    { title: '用户 / 应用', width: 160, render: (_: unknown, r) => (
      <div style={{ minWidth: 0 }}>
        {renderEllipsis(r.username)}
        <Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%', display: 'block' }}>{r.applicationName ?? r.backendType ?? ''}</Text>
      </div>
    )},
    // client_addr 带掩码（172.28.0.1/32）整行放得下；IPv6 截断显示
    { title: '来源', dataIndex: 'clientAddr', width: 160, render: (v: string | null) => v ? renderEllipsis(v) : <Text type="tertiary">本地</Text> },
    { title: '耗时', dataIndex: 'querySeconds', width: 90, align: 'right', render: (v: number | null) => {
      const danger = v != null && v > 30;
      return <Text type={danger ? 'danger' : undefined}>{fmtDuration(v)}</Text>;
    }},
    // 常见等待事件（Client:ClientRead、Lock:transactionid）整行放得下；更长的按列宽截断
    { title: '等待', width: 180, render: (_: unknown, r) => {
      const label = [r.waitEventType, r.waitEvent].filter(Boolean).join(':');
      return label ? renderEllipsisTag(label, 'amber') : renderEmpty();
    }},
    { title: '阻塞于', dataIndex: 'blockedBy', width: 130, render: (v: number[]) => v.length > 0 ? renderEllipsisTag(v.join(', '), 'red') : renderEmpty() },
    { title: 'SQL', dataIndex: 'query', minWidth: 360, ellipsis: { showTitle: false }, render: (v: string | null) => (
      <Tooltip content={<div style={{ maxWidth: 480, maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12 }}>{v || '(无)'}</div>}>
        <Text style={{ fontFamily: 'monospace', fontSize: 12 }} ellipsis={{ showTooltip: false }}>{v || <Text type="tertiary">(无)</Text>}</Text>
      </Tooltip>
    )},
  ];
  if (canMaintain) {
    columns.push(createOperationColumn<ActivityConnection>({
      width: 150,
      emptyContent: <Text type="tertiary" size="small">—</Text>,
      actions: (record) => [
        {
          key: 'cancel',
          label: '取消',
          hidden: record.isCurrent,
          onClick: () => {
            Modal.confirm({
              title: `取消 PID ${record.pid} 的查询？`,
              onOk: () => { void act(record.pid, 'cancel'); },
            });
          },
        },
        {
          key: 'terminate',
          label: '终止',
          danger: true,
          hidden: record.isCurrent,
          onClick: () => {
            confirmDanger({
              title: `强制终止 PID ${record.pid} 的连接？`,
              content: '连接将被断开',
              onOk: () => { void act(record.pid, 'terminate'); },
            });
          },
        },
      ],
    }));
  }

  return (
    <div>
      <Space style={{ marginBottom: 10 }} wrap>
        <Button icon={<RefreshCw size={14} />} onClick={() => void activityQuery.refetch()} loading={loading}>刷新</Button>
        <Space spacing={4}><Switch size="small" checked={auto} onChange={setAuto} /><Text type="tertiary" size="small">自动刷新(5s)</Text></Space>
        <Tag color="blue">{list.length} 连接</Tag>
        <Tag color="green">{activeCount} 活动</Tag>
        {blockedCount > 0 && <Tag color="red">{blockedCount} 被阻塞</Tag>}
      </Space>
      <ConfigurableTable<ActivityConnection>
        bordered
        columns={columns}
        dataSource={list}
        rowKey="pid"
        loading={loading}
        size="small"
        pagination={{ pageSize: 50, pageSizeOpts: [50, 100, 200] }}
      />
    </div>
  );
}

// ─── 表维护 ──────────────────────────────────────────────────────────────────────
function MaintenancePanel({ canMaintain }: Readonly<{ canMaintain: boolean }>) {
  const maintenanceQuery = useDbAdminMaintenance();
  const runMaintenanceMutation = useDbAdminRunMaintenance();
  const list = maintenanceQuery.data ?? [];
  const loading = maintenanceQuery.isFetching;
  const busyKey = runMaintenanceMutation.isPending
    ? `${runMaintenanceMutation.variables?.params.schema}.${runMaintenanceMutation.variables?.params.name}`
    : null;

  const run = async (r: TableMaintenance, action: 'vacuum' | 'vacuum_analyze' | 'analyze' | 'reindex') => {
    const key = `${r.schema}.${r.name}`;
    await runMaintenanceMutation.mutateAsync({ params: { schema: r.schema, name: r.name }, body: { action } });
    Toast.success(`${key} 已执行`);
  };

  const columns: ColumnProps<TableMaintenance>[] = [
    // 表名是弹性主列（标识符最长 63 字符），其余列定宽
    { title: '表', minWidth: 260, render: (_: unknown, r) => renderStrongEllipsis(qualifiedName(r.schema, r.name)) },
    { title: '活元组', dataIndex: 'liveTuples', width: 100, align: 'right', render: (v: number) => v.toLocaleString() },
    { title: '死元组', dataIndex: 'deadTuples', width: 160, render: (v: number, r) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ minWidth: 56 }}>{v.toLocaleString()}</span>
        <MetricMeter
          value={r.deadRatio}
          label={`${r.schema}.${r.name} 死元组率`}
          valueText={`${r.deadRatio}%`}
          tone={r.deadRatio > 20 ? 'danger' : r.deadRatio > 10 ? 'warning' : 'success'}
          height={6}
          style={{ flex: 1, minWidth: 40 }}
        />
        <Text type={r.deadRatio > 20 ? 'danger' : undefined} size="small">{r.deadRatio}%</Text>
      </div>
    )},
    { title: '大小', dataIndex: 'sizeText', width: 90, align: 'right' },
    { title: '上次 VACUUM', width: 160, render: (_: unknown, r) => <Text type="tertiary" size="small">{r.lastVacuum ?? r.lastAutovacuum ?? '从未'}</Text> },
    { title: '上次 ANALYZE', width: 160, render: (_: unknown, r) => <Text type="tertiary" size="small">{r.lastAnalyze ?? r.lastAutoanalyze ?? '从未'}</Text> },
  ];
  if (canMaintain) {
    columns.push(createOperationColumn<TableMaintenance>({
      width: 150,
      desktopInlineKeys: ['vacuum'],
      actions: (record) => {
        const key = `${record.schema}.${record.name}`;
        return [
          {
            key: 'vacuum',
            label: 'VACUUM',
            loading: busyKey === key,
            onClick: () => { void run(record, 'vacuum'); },
          },
          {
            key: 'vacuum-analyze',
            label: 'VACUUM ANALYZE',
            loading: busyKey === key,
            onClick: () => { void run(record, 'vacuum_analyze'); },
          },
          {
            key: 'analyze',
            label: 'ANALYZE',
            loading: busyKey === key,
            onClick: () => { void run(record, 'analyze'); },
          },
          {
            key: 'reindex',
            label: 'REINDEX',
            danger: true,
            loading: busyKey === key,
            onClick: () => { void run(record, 'reindex'); },
          },
        ];
      },
    }));
  }

  return (
    <div>
      <Space style={{ marginBottom: 10 }}>
        <Button icon={<RefreshCw size={14} />} onClick={() => void maintenanceQuery.refetch()} loading={loading}>刷新</Button>
        <Text type="tertiary" size="small">按死元组数倒序 · 死元组占比偏高建议 VACUUM</Text>
      </Space>
      <ConfigurableTable<TableMaintenance>
        bordered
        columns={columns}
        dataSource={list}
        rowKey={(r) => (r ? `${r.schema}.${r.name}` : '')}
        loading={loading}
        size="small"
        pagination={{ pageSize: 20, pageSizeOpts: [20, 50, 100] }}
      />
    </div>
  );
}

// ─── 索引健康 ────────────────────────────────────────────────────────────────────
function IndexHealthPanel() {
  const indexHealthQuery = useDbAdminIndexHealth();
  const data = indexHealthQuery.data ?? null;
  const loading = indexHealthQuery.isFetching;

  const copyDrop = (r: IndexInfoRow) => {
    void copyTextWithToast(`DROP INDEX ${r.schema === 'public' ? '' : `"${r.schema}".`}"${r.index}";`, { success: '已复制 DROP INDEX', error: '复制失败' });
  };

  const unusedColumns: ColumnProps<IndexInfoRow>[] = [
    // 索引名是弹性主列：名字最长且最不可控，窄屏下截断 + Tooltip；UNIQUE / 分区标记不参与压缩
    { title: '索引', dataIndex: 'index', minWidth: 320, render: (v: string, r) => (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%' }}>
        <Text strong ellipsis={{ showTooltip: true }} style={{ minWidth: 0 }}>{v}</Text>
        {r.isUnique && <Tag size="small" color="blue" style={{ flexShrink: 0 }}>UNIQUE</Tag>}
        {r.partitions > 1 && <Tooltip content="分区表索引：扫描数与大小为各分区之和"><Tag size="small" color="grey" style={{ flexShrink: 0 }}>{r.partitions} 分区</Tag></Tooltip>}
      </div>
    )},
    // 项目内表名最长 32 字符（约 240px）；带 schema 前缀的更长名字截断显示
    { title: '表', width: 260, render: (_: unknown, r) => renderEllipsis(qualifiedName(r.schema, r.table)) },
    // 表达式索引没有普通列，显示占位符
    { title: '列', dataIndex: 'columns', width: 240, render: (v: string[]) => renderEllipsis(v.join(', ')) },
    { title: '大小', dataIndex: 'sizeText', width: 90, align: 'right' },
    { title: '扫描次数', dataIndex: 'scans', width: 90, render: (v: number) => <Tag color="amber" size="small">{v}</Tag> },
    createOperationColumn<IndexInfoRow>({
      width: 140,
      actions: (record) => [
        {
          key: 'copy-drop',
          label: '复制 DROP',
          onClick: () => copyDrop(record),
        },
      ],
    }),
  ];

  return (
    <div>
      <Space style={{ marginBottom: 10 }} wrap>
        <Button icon={<RefreshCw size={14} />} onClick={() => void indexHealthQuery.refetch()} loading={loading}>刷新</Button>
        {data && <>
          <Tag color="blue">{data.totalIndexes} 索引</Tag>
          <Tag color="amber">{data.unused.length} 未使用</Tag>
          {data.duplicate.length > 0 && <Tag color="red">{data.duplicate.length} 组重复</Tag>}
        </>}
      </Space>
      {loading && !data && <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>}
      {data && (
        <Space vertical align="start" style={{ width: '100%' }} spacing={16}>
          <div style={{ width: '100%' }}>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>未使用索引（扫描数为 0，可考虑删除以节省空间与写入开销）</Text>
            {data.unused.length === 0 ? <Empty title="无未使用索引" style={{ padding: 16 }} /> : (
              <ConfigurableTable<IndexInfoRow>
                bordered columns={unusedColumns} dataSource={data.unused}
                rowKey={(r) => (r ? `${r.schema}.${r.index}` : '')} size="small"
                pagination={{ pageSize: 10 }}
              />
            )}
          </div>
          {data.duplicate.length > 0 && (
            <div style={{ width: '100%' }}>
              <Text strong style={{ display: 'block', marginBottom: 6 }}>重复索引（同表且定义完全相同，非唯一的那个可删除）</Text>
              {data.duplicate.map((g) => (
                <div key={`${g.schema}.${g.table}.${g.shape}`} style={{ border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', padding: 10, marginBottom: 8 }}>
                  <Text type="tertiary" size="small">{qualifiedName(g.schema, g.table)} · </Text>
                  <Text code size="small">{g.shape}</Text>
                  <div style={{ marginTop: 6 }}>
                    {g.indexes.map((idx) => (
                      <div key={idx.index} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                        <Text strong style={{ minWidth: 200 }}>{idx.index}</Text>
                        {idx.isPrimary && <Tag size="small" color="orange">PRIMARY</Tag>}
                        {idx.isUnique && !idx.isPrimary && <Tag size="small" color="blue">UNIQUE</Tag>}
                        {idx.partitions > 1 && <Tag size="small" color="grey">{idx.partitions} 分区</Tag>}
                        <Text type="tertiary" size="small">{idx.sizeText} · {idx.scans} 次扫描</Text>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Space>
      )}
    </div>
  );
}

// ─── Drizzle Schema 漂移 ─────────────────────────────────────────────────────────
const ISSUE_LABEL: Record<ColumnDiff['issue'], { text: string; color: 'red' | 'amber' | 'violet' }> = {
  missing_in_db: { text: '列缺失', color: 'red' },
  extra_in_db: { text: '多余列', color: 'amber' },
  type_mismatch: { text: '类型不符', color: 'violet' },
  nullable_mismatch: { text: '可空性不符', color: 'amber' },
};
const STATUS_LABEL: Record<TableDrift['status'], { text: string; color: 'red' | 'amber' | 'violet' }> = {
  missing_in_db: { text: '表在 DB 中缺失', color: 'red' },
  extra_in_db: { text: '表未在 schema.ts 声明', color: 'amber' },
  column_diff: { text: '列差异', color: 'violet' },
};

function DriftPanel() {
  const schemaDriftQuery = useDbAdminSchemaDrift();
  const data = schemaDriftQuery.data ?? null;
  const loading = schemaDriftQuery.isFetching;

  return (
    <div>
      <Space style={{ marginBottom: 10 }} wrap>
        <Button icon={<RefreshCw size={14} />} onClick={() => void schemaDriftQuery.refetch()} loading={loading}>重新校验</Button>
        {data && <Text type="tertiary" size="small">schema.ts 声明 {data.expectedTables} 表 · DB 实际 {data.actualTables} 表</Text>}
      </Space>
      {loading && !data && <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>}
      {data && data.inSync && (
        <Banner type="success" fullMode={false} closeIcon={null}
          title="结构已同步"
          description={`Drizzle schema.ts 与数据库实际结构一致（共对照 ${data.expectedTables} 张表，无差异）。`}
        />
      )}
      {data && !data.inSync && (
        <>
          <Banner type="warning" fullMode={false} closeIcon={null} style={{ marginBottom: 12 }}
            title={`发现 ${data.drifts.length} 处结构差异`}
            description="以下差异表示数据库实际结构与 schema.ts 不一致，建议通过生成并执行 Drizzle 迁移修复（npm run db:generate && npm run db:migrate）。"
          />
          <Space vertical align="start" style={{ width: '100%' }} spacing={10}>
            {data.drifts.map((d) => (
              <div key={`${d.schema}.${d.table}`} style={{ width: '100%', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', padding: 10 }}>
                <Space spacing={8} style={{ marginBottom: d.columns.length > 0 ? 8 : 0 }}>
                  <Text strong>{d.schema === 'public' ? d.table : `${d.schema}.${d.table}`}</Text>
                  <Tag color={STATUS_LABEL[d.status].color} size="small">{STATUS_LABEL[d.status].text}</Tag>
                </Space>
                {d.columns.length > 0 && (
                  <Table
                    size="small"
                    pagination={false}
                    dataSource={d.columns}
                    rowKey={(r) => (r ? `${r.column}-${r.issue}` : '')}
                    columns={[
                      { title: '列', dataIndex: 'column', width: 200, render: (v: string) => <Text style={{ fontFamily: 'monospace' }}>{v}</Text> },
                      { title: '问题', dataIndex: 'issue', width: 130, render: (v: ColumnDiff['issue']) => <Tag color={ISSUE_LABEL[v].color} size="small">{ISSUE_LABEL[v].text}</Tag> },
                      { title: '期望 (schema.ts)', dataIndex: 'expected', render: (v: string | null) => v ? <Text code>{v}</Text> : <Text type="tertiary">-</Text> },
                      { title: '实际 (DB)', dataIndex: 'actual', render: (v: string | null) => v ? <Text code>{v}</Text> : <Text type="tertiary">-</Text> },
                    ]}
                  />
                )}
              </div>
            ))}
          </Space>
        </>
      )}
    </div>
  );
}

// ─── 容器 ────────────────────────────────────────────────────────────────────────
export function OpsPanel({ canMaintain, active }: Readonly<{ canMaintain: boolean; active: boolean }>) {
  const [sub, setSub] = useState('activity');
  const [activated, setActivated] = useState(false);
  useEffect(() => { if (active) setActivated(true); }, [active]);

  if (!activated) return null;

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 4 }}>
      <Tabs collapsible="auto" activeKey={sub} onChange={setSub} type="button" size="small" lazyRender keepDOM={false}>
        <TabPane tab={<span><Activity size={13} style={{ verticalAlign: -2, marginRight: 4 }} />活动连接</span>} itemKey="activity">
          <ActivityPanel canMaintain={canMaintain} />
        </TabPane>
        <TabPane tab={<span><Wrench size={13} style={{ verticalAlign: -2, marginRight: 4 }} />表维护</span>} itemKey="maintenance">
          <MaintenancePanel canMaintain={canMaintain} />
        </TabPane>
        <TabPane tab={<span><KeyRound size={13} style={{ verticalAlign: -2, marginRight: 4 }} />索引健康</span>} itemKey="index">
          <IndexHealthPanel />
        </TabPane>
        <TabPane tab={<span><GitCompare size={13} style={{ verticalAlign: -2, marginRight: 4 }} />结构校验</span>} itemKey="drift">
          <DriftPanel />
        </TabPane>
      </Tabs>
    </div>
  );
}

OpsPanel.displayName = 'OpsPanel';
