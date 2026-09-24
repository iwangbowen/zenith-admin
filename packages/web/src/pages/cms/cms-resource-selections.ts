import { collectCmsSelectedResourceIds } from '@zenith/shared/cms';

/** Selection intent survives retries, while older save responses cannot clear newer choices. */
export function createCmsResourceSelections() {
  let sequence = 0;
  const pending = new Map<number, number>();
  return {
    select(id: number) { pending.set(id, ++sequence); },
    ids() { return [...pending.keys()]; },
    reset(ids: readonly number[] = []) { pending.clear(); for (const id of ids) pending.set(id, ++sequence); },
    capture(payload: unknown) {
      const current = new Set(collectCmsSelectedResourceIds(payload));
      return new Map([...pending].filter(([id]) => current.has(id)));
    },
    acknowledge(saved: ReadonlyMap<number, number>) {
      for (const [id, at] of saved) if (pending.get(id) === at) pending.delete(id);
    },
  };
}

/** Adopt frozen URLs only for handles unchanged since this save, preserving newer edits and selections. */
export function adoptCmsSavedResourceValues<T>(current: T, submitted: unknown, saved: unknown, pendingIds: ReadonlySet<number> = new Set()): T {
  if (typeof current === 'string' && current === submitted && typeof saved === 'string') {
    const match = /^cms-res:\/\/([1-9]\d*)$/.exec(current);
    return match && !pendingIds.has(Number(match[1])) ? saved as T : current;
  }
  if (Array.isArray(current) && Array.isArray(submitted) && Array.isArray(saved)) {
    const next = current.map((value, index) => adoptCmsSavedResourceValues(value, submitted[index], saved[index], pendingIds));
    return next.some((value, index) => value !== current[index]) ? next as T : current;
  }
  if (current && submitted && saved && typeof current === 'object' && typeof submitted === 'object' && typeof saved === 'object' && !Array.isArray(current)) {
    let changed = false;
    const before = submitted as Record<string, unknown>;
    const after = saved as Record<string, unknown>;
    const next = Object.fromEntries(Object.entries(current).map(([key, value]) => {
      const adopted = adoptCmsSavedResourceValues(value, before[key], after[key], pendingIds);
      changed ||= adopted !== value;
      return [key, adopted];
    }));
    return changed ? next as T : current;
  }
  return current;
}
