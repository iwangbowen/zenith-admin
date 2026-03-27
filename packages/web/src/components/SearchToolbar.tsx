import type { ReactNode } from 'react';
import { Space } from '@douyinfe/semi-ui';

interface SearchToolbarProps {
  readonly left?: ReactNode;
  readonly right?: ReactNode;
  /** 额外的 CSS 类名，附加到 responsive-toolbar div 上 */
  readonly className?: string;
  /** 工具栏下方的附加内容（如提示文字），渲染在 search-area 内、responsive-toolbar 之后 */
  readonly children?: ReactNode;
}

export function SearchToolbar({ left, right, className, children }: SearchToolbarProps) {
  return (
    <div className="search-area">
      <div className={className ? `responsive-toolbar ${className}` : 'responsive-toolbar'}>
        {left && (
          <div className={className ? `responsive-toolbar__left ${className}__left` : 'responsive-toolbar__left'}>
            <Space wrap>{left}</Space>
          </div>
        )}
        {right && (
          <div className={className ? `responsive-toolbar__right ${className}__right` : 'responsive-toolbar__right'}>
            {right}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
