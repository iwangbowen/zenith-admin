import { memo, useState } from 'react';
import { Dropdown } from '@douyinfe/semi-ui';
import {
  ChevronLeft, ChevronRight, Copy, Expand, ExternalLink, Link2, Pin, PinOff,
  Route, Shrink, Star, Trash2, X, XCircle, RotateCcw,
} from 'lucide-react';
import { renderLucideIcon } from '@/utils/icons';
import type { TabItem } from '@/hooks/useTabsStore';

/**
 * 页签操作集合。所有成员必须引用稳定（由 AdminLayout 用 useEventCallback 包装），
 * 否则 memo 会全部落空。
 */
export interface TabBarItemActions {
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onRefresh: (key: string) => void;
  onDoubleClick: (tab: TabItem) => void;
  onMiddleClick: (tab: TabItem) => void;
  onPinToggle: (tab: TabItem) => void;
  onToggleFullscreen: () => void;
  onToggleFavorite: (menuId: number) => void;
  onCopyName: (tab: TabItem) => void;
  onCopyLink: (tab: TabItem) => void;
  onCopyBreadcrumb: (tab: TabItem) => void;
  onOpenInNewWindow: (tab: TabItem) => void;
  onCloseOthers: (key: string) => void;
  onCloseLeft: (key: string) => void;
  onCloseRight: (key: string) => void;
  onCloseAll: () => void;
  onDragStart: (key: string) => void;
  onDragOver: (e: React.DragEvent, key: string) => void;
  onDrop: (key: string) => void;
  onDragEnd: () => void;
  onDragLeave: () => void;
}

interface TabBarItemProps {
  readonly tab: TabItem;
  readonly actions: TabBarItemActions;
  readonly isActive: boolean;
  readonly isEntering: boolean;
  readonly isExiting: boolean;
  readonly isDragging: boolean;
  readonly isDragOver: boolean;
  readonly hasClosableLeft: boolean;
  readonly hasClosableRight: boolean;
  readonly hasClosableOthers: boolean;
  readonly hasAnyClosable: boolean;
  /** 该页签对应的菜单 id；为 null 表示不可收藏（或收藏功能关闭） */
  readonly favMenuId: number | null;
  readonly faved: boolean;
  readonly showIcon: boolean;
  readonly iconName?: string;
  /** 悬浮提示：完整菜单路径（如「系统设置 / 运维管理 / 接口限流」），缺省退回页签标题 */
  readonly hoverTitle?: string;
  readonly isContentFullscreen: boolean;
  readonly innerRef?: React.Ref<HTMLDivElement>;
}

/**
 * 单个页签（含右键菜单）。
 *
 * 两项性能约束：
 * 1. `memo` —— AdminLayout 因任意无关 state（WebSocket 未读数、锁屏、偏好面板…）
 *    重渲染时，未变化的页签不参与 reconciliation。
 * 2. 右键菜单懒构建 —— 菜单 14 个 Dropdown.Item（各带图标）此前在每次渲染中
 *    对每个页签都急切创建，20 个页签即 600+ 个从未展示的元素。现在首次右键
 *    时才构建：`onContextMenu` 与 Semi 自身的显示逻辑在同一个原生事件内触发，
 *    React 18 会把两次 setState 批处理进同一次渲染，弹层挂载时菜单已就绪。
 */
function TabBarItemInner({
  tab, actions, isActive, isEntering, isExiting, isDragging, isDragOver,
  hasClosableLeft, hasClosableRight, hasClosableOthers, hasAnyClosable,
  favMenuId, faved, showIcon, iconName, hoverTitle, isContentFullscreen, innerRef,
}: TabBarItemProps) {
  // 首次右键后置 true 并保持，避免反复构建 / 卸载菜单
  const [menuReady, setMenuReady] = useState(false);

  const tabClass = [
    'admin-tab-item',
    isActive ? 'admin-tab-item--active' : '',
    isEntering ? 'admin-tab-item--entering' : '',
    isExiting ? 'admin-tab-item--exiting' : '',
    isDragging ? 'admin-tab-item--dragging' : '',
    isDragOver ? 'admin-tab-item--drag-over' : '',
  ].filter(Boolean).join(' ');

  const menu = menuReady ? (
    <Dropdown.Menu>
      <Dropdown.Item icon={<RotateCcw size={14} />} onClick={() => actions.onRefresh(tab.key)}>刷新页面</Dropdown.Item>
      <Dropdown.Item icon={<ExternalLink size={14} />} onClick={() => actions.onOpenInNewWindow(tab)}>在新标签页中打开</Dropdown.Item>
      <Dropdown.Item icon={<Copy size={14} />} onClick={() => actions.onCopyName(tab)}>复制名称</Dropdown.Item>
      <Dropdown.Item icon={<Link2 size={14} />} onClick={() => actions.onCopyLink(tab)}>复制链接</Dropdown.Item>
      <Dropdown.Item icon={<Route size={14} />} onClick={() => actions.onCopyBreadcrumb(tab)}>复制面包屑路径</Dropdown.Item>
      {favMenuId !== null && (
        <Dropdown.Item
          icon={<Star size={14} fill={faved ? 'currentColor' : 'none'} strokeWidth={faved ? 0 : 1.8} style={{ color: faved ? 'var(--semi-color-warning)' : undefined }} />}
          onClick={() => actions.onToggleFavorite(favMenuId)}
        >
          {faved ? '取消收藏' : '收藏此页'}
        </Dropdown.Item>
      )}
      {tab.key !== '/' && (
        <Dropdown.Item
          icon={tab.pinned ? <PinOff size={14} /> : <Pin size={14} />}
          onClick={() => actions.onPinToggle(tab)}
        >
          {tab.pinned ? '取消固定' : '固定标签页'}
        </Dropdown.Item>
      )}
      <Dropdown.Item icon={isContentFullscreen ? <Shrink size={14} /> : <Expand size={14} />} onClick={actions.onToggleFullscreen}>{isContentFullscreen ? '退出全屏' : '全屏显示'}</Dropdown.Item>
      <Dropdown.Divider />
      <Dropdown.Item icon={<X size={14} />} disabled={!tab.closable} onClick={() => actions.onClose(tab.key)}>关闭当前</Dropdown.Item>
      <Dropdown.Item icon={<XCircle size={14} />} disabled={!hasClosableOthers} onClick={() => actions.onCloseOthers(tab.key)}>关闭其他</Dropdown.Item>
      <Dropdown.Item icon={<ChevronLeft size={14} />} disabled={!hasClosableLeft} onClick={() => actions.onCloseLeft(tab.key)}>关闭左侧</Dropdown.Item>
      <Dropdown.Item icon={<ChevronRight size={14} />} disabled={!hasClosableRight} onClick={() => actions.onCloseRight(tab.key)}>关闭右侧</Dropdown.Item>
      <Dropdown.Item icon={<Trash2 size={14} />} disabled={!hasAnyClosable} onClick={actions.onCloseAll}>关闭全部</Dropdown.Item>
    </Dropdown.Menu>
  ) : null;

  return (
    <Dropdown trigger="contextMenu" position="bottomLeft" clickToHide render={menu}>
      <div
        ref={innerRef}
        role="tab"
        tabIndex={0}
        className={tabClass}
        draggable
        // Semi 的 mergeEvents 会链式保留子元素原有事件，此处与 Semi 的显示逻辑同批次执行
        onContextMenu={() => setMenuReady(true)}
        onDragStart={() => actions.onDragStart(tab.key)}
        onDragOver={(e) => actions.onDragOver(e, tab.key)}
        onDrop={() => actions.onDrop(tab.key)}
        onDragEnd={actions.onDragEnd}
        onDragLeave={actions.onDragLeave}
        onClick={() => actions.onSelect(tab.key)}
        onDoubleClick={() => actions.onDoubleClick(tab)}
        onMouseDown={(e) => { if (e.button === 1 && tab.closable) { e.preventDefault(); actions.onMiddleClick(tab); } }}
        onKeyDown={(e) => { if (e.key === 'Enter') actions.onSelect(tab.key); }}
      >
        {showIcon && iconName && (
          <span className="admin-tab-item__icon">{renderLucideIcon(iconName, 14)}</span>
        )}
        <span className="admin-tab-item__text" title={hoverTitle ?? tab.title}>{tab.title}</span>
        {tab.pinned && (
          <span className="admin-tab-item__pin"><Pin size={10} /></span>
        )}
        {tab.closable ? (
          <button
            type="button"
            className="admin-tab-item__close"
            onClick={(e) => { e.stopPropagation(); actions.onClose(tab.key); }}
          >
            <X size={12} />
          </button>
        ) : (
          /* 不可关闭页签（首页 / 固定）保留关闭按钮占位，避免与可关闭页签宽度不一致 */
          <span className="admin-tab-item__close admin-tab-item__close--placeholder" aria-hidden="true" />
        )}
      </div>
    </Dropdown>
  );
}

export const TabBarItem = memo(TabBarItemInner);
