import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SearchToolbar } from './SearchToolbar';
import ExportButton from './ExportButton';
import { ClearLogsButtons } from './logs/ClearLogsControl';
import { ToolbarSlotContext } from './toolbar-slot-context';

vi.mock('@/hooks/useExportJobRunner', () => ({
  useExportJobRunner: () => ({ runExport: vi.fn(), isPending: false, pendingFormat: null }),
}));

describe('SearchToolbar', () => {
  it('renders without crashing without any props', () => {
    const { container } = render(<SearchToolbar />);
    expect(container.querySelector('.search-area')).not.toBeNull();
    expect(container.querySelector('.responsive-toolbar')).not.toBeNull();
  });

  it('renders children as toolbar content', () => {
    render(
      <SearchToolbar>
        <span>SearchContent</span>
      </SearchToolbar>
    );
    expect(screen.getByText('SearchContent')).toBeTruthy();
  });

  it('applies custom className to toolbar', () => {
    render(<SearchToolbar className="custom-class" />);
    expect(document.querySelector('.custom-class')).not.toBeNull();
    expect(document.querySelector('.responsive-toolbar.custom-class')).not.toBeNull();
  });

  it('renders multiple children inside toolbar', () => {
    render(
      <SearchToolbar>
        <span>Button1</span>
        <span>Button2</span>
        <span>Button3</span>
      </SearchToolbar>
    );
    expect(screen.getByText('Button1')).toBeTruthy();
    expect(screen.getByText('Button2')).toBeTruthy();
    expect(screen.getByText('Button3')).toBeTruthy();
  });

  it('reuses actions for the mobile menu and flattens slot-aware buttons there', () => {
    const { container } = render(
      <SearchToolbar primary={<span>P</span>} actions={<ExportButton entity="demo" />} />,
    );
    // 桌面工具栏：分体按钮（主按钮 + 下拉），不平铺
    const desktop = container.querySelector('.responsive-toolbar__desktop')!;
    expect(desktop.querySelector('.export-button--flat')).toBeNull();
    expect(desktop.querySelector('.export-button__main')).not.toBeNull();

    // 未传 mobileActions 时更多菜单沿用 actions，菜单内 ExportButton 自动按格式平铺
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    const menu = document.querySelector('.responsive-toolbar__mobile-actions')!;
    expect(menu).not.toBeNull();
    expect(menu.querySelector('.export-button--flat')).not.toBeNull();
    expect(menu.textContent).toContain('导出 XLSX');
    expect(menu.textContent).toContain('导出 CSV');
  });
});

describe('ClearLogsButtons', () => {
  it('clears by retention days: main button uses one year, dropdown lists the other tiers', () => {
    const onClear = vi.fn();
    render(<ClearLogsButtons loading={false} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: /清除日志/ }));
    expect(onClear).toHaveBeenCalledWith(365);
    expect(screen.queryByText(/undefined/)).toBeNull();
  });

  it('flattens into one button per tier inside the mobile actions slot', () => {
    const onClear = vi.fn();
    render(
      <ToolbarSlotContext.Provider value="mobile-actions">
        <ClearLogsButtons loading={false} onClear={onClear} label="录屏" />
      </ToolbarSlotContext.Provider>,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([
      '清除一年前的录屏',
      '清除六个月前的录屏',
      '清除三个月前的录屏',
      '清除一个月前的录屏',
    ]);
    fireEvent.click(buttons[3]);
    expect(onClear).toHaveBeenCalledWith(30);
  });
});
