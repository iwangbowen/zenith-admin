import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';

type Side = 'left' | 'right';

interface MasterDetailLayoutProps {
  readonly master: ReactNode;
  detail: ReactNode;
  /** 主侧位置，默认 'left' */
  side?: Side;
  /** 主侧默认宽（px） */
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  /** 是否可拖拽调整宽度，默认 true */
  resizable?: boolean;
  /** 设置后宽度持久化到 localStorage，key 为 `mdLayout.${persistKey}` */
  persistKey?: string;
  /** 两栏间距 px，默认 0 */
  gap?: number;
  /** 两侧各自加 1px 边框 + 圆角，默认 false */
  bordered?: boolean;
  /** 是否显示分隔线/分隔条，默认 true */
  divider?: boolean;
  /** 受控折叠状态：为 true 时主侧隐藏 */
  collapsed?: boolean;
  /** 折叠状态变化回调，提供后分隔线上会显示折叠/展开图标按钮 */
  onCollapseChange?: (collapsed: boolean) => void;
  /**
   * 启用内置折叠功能，分隔线上展示折叠按鈕。
   * 无需外部传入 collapsed/onCollapseChange，组件自管内部状态。
   */
  collapsible?: boolean;
  /**
   * 容器宽度小于此值时切换到单栏模式（移动端样式），默认 560。
   * 传 0 或 undefined 可禁用响应式，传极大值（如 99999）可强制单栏。
   */
  responsiveBreakpoint?: number;
  /**
   * 响应式单栏模式下是否显示 detail 侧（优先级高于 responsiveActive）。
   * 通常与 onBack 配合：有选中项时传 true，onBack 重置选中项。
   */
  showDetail?: boolean;
  /**
   * 响应式返回回调：提供后，在响应式 detail 模式下自动显示返回按钮。
   * 点击时调用此回调，组件本身不管理状态。
   */
  onBack?: () => void;
  /**
   * 建议改用 showDetail。单栏模式下当前激活的面板（'master' | 'detail'），默认 'master'。
   */
  responsiveActive?: 'master' | 'detail';
  /**
   * 容器进入/退出响应式单栏模式时触发，参数为 isResponsive。
   * 可用于父组件按需显示/隐藏与布局状态绑定的 UI。
   */
  onResponsiveChange?: (isResponsive: boolean) => void;
  className?: string;
  style?: CSSProperties;
}

const STORAGE_PREFIX = 'mdLayout.';

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

function readPersisted(key: string | undefined): number | null {
  if (!key) return null;
  try {
    const v = localStorage.getItem(STORAGE_PREFIX + key);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writePersisted(key: string | undefined, value: number) {
  if (!key) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + key, String(value));
  } catch {
    /* ignore */
  }
}

function MasterDetailLayoutImpl(props: Readonly<MasterDetailLayoutProps>) {
  const {
    master,
    detail,
    side = 'left',
    defaultSize = 260,
    minSize = 180,
    maxSize = 600,
    resizable = true,
    persistKey,
    gap = 0,
    bordered = false,
    divider = true,
    collapsed: collapsedProp,
    onCollapseChange,
    collapsible = true,
    responsiveBreakpoint = 560,
    showDetail,
    onBack,
    responsiveActive,
    className,
    style,
  } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<number>(() => {
    const persisted = readPersisted(persistKey);
    return clamp(persisted ?? defaultSize, minSize, maxSize);
  });
  const [containerWidth, setContainerWidth] = useState<number>(0);
  // 内部折叠状态（collapsible 模式下使用）
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  // 最终折叠状态：collapsedProp 优先（受控），否则用内部状态
  const collapsed = collapsedProp ?? internalCollapsed;
  // 切换折叠状态
  const handleCollapseToggle = useCallback((next: boolean) => {
    if (onCollapseChange) {
      onCollapseChange(next);
    } else {
      setInternalCollapsed(next);
    }
  }, [onCollapseChange]);
  const showCollapseToggle = (collapsible || !!onCollapseChange) && divider;

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ob = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(Math.floor(entry.contentRect.width));
    });
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, size: 0 });

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!resizable) return;
      e.preventDefault();
      draggingRef.current = true;
      dragStartRef.current = { x: e.clientX, size };
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [resizable, size],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const dx = e.clientX - dragStartRef.current.x;
      const delta = side === 'left' ? dx : -dx;
      const next = clamp(dragStartRef.current.size + delta, minSize, maxSize);
      setSize(next);
    },
    [side, minSize, maxSize],
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      writePersisted(persistKey, size);
    },
    [persistKey, size],
  );

  // 持久化（拖拽中持续更新的版本，PointerUp 也会写一次，确保非拖拽来源变化也保存）
  useEffect(() => {
    if (!persistKey) return;
    writePersisted(persistKey, size);
  }, [persistKey, size]);

  const isResponsive =
    responsiveBreakpoint > 0 && containerWidth > 0 && containerWidth < responsiveBreakpoint;

  const { onResponsiveChange } = props;
  const prevIsResponsiveRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (containerWidth === 0) return; // 初始化未完成，跳过
    if (prevIsResponsiveRef.current === isResponsive) return;
    prevIsResponsiveRef.current = isResponsive;
    onResponsiveChange?.(isResponsive);
  }, [isResponsive, containerWidth, onResponsiveChange]);

  const rootStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'row',
    height: '100%',
    width: '100%',
    overflow: 'hidden',
    gap: gap > 0 ? gap : undefined,
    ...style,
  };

  const masterBaseStyle: CSSProperties = {
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    overflow: 'hidden',
    boxSizing: 'border-box',
    ...(bordered
      ? {
          border: '1px solid var(--semi-color-border)',
          borderRadius: 6,
          background: 'var(--semi-color-bg-1)',
        }
      : null),
  };

  const detailBaseStyle: CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    overflow: 'hidden',
    boxSizing: 'border-box',
    ...(bordered
      ? {
          border: '1px solid var(--semi-color-border)',
          borderRadius: 6,
          background: 'var(--semi-color-bg-1)',
        }
      : null),
  };

  // 响应式：单栏模式
  if (isResponsive) {
    // showDetail 优先；否则降级到旧的 responsiveActive
    const detailVisible = showDetail ?? (responsiveActive === 'detail');
    return (
      <div ref={rootRef} className={className} style={rootStyle}>
        <div style={{ ...masterBaseStyle, width: '100%', display: detailVisible ? 'none' : 'flex' }}>
          {master}
        </div>
        <div style={{ ...detailBaseStyle, display: detailVisible ? 'flex' : 'none' }}>
          {detailVisible && onBack && (
            <button
              type="button"
              onClick={onBack}
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 12px',
                borderBottom: '1px solid var(--semi-color-border)',
                background: 'transparent',
                border: 0,
                borderBottomColor: 'var(--semi-color-border)',
                borderBottomStyle: 'solid',
                borderBottomWidth: 1,
                cursor: 'pointer',
                color: 'var(--semi-color-text-2)',
                fontSize: 13,
                minHeight: 40,
                boxSizing: 'border-box',
                width: '100%',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              返回
            </button>
          )}
          {detail}
        </div>
      </div>
    );
  }

  // divider 样式（无 resize 时画一条 1px 边线；resize 时用一个可拖拽的把手）
  const showDivider = divider && !collapsed;
  const showResizeHandle = resizable && !collapsed && !bordered;
  // chevron 方向：side=left 展开时朝左（点击收起），collapsed 时朝右（点击展开）；side=right 相反
  const showLeftChevron = side === 'left' ? !collapsed : collapsed;
  const collapseToggleBtn = showCollapseToggle ? (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); handleCollapseToggle(!collapsed); }}
      onPointerDown={(e) => e.stopPropagation()}
      title={collapsed ? '展开左侧面板' : '收起左侧面板'}
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 20,
        height: 20,
        borderRadius: '50%',
        border: '1px solid transparent',
        background: 'transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        zIndex: 10,
        color: 'var(--semi-color-primary)',
        transition: 'background 0.15s, color 0.15s, border-color 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--semi-color-primary-hover)';
        e.currentTarget.style.borderColor = 'transparent';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--semi-color-primary)';
        e.currentTarget.style.borderColor = 'transparent';
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {showLeftChevron
          ? <polyline points="15 18 9 12 15 6" />
          : <polyline points="9 18 15 12 9 6" />}
      </svg>
    </button>
  ) : null;
  const dividerBorderProp = side === 'left' ? 'borderRight' : 'borderLeft';

  const masterStyle: CSSProperties = {
    ...masterBaseStyle,
    width: collapsed ? 0 : size,
    display: collapsed ? 'none' : 'flex',
    ...(showDivider && !showResizeHandle && !bordered ? { [dividerBorderProp]: '1px solid var(--semi-color-border)' } : null),
  };

  const handleEl = (() => {
    if (showResizeHandle && showDivider) {
      return (
        <div
          aria-orientation="vertical"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{
            flex: '0 0 auto',
            width: 5,
            cursor: 'col-resize',
            background: 'transparent',
            position: 'relative',
            zIndex: 1,
            touchAction: 'none',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--semi-color-primary-light-default)';
          }}
          onMouseLeave={(e) => {
            if (!draggingRef.current) e.currentTarget.style.background = 'transparent';
          }}
        >
          {/* 中央 1px 视觉分隔线 */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: '50%',
              width: 1,
              background: 'var(--semi-color-border)',
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
            }}
          />
          {collapseToggleBtn}
        </div>
      );
    }
    if (showCollapseToggle && !collapsed && !bordered) {
      // 无拖拽但有折叠按钮时：画一条分隔线
      return (
        <div style={{ flex: '0 0 auto', width: 5, position: 'relative', cursor: 'default' }}>
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: '50%',
              width: 1,
              background: 'var(--semi-color-border)',
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
            }}
          />
          {collapseToggleBtn}
        </div>
      );
    }
    if (showCollapseToggle && collapsed) {
      // 折叠时：显示展开按钮条
      return (
        <div style={{ flex: '0 0 auto', width: 5, position: 'relative', cursor: 'default' }}>
          {collapseToggleBtn}
        </div>
      );
    }
    return null;
  })();

  // bordered 模式仍提供 resize：在两个 bordered 容器之间放把手（无中央线，因为容器各自有边框）
  const handleElBordered = resizable && !collapsed && bordered && showDivider ? (
    <div
      aria-orientation="vertical"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        flex: '0 0 auto',
        width: Math.max(gap, 4),
        marginLeft: gap > 0 ? -gap : 0,
        marginRight: gap > 0 ? -gap : 0,
        cursor: 'col-resize',
        touchAction: 'none',
      }}
    />
  ) : null;

  const masterEl = <div style={masterStyle}>{master}</div>;
  const detailEl = <div style={detailBaseStyle}>{detail}</div>;

  return (
    <div ref={rootRef} className={className} style={rootStyle}>
      {side === 'left' ? (
        <>
          {masterEl}
          {handleEl}
          {handleElBordered}
          {detailEl}
        </>
      ) : (
        <>
          {detailEl}
          {handleEl}
          {handleElBordered}
          {masterEl}
        </>
      )}
    </div>
  );
}

interface HeaderProps {
  readonly children?: ReactNode;
  readonly extra?: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
}

function Header({ children, extra, className, style }: HeaderProps) {
  return (
    <div
      className={className ? `msdl-header ${className}` : 'msdl-header'}
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '8px 12px',
        borderBottom: '1px solid var(--semi-color-border)',
        minHeight: 44,
        boxSizing: 'border-box',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>{children}</div>
      {extra ? <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>{extra}</div> : null}
    </div>
  );
}

interface BodyProps {
  readonly children?: ReactNode;
  /** auto: overflow auto（默认）；hidden: overflow hidden（内部自管滚动）；visible: overflow visible */
  readonly scroll?: 'auto' | 'hidden' | 'visible';
  readonly padding?: number | string;
  readonly className?: string;
  readonly style?: CSSProperties;
}

const SCROLL_MAP = { auto: 'auto', hidden: 'hidden', visible: 'visible' } as const;

function Body({ children, scroll = 'auto', padding, className, style }: BodyProps) {
  const overflow = SCROLL_MAP[scroll];
  return (
    <div
      className={className ? `msdl-body ${className}` : 'msdl-body'}
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        overflow,
        padding,
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export const MasterDetailLayout = Object.assign(MasterDetailLayoutImpl, {
  Header,
  Body,
});

export type { MasterDetailLayoutProps };
