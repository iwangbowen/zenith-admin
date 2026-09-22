import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SwatchColorPicker } from './SwatchColorPicker';

const OPTIONS = [
  { key: 'blue', label: '飞书蓝', color: '#3370ff' },
  { key: '#123456', label: '深 slate', color: '#123456' },
];

describe('SwatchColorPicker', () => {
  it('点击预设色块回传其 key', async () => {
    const onChange = vi.fn();
    render(<SwatchColorPicker value="blue" onChange={onChange} options={OPTIONS} />);
    expect(screen.getByRole('button', { name: '飞书蓝' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: '深 slate' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('#123456');
  });

  it('自定义 hex 值时高亮自定义按钮', () => {
    render(<SwatchColorPicker value="#abcdef" onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByRole('button', { name: '自定义颜色' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '飞书蓝' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('预设 key 本身是 hex 时只高亮该预设，不高亮自定义按钮', () => {
    render(<SwatchColorPicker value="#123456" onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByRole('button', { name: '深 slate' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '自定义颜色' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('allowClear 展示无颜色选项并回传空串', async () => {
    const onChange = vi.fn();
    render(<SwatchColorPicker value="#abcdef" onChange={onChange} options={OPTIONS} allowClear />);
    await userEvent.click(screen.getByRole('button', { name: '无颜色' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('');
  });

  it('默认不展示无颜色选项，allowCustom=false 隐藏自定义按钮', () => {
    const { rerender } = render(<SwatchColorPicker value="" onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.queryByRole('button', { name: '无颜色' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '自定义颜色' })).toBeVisible();
    rerender(<SwatchColorPicker value="" onChange={vi.fn()} options={OPTIONS} allowCustom={false} />);
    expect(screen.queryByRole('button', { name: '自定义颜色' })).not.toBeInTheDocument();
  });
});
