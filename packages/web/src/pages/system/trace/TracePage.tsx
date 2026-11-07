import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Banner, Button, Card, Collapse, Empty, Input, Select, SideSheet, Spin, Tabs, TabPane, Tag, Timeline, Typography,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search } from 'lucide-react';
import type { TraceFailureEntry, TraceListEntry, TraceNodeKind, TraceNodeStatus, TraceTimelineNode } from '@zenith/shared/platform';
import { TRACE_NODE_KIND_LABELS, TRACE_NODE_KINDS, TRACE_NODE_STATUS_LABELS } from '@zenith/shared/platform';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { listTableProps } from '@/components/list-page';
import { usePermission } from '@/hooks/usePermission';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useRecentTraceFailures, useRecentTraces, useTraceTimeline } from '@/hooks/queries/trace';
import { useLogLocator } from '@/hooks/queries/log-locator';
import { LogLineText } from '@/components/log-workbench/LogLineText';
import { computeEffectiveLevels } from '@/components/log-workbench/log-search';
import { LOG_PALETTE_STYLES, useLogPalette } from '@/components/log-workbench/log-palettes';
import '@/components/log-workbench/LogContentView.css';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { FilterSelect } from '@/components/search-filters';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { TextBlock } from '@/components/TextBlock';
import ObservabilityLink from '@/components/observability/ObservabilityLink';

const { Text } = Typography;

type TimelineType = 'default' | 'ongoing' | 'success' | 'error';

const STATUS_META: Record<TraceNodeStatus, { color: 'green' | 'red' | 'blue' | 'grey'; timeline: TimelineType }> = {
  success: { color: 'green', timeline: 'success' },
  failed: { color: 'red', timeline: 'error' },
  running: { color: 'blue', timeline: 'ongoing' },
  pending: { color: 'grey', timeline: 'default' },
};

const KIND_COLORS = {
  request: 'blue',
  job: 'violet',
  event: 'cyan',
  notification: 'orange',
  task: 'light-blue',
} as const satisfies Record<TraceTimelineNode['kind'], string>;

const CORRELATION_ID_RE = /^[\w-]{8,64}$/;

/** 展示服务端 locator 的实际命中，不依据节点日期猜测唯一日志文件。 */
function TraceLogsPanel({ correlationId }: { correlationId: string }) {
  const navigate = useNavigate();
  const locatorQuery = useLogLocator(correlationId, 2);
  const matches = locatorQuery.data?.matches ?? [];
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = matches[selectedIndex] ?? matches[0];
  const lines = useMemo(() => selected?.context ?? [], [selected]);
  const palette = useLogPalette();
  const levels = useMemo(() => computeEffectiveLevels(lines), [lines]);

  const handleViewInLogFiles = () => {
    if (!selected) return;
    const params = new URLSearchParams({ file: selected.filename, correlationId });
    navigate(`/system/log-files?${params.toString()}`);
  };

  const status = locatorQuery.data?.status;
  const hasSourceError = locatorQuery.data?.sources.some((source) => source.status === 'error') ?? false;
  const statusText = status === 'source_unavailable'
    ? '当前实例不可见可检索的应用日志源'
    : status === 'source_error' || hasSourceError
      ? '部分日志源读取失败，结果可能不完整'
      : status === 'not_found'
        ? '已扫描可见日志文件，但未找到该业务关联 ID'
        : null;
  const sourceStatusLabel = { scanned: '已扫描', unavailable: '不可用', error: '读取失败' } as const;
  const sourceStatusColor = { scanned: 'green', unavailable: 'grey', error: 'red' } as const;

  return (
    <Spin spinning={locatorQuery.isPending}>
      {locatorQuery.isError ? (
        <Banner type="danger" closeIcon={null} description={`日志定位失败：${locatorQuery.error.message}`} />
      ) : (
        <>
          {statusText && <Banner type={status === 'source_error' || hasSourceError ? 'warning' : 'info'} closeIcon={null} description={statusText} />}
          {locatorQuery.data?.truncated && (
            <Banner type="warning" closeIcon={null} description={`扫描达到保护上限（${locatorQuery.data.scannedFiles} 个文件 / ${locatorQuery.data.scannedBytes} 字节），结果可能不完整。`} />
          )}
          {matches.length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              {matches.length > 1 && (
                <Select
                  size="small"
                  value={selectedIndex}
                  onChange={(v) => setSelectedIndex(v as number)}
                  optionList={matches.map((match, index) => ({ value: index, label: `${match.role} · ${match.filename} · ${match.matchCount} 次` }))}
                  style={{ width: 360 }}
                />
              )}
              <Text type="tertiary" size="small">
                {selected?.hostname}{selected?.pid ? `:${selected.pid}` : ''} · 顶层 {selected?.matchedField} 精确命中
              </Text>
              <Button size="small" onClick={handleViewInLogFiles}>在日志文件中查看</Button>
            </div>
          )}
          {locatorQuery.data && locatorQuery.data.sources.length > 0 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <Text type="tertiary" size="small">日志源：</Text>
              {locatorQuery.data.sources.map((source) => (
                <Tag key={source.role} size="small" color={sourceStatusColor[source.status]}>
                  {source.role} · {sourceStatusLabel[source.status]}
                  {source.hostname ? ` · ${source.hostname}` : ''}
                  {source.scannedFiles > 0 ? ` · ${source.scannedFiles} 个文件` : ''}
                  {source.error ? ` · ${source.error}` : ''}
                </Tag>
              ))}
            </div>
          )}
          {lines.length === 0 ? (
            <Empty description={statusText ?? '未找到该业务关联 ID 的日志记录'} style={{ padding: '16px 0' }} />
          ) : (
            <div
              className="log-content-view"
              data-palette={palette}
              style={{
                ...LOG_PALETTE_STYLES.get(palette),
                fontFamily: 'var(--zx-font-mono, monospace)', fontSize: 12, lineHeight: '20px',
                maxHeight: 360, overflow: 'auto', background: 'var(--log-background)',
                borderRadius: 'var(--semi-border-radius-medium)', padding: '8px 12px', wordBreak: 'break-all',
              }}
            >
              {lines.map((line, i) => (
                <div key={i} className="log-content-row" data-level={levels[i] ?? undefined}>
                  <LogLineText raw={line} activeStart={null} />
                </div>
              ))}
            </div>
          )}
          {locatorQuery.data && (
            <Text type="tertiary" size="small" style={{ display: 'block', marginTop: 6 }}>
              已扫描 {locatorQuery.data.scannedFiles} 个文件、{locatorQuery.data.scannedBytes} 字节；命中 {matches.length} 个文件
            </Text>
          )}
        </>
      )}
    </Spin>
  );
}

/** 最近链路列表（无 ID 时的默认浏览入口） */
function RecentTracesPanel({ onView }: { onView: (correlationId: string) => void }) {
  const [days, setDays] = useState(7);
  const tracesQuery = useRecentTraces(days);
  const columns: ColumnProps<TraceListEntry>[] = [
    dateTimeColumn('最近活动', 'ts'),
    { title: '入口摘要', dataIndex: 'title', minWidth: 220, render: (v: string) => renderEllipsis(v) },
    { title: '业务关联 ID', dataIndex: 'correlationId', width: 390, render: (v: string) => <ObservabilityLink correlationId={v} compact expand /> },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (v: TraceNodeStatus) => <Tag size="small" color={STATUS_META[v].color}>{TRACE_NODE_STATUS_LABELS[v]}</Tag>,
    },
    { title: '节点', dataIndex: 'nodeCount', width: 70, align: 'right' },
    {
      title: '失败', dataIndex: 'failedCount', width: 70, align: 'right',
      render: (v: number) => (v > 0 ? <Text type="danger" size="small">{v}</Text> : <Text type="tertiary" size="small">0</Text>),
    },
    createOperationColumn<TraceListEntry>({
      width: 120,
      actions: (r) => [{ key: 'view', label: '查看链路', onClick: () => onView(r.correlationId) }],
    }),
  ];

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <Select
          value={days}
          onChange={(v) => setDays(v as number)}
          optionList={[{ value: 1, label: '近 1 天' }, { value: 3, label: '近 3 天' }, { value: 7, label: '近 7 天' }, { value: 30, label: '近 30 天' }]}
          style={{ width: 120 }}
        />
      </div>
      <ConfigurableTable
        columnSettings={false}
        columns={columns}
        {...listTableProps(tracesQuery, {
          rowKey: (r?: TraceListEntry) => r?.correlationId ?? '',
          empty: '时间窗内没有链路记录',
        })}
        pagination={false}
      />
      <Text type="tertiary" size="small" style={{ display: 'block', marginTop: 8 }}>
        按最近活动时间倒序，最多展示最近 50 条；点击「查看链路」展开完整时间线。
      </Text>
    </>
  );
}

/** 最近失败链路列表（排障入口：不知道 ID 时从这里进） */
function RecentFailuresPanel({ onView }: { onView: (correlationId: string) => void }) {
  const [days, setDays] = useState(7);
  const [kind, setKind] = useState<TraceNodeKind | undefined>();
  const failuresQuery = useRecentTraceFailures(days, kind);
  const columns: ColumnProps<TraceFailureEntry>[] = [
    {
      title: '类型', dataIndex: 'kind', width: 110,
      render: (v: TraceNodeKind) => <Tag size="small" color={KIND_COLORS[v]}>{TRACE_NODE_KIND_LABELS[v]}</Tag>,
    },
    { title: '标题', dataIndex: 'title', width: 240, render: (v: string) => renderEllipsis(v) },
    { title: '失败原因', dataIndex: 'error', minWidth: 320, render: (v: string) => renderEllipsis(v) },
    dateTimeColumn('发生时间', 'ts'),
    createOperationColumn<TraceFailureEntry>({
      width: 120,
      actions: (r) => [{ key: 'view', label: '查看链路', onClick: () => onView(r.correlationId) }],
    }),
  ];

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <Select
          value={days}
          onChange={(v) => setDays(v as number)}
          optionList={[{ value: 1, label: '近 1 天' }, { value: 3, label: '近 3 天' }, { value: 7, label: '近 7 天' }, { value: 30, label: '近 30 天' }]}
          style={{ width: 120 }}
        />
        <FilterSelect
          placeholder="全部类型"
          items={TRACE_NODE_KINDS.filter((k) => k !== 'event').map((k) => ({ value: k, label: TRACE_NODE_KIND_LABELS[k] }))}
          value={kind}
          onChange={(v) => setKind(v as TraceNodeKind | undefined)}
          width={140}
        />
      </div>
      <ConfigurableTable
        columnSettings={false}
        columns={columns}
        {...listTableProps(failuresQuery, {
          rowKey: (r?: TraceFailureEntry) => `${r?.kind}-${r?.refId}`,
          empty: '时间窗内没有失败记录，一切正常 🎉',
        })}
        pagination={false}
      />
      <Text type="tertiary" size="small" style={{ display: 'block', marginTop: 8 }}>
        聚合请求 5xx、作业失败/死信、任务失败与通知派发失败，最多展示最近 50 条。
      </Text>
    </>
  );
}

export default function TracePage() {
  const { hasPermission } = usePermission();
  const [searchParams, setSearchParams] = useSearchParams();
  const correlationId = searchParams.get('correlationId');
  const [activeTab, setActiveTab] = useUrlTabState(['query', 'failures'] as const, 'query');
  const [draft, setDraft] = useState(correlationId ?? '');
  const [detailNode, setDetailNode] = useState<TraceTimelineNode | null>(null);

  const timelineQuery = useTraceTimeline(correlationId);
  const nodes = useMemo(() => timelineQuery.data?.nodes ?? [], [timelineQuery.data]);

  /**
   * 只改写自己的 correlationId 参数（写新值 / 传 null 删除）。
   * 基础是 router 给的 searchParams 而非整份替换，页签等其它查询参数原样保留——
   * 与 `useUrlTabState` 的「各写各的参数」一致；参数无变化时不写 URL，不污染历史记录。
   */
  function applyCorrelationId(next: string | null) {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('correlationId', next);
    else params.delete('correlationId');
    if (params.toString() !== searchParams.toString()) setSearchParams(params);
  }

  function handleSearch() {
    const next = draft.trim();
    if (!next || !CORRELATION_ID_RE.test(next)) return;
    applyCorrelationId(next);
  }

  /**
   * 清空查询：输入框叉号与「重置」共用。
   * 叉号只把受控值置空，若不摘掉 URL 上的 correlationId，已查出的时间线会留在页面上（且「查询」按钮此时已禁用，无路可退）。
   */
  function handleReset() {
    setDraft('');
    setDetailNode(null);
    if (correlationId) applyCorrelationId(null);
  }

  /** 失败 / 最近链路列表行点击：回填 ID、切到查询 Tab 并触发查询 */
  function handleViewTrace(id: string) {
    setDraft(id);
    setActiveTab('query');
    applyCorrelationId(id);
  }

  const kindCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodes) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
    return counts;
  }, [nodes]);

  // 因果树展开：按 parentRef 组织父子（`kind:refId` / `request`），DFS 顺序 + 缩进深度；
  // 父引用缺失或指向窗口外节点时兜底为根，保持平铺可读
  const treeRows = useMemo(() => {
    const nodeKey = (n: TraceTimelineNode) => (n.kind === 'request' ? 'request' : `${n.kind}:${n.refId}`);
    const keySet = new Set(nodes.map(nodeKey));
    const children = new Map<string, TraceTimelineNode[]>();
    const roots: TraceTimelineNode[] = [];
    for (const n of nodes) {
      const parent = n.parentRef && n.parentRef !== nodeKey(n) && keySet.has(n.parentRef) ? n.parentRef : null;
      if (parent) {
        const list = children.get(parent) ?? [];
        list.push(n);
        children.set(parent, list);
      } else {
        roots.push(n);
      }
    }
    const rows: Array<{ node: TraceTimelineNode; depth: number }> = [];
    const visit = (n: TraceTimelineNode, depth: number) => {
      rows.push({ node: n, depth });
      for (const child of children.get(nodeKey(n)) ?? []) visit(child, depth + 1);
    };
    for (const r of roots) visit(r, 0);
    return rows;
  }, [nodes]);

  return (
    <div className="page-container zx-flat-panels">
      <Banner
        fullMode={false} type="info" closeIcon={null} style={{ marginBottom: 12 }}
        description="输入业务关联 ID（接口响应头 X-Request-Id / 报错提示中的业务关联 ID / 操作日志详情），查看一次操作触发的请求、作业、事件、通知与任务的完整时间线。数据受各锚点保留策略约束，超出保留窗口的节点不再展示。"
      />

      <Tabs type="line" collapsible="auto" activeKey={activeTab} onChange={(k) => setActiveTab(k as 'query' | 'failures')}>
        <TabPane tab="按 ID 查询" itemKey="query">
          <div style={{ display: 'flex', gap: 8, margin: '12px 0 16px', maxWidth: 680 }}>
            <Input
              prefix={<Search size={14} />}
              placeholder="业务关联 ID，如 b9c67477-1433-4815-bbf3-51419c322770"
              value={draft}
              onChange={setDraft}
              onEnterPress={handleSearch}
              onClear={handleReset}
              showClear
            />
            <SearchButton onClick={handleSearch} disabled={!CORRELATION_ID_RE.test(draft.trim())} />
            <ResetButton onClick={handleReset} disabled={!correlationId && draft === ''} />
          </div>

          {!correlationId ? (
            <RecentTracesPanel onView={handleViewTrace} />
          ) : (
            <Spin spinning={timelineQuery.isFetching}>
              {timelineQuery.isFetched && nodes.length === 0 ? (
                <Empty title="未找到该链路的留痕" description="业务关联 ID 可能有误，或相关数据已按保留策略清理" style={{ padding: '48px 0' }} />
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
                    <Text type="tertiary" size="small">共 {nodes.length} 个节点：</Text>
                    <ObservabilityLink correlationId={correlationId} compact />
                    {[...kindCounts.entries()].map(([kind, count]) => (
                      <Tag key={kind} size="small" color={KIND_COLORS[kind as TraceTimelineNode['kind']]}>
                        {TRACE_NODE_KIND_LABELS[kind as TraceTimelineNode['kind']]} × {count}
                      </Tag>
                    ))}
                  </div>

                  <Timeline mode="left">
                    {treeRows.map(({ node, depth }, i) => (
                      <Timeline.Item
                        key={`${node.kind}-${node.refId}-${i}`}
                        time={node.ts}
                        type={STATUS_META[node.status].timeline}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginLeft: depth * 24 }}>
                          {depth > 0 && <Text type="tertiary" size="small">↳</Text>}
                          <Tag size="small" color={KIND_COLORS[node.kind]}>{TRACE_NODE_KIND_LABELS[node.kind]}</Tag>
                          <Text strong>{node.title}</Text>
                          <Tag size="small" color={STATUS_META[node.status].color}>{TRACE_NODE_STATUS_LABELS[node.status]}</Tag>
                          {node.durationMs !== null && <Text type="tertiary" size="small">{node.durationMs}ms</Text>}
                          <Button size="small" theme="borderless" type="primary" onClick={() => setDetailNode(node)}>详情</Button>
                        </div>
                      </Timeline.Item>
                    ))}
                  </Timeline>

                  {!timelineQuery.isPending && !timelineQuery.isError && hasPermission('system:log:files') && (
                    <Collapse style={{ marginTop: 16 }} defaultActiveKey={['logs']}>
                      <Collapse.Panel header="应用日志（按业务关联 ID 过滤）" itemKey="logs">
                        <TraceLogsPanel key={correlationId} correlationId={correlationId} />
                      </Collapse.Panel>
                    </Collapse>
                  )}
                </>
              )}
            </Spin>
          )}
        </TabPane>
        <TabPane tab="最近失败" itemKey="failures">
          <div style={{ marginTop: 12 }}>
            <RecentFailuresPanel onView={handleViewTrace} />
          </div>
        </TabPane>
      </Tabs>

      {/* 节点明细抽屉 */}
      <SideSheet
        title={detailNode ? `${TRACE_NODE_KIND_LABELS[detailNode.kind]} · ${detailNode.title}` : ''}
        visible={detailNode !== null}
        onCancel={() => setDetailNode(null)}
        width={560}
        closeOnEsc
      >
        {detailNode && (
          <div className="zx-flat-panels">
            <Card title="节点信息">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Text>时间：{detailNode.ts}</Text>
                <Text>状态：<Tag size="small" color={STATUS_META[detailNode.status].color}>{TRACE_NODE_STATUS_LABELS[detailNode.status]}</Tag></Text>
                {detailNode.durationMs !== null && <Text>耗时：{detailNode.durationMs}ms</Text>}
                <Text>单据 ID：{detailNode.refId}</Text>
              </div>
            </Card>
            <Card title="明细" style={{ marginTop: 12 }}>
              {/* 不再套 Typography.Paragraph：它渲染成 <p>，而 <pre> 不能是 <p> 的后代（React 报 hydration 级错误） */}
              <TextBlock maxHeight={480}>
                {JSON.stringify(detailNode.detail, null, 2)}
              </TextBlock>
            </Card>
          </div>
        )}
      </SideSheet>
    </div>
  );
}
