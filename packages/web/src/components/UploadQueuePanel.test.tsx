import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@douyinfe/semi-ui', () => {
  function Button({ children, onClick, disabled, 'aria-label': ariaLabel }: {
    children?: ReactNode; onClick?: () => void; disabled?: boolean; 'aria-label'?: string; [key: string]: unknown;
  }) {
    return <button type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel}>{children}</button>;
  }

  function Progress({ percent }: { percent: number }) {
    return <div data-testid="progress">{percent}</div>;
  }

  function Tag({ children }: { children: ReactNode }) {
    return <span>{children}</span>;
  }

  function TypographyText({ children }: { children: ReactNode }) {
    return <span>{children}</span>;
  }

  return { Button, Progress, Tag, Typography: { Text: TypographyText } };
});

vi.mock('@zenith/shared/core', () => ({
  formatBytes: (size: number) => `${size} B`,
}));

import { UploadQueuePanel, type UploadQueueItem } from './UploadQueuePanel';

const ITEMS: UploadQueueItem[] = [
  { id: 'u1', name: 'a.txt', size: 12, status: 'uploading', percent: 42 },
  { id: 'u2', name: 'b.txt', size: 34, status: 'success', percent: 100 },
];

describe('UploadQueuePanel', () => {
  it('renders nothing when the queue is empty', () => {
    const { container } = render(<UploadQueuePanel items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the active count, item states and progress', () => {
    render(<UploadQueuePanel items={ITEMS} />);

    expect(screen.getByText('正在上传 1 个文件')).toBeTruthy();
    expect(screen.getByText('a.txt')).toBeTruthy();
    expect(screen.getByText('b.txt')).toBeTruthy();
    expect(screen.getByTestId('progress')).toBeTruthy();
  });

  it('shows the finished title when nothing is active', () => {
    render(<UploadQueuePanel items={[{ id: 'u9', name: 'c.txt', status: 'success', percent: 100 }]} />);

    expect(screen.getByText('上传完成（1）')).toBeTruthy();
  });

  it('forwards cancel and clear actions', () => {
    const onCancel = vi.fn();
    const onClear = vi.fn();
    render(<UploadQueuePanel items={ITEMS} onCancel={onCancel} onClear={onClear} />);

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledWith('u1');

    fireEvent.click(screen.getByRole('button', { name: '清空已完成' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('collapses the list on toggle', () => {
    render(<UploadQueuePanel items={ITEMS} />);

    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(screen.queryByText('a.txt')).toBeNull();
  });
});
