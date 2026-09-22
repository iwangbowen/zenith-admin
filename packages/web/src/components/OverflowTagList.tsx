import type { ComponentProps, CSSProperties, Key, ReactNode } from 'react';
import { OverflowList, Popover, Space, Tag, TagGroup } from '@douyinfe/semi-ui';

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
  /** 计数模式的兜底宽度，也是宽度模式下的可用宽度（列宽 − 单元格左右 padding） */
  readonly contentWidth: number | string;
  /**
   * 计数模式：只内联 N 枚标签、其余收进 +N 气泡（透传 Semi TagGroup，标签文案与列宽量级匹配时使用）；
   * 缺省为宽度模式（OverflowList 实测宽度自适应）。
   */
  readonly maxTagCount?: number;
  readonly tagColor?: TagColor;
  readonly tagSize?: TagSize;
  readonly popoverWidth?: number | string;
  readonly popoverTrigger?: PopoverTrigger;
  readonly onClick?: () => void;
  readonly style?: CSSProperties;
}

/**
 * 单行标签列表：超出容器的标签收纳到 +N 中，避免表格行高被撑开；逐项 color 优先于列级 tagColor。
 *
 * 两种收起模式：缺省按容器宽度自适应（OverflowList 实测宽度，列宽变化后自动重算）；
 * 传 `maxTagCount` 则改为固定计数（TagGroup，标签数量与文案长度可控时用，避免测量开销）。
 */
export default function OverflowTagList({
  items,
  contentWidth,
  maxTagCount,
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
      {maxTagCount != null ? (
        // TagGroup 的 size 只认 small / large，default 走不传；tagKey 只接受 string | number
        <TagGroup
          maxTagCount={maxTagCount}
          showPopover
          size={tagSize === 'small' || tagSize === 'large' ? tagSize : undefined}
          popoverProps={popoverTrigger ? { trigger: popoverTrigger } : undefined}
          tagList={[...items].map((item) => ({
            tagKey: typeof item.key === 'number' ? item.key : String(item.key),
            children: item.label,
            color: item.color ?? tagColor,
            size: tagSize,
          }))}
        />
      ) : (
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
      )}
    </div>
  );
}
