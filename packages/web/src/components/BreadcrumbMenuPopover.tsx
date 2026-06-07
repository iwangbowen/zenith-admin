import { useState, useCallback, createContext, useContext } from 'react';
import { Popover } from '@douyinfe/semi-ui';
import { ChevronRight } from 'lucide-react';
import type { Menu } from '@zenith/shared';
import { renderLucideIcon } from '@/utils/icons';

/** 用于向子菜单传递"立即关闭整棵 Popover 树"的稳定回调 */
const CloseAllContext = createContext<(() => void) | null>(null);

interface MenuItemProps {
  item: Menu;
  onNavigate: (path: string) => void;
  depth?: number;
}

/** 单个菜单项：叶子菜单直接导航，目录节点展示嵌套 Popover */
function MenuItem({ item, onNavigate, depth = 0 }: Readonly<MenuItemProps>) {
  const closeAll = useContext(CloseAllContext);
  const visibleChildren = (item.children ?? []).filter(
    (c) => c.visible && c.status === 'enabled' && c.type !== 'button',
  );
  const isDirectory = item.type === 'directory' && visibleChildren.length > 0;

  const itemContent = (
    <div
      role="menuitem"
      tabIndex={0}
      onClick={() => {
        if (!isDirectory && item.path) {
          closeAll?.();
          onNavigate(item.path);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !isDirectory && item.path) {
          closeAll?.();
          onNavigate(item.path);
        }
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--semi-color-fill-0)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '6px 12px',
        cursor: isDirectory ? 'default' : 'pointer',
        borderRadius: 4,
        fontSize: 13,
        color: 'var(--semi-color-text-0)',
        background: 'transparent',
        transition: 'background 0.15s',
        userSelect: 'none',
        minWidth: 140,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {item.icon && (
          <span style={{ display: 'flex', alignItems: 'center', opacity: 0.6 }}>
            {renderLucideIcon(item.icon, 13)}
          </span>
        )}
        {item.title}
      </span>
      {isDirectory && (
        <ChevronRight size={12} style={{ opacity: 0.4, flexShrink: 0 }} />
      )}
    </div>
  );

  if (!isDirectory) return itemContent;

  return (
    <Popover
      trigger="hover"
      position="rightTop"
      mouseEnterDelay={80}
      mouseLeaveDelay={300}
      showArrow={false}
      content={
        <MenuList items={visibleChildren} onNavigate={onNavigate} depth={depth + 1} />
      }
    >
      {itemContent}
    </Popover>
  );
}

interface MenuListProps {
  items: Menu[];
  onNavigate: (path: string) => void;
  depth?: number;
}

/** 菜单列表（递归） */
function MenuList({ items, onNavigate, depth = 0 }: Readonly<MenuListProps>) {
  return (
    <div
      style={{
        padding: '4px 0',
        minWidth: 160,
        maxHeight: 320,
        overflowY: 'auto',
      }}
    >
      {items.map((item) => (
        <MenuItem key={item.id} item={item} onNavigate={onNavigate} depth={depth} />
      ))}
    </div>
  );
}

interface BreadcrumbMenuPopoverProps {
  /** 要展示的子菜单列表（来自面包屑目录节点的 menuChildren），作为 children 传入 */
  readonly children: Menu[];
  /** 点击叶子菜单时的导航回调 */
  readonly onNavigate: (path: string) => void;
  /** 触发器内容（面包屑条目） */
  readonly trigger: React.ReactNode;
}

/**
 * 面包屑目录节点的子菜单 Popover
 * 悬停目录节点时弹出，支持多级嵌套展开；点击叶子菜单后立即关闭
 */
export default function BreadcrumbMenuPopover({
  children,
  onNavigate,
  trigger,
}: BreadcrumbMenuPopoverProps) {
  const [visible, setVisible] = useState(false);
  const closeAll = useCallback(() => setVisible(false), []);

  if (!children.length) return <>{trigger}</>;

  return (
    <CloseAllContext.Provider value={closeAll}>
      <Popover
        trigger="hover"
        visible={visible}
        onVisibleChange={setVisible}
        position="bottomLeft"
        mouseEnterDelay={100}
        mouseLeaveDelay={300}
        showArrow={false}
        content={<MenuList items={children} onNavigate={onNavigate} />}
      >
        {/* Popover 需要包裹单个元素，用 span 承接 */}
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          {trigger}
        </span>
      </Popover>
    </CloseAllContext.Provider>
  );
}
