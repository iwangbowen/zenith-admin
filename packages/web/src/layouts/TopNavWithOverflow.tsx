import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Badge, Nav } from '@douyinfe/semi-ui';

export type TopNavItem = {
  itemKey: string;
  text: string;
  icon?: React.ReactNode;
  items?: TopNavItem[];
  badge?: { count: number; overflowCount?: number };
  isExternal?: boolean;
};

/** 与 Semi Nav 的 renderWrapper 签名兼容（额外字段被忽略） */
type RenderWrapper = (args: {
  itemElement: React.ReactNode;
  isSubNav?: boolean;
  isInSubNav?: boolean;
  props: { itemKey?: string | number };
}) => React.ReactNode;

type SemiNavItem = {
  itemKey: string;
  text: React.ReactNode;
  icon?: React.ReactNode;
  items?: SemiNavItem[];
};

type Props = Readonly<{
  items: TopNavItem[];
  selectedKeys: string[];
  /** 复用 AdminLayout 的 renderWrapper：内链包 NavLink、外链包 a */
  renderWrapper: RenderWrapper;
  className?: string;
  /** 导航地标的无障碍标签 */
  ariaLabel?: string;
  /** mixed 模式：点击顶部分类项的回调（非路径项由此处理） */
  onItemClick?: (key: string) => void;
}>;

const MORE_KEY = '__topnav_more__';
const MORE_TEXT = '更多';

function decorateText(text: React.ReactNode, badge?: TopNavItem['badge']): React.ReactNode {
  if (!badge || badge.count <= 0) return text;
  return (
    <span className="topnav-badge-text">
      <span>{text}</span>
      <Badge count={badge.count} overflowCount={badge.overflowCount ?? 99} type="danger" />
    </span>
  );
}

/** TopNavItem 树 → Semi Nav items，把徽标注入 text 节点 */
function toSemiItems(items: TopNavItem[]): SemiNavItem[] {
  return items.map((item) => {
    const node: SemiNavItem = {
      itemKey: item.itemKey,
      text: decorateText(item.text, item.badge),
    };
    if (item.icon != null) node.icon = item.icon;
    if (item.items?.length) node.items = toSemiItems(item.items);
    return node;
  });
}

/** 溢出项中是否有被选中（含后代），用于高亮「更多」 */
function anyKeySelected(items: SemiNavItem[], selected: Set<string>): boolean {
  return items.some(
    (it) => selected.has(it.itemKey) || (it.items ? anyKeySelected(it.items, selected) : false),
  );
}

/**
 * 顶部水平导航：基于 Semi `Nav mode="horizontal"` 渲染可见项，
 * 仅对放不下的项用一个合成的「更多」Sub 收纳（Semi 原生下拉）。
 * 通过隐藏的探测 Nav 测量各项宽度，配合 ResizeObserver 实现响应式收纳。
 */
export function TopNavWithOverflow({
  items,
  selectedKeys,
  renderWrapper,
  className,
  ariaLabel,
  onItemClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);

  const semiItems = useMemo(() => toSemiItems(items), [items]);

  // 隐藏探测 Nav：渲染全部项 + 一个「更多」Sub（带占位子项以带出展开箭头），仅用于测量
  const probeItems = useMemo<SemiNavItem[]>(
    () => [
      ...semiItems,
      { itemKey: MORE_KEY, text: MORE_TEXT, items: [{ itemKey: `${MORE_KEY}__probe`, text: ' ' }] },
    ],
    [semiItems],
  );

  const measure = useCallback(() => {
    const container = containerRef.current;
    const probe = probeRef.current;
    if (!container || !probe) return;
    const list = probe.querySelector('.semi-navigation-list');
    if (!list) return;
    const children = Array.from(list.children) as HTMLElement[];
    // children = [...全部顶级项, 更多]
    if (children.length < 2) {
      setVisibleCount(items.length);
      return;
    }
    // 可用宽度 = 容器宽度 - 实际可见 Nav 的左右内边距（padding:0 4px）
    const realNav = container.querySelector<HTMLElement>('.admin-topnav__nav');
    const navStyle = realNav ? getComputedStyle(realNav) : null;
    const padX = navStyle
      ? (Number.parseFloat(navStyle.paddingLeft) || 0) + (Number.parseFloat(navStyle.paddingRight) || 0)
      : 0;
    const containerW = container.clientWidth - padX;

    const moreEl = children[children.length - 1];
    const itemEls = children.slice(0, -1);
    const n = itemEls.length;

    // 项间距：探测 Nav 与真实 Nav 使用相同 class，间距一致（gap: 4px）
    const r0 = children[0].getBoundingClientRect();
    const r1 = children[1].getBoundingClientRect();
    const gap = Math.max(0, Math.round(r1.left - r0.right));
    const widths = itemEls.map((el) => el.getBoundingClientRect().width);
    const moreW = moreEl.getBoundingClientRect().width + gap;

    // 先判断：全部项是否能在不显示「更多」的情况下放下（避免有空间却仍收纳）
    const totalAll = widths.reduce((a, b) => a + b, 0) + Math.max(0, n - 1) * gap;
    if (totalAll <= containerW) {
      setVisibleCount(n);
      return;
    }

    // 否则贪心：尽可能多放「可见项 + 更多」，为「更多」按钮预留空间
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const w = widths[i] + (i > 0 ? gap : 0);
      if (sum + w + moreW <= containerW) {
        sum += w;
        count++;
      } else {
        break;
      }
    }
    setVisibleCount(Math.max(1, Math.min(count, n)));
  }, [items.length]);

  // 首帧同步测量，避免闪烁
  useLayoutEffect(() => {
    measure();
  }, [measure, probeItems]);

  // 容器宽度变化时重新测量
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(container);
    return () => ro.disconnect();
  }, [measure]);

  const hasOverflow = visibleCount < semiItems.length;

  const displayItems = useMemo<SemiNavItem[]>(() => {
    if (!hasOverflow) return semiItems;
    const visible = semiItems.slice(0, visibleCount);
    const overflow = semiItems.slice(visibleCount);
    return [...visible, { itemKey: MORE_KEY, text: MORE_TEXT, items: overflow }];
  }, [semiItems, visibleCount, hasOverflow]);

  // 溢出项被选中时，额外把「更多」标记为选中
  const effectiveSelectedKeys = useMemo(() => {
    if (!hasOverflow) return selectedKeys;
    const overflow = semiItems.slice(visibleCount);
    return anyKeySelected(overflow, new Set(selectedKeys)) ? [...selectedKeys, MORE_KEY] : selectedKeys;
  }, [selectedKeys, semiItems, visibleCount, hasOverflow]);

  const handleClick = useCallback(
    (data: { itemKey?: string | number }) => {
      const key = String(data.itemKey ?? '');
      if (!key || key === MORE_KEY) return;
      onItemClick?.(key);
    },
    [onItemClick],
  );

  return (
    <div
      ref={containerRef}
      className={`admin-topnav${className ? ' ' + className : ''}`}
      role="navigation"
      aria-label={ariaLabel ?? '主导航'}
    >
      {/* 隐藏探测：渲染全部项用于宽度测量。必须与真实 Nav 使用相同 class
          （admin-topnav__nav），以保证项间距/内边距完全一致，避免测量误差导致过早收纳 */}
      <div ref={probeRef} className="admin-topnav__probe" aria-hidden="true">
        <Nav className="admin-topnav__nav" mode="horizontal" items={probeItems} selectedKeys={[]} />
      </div>
      {/* 实际显示项 + 溢出「更多」 */}
      <Nav
        className="admin-topnav__nav"
        mode="horizontal"
        items={displayItems}
        selectedKeys={effectiveSelectedKeys}
        renderWrapper={renderWrapper}
        onClick={handleClick}
        subNavCloseDelay={150}
      />
    </div>
  );
}
