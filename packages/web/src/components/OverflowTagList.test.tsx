import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@douyinfe/semi-ui', () => {
  type Item = { key: string | number; label: ReactNode };
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

  function Tag({ children }: { children: ReactNode }) {
    return <span>{children}</span>;
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

  it('supports keyboard activation when the container is clickable', () => {
    const onClick = vi.fn();
    render(<OverflowTagList items={ITEMS} contentWidth={228} onClick={onClick} />);

    const button = screen.getByRole('button');
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.keyDown(button, { key: ' ' });

    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
