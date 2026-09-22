import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@douyinfe/semi-ui', () => {
  type Item = { key: string | number; label: ReactNode; color?: string };
  type TagGroupItem = { tagKey: string | number; children: ReactNode; color?: string };
  type OverflowListProps = {
    items: Item[];
    visibleItemRenderer: (item: Item) => ReactNode;
    overflowRenderer: (items: Item[]) => ReactNode;
  };

  function OverflowList({ items, visibleItemRenderer, overflowRenderer }: OverflowListProps) {
    return (
      <div>
        {items.slice(0, 1).map(visibleItemRenderer)}
        {overflowRenderer(items.slice(1))}
      </div>
    );
  }

  function Popover({ children, content }: { children: ReactNode; content: ReactNode }) {
    return <div>{children}{content}</div>;
  }

  function Space({ children }: { children: ReactNode }) {
    return <div>{children}</div>;
  }

  function Tag({ children, color }: { children: ReactNode; color?: string }) {
    return <span data-color={color ?? ''}>{children}</span>;
  }

  function TagGroup({ maxTagCount, tagList }: { maxTagCount: number; tagList: TagGroupItem[] }) {
    return (
      <div data-max-tag-count={maxTagCount}>
        {tagList.slice(0, maxTagCount).map((item) => (
          <Tag key={item.tagKey} color={item.color}>{item.children}</Tag>
        ))}
        {tagList.length > maxTagCount ? <span>+{tagList.length - maxTagCount}</span> : null}
      </div>
    );
  }

  return { OverflowList, Popover, Space, Tag, TagGroup };
});

import OverflowTagList from './OverflowTagList';

const ITEMS = [
  { key: 'role-1', label: '管理员' },
  { key: 'role-2', label: '审核员' },
];

describe('OverflowTagList', () => {
  it('renders visible and overflow tags with the overflow count', () => {
    render(<OverflowTagList items={ITEMS} contentWidth={228} />);

    expect(screen.getByText('管理员')).toBeTruthy();
    expect(screen.getByText('+1')).toBeTruthy();
    expect(screen.getByText('审核员')).toBeTruthy();
  });

  it('prefers the per-item color over the column-level tagColor', () => {
    render(
      <OverflowTagList
        contentWidth={228}
        tagColor="blue"
        items={[
          { key: 'high', label: '高', color: 'red' },
          { key: 'medium', label: '中' },
        ]}
      />,
    );

    expect(screen.getByText('高').getAttribute('data-color')).toBe('red');
    expect(screen.getByText('中').getAttribute('data-color')).toBe('blue');
  });

  it('collapses by maxTagCount in count mode and keeps per-item colors', () => {
    const { container } = render(
      <OverflowTagList
        contentWidth={228}
        tagColor="blue"
        maxTagCount={1}
        items={[
          { key: 'scope-1', label: 'user:read', color: 'green' },
          { key: 'scope-2', label: 'user:write' },
        ]}
      />,
    );

    expect(container.querySelector('[data-max-tag-count="1"]')).toBeTruthy();
    expect(screen.getByText('user:read').getAttribute('data-color')).toBe('green');
    expect(screen.getByText('+1')).toBeTruthy();
  });

  it('supports keyboard activation when the container is clickable', () => {
    const onClick = vi.fn();
    render(<OverflowTagList items={ITEMS} contentWidth={228} onClick={onClick} />);

    const button = screen.getByRole('button');
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.keyDown(button, { key: ' ' });

    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
