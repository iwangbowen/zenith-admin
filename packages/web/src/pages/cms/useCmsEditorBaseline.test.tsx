import { act, renderHook } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useCmsEditorBaseline } from './useCmsEditorBaseline';

interface Draft { id: number; version: number; title: string; body: string; ownerId: number }
const initial: Draft = { id: 1, version: 1, title: '初稿标题', body: '初稿正文', ownerId: 1 };

function useEditor(record: Draft) {
  const dirty = useRef(false);
  const saving = useRef<unknown>(null);
  const cas = useRef(0);
  const [form, setForm] = useState(initial);
  const [state, setState] = useState('saved');
  const [conflicts, setConflicts] = useState(0);
  const baseline = useCmsEditorBaseline({ record, dirty, saving, saveState: state,
    onAdopt: (next) => { cas.current = next.version; dirty.current = false; setForm(next); setState('saved'); },
    onConflict: () => { setConflicts((count) => count + 1); setState('conflict'); },
  });
  return {
    form, state, conflicts,
    edit: (title: string) => { dirty.current = true; setForm((value) => ({ ...value, title })); setState('dirty'); },
    savePayload: () => ({ title: form.title, body: form.body, ownerId: form.ownerId, expectedVersion: cas.current }),
    useServer: baseline.adoptLatest,
    savedWhileEditing: (next: Draft) => { cas.current = next.version; baseline.acknowledge(next, false); },
  };
}

describe('CMS 显示稿与保存版本一致性', () => {
  it('adopts every clean field together with its CAS version on a background refresh', () => {
    const hook = renderHook(({ record }) => useEditor(record), { initialProps: { record: initial } });
    const refreshed = { ...initial, version: 2, title: '另一编辑者的标题', body: '另一编辑者的正文', ownerId: 2 };
    hook.rerender({ record: refreshed });
    expect(hook.result.current.form).toEqual(refreshed);
    act(() => hook.result.current.edit('仅修改标题'));
    expect(hook.result.current.savePayload()).toEqual({ title: '仅修改标题', body: refreshed.body, ownerId: 2, expectedVersion: 2 });
    expect(hook.result.current.conflicts).toBe(0);
  });

  it('keeps local edits and the old CAS version and reports a conflict when the server advances', () => {
    const hook = renderHook(({ record }) => useEditor(record), { initialProps: { record: initial } });
    act(() => hook.result.current.edit('我的未保存标题'));
    const refreshed = { ...initial, version: 2, body: '服务端新正文', ownerId: 2 };
    hook.rerender({ record: refreshed });
    expect(hook.result.current.savePayload()).toEqual({ title: '我的未保存标题', body: initial.body, ownerId: 1, expectedVersion: 1 });
    expect(hook.result.current.state).toBe('conflict');
    expect(hook.result.current.conflicts).toBe(1);
    hook.rerender({ record: { ...refreshed } });
    expect(hook.result.current.conflicts).toBe(1);
    act(() => hook.result.current.useServer());
    expect(hook.result.current.form).toEqual(refreshed);
    expect(hook.result.current.savePayload().expectedVersion).toBe(2);
    expect(hook.result.current.state).toBe('saved');
  });

  it('does not mistake an acknowledged save for another editor or roll its version back on a stale response', () => {
    const hook = renderHook(({ record }) => useEditor(record), { initialProps: { record: initial } });
    const saved = { ...initial, version: 2, title: '保存中的标题' };
    act(() => { hook.result.current.edit('保存期间继续输入'); hook.result.current.savedWhileEditing(saved); });
    hook.rerender({ record: { ...initial } });
    expect(hook.result.current.savePayload().expectedVersion).toBe(2);
    hook.rerender({ record: saved });
    expect(hook.result.current.form.title).toBe('保存期间继续输入');
    expect(hook.result.current.state).toBe('dirty');
    expect(hook.result.current.conflicts).toBe(0);
  });
});
