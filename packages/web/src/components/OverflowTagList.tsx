import type { ComponentProps, CSSProperties, Key, ReactNode } from 'react';
import { OverflowList, Popover, Space, Tag } from '@douyinfe/semi-ui';

export type OverflowTagItem = {
  readonly key: Key;
  readonly label: ReactNode;
  /** 逐项配色；缺省回退到列级 tagColor（适用于色值由业务数据决定的标签列，如成员标签 / 告警渠道） */
  readonly color?: TagColor;
};

type TagColor = ComponentProps<typeof Tag>['color'];
type TagSize = ComponentProps<typeof Tag>['size'];
type PopoverTrigger = ComponentProps<typeof Popover>['trigger'];

export interface OverflowTagListProps {
  readonly items: readonly OverflowTagItem[];
  readonly contentWidth: number | string;
  readonly tagColor?: TagColor;
  readonly tagSize?: TagSize;
  readonly popoverWidth?: number | string;
  readonly popoverTrigger?: PopoverTrigger;
  readonly onClick?: () => void;
  readonly style?: CSSProperties;
}

/** 单行标签列表：超出容器的标签收纳到 +N Popover 中，避免表格行高被撑开；逐项 color 优先于列级 tagColor。 */
export default function OverflowTagList({
  items,
  contentWidth,
  tagColor,
  tagSize,
  popoverWidth,
  popoverTrigger,
  onClick,
  style,
}: OverflowTagListProps) {
  return (
    <div
      style={{
        width: contentWidth,
        maxWidth: '100%',
        minWidth: 0,
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : undefined,
        ...style,
      }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      } : undefined}
    >
      <OverflowList
        items={[...items]}
        renderMode="collapse"
        style={{ width: contentWidth, maxWidth: '100%', minWidth: 0 }}
        visibleItemRenderer={(item) => (
          <Tag key={item.key} size={tagSize} color={item.color ?? tagColor} style={{ flex: '0 0 auto', marginRight: 4 }}>
            {item.label}
          </Tag>
        )}
        overflowRenderer={(overflowItems) => (
          overflowItems.length > 0 ? (
            <Popover
              position="bottomLeft"
              trigger={popoverTrigger}
              content={(
                <Space spacing={4} wrap style={{ maxWidth: popoverWidth }}>
                  {overflowItems.map((item) => (
                    <Tag key={item.key} size={tagSize} color={item.color ?? tagColor}>
                      {item.label}
                    </Tag>
                  ))}
                </Space>
              )}
            >
              <Tag size={tagSize} color="grey" style={{ flex: '0 0 auto', cursor: 'pointer' }}>
                +{overflowItems.length}
              </Tag>
            </Popover>
          ) : null
        )}
      />
    </div>
  );
}
