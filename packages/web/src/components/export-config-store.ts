import type { ExportConfiguration } from './ExportConfigPanel';
let current: ExportConfiguration | null = null;
const listeners = new Set<() => void>();
export const exportConfigStore = {
  getSnapshot: () => current,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  open(value: ExportConfiguration) { current = value; for (const listener of listeners) listener(); },
  close() { current = null; for (const listener of listeners) listener(); },
};
