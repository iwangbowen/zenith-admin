import { beforeEach, describe, expect, it, vi } from 'vitest';

const { registrations, select, update } = vi.hoisted(() => ({
  registrations: [] as Array<{ taskType: string; run: (ctx: { payload: Record<string, unknown>; progress: (input: unknown) => Promise<unknown> }) => Promise<unknown> }>,
  select: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../../lib/task-center', () => ({
  registerTaskHandler: (registration: { taskType: string; run: (ctx: { payload: Record<string, unknown>; progress: (input: unknown) => Promise<unknown> }) => Promise<unknown> }) => registrations.push(registration),
}));
vi.mock('../../db', () => ({ db: { select, update } }));
vi.mock('./analytics-rollup.service', () => ({ rebuildRollup: vi.fn(async () => 0) }));
vi.mock('./analytics-segments.service', () => ({ materializeSegment: vi.fn(async () => ({ estimatedSize: 0 })) }));
vi.mock('../messaging/email-send-logs.service', () => ({ sendEmail: vi.fn() }));
vi.mock('../messaging/in-app-messages.service', () => ({ sendInApp: vi.fn() }));
vi.mock('../../lib/http-client', () => ({ httpPost: vi.fn() }));

import { registerAnalyticsTaskHandlers } from './analytics-tasks';

function selectRows(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(async () => rows);
  return chain;
}

function selectWhereRows(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(async () => rows);
  return chain;
}

function updateChain() {
  const chain: Record<string, unknown> = {};
  chain.set = vi.fn(() => chain);
  chain.where = vi.fn(async () => []);
  update.mockReturnValue(chain);
  return chain;
}

describe('analytics campaign execute task', () => {
  beforeEach(() => {
    registrations.length = 0;
    vi.clearAllMocks();
    updateChain();
    registerAnalyticsTaskHandlers();
  });

  it('fails clearly when segment member snapshot is empty and persists lastError', async () => {
    const campaign = { id: 1, segmentId: 2, tenantId: null, channel: 'email', templateId: 3, webhookUrl: null };
    select.mockReturnValueOnce(selectRows([campaign])).mockReturnValueOnce(selectWhereRows([]));
    const handler = registrations.find((r) => r.taskType === 'analytics-campaign-execute');
    await expect(handler?.run({ payload: { campaignId: 1 }, progress: vi.fn(async () => ({})) })).rejects.toThrow('分群成员快照为空');
    expect(update).toHaveBeenCalled();
  });
});
