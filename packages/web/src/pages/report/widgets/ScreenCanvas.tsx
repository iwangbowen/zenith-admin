import { useEffect, useRef, useState } from 'react';
import RGL, { WidthProvider, type Layout } from 'react-grid-layout/legacy';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import '../report-grid.css';
import '../report-screen.css';
import { WidgetRenderer } from './WidgetRenderer';
import type {
  ReportWidget, ReportGridItem, ReportCanvasItem, ReportDashboardConfig, ReportDataResult, ReportDatasetQueryOptions, ReportScreenConfig,
} from '@zenith/shared';

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

/** 组件卡片外壳 + 渲染器 */
function WidgetFrame({
  widget, state, filterValues, getWidgetQuery, onWidgetQueryChange, onCategoryClick, onWidgetClick,
}: {
  readonly widget: ReportWidget;
  readonly state: WidgetState;
  readonly filterValues: Record<string, unknown>;
  readonly getWidgetQuery?: (w: ReportWidget) => ReportDatasetQueryOptions | undefined;
  readonly onWidgetQueryChange?: (widgetId: string, next: ReportDatasetQueryOptions) => void;
  readonly onCategoryClick?: (w: ReportWidget, value: string) => void;
  readonly onWidgetClick?: (widget: ReportWidget) => void;
}) {
  const showHeader = widget.style?.showHeader !== false;
  const clickable = !!(widget.interaction?.enabled || widget.drilldown?.enabled);
  return (
    <div className="report-widget-card" style={widget.style?.background ? { background: widget.style.background } : undefined} onClick={() => onWidgetClick?.(widget)}>
      {showHeader && (
        <div className="report-widget-card__header">
          <span className="report-widget-card__title">{widget.title || '未命名组件'}</span>
        </div>
      )}
      <div className="report-widget-card__body">
        <WidgetRenderer
          widget={widget} data={state.data} loading={state.loading} error={state.error} filterValues={filterValues}
          widgetQuery={getWidgetQuery?.(widget)}
          onWidgetQueryChange={onWidgetQueryChange}
          onCategoryClick={clickable && onCategoryClick ? (v) => onCategoryClick(widget, v) : undefined}
        />
      </div>
    </div>
  );
}

/** 栅格模式（响应式 12 列只读）*/
function GridStage({ widgets, layout, filterValues, getWidgetState, getWidgetQuery, onWidgetQueryChange, onCategoryClick, onWidgetClick }: Readonly<Omit<ScreenCanvasProps, 'canvasLayout' | 'config'>>) {
  return (
    <GridLayout className="report-grid" layout={layout as Layout} cols={12} rowHeight={40} margin={[12, 12]} isDraggable={false} isResizable={false} compactType="vertical">
      {widgets.map((w) => (
        <div key={w.i}>
          <WidgetFrame widget={w} state={getWidgetState(w)} filterValues={filterValues} getWidgetQuery={getWidgetQuery} onWidgetQueryChange={onWidgetQueryChange} onCategoryClick={onCategoryClick} onWidgetClick={onWidgetClick} />
        </div>
      ))}
    </GridLayout>
  );
}

/** 自由画布大屏模式（固定设计尺寸 + 等比缩放居中）*/
function CanvasStage({ widgets, canvasLayout, config, filterValues, getWidgetState, getWidgetQuery, onWidgetQueryChange, onCategoryClick, onWidgetClick }: Readonly<Omit<ScreenCanvasProps, 'layout'>>) {
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
              <WidgetFrame widget={w} state={getWidgetState(w)} filterValues={filterValues} getWidgetQuery={getWidgetQuery} onWidgetQueryChange={onWidgetQueryChange} onCategoryClick={onCategoryClick} onWidgetClick={onWidgetClick} />
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

  const carousel = config.carousel;
  const pageCount = Math.max(1, carousel?.enabled ? (carousel.pageCount ?? 1) : 1);
  const carouselOn = pageCount > 1;
  const [page, setPage] = useState(1);

  // 页数变化时夹紧当前页
  useEffect(() => { setPage((p) => Math.min(Math.max(1, p), pageCount)); }, [pageCount]);

  // 自动切换
  const intervalSec = carousel?.intervalSec ?? 0;
  useEffect(() => {
    if (!carouselOn || intervalSec <= 0) return;
    const t = setInterval(() => setPage((p) => (p % pageCount) + 1), intervalSec * 1000);
    return () => clearInterval(t);
  }, [carouselOn, intervalSec, pageCount]);

  const widgets = carouselOn ? props.widgets.filter((w) => (w.page ?? 1) === page) : props.widgets;
  const visibleIds = new Set(widgets.map((w) => w.i));
  const layout = carouselOn ? props.layout.filter((l) => visibleIds.has(l.i)) : props.layout;

  return (
    <div className={`report-screen${isDark ? ' report-screen--dark' : ''}`} style={{ width: '100%', height: '100%', position: 'relative' }}>
      {isCanvas
        ? <CanvasStage {...props} widgets={widgets} />
        : (
          <GridStage
            widgets={widgets}
            layout={layout}
            filterValues={props.filterValues}
            getWidgetState={props.getWidgetState}
            getWidgetQuery={props.getWidgetQuery}
            onWidgetQueryChange={props.onWidgetQueryChange}
            onCategoryClick={props.onCategoryClick}
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
