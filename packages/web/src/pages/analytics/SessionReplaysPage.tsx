/**
 * 会话回放中心：回放列表（详情侧栏：播放器/触发器/关联错误/旅程拼接/导出）
 * 与页面点击热力两个 Tab。支持 ?replay={id} 深链直达。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Checkbox, Descriptions, SideSheet, Space, TabPane, Tabs, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Download, Trash2 } from 'lucide-react';
import type { ReplaySession, ReplayTriggerType } from '@zenith/shared/analytics';
import { REPLAY_STATUSES, REPLAY_TRIGGER_TYPES } from '@zenith/shared/analytics';
import { enumValueOf } from '@zenith/shared/core';
import ConfigurableTable from '@/components/ConfigurableTable';
import ReplayPlayer from '@/components/ReplayPlayer';
import ReplayHeatmapTab from './ReplayHeatmapTab';
import ReplayAccessLogsTab from './ReplayAccessLogsTab';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { dateTimeColumn } from '@/utils/table-columns';
import { formatDurationMs } from '@/utils/format';
import { confirmDelete } from '@/utils/confirm';
import { exportReplayHtml } from '@/utils/replay-export';
import { useListSearch } from '@/hooks/useListSearch';
import { usePermission } from '@/hooks/usePermission';
import { StatCard, StatGrid } from '@/components/charts';
import { replayKeys, useBatchDeleteReplays, useReplayDetail, useReplayList, useReplayStorageStats } from '@/hooks/queries/session-replays';
import { formatBytes } from '@zenith/shared/core';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';

const { Text } = Typography;

interface SearchParams {
  status?: string;
  triggerType?: string;
  source?: string;
  keyword: string;
  hasError: boolean;
  pagePath: string;
  clickLabel: string;
}

const defaultSearchParams: SearchParams = { status: undefined, triggerType: undefined, source: undefined, keyword: '', hasError: false, pagePath: '', clickLabel: '' };
const STATUS_META = {
  recording: { label: '录制中', color: 'blue' },
  completed: { label: '已完成', color: 'green' },
  expired: { label: '已超时', color: 'grey' },
} as const;

const TRIGGER_META: Record<ReplayTriggerType, { label: string; color: string }> = {
  error: { label: '错误触发', color: 'red' },
  sampled: { label: '采样录制', color: 'blue' },
  manual: { label: '手动开启', color: 'purple' },
  rage_click: { label: '暴躁点击', color: 'orange' },
  white_screen: { label: '白屏', color: 'red' },
};

const statusOptions = [
  { value: 'recording', label: '录制中' },
  { value: 'completed', label: '已完成' },
  { value: 'expired', label: '已超时' },
];

const triggerOptions = [
  { value: 'error', label: '错误触发' },
  { value: 'sampled', label: '采样录制' },
  { value: 'manual', label: '手动开启' },
  { value: 'rage_click', label: '暴躁点击' },
  { value: 'white_screen', label: '白屏' },
];

/** 回放只来自两个 Web 端（服务端埋点不产生录像） */
const REPLAY_SOURCES = ['web_admin', 'web_member'] as const;

const sourceOptions = [
  { value: 'web_admin', label: '管理后台' },
  { value: 'web_member', label: '会员前台' },
];

export default function SessionReplaysPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    page, pageSize, buildPagination,
    draftParams, setField, bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: replayKeys.lists });

  const [detailId, setDetailId] = useState<string | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

  const listQuery = useReplayList({
    page, pageSize,
    status: enumValueOf(REPLAY_STATUSES, submittedParams.status),
    triggerType: enumValueOf(REPLAY_TRIGGER_TYPES, submittedParams.triggerType),
    source: enumValueOf(REPLAY_SOURCES, submittedParams.source),
    keyword: submittedParams.keyword || undefined,
    hasError: submittedParams.hasError || undefined,
    pagePath: submittedParams.pagePath || undefined,
    clickLabel: submittedParams.clickLabel || undefined,
  });
  const total = listQuery.data?.total ?? 0;

  const detailQuery = useReplayDetail(detailId, detailId !== null);
  const detail = detailQuery.data ?? null;
  const batchDeleteMutation = useBatchDeleteReplays();
  const statsQuery = useReplayStorageStats();
  const stats = statsQuery.data ?? null;

  // ?replay={id} 直达（错误监控跳转）
  useEffect(() => {
    const target = searchParams.get('replay');
    if (target) setDetailId(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 详情开关同步 URL，便于分享定位
  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (detailId) next.set('replay', detailId);
      else next.delete('replay');
      return next;
    }, { replace: true });
  }, [detailId, setSearchParams]);

  const columns: ColumnProps<ReplaySession>[] = useMemo(() => [
    {
      title: '触发', width: 110,
      render: (_: unknown, r: ReplaySession) => {
        const primary = r.triggers.find((t) => t.type === 'error') ?? r.triggers[0];
        if (!primary) return <Tag size="small" color="grey">缓冲中</Tag>;
        const meta = TRIGGER_META[primary.type] ?? { label: primary.type, color: 'grey' };
        return <Tag size="small" color={meta.color as 'grey'}>{meta.label}</Tag>;
      },
    },
    {
      title: '入口页面', dataIndex: 'entryPageUrl', minWidth: 260, ellipsis: { showTitle: false },
      render: (v: string | null) => v
        ? <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }} size="small">{v.replace(/^https?:\/\/[^/]+/, '')}</Text>
        : '—',
    },
    {
      title: '用户', width: 120,
      render: (_: unknown, r: ReplaySession) => r.username ?? (r.memberId ? `会员#${r.memberId}` : '匿名'),
    },
    {
      title: '时长', dataIndex: 'durationMs', width: 90,
      render: (v: number) => formatDurationMs(v),
    },
    {
      title: '错误', dataIndex: 'errorCount', width: 70, align: 'right',
      render: (v: number) => v > 0 ? <Text type="danger">{v}</Text> : <Text type="quaternary">0</Text>,
    },
    { title: '翻页', dataIndex: 'pageCount', width: 70, align: 'right' },
    { title: '点击', dataIndex: 'clickCount', width: 70, align: 'right' },
    {
      title: '体积', dataIndex: 'totalBytes', width: 110, align: 'right',
      render: (v: number) => formatBytes(v),
    },
    {
      title: '来源', dataIndex: 'source', width: 100,
      render: (v: string) => v === 'web_member' ? '会员前台' : '管理后台',
    },
    {
      title: '浏览器', width: 170,
      render: (_: unknown, r: ReplaySession) => (
        <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }} size="small">
          {[r.browser, r.os].filter(Boolean).join(' / ') || '—'}
        </Text>
      ),
    },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (v: ReplaySession['status']) => {
        const meta = STATUS_META[v] ?? { label: v, color: 'grey' as const };
        return <Tag size="small" color={meta.color as 'grey'}>{meta.label}</Tag>;
      },
    },
    dateTimeColumn('开始时间', 'startedAt'),
    createOperationColumn<ReplaySession>({
      width: 100,
      desktopInlineKeys: ['play'],
      actions: (record) => [
        { key: 'play', label: '播放', onClick: () => setDetailId(record.id) },
      ],
    }),
  ], []);

  async function handleBatchDelete() {
    const ok = await confirmDelete({ title: `确认删除选中的 ${selectedRowKeys.length} 条回放？`, content: '录像分片将一并删除，不可恢复。' });
    if (!ok) return;
    await batchDeleteMutation.mutateAsync({ body: { ids: selectedRowKeys } });
    setSelectedRowKeys([]);
  }

  return (
    <div className="page-container">
      {stats && (
        <StatGrid style={{ marginBottom: 16 }}>
          <StatCard title="存储占用" value={formatBytes(stats.totalBytes)} sub={stats.quotaMb > 0 ? `配额 ${stats.quotaMb} MB` : '未设配额'} />
          <StatCard
            title="配额使用率"
            value={stats.quotaMb > 0 ? `${stats.usagePercent}%` : '—'}
            accent={stats.usagePercent >= 90 ? 'var(--semi-color-danger)' : stats.usagePercent >= 75 ? 'var(--semi-color-warning)' : undefined}
            sub={stats.usagePercent >= 100 ? '滚动淘汰进行中（旧的无错误回放优先清退）' : stats.usagePercent >= 90 ? '接近配额，即将触发滚动淘汰' : '低于水位线'}
          />
          <StatCard title="今日新增" value={formatBytes(stats.todayBytes)} sub={`${stats.todayCount} 个会话`} />
          <StatCard title="回放总数" value={stats.totalCount} sub="按保留天数自动清理" />
        </StatGrid>
      )}
      <Tabs type="line" lazyRender>
        <TabPane tab="回放列表" itemKey="list">
          <ListSearchToolbar
            keyword={(
              <>
                <KeywordInput
                  placeholder="用户名/页面/回放 ID"
                  {...bindKeyword('keyword')}
                  width={200}
                />
                <KeywordInput
                  placeholder="访问过的页面路径"
                  {...bindKeyword('pagePath')}
                  width={170}
                />
                <KeywordInput
                  placeholder="点击过的内容"
                  {...bindKeyword('clickLabel')}
                  width={150}
                />
              </>
            )}
            filters={(
              <>
                <StatusSelect
                  items={statusOptions}
                  {...bind('status')}
                />
                <FilterSelect
                  placeholder="全部触发方式"
                  items={triggerOptions}
                  {...bind('triggerType')}
                  width={140}
                />
                <FilterSelect
                  placeholder="全部来源"
                  items={sourceOptions}
                  {...bind('source')}
                />
                <Checkbox
                  checked={draftParams.hasError}
                  onChange={(e) => setField('hasError')(Boolean(e.target.checked))}
                >
                  仅看有错误
                </Checkbox>
              </>
            )}
            onSearch={handleSearch}
            onReset={handleReset}
            actions={selectedRowKeys.length > 0 ? (
              <Button type="danger" icon={<Trash2 size={14} />} loading={batchDeleteMutation.isPending} onClick={() => void handleBatchDelete()}>
                批量删除 ({selectedRowKeys.length})
              </Button>
            ) : null}
            mobileActions={selectedRowKeys.length > 0 ? (
              <Button type="danger" theme="borderless" icon={<Trash2 size={14} />} loading={batchDeleteMutation.isPending} onClick={() => void handleBatchDelete()}>
                批量删除 ({selectedRowKeys.length})
              </Button>
            ) : null}
          />

          <ConfigurableTable
            columns={columns}
            {...listTableProps(listQuery, {
              pagination: () => buildPagination(total),
              rowSelection: {
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys((keys ?? []) as string[]),
              },
              empty: '暂无回放记录。开启「数据分析设置 → 会话回放」后，报错现场将自动录制。',
            })}
          />
        </TabPane>
        <TabPane tab="点击热力" itemKey="heatmap">
          <ReplayHeatmapTab />
        </TabPane>
        {hasPermission('monitor:replay:manage') && (
          <TabPane tab="访问审计" itemKey="audit">
            <ReplayAccessLogsTab onOpenReplay={setDetailId} />
          </TabPane>
        )}
      </Tabs>

      <SideSheet
        title="会话回放"
        visible={detailId !== null}
        onCancel={() => setDetailId(null)}
        width={Math.min(960, globalThis.innerWidth - 80)}
      >
        {detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24 }}>
            <Descriptions
              size="small"
              row
              data={[
                { key: '用户', value: detail.username ?? (detail.memberId ? `会员#${detail.memberId}` : '匿名') },
                { key: '时长', value: formatDurationMs(detail.durationMs) },
                { key: '分片', value: `${detail.segmentCount} 个 · ${formatBytes(detail.totalBytes)}` },
                { key: '环境', value: `${detail.browser ?? '?'} / ${detail.os ?? '?'}` },
              ]}
            />
            <div>
              <Button
                icon={<Download size={14} />}
                onClick={() => void exportReplayHtml(detail.id, detail.username ?? detail.entryPageUrl ?? detail.id.slice(0, 8), detail.segments)}
              >
                导出 HTML（自包含，可离线播放）
              </Button>
            </div>
            <Space wrap>
              {detail.triggers.map((t, i) => {
                const meta = TRIGGER_META[t.type] ?? { label: t.type, color: 'grey' };
                return <Tag key={`${t.type}-${i}`} size="small" color={meta.color as 'grey'}>{meta.label} · {t.at.slice(11, 19)}</Tag>;
              })}
            </Space>

            {detail.siblings.length > 0 && (
              <div>
                <Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 6 }}>
                  本次浏览器会话共 {detail.siblings.length + 1} 段录像（旅程拼接，点击切换）
                </Text>
                <Space wrap>
                  {[...detail.siblings, { id: detail.id, startedAt: detail.startedAt, durationMs: detail.durationMs, errorCount: detail.errorCount, status: detail.status, entryPageUrl: detail.entryPageUrl }]
                    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
                    .map((seg, i) => (
                      <Tag
                        key={seg.id}
                        size="small"
                        color={seg.id === detail.id ? 'blue' : 'grey'}
                        style={seg.id === detail.id ? undefined : { cursor: 'pointer' }}
                        onClick={seg.id === detail.id ? undefined : () => setDetailId(seg.id)}
                      >
                        片段{i + 1} · {seg.startedAt.slice(11, 19)} · {formatDurationMs(seg.durationMs)}{seg.errorCount > 0 ? ` · ${seg.errorCount} 错误` : ''}
                      </Tag>
                    ))}
                </Space>
              </div>
            )}

            <ReplayPlayer
              replayId={detail.id}
              segments={detail.segments}
              errors={detail.errors}
              perfEvents={detail.perfEvents}
              startedAt={detail.startedAt}
              live={detail.status === 'recording'}
            />

            {detail.errors.length > 0 && (
              <div>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>关联错误（{detail.errors.length}）</Text>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {detail.errors.map((e) => (
                    <Text
                      key={e.id}
                      type="danger"
                      size="small"
                      ellipsis={{ showTooltip: true }}
                      style={{ maxWidth: '100%', cursor: 'pointer' }}
                      onClick={() => navigate(`/analytics/errors?issue=${e.groupId}`)}
                    >
                      [{e.createdAt.slice(11, 19)}] {e.errorType}: {e.message}
                    </Text>
                  ))}
                </div>
                <Text type="quaternary" size="small">点击错误跳转错误监控 Issue 详情</Text>
              </div>
            )}
            <Text type="tertiary" size="small">
              回放已按隐私策略打码（输入框默认脱敏）；入口页面：{detail.entryPageUrl ?? '—'}
            </Text>
          </div>
        )}
      </SideSheet>
    </div>
  );
}
