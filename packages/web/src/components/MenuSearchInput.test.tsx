import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import MenuSearchInput from './MenuSearchInput';

const state = vi.hoisted(() => ({ shortcuts: true, renders: vi.fn() }));
vi.mock('@/hooks/usePreferences', () => ({ useOptionalPreferences: () => ({ preferences: { enableShortcuts: state.shortcuts } }) }));
vi.mock('./MenuCommandPalette', () => ({
  default: ({ open }: { open: boolean }) => {
    state.renders();
    return open ? <div role="dialog">搜索面板</div> : null;
  },
}));

beforeEach(() => { state.shortcuts = true; state.renders.mockClear(); });

function renderTrigger() {
  return render(<MenuSearchInput menus={[]} recentMenus={[]} onClearRecents={() => {}} onRemoveRecent={() => {}} />);
}

describe('MenuSearchInput deferred palette', () => {
  it('opens on the first Ctrl+K and toggles or closes without loading the palette at startup', async () => {
    renderTrigger();
    expect(state.renders).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog')).toBeVisible();
    expect(screen.getByRole('button', { name: '全局搜索' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(await screen.findByRole('dialog')).toBeVisible();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('respects disabled shortcuts while retaining button activation and Escape', async () => {
    state.shortcuts = false;
    renderTrigger();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(state.renders).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '全局搜索' }));
    expect(await screen.findByRole('dialog')).toBeVisible();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
