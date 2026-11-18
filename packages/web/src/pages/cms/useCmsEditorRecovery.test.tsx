import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useNavigate, useSearchParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCmsEditorRecovery } from './useCmsEditorRecovery';

const { confirm, account } = vi.hoisted(() => ({ confirm: vi.fn(), account: { id: 71 } }));
vi.mock('@douyinfe/semi-ui', () => ({ Modal: { confirm }, Button: () => null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: account.id } }) }));

const key = 'cms-editor-recovery:71:3:new-article';
const otherKey = 'cms-editor-recovery:72:3:new-article';
const draft = { values: { title: '未保存的新稿' }, body: '<p>正文修改</p>', albumImages: [], attachments: [], version: 3 };
const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={['/cms/contents/edit']}>{children}</MemoryRouter>;

beforeEach(() => { confirm.mockReset(); account.id = 71; localStorage.removeItem(key); localStorage.removeItem(otherKey); });
afterEach(() => { localStorage.removeItem(key); localStorage.removeItem(otherKey); });

describe('CMS 编辑恢复', () => {

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

  it('moves edits made during the initial POST to the created id without a restore prompt or orphaned new draft', () => {
    const dirty = { current: true };
    const createdKey = 'cms-editor-recovery:71:3:19';
    const inFlightDraft = { ...draft, values: { title: '首次保存期间继续输入', mediaUrl: 'cms-res://41' }, version: 1, refreshResourceIds: [41] };
    const hook = renderHook(() => {
      const [params] = useSearchParams();
      const id = params.get('id');
      return { recovery: useCmsEditorRecovery({ key: `3:${id ?? 'new-article'}`, dirty, getDraft: () => inFlightDraft }), navigate: useNavigate() };
    }, { wrapper });
    act(() => hook.result.current.recovery.persist());
    act(() => {
      expect(hook.result.current.recovery.promote('3:19')).toBe(true);
      hook.result.current.recovery.navigateSaved(() => hook.result.current.navigate('/cms/contents/edit?id=19', { replace: true }));
    });
    expect(localStorage.getItem(key)).toBeNull();
    expect(JSON.parse(localStorage.getItem(createdKey)!)).toMatchObject(inFlightDraft);
    expect(hook.result.current.recovery.pending).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
    hook.unmount();
    expect(localStorage.getItem(key)).toBeNull();
    localStorage.removeItem(createdKey);
  });
});
