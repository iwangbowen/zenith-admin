import { useEffect, useRef, useState } from 'react';
import RGL, { WidthProvider, type Layout } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import '../report-grid.css';
import '../report-screen.css';
import { WidgetRenderer } from './WidgetRenderer';
import type {
  ReportWidget, ReportGridItem, ReportCanvasItem, ReportDashboardConfig, ReportDataResult, ReportScreenConfig,
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
  onCategoryClick?: (w: ReportWidget, value: string) => void;
}

/** 组件卡片外壳 + 渲染器 */
function WidgetFrame({
  widget, state, filterValues, onCategoryClick,
}: {
  readonly widget: ReportWidget;
  readonly state: WidgetState;
  readonly filterValues: Record<string, unknown>;
  readonly onCategoryClick?: (w: ReportWidget, value: string) => void;
}) {
  const showHeader = widget.style?.showHeader !== false;
  const clickable = !!(widget.interaction?.enabled || widget.drilldown?.enabled);
  return (
    <div className="report-widget-card" style={widget.style?.background ? { background: widget.style.background } : undefined}>
      {showHeader && (
        <div className="report-widget-card__header">
          <span className="report-widget-card__title">{widget.title || '未命名组件'}</span>
        </div>
      )}
      <div className="report-widget-card__body">
        <WidgetRenderer
          widget={widget} data={state.data} loading={state.loading} error={state.error} filterValues={filterValues}
          onCategoryClick={clickable && onCategoryClick ? (v) => onCategoryClick(widget, v) : undefined}
        />
      </div>
    </div>
  );
}

/** 栅格模式（响应式 12 列只读）*/
function GridStage({ widgets, layout, filterValues, getWidgetState, onCategoryClick }: Readonly<Omit<ScreenCanvasProps, 'canvasLayout' | 'config'>>) {
  return (
    <GridLayout className="report-grid" layout={layout as Layout} cols={12} rowHeight={40} margin={[12, 12]} isDraggable={false} isResizable={false} compactType="vertical">
      {widgets.map((w) => (
        <div key={w.i}>
          <WidgetFrame widget={w} state={getWidgetState(w)} filterValues={filterValues} onCategoryClick={onCategoryClick} />
        </div>
      ))}
    </GridLayout>
  );
}

/** 自由画布大屏模式（固定设计尺寸 + 等比缩放居中）*/
function CanvasStage({ widgets, canvasLayout, config, filterValues, getWidgetState, onCategoryClick }: Readonly<Omit<ScreenCanvasProps, 'layout'>>) {
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
              <WidgetFrame widget={w} state={getWidgetState(w)} filterValues={filterValues} onCategoryClick={onCategoryClick} />
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
 */
export function ScreenCanvas(props: Readonly<ScreenCanvasProps>) {
  const { config } = props;
  const isCanvas = config.layoutMode === 'canvas';
  const isDark = config.theme === 'dark';
  return (
    <div className={`report-screen${isDark ? ' report-screen--dark' : ''}`} style={{ width: '100%', height: '100%' }}>
      {isCanvas
        ? <CanvasStage {...props} />
        : <GridStage widgets={props.widgets} layout={props.layout} filterValues={props.filterValues} getWidgetState={props.getWidgetState} onCategoryClick={props.onCategoryClick} />}
    </div>
  );
}

export default ScreenCanvas;
