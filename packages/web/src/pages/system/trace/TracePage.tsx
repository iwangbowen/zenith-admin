import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Banner, Button, Card, Collapse, Empty, Input, Select, SideSheet, Spin, Tabs, TabPane, Tag, Timeline, Typography,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search } from 'lucide-react';
import type { TraceFailureEntry, TraceNodeKind, TraceNodeStatus, TraceTimelineNode } from '@zenith/shared/platform';
import { TRACE_NODE_KIND_LABELS, TRACE_NODE_KINDS, TRACE_NODE_STATUS_LABELS } from '@zenith/shared/platform';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { listTableProps } from '@/components/list-page';
import { usePermission } from '@/hooks/usePermission';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useRecentTraceFailures, useTraceTimeline } from '@/hooks/queries/trace';
import { useLogFiles, useLogFileContent } from '@/hooks/queries/log-files';
import { renderEllipsis } from '@/utils/table-columns';
import { FilterSelect } from '@/components/search-filters';
import { SearchButton } from '@/components/toolbar-controls';

const { Text, Paragraph } = Typography;

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

const TRACE_ID_RE = /^[\w-]{8,64}$/;

/** 链路日志（复用日志文件接口按 traceId 全文过滤，支持切换近 7 天的日志文件） */
function TraceLogsPanel({ traceId }: { traceId: string }) {
  const filesQuery = useLogFiles();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  // pino-roll 按天滚动：候选 = 近 7 个未压缩的 app 日志文件，默认最新
  const appFiles = useMemo(() => {
    const files = filesQuery.data ?? [];
    return files
      .filter((f) => f.name.startsWith('app.') && !f.isGzip)
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
      .slice(0, 7);
  }, [filesQuery.data]);
  const activeFile = selectedFile && appFiles.some((f) => f.name === selectedFile)
    ? selectedFile
    : appFiles[0]?.name;
  const contentQuery = useLogFileContent(activeFile, { lines: 5000, keyword: traceId }, Boolean(activeFile));
  const lines = contentQuery.data?.lines ?? [];

  return (
    <Spin spinning={filesQuery.isPending || contentQuery.isFetching}>
      {appFiles.length > 1 && (
        <Select
          size="small"
          value={activeFile}
          onChange={(v) => setSelectedFile(v as string)}
          optionList={appFiles.map((f) => ({ value: f.name, label: f.name }))}
          style={{ width: 260, marginBottom: 8 }}
        />
      )}
      {lines.length === 0 ? (
        <Empty description="所选日志文件中未检索到该链路的记录" style={{ padding: '16px 0' }} />
      ) : (
        <div style={{
          fontFamily: 'var(--zx-font-mono, monospace)', fontSize: 12, lineHeight: '20px',
          maxHeight: 360, overflow: 'auto', background: 'var(--semi-color-fill-0)',
          borderRadius: 'var(--semi-border-radius-medium)', padding: '8px 12px', wordBreak: 'break-all',
        }}>
          {lines.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}
      {activeFile && (
        <Text type="tertiary" size="small" style={{ display: 'block', marginTop: 6 }}>
          检索范围：{activeFile} 最近 5000 行
        </Text>
      )}
    </Spin>
  );
}

/** 最近失败链路列表（排障入口：不知道 ID 时从这里进） */
function RecentFailuresPanel({ onView }: { onView: (traceId: string) => void }) {
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
    { title: '发生时间', dataIndex: 'ts', width: 160 },
    createOperationColumn<TraceFailureEntry>({
      width: 120,
      actions: (r) => [{ key: 'view', label: '查看链路', onClick: () => onView(r.traceId) }],
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
  const traceId = searchParams.get('traceId');
  const [activeTab, setActiveTab] = useUrlTabState(['query', 'failures'] as const, 'query');
  const [draft, setDraft] = useState(traceId ?? '');
  const [detailNode, setDetailNode] = useState<TraceTimelineNode | null>(null);

  const timelineQuery = useTraceTimeline(traceId);
  const nodes = useMemo(() => timelineQuery.data?.nodes ?? [], [timelineQuery.data]);

  function handleSearch() {
    const next = draft.trim();
    if (!next || !TRACE_ID_RE.test(next)) return;
    setSearchParams(next === traceId ? searchParams : { traceId: next });
  }

  /** 失败列表行点击：回填 ID、切换到查询 Tab 并触发查询 */
  function handleViewFailure(id: string) {
    setDraft(id);
    setActiveTab('query');
    setSearchParams({ traceId: id });
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
        description="输入链路 ID（接口响应头 X-Request-Id / 报错提示中的链路ID / 操作日志详情），查看一次操作触发的请求、作业、事件、通知与任务的完整时间线。数据受各锚点保留策略约束，超出保留窗口的节点不再展示。"
      />

      <Tabs type="line" collapsible="auto" activeKey={activeTab} onChange={(k) => setActiveTab(k as 'query' | 'failures')}>
        <TabPane tab="按 ID 查询" itemKey="query">
          <div style={{ display: 'flex', gap: 8, margin: '12px 0 16px', maxWidth: 560 }}>
            <Input
              prefix={<Search size={14} />}
              placeholder="链路 ID，如 b9c67477-1433-4815-bbf3-51419c322770"
              value={draft}
              onChange={setDraft}
              onEnterPress={handleSearch}
              showClear
            />
            <SearchButton onClick={handleSearch} disabled={!TRACE_ID_RE.test(draft.trim())} />
          </div>

          {!traceId ? (
            <Empty title="输入链路 ID 开始追踪" description="从操作日志详情、任务中心、报错提示或「最近失败」页签获取链路 ID" style={{ padding: '48px 0' }} />
          ) : (
            <Spin spinning={timelineQuery.isFetching}>
              {timelineQuery.isFetched && nodes.length === 0 ? (
                <Empty title="未找到该链路的留痕" description="链路 ID 可能有误，或相关数据已按保留策略清理" style={{ padding: '48px 0' }} />
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
                    <Text type="tertiary" size="small">共 {nodes.length} 个节点：</Text>
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

                  {hasPermission('system:log:files') && (
                    <Collapse style={{ marginTop: 16 }}>
                      <Collapse.Panel header="应用日志（按链路 ID 过滤）" itemKey="logs">
                        <TraceLogsPanel traceId={traceId} />
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
            <RecentFailuresPanel onView={handleViewFailure} />
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
              <Paragraph>
                <pre style={{
                  margin: 0, fontSize: 12, lineHeight: '20px', whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all', maxHeight: 480, overflow: 'auto',
                }}>
                  {JSON.stringify(detailNode.detail, null, 2)}
                </pre>
              </Paragraph>
            </Card>
          </div>
        )}
      </SideSheet>
    </div>
  );
}
