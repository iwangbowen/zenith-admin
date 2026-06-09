import type { CSSProperties, ReactNode } from 'react';
import { Input, Spin } from '@douyinfe/semi-ui';
import { Search } from 'lucide-react';
import './NavListPanel.css';

/* ─────────────────────────── NavListPanel ──────────────────────────────── */

export interface NavListPanelSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onEnterPress?: () => void;
}

export interface NavListPanelProps {
  /** 标题栏左侧文字 */
  title?: ReactNode;
  /** 标题栏右侧操作区（按钮/下拉菜单等） */
  headerExtra?: ReactNode;
  /** 如果提供，在标题栏下方渲染搜索输入框 */
  search?: NavListPanelSearchProps;
  /** 列表加载中 */
  loading?: boolean;
  /** 空状态文字 */
  emptyText?: string;
  /** 底部插槽（分页等） */
  footer?: ReactNode;
  /** 列表条目 */
  children?: ReactNode;
  style?: CSSProperties;
  /** 是否去掉 body 的 padding（用于 Collapse 分组等场景） */
  bodyNoPadding?: boolean;
}

export function NavListPanel({
  title,
  headerExtra,
  search,
  loading,
  emptyText = '暂无数据',
  footer,
  children,
  style,
  bodyNoPadding,
}: Readonly<NavListPanelProps>) {
  const isEmpty = !loading && !children;

  return (
    <div className="nav-list-panel" style={style}>
      {(title !== undefined || headerExtra !== undefined) && (
        <div className="nav-list-panel__header">
          {title !== undefined && (
            <span className="nav-list-panel__title">{title}</span>
          )}
          {headerExtra !== undefined && (
            <div className="nav-list-panel__header-extra">{headerExtra}</div>
          )}
        </div>
      )}

      {search && (
        <div className="nav-list-panel__search">
          <Input
            prefix={<Search size={14} />}
            placeholder={search.placeholder ?? '搜索'}
            value={search.value}
            onChange={search.onChange}
            onEnterPress={search.onEnterPress}
            showClear
            size="small"
          />
        </div>
      )}

      <div className={`nav-list-panel__body${bodyNoPadding ? ' nav-list-panel__body--no-padding' : ''}`}>
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <Spin />
          </div>
        )}
        {isEmpty && (
          <div className="nav-list-panel__empty">{emptyText}</div>
        )}
        {!loading && children}
      </div>

      {footer && (
        <div className="nav-list-panel__footer">{footer}</div>
      )}
    </div>
  );
}

/* ─────────────────────────── NavListItem ───────────────────────────────── */

export interface NavListItemProps {
  /** 高亮激活状态 */
  active?: boolean;
  onClick?: () => void;
  /** 主标题（加粗） */
  primary: ReactNode;
  /** 副标题（主标题后 · 分隔，省略样式） */
  secondary?: ReactNode;
  /** 底部元信息行（日期/大小/标签等，颜色更淡） */
  meta?: ReactNode;
  /** 左侧图标 */
  icon?: ReactNode;
  /**
   * 右侧操作区，默认 hover/active 时才可见。
   * 如需始终显示，设置 `extraAlwaysVisible`。
   */
  extra?: ReactNode;
  /** 让 extra 区域始终可见（不随 hover 隐藏） */
  extraAlwaysVisible?: boolean;
  style?: CSSProperties;
  className?: string;
}

export function NavListItem({
  active,
  onClick,
  primary,
  secondary,
  meta,
  icon,
  extra,
  extraAlwaysVisible,
  style,
  className,
}: Readonly<NavListItemProps>) {
  return (
    <button
      type="button"
      className={[
        'nav-list-item',
        active ? 'nav-list-item--active' : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
      onClick={onClick}
      style={style}
    >
      {icon && <span className="nav-list-item__icon">{icon}</span>}

      <div className="nav-list-item__body">
        <div className="nav-list-item__row1">
          <span className="nav-list-item__primary">{primary}</span>
          {secondary !== undefined && (
            <>
              <span className="nav-list-item__sep">·</span>
              <span className="nav-list-item__secondary">{secondary}</span>
            </>
          )}
        </div>
        {meta !== undefined && (
          <div className="nav-list-item__meta">{meta}</div>
        )}
      </div>

      {extra !== undefined && (
        <div className={`nav-list-item__extra${extraAlwaysVisible ? ' nav-list-item__extra--visible' : ''}`}>
          {extra}
        </div>
      )}
    </button>
  );
}
