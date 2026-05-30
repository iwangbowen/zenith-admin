import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Badge, Dropdown } from '@douyinfe/semi-ui';
import { ChevronDown, ChevronRight } from 'lucide-react';

export type TopNavItem = {
  itemKey: string;
  text: string;
  icon?: React.ReactNode;
  items?: TopNavItem[];
  badge?: { count: number; overflowCount?: number };
};

interface Props {
  items: TopNavItem[];
  selectedKeys: string[];
  className?: string;
  style?: React.CSSProperties;
  /** 覆盖默认导航行为（用于 mixed 模式） */
  onItemClick?: (key: string) => void;
}

function isPath(key: string) {
  return key.startsWith('/');
}

function isItemActive(item: TopNavItem, selectedKeys: string[]): boolean {
  if (selectedKeys.includes(item.itemKey)) return true;
  return (item.items ?? []).some((child) => isItemActive(child, selectedKeys));
}

// ─── 递归 Dropdown 菜单项 ──────────────────────────────────────────────────────

function DropdownMenuItems({
  items,
  selectedKeys,
  onNavigate,
}: {
  items: TopNavItem[];
  selectedKeys: string[];
  onNavigate: (key: string) => void;
}) {
  return (
    <>
      {items.map((item) => {
        if (item.items?.length) {
          return (
            <Dropdown
              key={item.itemKey}
              position="rightTop"
              trigger="hover"
              render={
                <Dropdown.Menu>
                  <DropdownMenuItems items={item.items} selectedKeys={selectedKeys} onNavigate={onNavigate} />
                </Dropdown.Menu>
              }
            >
              <Dropdown.Item active={isItemActive(item, selectedKeys)}>
                <span className="topnav-dd-item">
                  {item.icon && <span className="topnav-dd-item__icon">{item.icon}</span>}
                  <span className="topnav-dd-item__text">{item.text}</span>
                  <ChevronRight size={12} className="topnav-dd-item__arrow" />
                </span>
              </Dropdown.Item>
            </Dropdown>
          );
        }
        return (
          <Dropdown.Item
            key={item.itemKey}
            active={selectedKeys.includes(item.itemKey)}
            onClick={() => onNavigate(item.itemKey)}
          >
            <span className="topnav-dd-item">
              {item.icon && <span className="topnav-dd-item__icon">{item.icon}</span>}
              <span className="topnav-dd-item__text">{item.text}</span>
            </span>
          </Dropdown.Item>
        );
      })}
    </>
  );
}

// ─── 单个顶部导航按钮 ──────────────────────────────────────────────────────────

function TopNavButton({
  item,
  selectedKeys,
  onNavigate,
}: {
  item: TopNavItem;
  selectedKeys: string[];
  onNavigate: (key: string) => void;
}) {
  const active = isItemActive(item, selectedKeys);
  const cls = `topnav-item${active ? ' topnav-item--active' : ''}`;

  const content = (
    <>
      {item.icon && <span className="topnav-item__icon">{item.icon}</span>}
      <span>{item.text}</span>
      {item.items?.length ? <ChevronDown size={11} className="topnav-item__arrow" /> : null}
    </>
  );

  const badgeCount = item.badge?.count ?? 0;

  const wrapBadge = (el: React.ReactNode) =>
    badgeCount > 0 ? (
      <Badge count={badgeCount} overflowCount={item.badge?.overflowCount ?? 99} style={{ zIndex: 1 }}>
        {el}
      </Badge>
    ) : (
      el
    );

  // 目录类：Dropdown 触发显示子菜单
  if (item.items?.length) {
    return wrapBadge(
      <Dropdown
        trigger="hover"
        position="bottomLeft"
        render={
          <Dropdown.Menu>
            <DropdownMenuItems items={item.items} selectedKeys={selectedKeys} onNavigate={onNavigate} />
          </Dropdown.Menu>
        }
      >
        <button type="button" className={cls}>
          {content}
        </button>
      </Dropdown>,
    );
  }

  // 路径类：NavLink（支持右键新标签打开）
  if (isPath(item.itemKey)) {
    return wrapBadge(
      <NavLink
        to={item.itemKey}
        className={({ isActive: a }) => `topnav-item${a ? ' topnav-item--active' : ''}`}
      >
        {content}
      </NavLink>,
    );
  }

  // 非路径非目录（如 mixed 模式的分类 key）：普通按钮
  return wrapBadge(
    <button type="button" className={cls} onClick={() => onNavigate(item.itemKey)}>
      {content}
    </button>,
  );
}

// ─── 主组件 ────────────────────────────────────────────────────────────────────

export function TopNavWithOverflow({ items, selectedKeys, className, style, onItemClick }: Props) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const moreBtnProbeRef = useRef<HTMLButtonElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);

  const handleNavigate = useCallback(
    (key: string) => {
      if (onItemClick) {
        onItemClick(key);
        return;
      }
      if (isPath(key)) navigate(key);
    },
    [navigate, onItemClick],
  );

  const measure = useCallback(() => {
    const container = containerRef.current;
    const probe = probeRef.current;
    if (!container || !probe) return;

    const containerW = container.clientWidth;
    const probeChildren = Array.from(probe.children) as HTMLElement[];
    const n = probeChildren.length;
    if (n === 0) return;

    const moreBtnW = (moreBtnProbeRef.current?.offsetWidth ?? 64) + 4;

    let sum = 0;
    let count = 0;

    for (let i = 0; i < n; i++) {
      const w = probeChildren[i].offsetWidth + 4; // 4px gap
      const isLast = i === n - 1;

      if (isLast) {
        // 最后一项：不需要"更多"按钮，直接检查是否放得下
        if (sum + w <= containerW) count = n;
        break;
      }

      // 非最后一项：需要为"更多"按钮预留空间
      if (sum + w + moreBtnW <= containerW) {
        sum += w;
        count++;
      } else {
        break;
      }
    }

    // 至少显示 1 项，避免全空
    setVisibleCount(Math.max(1, count));
  }, []);

  // 首次渲染后立即测量（同步，避免闪烁）
  useLayoutEffect(() => {
    measure();
  }, [items, measure]);

  // 监听容器宽度变化
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [measure]);

  const visible = items.slice(0, visibleCount);
  const overflow = items.slice(visibleCount);

  return (
    <div
      ref={containerRef}
      className={`topnav-overflow${className ? ` ${className}` : ''}`}
      style={style}
    >
      {/* 隐藏探测容器：仅用于测量各项宽度 */}
      <div ref={probeRef} className="topnav-overflow__probe" aria-hidden="true">
        {items.map((item) => (
          <div key={item.itemKey}>
            <button type="button" className="topnav-item" tabIndex={-1}>
              {item.icon && <span className="topnav-item__icon">{item.icon}</span>}
              <span>{item.text}</span>
              {item.items?.length ? <ChevronDown size={11} className="topnav-item__arrow" /> : null}
            </button>
          </div>
        ))}
      </div>
      {/* 隐藏"更多"按钮：用于测量其宽度 */}
      <div className="topnav-overflow__probe" aria-hidden="true">
        <button ref={moreBtnProbeRef} type="button" className="topnav-item" tabIndex={-1}>
          <span>更多</span>
          <ChevronDown size={11} className="topnav-item__arrow" />
        </button>
      </div>

      {/* 实际显示项 + 更多按钮 */}
      <div className="topnav-overflow__items">
        {visible.map((item) => (
          <TopNavButton
            key={item.itemKey}
            item={item}
            selectedKeys={selectedKeys}
            onNavigate={handleNavigate}
          />
        ))}

        {overflow.length > 0 && (
          <Dropdown
            trigger="hover"
            position="bottomRight"
            render={
              <Dropdown.Menu>
                <DropdownMenuItems
                  items={overflow}
                  selectedKeys={selectedKeys}
                  onNavigate={handleNavigate}
                />
              </Dropdown.Menu>
            }
          >
            <button
              type="button"
              className={`topnav-item${overflow.some((i) => isItemActive(i, selectedKeys)) ? ' topnav-item--active' : ''}`}
            >
              <span>更多</span>
              <ChevronDown size={11} className="topnav-item__arrow" />
            </button>
          </Dropdown>
        )}
      </div>
    </div>
  );
}
