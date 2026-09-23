import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCmsEditorRecovery } from './useCmsEditorRecovery';

const { confirm, account } = vi.hoisted(() => ({ confirm: vi.fn(), account: { id: 71 } }));
vi.mock('@douyinfe/semi-ui', () => ({ Modal: { confirm } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: account.id } }) }));

const key = 'cms-editor-recovery:71:3:new-article';
const otherKey = 'cms-editor-recovery:72:3:new-article';
const draft = { values: { title: '未保存的新稿' }, body: '<p>正文修改</p>', albumImages: [], attachments: [], version: 3 };
const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={['/cms/contents/edit']}>{children}</MemoryRouter>;

beforeEach(() => { confirm.mockReset(); account.id = 71; localStorage.removeItem(key); localStorage.removeItem(otherKey); });
afterEach(() => { localStorage.removeItem(key); localStorage.removeItem(otherKey); });

describe('CMS 编辑恢复', () => {
  it('requires confirmation before leaving and writes the complete current draft before navigation', () => {
    const dirty = { current: true };
    const hook = renderHook(() => ({ recovery: useCmsEditorRecovery({ key: '3:new-article', dirty, getDraft: () => draft }), navigate: useNavigate(), location: useLocation() }), { wrapper });
    act(() => hook.result.current.navigate('/cms/contents'));
    expect(hook.result.current.location.pathname).toBe('/cms/contents/edit');
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject(draft);
    expect(confirm).toHaveBeenCalledTimes(1);
    act(() => confirm.mock.calls[0][0].onOk());
    expect(hook.result.current.location.pathname).toBe('/cms/contents');
    hook.unmount();
  });

  it('restores only the current account draft and expires recovery copies after seven days', () => {
    localStorage.setItem(key, JSON.stringify({ ...draft, savedAt: Date.now() }));
    const dirty = { current: false };
    const hook = renderHook(() => useCmsEditorRecovery({ key: '3:new-article', dirty, getDraft: () => draft }), { wrapper });
    expect(hook.result.current.pending?.body).toBe(draft.body);
    account.id = 72;
    hook.rerender();
    expect(hook.result.current.pending).toBeNull();
    hook.unmount();
    localStorage.setItem(otherKey, JSON.stringify({ ...draft, savedAt: Date.now() - 8 * 86400_000 }));
    const expired = renderHook(() => useCmsEditorRecovery({ key: '3:new-article', dirty, getDraft: () => draft }), { wrapper });
    expect(expired.result.current.pending).toBeNull();
    expect(localStorage.getItem(otherKey)).toBeNull();
    expired.unmount();
  });

  it('protects reloads but lets a saved-record route replacement proceed without prompting', () => {
    const dirty = { current: true };
    const hook = renderHook(() => ({ recovery: useCmsEditorRecovery({ key: '3:new-article', dirty, getDraft: () => draft }), navigate: useNavigate(), location: useLocation() }), { wrapper });
    const event = new Event('beforeunload', { cancelable: true });
    act(() => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject(draft);
    act(() => hook.result.current.recovery.navigateSaved(() => hook.result.current.navigate('/cms/contents/edit?id=19', { replace: true })));
    expect(confirm).not.toHaveBeenCalled();
    expect(hook.result.current.location.search).toBe('?id=19');
    dirty.current = false;
    act(() => hook.result.current.recovery.clear());
    expect(localStorage.getItem(key)).toBeNull();
    hook.unmount();
  });

  it('allows switching tabs inside the current draft while still protecting another content record', () => {
    const dirty = { current: true };
    const hook = renderHook(() => ({ recovery: useCmsEditorRecovery({ key: '3:new-article', dirty, getDraft: () => draft }), navigate: useNavigate(), location: useLocation() }), { wrapper });
    act(() => hook.result.current.navigate('?tab=workflow', { replace: true }));
    expect(hook.result.current.location.search).toBe('?tab=workflow');
    expect(confirm).not.toHaveBeenCalled();
    act(() => hook.result.current.navigate('/cms/contents/edit?id=99'));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(hook.result.current.location.search).toBe('?tab=workflow');
    hook.unmount();
  });
});
