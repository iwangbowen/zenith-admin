import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Avatar, Button, Empty, SideSheet, Space, Spin, TextArea, Toast, Typography, Tag } from '@douyinfe/semi-ui';
import { ArrowLeft, RotateCcw, PencilRuler, Maximize, Image, MessageSquare, Send, Trash2, CheckCircle2, CornerDownRight } from 'lucide-react';
import { toPng } from 'html-to-image';
import './report-grid.css';
import './report-screen.css';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { ScreenCanvas } from './widgets/ScreenCanvas';
import { FilterBar } from './widgets/FilterBar';
import { filterValuesFromSearch, withFilterParam } from './widgets/filter-url';
import type { ReportWidget, ReportFilter, ReportGridItem, ReportCanvasItem, ReportDatasetQueryOptions } from '@zenith/shared';
import {
  useCreateReportDashboardComment,
  useDeleteReportDashboardComment,
  useReportDashboardComments,
  useReportDashboardDetail,
  useResolveReportDashboardComment,
  useReportDashboardWidgetData,
} from '@/hooks/queries/report-dashboards';

function defaultFilterValue(f: ReportFilter): unknown {
  if (f.defaultValue !== undefined) return f.defaultValue;
  return f.type === 'multiSelect' ? [] : undefined;
}

export default function DashboardViewPage() {
  const { id } = useParams<{ id: string }>();
  const dashboardId = Number(id);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission } = usePermission();

  const [filterValues, setFilterValues] = useState<Record<string, unknown>>({});
  const [debouncedFilterValues, setDebouncedFilterValues] = useState<Record<string, unknown>>({});
  const [widgetQueries, setWidgetQueries] = useState<Record<string, ReportDatasetQueryOptions>>({});
  const rootRef = useRef<HTMLDivElement | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const [exporting, setExporting] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentWidgetId, setCommentWidgetId] = useState<string | undefined>(undefined);
  const [replyTo, setReplyTo] = useState<{ id: number; widgetId?: string | null } | null>(null);
  const [commentPage, setCommentPage] = useState(1);
  const viewMode = (searchParams.get('mode') as 'auto' | 'draft' | 'published' | null) ?? 'auto';

  const dashboardQuery = useReportDashboardDetail(dashboardId, !!dashboardId, viewMode);
  const dashboard = dashboardQuery.data ?? null;
  const widgets = useMemo(() => dashboard?.widgets ?? [], [dashboard]);
  const filters = dashboard?.filters ?? [];
  const isDark = dashboard?.config?.theme === 'dark';
  const isCanvas = dashboard?.config?.layoutMode === 'canvas';
  const screen = dashboard?.config?.screenConfig;
  const aspect = isCanvas ? `${screen?.width || 1920} / ${screen?.height || 1080}` : undefined;
  const refreshInterval = dashboard?.config?.refreshInterval && dashboard.config.refreshInterval > 0 ? dashboard.config.refreshInterval * 1000 : false;

  const { get: getData, refresh } = useReportDashboardWidgetData(dashboardId, widgets, debouncedFilterValues, {
    refetchInterval: refreshInterval,
    widgetQueries,
    mode: viewMode,
  });
  const commentsQuery = useReportDashboardComments(dashboardId, { page: commentPage, pageSize: 20, widgetId: commentWidgetId }, commentsVisible);
  const comments = commentsQuery.data?.list ?? [];
  const createCommentMutation = useCreateReportDashboardComment();
  const deleteCommentMutation = useDeleteReportDashboardComment();
  const resolveCommentMutation = useResolveReportDashboardComment();

  // 初始化筛选值：URL 优先 > 筛选器默认值（仅在仪表盘加载/切换时执行，
  // 后续 URL 回写不重置状态，避免写 URL → 触发本 effect 的循环）
  useEffect(() => {
    if (!dashboard) return;
    setFilterValues(filterValuesFromSearch(dashboard.filters ?? [], searchParams, defaultFilterValue));
    setWidgetQueries({});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随仪表盘变化初始化（searchParams 为闭包快照）
  }, [dashboard]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedFilterValues(filterValues), 250);
    return () => window.clearTimeout(timer);
  }, [filterValues]);

  /** 更新筛选值并回写 URL（replace，不产生历史记录），分享/刷新可保留筛选状态 */
  function updateFilter(filterId: string, value: unknown) {
    setFilterValues((p) => ({ ...p, [filterId]: value }));
    setWidgetQueries({});
    setSearchParams((prev) => withFilterParam(prev, filterId, value), { replace: true });
  }

  const handleWidgetQueryChange = useCallback((widgetId: string, next: ReportDatasetQueryOptions) => {
    setWidgetQueries((prev) => ({ ...prev, [widgetId]: next }));
  }, []);

  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  function handleCategoryClick(w: ReportWidget, value: string) {
    if (w.interaction?.enabled && w.interaction.setFilterId) {
      updateFilter(w.interaction.setFilterId, value);
    }
    if (w.drilldown?.enabled) {
      const dd = w.drilldown;
      if (dd.type === 'url' && dd.url) { window.open(dd.url.replace('{value}', encodeURIComponent(value)), '_blank'); }
      else if (dd.targetDashboardId) {
        const q = dd.paramName ? `?${encodeURIComponent(dd.paramName)}=${encodeURIComponent(value)}` : '';
        navigate(`/report/dashboards/${dd.targetDashboardId}/view${q}`);
      }
    }
  }

  function toggleFullscreen() {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }

  async function handleExportPng() {
    if (!exportRef.current) return;
    setExporting(true);
    try {
      const dataUrl = await toPng(exportRef.current, { backgroundColor: isDark ? '#0b1020' : '#ffffff', pixelRatio: 2, cacheBust: true });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${dashboard?.name ?? 'dashboard'}.png`;
      a.click();
    } catch { Toast.error('导出失败，请重试'); } finally { setExporting(false); }
  }

  function openComments() {
    setCommentsVisible(true);
    setCommentWidgetId(undefined);
    setReplyTo(null);
    setCommentPage(1);
  }

  function openWidgetComments(widgetId: string) {
    setCommentsVisible(true);
    setCommentWidgetId(widgetId);
    setReplyTo(null);
    setCommentPage(1);
  }

  async function submitComment() {
    const content = commentText.trim();
    if (!content) { Toast.warning('请输入评论内容'); return; }
    try {
      await createCommentMutation.mutateAsync({
        dashboardId,
        widgetId: replyTo?.widgetId ?? commentWidgetId ?? null,
        parentId: replyTo?.id ?? null,
        content,
      });
      setCommentText('');
      setReplyTo(null);
      Toast.success('发表成功');
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '发表失败');
    }
  }

  async function deleteComment(commentId: number) {
    try {
      await deleteCommentMutation.mutateAsync({ dashboardId, commentId });
      Toast.success('删除成功');
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '删除失败');
    }
  }

  async function toggleResolve(commentId: number, resolved: boolean) {
    try {
      await resolveCommentMutation.mutateAsync({ dashboardId, commentId, resolved });
      Toast.success(resolved ? '已解决评论' : '已重新打开评论');
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '操作失败');
    }
  }

  if (dashboardQuery.isFetching && !dashboard) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spin size="large" /></div>;

  const canvasState = (w: ReportWidget) => getData(w);

  return (
    <div
      ref={rootRef}
      className={`report-screen-root${isCanvas ? '' : ' report-view'}`}
      style={isCanvas ? { background: isDark ? '#060c1f' : 'var(--semi-color-fill-0)' } : (isDark ? { background: '#0b1020' } : undefined)}
    >
      <div className={`report-screen-header${isDark ? ' report-screen-header--dark' : ''}`} style={isCanvas ? undefined : { padding: 0, marginBottom: 12 }}>
        <Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={() => navigate('/report/dashboards')}>返回</Button>
        <span className="report-screen-header__title" style={{ margin: 0, color: isDark ? '#eaf4ff' : 'var(--semi-color-text-0)', fontSize: isCanvas ? 20 : 18 }}>{dashboard?.name ?? '仪表盘'}</span>
        <div style={{ flex: 1 }} />
        <Button icon={<RotateCcw size={16} />} onClick={() => refresh()}>刷新</Button>
        <Button icon={<Image size={16} />} loading={exporting} onClick={handleExportPng}>图片</Button>
        <Button icon={<Maximize size={16} />} onClick={toggleFullscreen}>全屏</Button>
        {hasPermission('report:dashboard:list') && (
          <Button icon={<MessageSquare size={16} />} onClick={openComments}>评论</Button>
        )}
        {hasPermission('report:dashboard:update') && (
          <Button icon={<PencilRuler size={16} />} onClick={() => navigate(`/report/dashboards/${dashboardId}/design`)}>编辑</Button>
        )}
      </div>

      <div ref={exportRef} style={isCanvas ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : undefined}>
        <div style={isCanvas ? { padding: '0 12px' } : undefined}>
          <FilterBar filters={filters} values={filterValues} onChange={updateFilter} />
        </div>

        {widgets.length === 0 ? (
          <Empty description="该仪表盘还没有组件" style={{ paddingTop: 80 }} />
        ) : isCanvas ? (
          <div style={isFs ? { flex: 1, minHeight: 0 } : { width: '100%', aspectRatio: aspect, maxHeight: 'calc(100vh - 160px)' }}>
            <ScreenCanvas
              widgets={widgets}
              layout={(dashboard?.layout ?? []) as ReportGridItem[]}
              canvasLayout={(dashboard?.canvasLayout ?? []) as ReportCanvasItem[]}
              config={dashboard?.config ?? {}}
              filterValues={filterValues}
              getWidgetState={canvasState}
              getWidgetQuery={(widget) => widgetQueries[widget.i]}
              onWidgetQueryChange={handleWidgetQueryChange}
              onCategoryClick={handleCategoryClick}
              onWidgetClick={(widget) => openWidgetComments(widget.i)}
            />
          </div>
        ) : (
          <ScreenCanvas
            widgets={widgets}
            layout={(dashboard?.layout ?? []) as ReportGridItem[]}
            canvasLayout={(dashboard?.canvasLayout ?? []) as ReportCanvasItem[]}
            config={dashboard?.config ?? {}}
            filterValues={filterValues}
            getWidgetState={canvasState}
            getWidgetQuery={(widget) => widgetQueries[widget.i]}
            onWidgetQueryChange={handleWidgetQueryChange}
            onCategoryClick={handleCategoryClick}
            onWidgetClick={(widget) => openWidgetComments(widget.i)}
          />
        )}
      </div>

      <SideSheet
        title={commentWidgetId ? `组件评论 · ${widgets.find((item) => item.i === commentWidgetId)?.title || commentWidgetId}` : '仪表盘评论'}
        visible={commentsVisible}
        onCancel={() => { setCommentsVisible(false); setReplyTo(null); }}
        placement="right"
        width={420}
        bodyStyle={{ padding: 0 }}
      >
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
            {commentsQuery.isFetching ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spin /></div>
            ) : comments.length === 0 ? (
              <Empty description="暂无评论" style={{ padding: '32px 0' }} />
            ) : (
              <Space vertical align="start" spacing={14} style={{ width: '100%' }}>
                {comments.map((comment) => (
                  <div key={comment.id} style={{ width: '100%', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <Avatar size="small" src={comment.userAvatar || undefined}>{comment.userName?.slice(0, 1) || '用'}</Avatar>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Typography.Text strong>{comment.userName || `用户 ${comment.userId}`}</Typography.Text>
                        <Typography.Text type="tertiary" size="small">{formatDateTime(comment.createdAt)}</Typography.Text>
                        {comment.resolvedAt ? <Tag color="green" size="small">已解决</Tag> : null}
                        <div style={{ flex: 1 }} />
                        {comment.canResolve ? (
                          <Button
                            theme="borderless"
                            size="small"
                            icon={<CheckCircle2 size={14} />}
                            onClick={() => void toggleResolve(comment.id, !comment.resolvedAt)}
                          >
                            {comment.resolvedAt ? '重开' : '解决'}
                          </Button>
                        ) : null}
                        <Button theme="borderless" size="small" icon={<CornerDownRight size={14} />} onClick={() => setReplyTo({ id: comment.id, widgetId: comment.widgetId })}>回复</Button>
                        {comment.canDelete ? (
                          <Button
                            theme="borderless"
                            type="danger"
                            size="small"
                            icon={<Trash2 size={14} />}
                            onClick={() => void deleteComment(comment.id)}
                            aria-label="删除评论"
                          />
                        ) : null}
                      </div>
                      <Typography.Paragraph style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{comment.content}</Typography.Paragraph>
                      {(comment.replies ?? []).map((reply) => (
                        <div key={reply.id} style={{ display: 'flex', gap: 8, marginTop: 10, paddingLeft: 12, borderLeft: '2px solid var(--semi-color-border)' }}>
                          <Avatar size="extra-small" src={reply.userAvatar || undefined}>{reply.userName?.slice(0, 1) || '用'}</Avatar>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <Typography.Text strong>{reply.userName || `用户 ${reply.userId}`}</Typography.Text>
                              <Typography.Text type="tertiary" size="small">{formatDateTime(reply.createdAt)}</Typography.Text>
                              {reply.resolvedAt ? <Tag color="green" size="small">已解决</Tag> : null}
                              <div style={{ flex: 1 }} />
                              {reply.canResolve ? <Button theme="borderless" size="small" onClick={() => void toggleResolve(reply.id, !reply.resolvedAt)}>{reply.resolvedAt ? '重开' : '解决'}</Button> : null}
                              {reply.canDelete ? <Button theme="borderless" type="danger" size="small" onClick={() => void deleteComment(reply.id)}>删除</Button> : null}
                            </div>
                            <Typography.Paragraph style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{reply.content}</Typography.Paragraph>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </Space>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
              <Button disabled={commentPage <= 1} onClick={() => setCommentPage((page) => Math.max(1, page - 1))}>上一页</Button>
              <Typography.Text type="tertiary">第 {commentPage} 页 / 共 {Math.max(1, Math.ceil((commentsQuery.data?.total ?? 0) / (commentsQuery.data?.pageSize ?? 20)))} 页</Typography.Text>
              <Button disabled={commentPage >= Math.max(1, Math.ceil((commentsQuery.data?.total ?? 0) / (commentsQuery.data?.pageSize ?? 20)))} onClick={() => setCommentPage((page) => page + 1)}>下一页</Button>
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--semi-color-border)', padding: 16 }}>
            {replyTo ? (
              <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography.Text type="tertiary">正在回复评论 #{replyTo.id}</Typography.Text>
                <Button theme="borderless" size="small" onClick={() => setReplyTo(null)}>取消回复</Button>
              </div>
            ) : null}
            <TextArea
              value={commentText}
              onChange={setCommentText}
              placeholder={commentWidgetId ? '写下该组件的评论...' : '写下评论...'}
              autosize={{ minRows: 3, maxRows: 5 }}
              maxCount={1000}
              showClear
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <Button type="primary" icon={<Send size={14} />} loading={createCommentMutation.isPending} onClick={() => void submitComment()}>发表</Button>
            </div>
          </div>
        </div>
      </SideSheet>
    </div>
  );
}
