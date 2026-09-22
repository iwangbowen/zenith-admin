import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@douyinfe/semi-ui', () => {
  type Item = { key: string | number; label: ReactNode; color?: string };
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

  return { OverflowList, Popover, Space, Tag };
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

  it('supports keyboard activation when the container is clickable', () => {
    const onClick = vi.fn();
    render(<OverflowTagList items={ITEMS} contentWidth={228} onClick={onClick} />);

    const button = screen.getByRole('button');
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.keyDown(button, { key: ' ' });

    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
