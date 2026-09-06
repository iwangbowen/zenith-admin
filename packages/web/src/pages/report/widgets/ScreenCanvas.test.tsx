import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReportDashboardConfig, ReportGridItem, ReportWidget } from '@zenith/shared/report';
import { ScreenCanvas } from './ScreenCanvas';

vi.mock('react-grid-layout/legacy', () => {
  const Grid = ({ className, children }: { className?: string; children?: React.ReactNode }) => (
    <div className={className}>{children}</div>
  );
  return { default: Grid, WidthProvider: (Component: typeof Grid) => Component };
});

const rendererRenders = vi.hoisted(() => ({ byWidget: new Map<string, number>() }));

vi.mock('./WidgetRenderer', () => ({
  WidgetRenderer: ({ widget }: { widget: ReportWidget }) => {
    rendererRenders.byWidget.set(widget.i, (rendererRenders.byWidget.get(widget.i) ?? 0) + 1);
    return (
      <div>
        {widget.options?.text as string}
        <button type="button">内部操作-{widget.i}</button>
      </div>
    );
  },
}));

function installViewport(mobile: boolean) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: mobile ? 375 : 1280 });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === '(max-width: 767px)' ? mobile : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

const widgets: ReportWidget[] = [
  { i: 'late', type: 'text', title: 'Late', options: { text: 'late' } },
  { i: 'right', type: 'text', title: 'Right', options: { text: 'right' } },
  { i: 'left', type: 'text', title: 'Left', options: { text: 'left' } },
];

const layout: ReportGridItem[] = [
  { i: 'late', x: 0, y: 2, w: 12, h: 3 },
  { i: 'right', x: 6, y: 0, w: 6, h: 3 },
  { i: 'left', x: 0, y: 0, w: 6, h: 3 },
];

function renderCanvas(config: ReportDashboardConfig = {}) {
  return render(
    <ScreenCanvas
      widgets={widgets}
      layout={layout}
      canvasLayout={[]}
      config={config}
      filterValues={{}}
      getWidgetState={() => ({ data: null })}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ScreenCanvas responsive reading layout', () => {
  it('uses one column at 375px and orders widgets by original y/x without mutating the saved layout', () => {
    installViewport(true);
    const savedLayout = structuredClone(layout);
    renderCanvas();

    const reading = screen.getByTestId('report-mobile-reading');
    expect(reading.children).toHaveLength(3);
    expect([...reading.children].map((item) => item.getAttribute('data-widget-id')))
      .toEqual(['left', 'right', 'late']);
    expect([...reading.children].every((item) => (item as HTMLElement).style.minHeight !== '')).toBe(true);
    expect(layout).toEqual(savedLayout);
  });

  it('keeps the desktop grid path and original widget render order unchanged', () => {
    installViewport(false);
    const { container } = renderCanvas();

    expect(screen.queryByTestId('report-mobile-reading')).toBeNull();
    expect(container.querySelector('.report-grid')).not.toBeNull();
    expect([...container.querySelectorAll('.report-widget-card__title')].map((node) => node.textContent))
      .toEqual(['Late', 'Right', 'Left']);
  });

  it('keeps canvas content readable and shows a concise landscape recommendation on mobile', () => {
    installViewport(true);
    renderCanvas({ layoutMode: 'canvas' });

    expect(screen.getByRole('note').textContent).toContain('横屏');
    expect(screen.getByTestId('report-mobile-reading').children).toHaveLength(3);
  });

  it('only triggers the widget action from the header, not interactive body controls', () => {
    installViewport(false);
    const onWidgetClick = vi.fn();
    render(
      <ScreenCanvas
        widgets={widgets}
        layout={layout}
        canvasLayout={[]}
        config={{}}
        filterValues={{}}
        getWidgetState={() => ({ data: null })}
        onWidgetClick={onWidgetClick}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '内部操作-late' }));
    expect(onWidgetClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Late' }));
    expect(onWidgetClick).toHaveBeenCalledWith(widgets[0]);
  });
});

describe('ScreenCanvas widget frame memoization', () => {
  const dataA = { columns: ['v'], fields: [], rows: [{ v: 1 }], total: 1 };
  const dataB = { columns: ['v'], fields: [], rows: [{ v: 2 }], total: 1 };
  // 与页面一致：筛选值是 state，引用稳定；内联的 {} 会让所有卡片每次都重跑
  const stableFilterValues = {};

  function Harness({ lateData, onWidgetClick }: { readonly lateData: typeof dataA; readonly onWidgetClick: (w: ReportWidget) => void }) {
    // 与真实调用方一致：getter 与回调都是渲染期新建的内联函数
    return (
      <ScreenCanvas
        widgets={widgets}
        layout={layout}
        canvasLayout={[]}
        config={{}}
        filterValues={stableFilterValues}
        getWidgetState={(w) => ({ data: w.i === 'late' ? lateData : null, loading: false, error: null })}
        getWidgetQuery={() => undefined}
        onCategoryClick={() => undefined}
        onWidgetClick={onWidgetClick}
      />
    );
  }

  it('re-renders only the widget whose data changed, even though the parent passes fresh inline callbacks every render', () => {
    installViewport(false);
    rendererRenders.byWidget.clear();
    const first = vi.fn();
    const { rerender } = render(<Harness lateData={dataA} onWidgetClick={first} />);
    expect([...rendererRenders.byWidget.values()]).toEqual([1, 1, 1]);

    // 父级重渲染、回调换了新引用、数据未变：三个组件都不重跑
    rerender(<Harness lateData={dataA} onWidgetClick={vi.fn()} />);
    expect([...rendererRenders.byWidget.values()]).toEqual([1, 1, 1]);

    // 只有一个组件的数据变化：只有它重跑
    const latest = vi.fn();
    rerender(<Harness lateData={dataB} onWidgetClick={latest} />);
    expect(rendererRenders.byWidget.get('late')).toBe(2);
    expect(rendererRenders.byWidget.get('right')).toBe(1);
    expect(rendererRenders.byWidget.get('left')).toBe(1);

    // 稳定包装始终调用最近一次传入的回调，而不是首次渲染时的那个
    fireEvent.click(screen.getByRole('button', { name: 'Left' }));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith(widgets[2]);
  });
});
