import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RGL, { WidthProvider, type Layout } from 'react-grid-layout/legacy';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import '../report-grid.css';
import '../report-screen.css';
import { WidgetRenderer } from './WidgetRenderer';
import { useIsMobile, useMediaQuery } from '@/hooks/useMediaQuery';
import { useEventCallback } from '@/hooks/useEventCallback';
import type { ReportWidget, ReportGridItem, ReportCanvasItem, ReportDashboardConfig, ReportDataResult, ReportDatasetQueryOptions, ReportScreenConfig } from '@zenith/shared/report';

const GridLayout = WidthProvider(RGL);

const DEFAULT_SCREEN: ReportScreenConfig = { width: 1920, height: 1080, scaleMode: 'fit' };

export interface WidgetState { data: ReportDataResult | null; loading?: boolean; error?: string | null }

interface ScreenCanvasProps {
  widgets: ReportWidget[];
  layout: ReportGridItem[];
  canvasLayout: ReportCanvasItem[];
  config: ReportDashboardConfig;
  filterValues: Record<string, unknown>;
  getWidgetState: (w: ReportWidget) => WidgetState;
  getWidgetQuery?: (w: ReportWidget) => ReportDatasetQueryOptions | undefined;
  onWidgetQueryChange?: (widgetId: string, next: ReportDatasetQueryOptions) => void;
  onCategoryClick?: (w: ReportWidget, value: string) => void;
  onWidgetClick?: (widget: ReportWidget) => void;
}

interface WidgetFrameProps {
  readonly widget: ReportWidget;
  readonly data: ReportDataResult | null;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly filterValues: Record<string, unknown>;
  readonly widgetQuery?: ReportDatasetQueryOptions;
  readonly onWidgetQueryChange?: (widgetId: string, next: ReportDatasetQueryOptions) => void;
  readonly onCategoryClick?: (w: ReportWidget, value: string) => void;
  readonly onWidgetClick?: (widget: ReportWidget) => void;
}

/**
 * 组件卡片外壳 + 渲染器。memo：轮播计时、视口缩放、轮询刷新等让整个舞台重渲染时，
 * 数据与配置未变的组件整棵跳过；props 只接收值（data / loading / error / widgetQuery）与
 * 引用稳定的回调，不接收父级每次渲染新建的 getter。
 */
const WidgetFrame = memo(function WidgetFrame({
  widget, data, loading, error, filterValues, widgetQuery, onWidgetQueryChange, onCategoryClick, onWidgetClick,
}: WidgetFrameProps) {
  const showHeader = widget.style?.showHeader !== false;
  const clickable = !!(widget.interaction?.enabled || widget.drilldown?.enabled);
  const handleWidgetClick = useCallback(() => onWidgetClick?.(widget), [onWidgetClick, widget]);
  // 每个组件自己的维度点击回调只随组件 / 外部回调变化，WidgetRenderer 的 spec 记忆化才不会被内联函数击穿
  const handleCategoryClick = useMemo(
    () => (clickable && onCategoryClick ? (value: string) => onCategoryClick(widget, value) : undefined),
    [clickable, onCategoryClick, widget],
  );
  return (
    <div
      className="report-widget-card"
      style={widget.style?.background ? { background: widget.style.background } : undefined}
    >
      {showHeader && (
        <div
          className="report-widget-card__header"
          onClick={onWidgetClick ? handleWidgetClick : undefined}
          onKeyDown={onWidgetClick ? (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              handleWidgetClick();
            }
          } : undefined}
          role={onWidgetClick ? 'button' : undefined}
          tabIndex={onWidgetClick ? 0 : undefined}
        >
          <span className="report-widget-card__title">{widget.title || '未命名组件'}</span>
        </div>
      )}
      <div className="report-widget-card__body">
        <WidgetRenderer
          widget={widget} data={data} loading={loading} error={error} filterValues={filterValues}
          widgetQuery={widgetQuery}
          onWidgetQueryChange={onWidgetQueryChange}
          onCategoryClick={handleCategoryClick}
        />
      </div>
    </div>
  );
});

/** 把 getter 形态的 props 在舞台层展开成值，交给 memo 化的 WidgetFrame */
function frameProps(w: ReportWidget, props: Pick<ScreenCanvasProps, 'filterValues' | 'getWidgetState' | 'getWidgetQuery' | 'onWidgetQueryChange' | 'onCategoryClick' | 'onWidgetClick'>) {
  const state = props.getWidgetState(w);
  return {
    widget: w,
    data: state.data,
    loading: state.loading,
    error: state.error,
    filterValues: props.filterValues,
    widgetQuery: props.getWidgetQuery?.(w),
    onWidgetQueryChange: props.onWidgetQueryChange,
    onCategoryClick: props.onCategoryClick,
    onWidgetClick: props.onWidgetClick,
  };
}

/** 栅格模式（响应式 12 列只读）*/
function GridStage({ widgets, layout, ...rest }: Readonly<Omit<ScreenCanvasProps, 'canvasLayout' | 'config'>>) {
  return (
    <GridLayout className="report-grid" layout={layout as Layout} cols={12} rowHeight={40} margin={[12, 12]} isDraggable={false} isResizable={false} compactType="vertical">
      {widgets.map((w) => (
        <div key={w.i}>
          <WidgetFrame {...frameProps(w, rest)} />
        </div>
      ))}
    </GridLayout>
  );
}

const MOBILE_WIDGET_MIN_HEIGHT: Partial<Record<ReportWidget['type'], number>> = {
  kpi: 180,
  flipper: 180,
  text: 160,
  image: 220,
  gauge: 240,
  liquid: 240,
  table: 360,
  pivot: 360,
  iframe: 420,
  scrollList: 300,
};

function mobileWidgetHeight(
  widget: ReportWidget,
  gridItem?: ReportGridItem,
  canvasItem?: ReportCanvasItem,
): number {
  const minimum = MOBILE_WIDGET_MIN_HEIGHT[widget.type] ?? 280;
  const designedHeight = canvasItem?.h ?? (gridItem ? gridItem.h * 40 + Math.max(0, gridItem.h - 1) * 12 : minimum);
  return Math.min(480, Math.max(minimum, designedHeight));
}

function MobileReadingStage({
  widgets,
  layout,
  canvasLayout,
  config,
  ...rest
}: Readonly<ScreenCanvasProps>) {
  const widgetOrder = new Map(widgets.map((widget, index) => [widget.i, index]));
  const gridPositions = new Map(layout.map((item) => [item.i, item]));
  const canvasPositions = new Map(canvasLayout.map((item) => [item.i, item]));
  const isCanvas = config.layoutMode === 'canvas';
  const sortedWidgets = [...widgets].sort((left, right) => {
    const leftPosition = isCanvas ? canvasPositions.get(left.i) : gridPositions.get(left.i);
    const rightPosition = isCanvas ? canvasPositions.get(right.i) : gridPositions.get(right.i);
    const leftY = leftPosition?.y ?? Number.MAX_SAFE_INTEGER;
    const rightY = rightPosition?.y ?? Number.MAX_SAFE_INTEGER;
    if (leftY !== rightY) return leftY - rightY;
    const leftX = leftPosition?.x ?? Number.MAX_SAFE_INTEGER;
    const rightX = rightPosition?.x ?? Number.MAX_SAFE_INTEGER;
    if (leftX !== rightX) return leftX - rightX;
    return (widgetOrder.get(left.i) ?? 0) - (widgetOrder.get(right.i) ?? 0);
  });

  return (
    <>
      {isCanvas ? (
        <div className="report-mobile-landscape-hint" role="note">
          大屏已转为纵向阅读，横屏可获得更佳效果
        </div>
      ) : null}
      <div className="report-mobile-reading" data-testid="report-mobile-reading">
        {sortedWidgets.map((widget) => {
          const height = mobileWidgetHeight(
            widget,
            gridPositions.get(widget.i),
            canvasPositions.get(widget.i),
          );
          return (
            <section
              key={widget.i}
              className="report-mobile-reading__item"
              data-widget-id={widget.i}
              style={{ height, minHeight: height }}
            >
              <WidgetFrame {...frameProps(widget, rest)} />
            </section>
          );
        })}
      </div>
    </>
  );
}

/** 自由画布大屏模式（固定设计尺寸 + 等比缩放居中）*/
function CanvasStage({ widgets, canvasLayout, config, ...rest }: Readonly<Omit<ScreenCanvasProps, 'layout'>>) {
  const sc = { ...DEFAULT_SCREEN, ...(config.screenConfig ?? {}) };
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [transform, setTransform] = useState<{ sx: number; sy: number; ox: number; oy: number }>({ sx: 1, sy: 1, ox: 0, oy: 0 });

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const recompute = () => {
      const cw = el.clientWidth, ch = el.clientHeight;
      const dw = sc.width || 1920, dh = sc.height || 1080;
      let sx: number, sy: number;
      if (sc.scaleMode === 'full') { sx = cw / dw; sy = ch / dh; }
      else if (sc.scaleMode === 'width') { sx = sy = cw / dw; }
      else { sx = sy = Math.min(cw / dw, ch / dh); } // fit
      const ox = Math.max(0, (cw - dw * sx) / 2);
      const oy = Math.max(0, (ch - dh * sy) / 2);
      setTransform({ sx, sy, ox, oy });
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sc.width, sc.height, sc.scaleMode]);

  const items = canvasLayout ?? [];
  return (
    <div ref={viewportRef} className="report-screen-viewport" style={sc.background && config.theme !== 'dark' ? { background: sc.background } : undefined}>
      <div
        className="report-screen-stage"
        style={{
          width: sc.width || 1920,
          height: sc.height || 1080,
          transform: `translate(${transform.ox}px, ${transform.oy}px) scale(${transform.sx}, ${transform.sy})`,
          background: sc.backgroundImage ? `center/cover no-repeat url(${sc.backgroundImage})` : (config.theme === 'dark' ? undefined : sc.background),
        }}
      >
        {widgets.map((w) => {
          const it = items.find((c) => c.i === w.i);
          if (!it) return null;
          return (
            <div key={w.i} className="report-canvas-item" style={{ left: it.x, top: it.y, width: it.w, height: it.h, zIndex: it.z ?? 1 }}>
              <WidgetFrame {...frameProps(w, rest)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 大屏/仪表盘只读渲染器 —— 供预览、公开页、嵌入组件统一复用。
 * 按 config.layoutMode 选择「栅格」或「自由画布大屏」渲染。
 * 启用多屏轮播（config.carousel）时，按 widget.page 分页 + 自动/手动切换。
 */
export function ScreenCanvas(props: Readonly<ScreenCanvasProps>) {
  const { config } = props;
  const isCanvas = config.layoutMode === 'canvas';
  const isDark = config.theme === 'dark';
  const isMobile = useIsMobile();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  // 调用方通常以内联函数传回调；这里统一换成引用稳定的包装，避免舞台每次重渲染都击穿所有 WidgetFrame 的 memo。
  // 是否存在回调仍以原 props 判定（决定卡片标题是否可点、维度是否可交互）。
  const stableCategoryClick = useEventCallback((w: ReportWidget, value: string) => props.onCategoryClick?.(w, value));
  const stableWidgetClick = useEventCallback((w: ReportWidget) => props.onWidgetClick?.(w));
  const stableWidgetQueryChange = useEventCallback((widgetId: string, next: ReportDatasetQueryOptions) => props.onWidgetQueryChange?.(widgetId, next));
  const stageProps: ScreenCanvasProps = {
    ...props,
    onCategoryClick: props.onCategoryClick ? stableCategoryClick : undefined,
    onWidgetClick: props.onWidgetClick ? stableWidgetClick : undefined,
    onWidgetQueryChange: props.onWidgetQueryChange ? stableWidgetQueryChange : undefined,
  };

  const carousel = config.carousel;
  const pageCount = Math.max(1, carousel?.enabled ? (carousel.pageCount ?? 1) : 1);
  const carouselOn = pageCount > 1;
  const [page, setPage] = useState(1);

  // 页数变化时夹紧当前页
  useEffect(() => { setPage((p) => Math.min(Math.max(1, p), pageCount)); }, [pageCount]);

  // 自动切换
  const intervalSec = carousel?.intervalSec ?? 0;
  useEffect(() => {
    if (!carouselOn || intervalSec <= 0 || reduceMotion) return;
    const t = setInterval(() => setPage((p) => (p % pageCount) + 1), intervalSec * 1000);
    return () => clearInterval(t);
  }, [carouselOn, intervalSec, pageCount, reduceMotion]);

  const widgets = carouselOn ? props.widgets.filter((w) => (w.page ?? 1) === page) : props.widgets;
  const visibleIds = new Set(widgets.map((w) => w.i));
  const layout = carouselOn ? props.layout.filter((l) => visibleIds.has(l.i)) : props.layout;

  return (
    <div
      className={`report-screen${isDark ? ' report-screen--dark' : ''}${isMobile ? ' report-screen--mobile' : ''}`}
      style={{ width: '100%', height: isMobile ? 'auto' : '100%', minHeight: isMobile ? '100%' : undefined, position: 'relative' }}
    >
      {isMobile
        ? <MobileReadingStage {...stageProps} widgets={widgets} layout={layout} />
        : isCanvas
        ? <CanvasStage {...stageProps} widgets={widgets} />
        : (
          <GridStage
            widgets={widgets}
            layout={layout}
            filterValues={stageProps.filterValues}
            getWidgetState={stageProps.getWidgetState}
            getWidgetQuery={stageProps.getWidgetQuery}
            onWidgetQueryChange={stageProps.onWidgetQueryChange}
            onCategoryClick={stageProps.onCategoryClick}
            onWidgetClick={stageProps.onWidgetClick}
          />
        )}
      {carouselOn && (
        <CarouselControls
          page={page}
          pageCount={pageCount}
          showDots={carousel?.showDots !== false}
          onJump={(p) => setPage(p)}
          onPrev={() => setPage((p) => (p - 2 + pageCount) % pageCount + 1)}
          onNext={() => setPage((p) => (p % pageCount) + 1)}
        />
      )}
    </div>
  );
}

/** 多屏轮播控制条：上一页/下一页 + 页码指示点 */
function CarouselControls({
  page, pageCount, showDots, onJump, onPrev, onNext,
}: {
  readonly page: number;
  readonly pageCount: number;
  readonly showDots: boolean;
  readonly onJump: (p: number) => void;
  readonly onPrev: () => void;
  readonly onNext: () => void;
}) {
  return (
    <div className="report-carousel-ctrl">
      <button type="button" className="report-carousel-ctrl__arrow" onClick={onPrev} aria-label="上一页"><ChevronLeft size={18} /></button>
      {showDots ? (
        <div className="report-carousel-ctrl__dots">
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              type="button"
              className={`report-carousel-ctrl__dot${p === page ? ' is-active' : ''}`}
              onClick={() => onJump(p)}
              aria-label={`第 ${p} 页`}
            />
          ))}
        </div>
      ) : (
        <span className="report-carousel-ctrl__label">{page} / {pageCount}</span>
      )}
      <button type="button" className="report-carousel-ctrl__arrow" onClick={onNext} aria-label="下一页"><ChevronRight size={18} /></button>
    </div>
  );
}

export default ScreenCanvas;
