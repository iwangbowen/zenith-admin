import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPException } from 'hono/http-exception';

const { select, update, del, count, submitAsyncTask } = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
  count: vi.fn(async () => 0),
  submitAsyncTask: vi.fn(async () => ({ id: 99, taskType: 'analytics-campaign-execute' })),
}));

vi.mock('../../db', () => ({ db: { select, update, delete: del, $count: count } }));
vi.mock('../../lib/tenant', () => ({ tenantScope: () => undefined, currentCreateTenantId: () => 7 }));
vi.mock('../../lib/task-center', () => ({ submitAsyncTask }));
vi.mock('./analytics-segments.service', () => ({
  ensureSegmentExists: vi.fn(async (id: number) => ({ id, tenantId: 7, name: '测试分群' })),
}));

import { executeCampaign, updateCampaign } from './analytics-campaigns.service';

function selectRows(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(async () => rows);
  return chain;
}

function updateReturning(rows: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  chain.set = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.returning = vi.fn(async () => rows);
  update.mockReturnValue(chain);
  return chain;
}

const baseCampaign = {
  id: 1,
  tenantId: 7,
  segmentId: 2,
  name: '触达',
  channel: 'email' as const,
  templateId: 3,
  webhookUrl: null,
  status: 'draft' as const,
  totalCount: 0,
  sentCount: 0,
  failedCount: 0,
  lastRunAt: null,
  lastError: null,
  createdBy: 1,
  updatedBy: 1,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('analytics campaigns service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects updating a non-draft campaign', async () => {
    select.mockReturnValue(selectRows([{ ...baseCampaign, status: 'completed' }]));
    await expect(updateCampaign(1, { name: 'new' })).rejects.toThrow(HTTPException);
    expect(update).not.toHaveBeenCalled();
  });

  it('marks runnable campaigns as running (atomic CAS) and submits task with minute idempotency bucket', async () => {
    select.mockReturnValue(selectRows(baseCampaign ? [baseCampaign] : []));
    updateReturning([{ id: 1 }]); // CAS 命中：status <> 'running' 的行被更新并返回
    await executeCampaign(1);
    expect(update).toHaveBeenCalled();
    expect(submitAsyncTask).toHaveBeenCalledWith(expect.objectContaining({
      taskType: 'analytics-campaign-execute',
      payload: { campaignId: 1 },
      idempotencyKey: expect.stringContaining('analytics-campaign-execute:1:'),
    }));
  });

  it('rejects concurrent execute when atomic CAS misses (already running)', async () => {
    select.mockReturnValue(selectRows([baseCampaign]));
    updateReturning([]); // 另一并发请求已抢先置 running，CAS 未命中
    await expect(executeCampaign(1)).rejects.toThrow(HTTPException);
    expect(submitAsyncTask).not.toHaveBeenCalled();
  });
});
