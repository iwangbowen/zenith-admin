import { expect, it, vi } from 'vitest';
it('rejects duplicates and lists sources in stable order', async () => {
  vi.resetModules();
  const registry = await import('./registry');
  const collect = async () => ({ counts: { pending: 0, running: 0, stuck: 0, dead: null, failed24h: 0, succeeded24h: 0 }, oldestPendingAgeSec: null, issues: [] });
  registry.registerJobSource({ key: 'export-job', title: 'export', module: 'tasks', order: 20, collect });
  registry.registerJobSource({ key: 'async-task', title: 'tasks', module: 'tasks', order: 10, collect });
  expect(registry.listJobSources().map(s => s.key)).toEqual(['async-task', 'export-job']);
  expect(() => registry.registerJobSource({ key: 'async-task', title: '', module: '', order: 10, collect })).toThrow('重复作业源');
});
