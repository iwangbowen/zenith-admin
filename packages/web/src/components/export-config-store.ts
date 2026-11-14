import type { ExportConfiguration } from './ExportConfigPanel';
let current: { id: number; configuration: ExportConfiguration } | null = null;
let nextId = 0;
const listeners = new Set<() => void>();
export const exportConfigStore = {
  getSnapshot: () => current,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  open(value: ExportConfiguration) { current = { id: ++nextId, configuration: value }; for (const listener of listeners) listener(); },
  close() { current = null; for (const listener of listeners) listener(); },
};
