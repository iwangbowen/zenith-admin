import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CmsHomeSection } from '@zenith/shared/cms';
import HomeSectionsEditor from './HomeSectionsEditor';

vi.mock('@/hooks/queries/cms-channels', () => ({ useCmsChannelTree: () => ({ data: [], isFetching: false, isError: false }) }));
const rows: CmsHomeSection[] = ['甲区', '乙区'].map((title, index) => ({ id: `region-${index}`, title, source: 'latest', channelId: null, count: index + 3, style: 'compact', imageRatio: 'wide', focusX: 50, focusY: 50 }));

function Editor({ changed }: { changed: (value: CmsHomeSection[]) => void }) {
  const [value, setValue] = useState(rows);
  return <HomeSectionsEditor siteId={1} value={value} onChange={(next) => { setValue(next); changed(next); }} />;
}
describe('首页编排交互', () => {
  it('reorders complete section settings with accessible move controls', () => {
    const changed = vi.fn();
    render(<Editor changed={changed} />);
    fireEvent.click(screen.getByRole('button', { name: '下移区域 1' }));
    expect(changed).toHaveBeenLastCalledWith([rows[1], rows[0]]);
    expect(screen.getByLabelText('区域 1 标题')).toHaveValue('乙区');
  });
  it('commits a drag once on drop and keeps changes when a region is removed', () => {
    const changed = vi.fn();
    render(<Editor changed={changed} />);
    const dataTransfer = { setData: vi.fn(), effectAllowed: 'none' };
    fireEvent.dragStart(screen.getByRole('button', { name: '拖动区域 1' }), { dataTransfer });
    fireEvent.dragOver(screen.getByRole('button', { name: '拖动区域 2' }));
    expect(changed).not.toHaveBeenCalled();
    fireEvent.drop(screen.getByRole('button', { name: '拖动区域 2' }));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenLastCalledWith([rows[1], rows[0]]);
    fireEvent.click(screen.getByRole('button', { name: '删除区域 1' }));
    expect(changed).toHaveBeenLastCalledWith([rows[0]]);
  });
});
