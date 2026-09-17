import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PrefsActionsSection } from './PreferencesSections';

describe('PrefsActionsSection', () => {
  it('主按钮复制，下拉菜单承载导入与导出', async () => {
    const handleCopyPreferences = vi.fn();
    const onOpenImport = vi.fn();
    const onExportPreferences = vi.fn();
    render(<PrefsActionsSection
      handleCopyPreferences={handleCopyPreferences}
      onOpenImport={onOpenImport}
      onExportPreferences={onExportPreferences}
      resetPreferences={vi.fn()}
    />);

    await userEvent.click(screen.getByRole('button', { name: '复制偏好' }));
    expect(handleCopyPreferences).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: '更多偏好操作' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '导入偏好' }));
    expect(onOpenImport).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: '更多偏好操作' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '导出配置文件' }));
    expect(onExportPreferences).toHaveBeenCalledTimes(1);
  });
});
