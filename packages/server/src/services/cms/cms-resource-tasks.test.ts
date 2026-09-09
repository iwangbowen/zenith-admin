import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskHandlerRegistration, TaskRunContext } from '../../lib/task-center/types';

/**
 * 素材引用索引重建任务的分片循环。
 *
 * 此前每个 owner 类型在一个事务里把全站行（含正文）一次装进内存并逐行重建；
 * 这里锁定新行为：按 id 游标分片、每片一个事务整批重建、断点落在「阶段 + 游标」、取消即停。
 * 各阶段的取数 SQL 与批量重建的语义由真实数据库验证，本文件只关心编排。
 */
const runtime = vi.hoisted(() => ({
  pages: new Map<unknown, Array<Array<{ id: number }>>>(),
  fetched: [] as unknown[],
}));

const TX = Symbol('tx');

vi.mock('../../db', () => {
  const terminal = (table: unknown) => ({
    limit: async () => {
      runtime.fetched.push(table);
      return runtime.pages.get(table)?.shift() ?? [];
    },
  });
  const afterFrom = (table: unknown) => ({
    where: () => ({ ...terminal(table), orderBy: () => terminal(table) }),
    innerJoin: () => ({ where: () => ({ orderBy: () => terminal(table) }) }),
  });
  return {
    db: {
      select: () => ({ from: (table: unknown) => afterFrom(table) }),
      transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(TX),
    },
  };
});
vi.mock('../../lib/task-center', () => ({ registerTaskHandler: vi.fn() }));
vi.mock('./cms-sites.service', () => ({ assertSiteAccess: vi.fn(async () => undefined) }));
vi.mock('./cms-resources.service', () => ({
  deleteCmsOrphanResource: vi.fn(), listCmsResourcesAfter: vi.fn(), listCmsSiteOrphanResourceIds: vi.fn(), moveCmsResources: vi.fn(),
}));
vi.mock('./cms-resource-refs.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./cms-resource-refs.service')>()),
  rebuildCmsResourceRefsForOwners: vi.fn(async () => undefined),
}));

import { cmsContents, cmsSites } from '../../db/schema';
import { registerTaskHandler } from '../../lib/task-center';
import { rebuildCmsResourceRefsForOwners } from './cms-resource-refs.service';
import { CMS_RESOURCE_REF_REBUILD_TASK, registerCmsResourceTaskHandler } from './cms-resource-tasks';

registerCmsResourceTaskHandler();
const handler = vi.mocked(registerTaskHandler).mock.calls
  .map(([registration]) => registration as TaskHandlerRegistration)
  .find((registration) => registration.taskType === CMS_RESOURCE_REF_REBUILD_TASK)!;

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ id: from + i }));

function makeCtx(checkpoint: Record<string, unknown> | null = null, cancelAtCall = Infinity) {
  let calls = 0;
  const progress = vi.fn(async () => ({ cancelRequested: ++calls >= cancelAtCall }));
  const reportItems = vi.fn(async () => undefined);
  const ctx = { taskId: 1, payload: { siteId: 1 }, checkpoint, attempt: 1, progress, reportItems, isCancelRequested: async () => false } as unknown as TaskRunContext;
  return { ctx, progress, reportItems };
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.pages.clear();
  runtime.fetched.length = 0;
});

describe('CMS 素材引用索引重建：分片编排', () => {
  it('rebuilds each owner type in id-ordered chunks, one transaction per chunk, and checkpoints the cursor', async () => {
    runtime.pages.set(cmsSites, [[{ id: 1 }]]);
    runtime.pages.set(cmsContents, [range(1, 200), range(201, 400), range(401, 450)]);
    const { ctx, progress, reportItems } = makeCtx();

    const result = await handler.run(ctx);

    // 站点 1 片 + 内容 3 片 = 4 次整批重建，每次都拿到事务执行器
    const calls = vi.mocked(rebuildCmsResourceRefsForOwners).mock.calls;
    expect(calls).toHaveLength(4);
    expect(calls.every(([executor]) => executor === TX)).toBe(true);
    const contentCalls = calls.filter(([, ownerType]) => ownerType === 'content');
    expect(contentCalls.map(([, , , owners]) => [owners[0].ownerId, owners.at(-1)!.ownerId, owners.length]))
      .toEqual([[1, 200, 200], [201, 400, 200], [401, 450, 50]]);
    // 内容表恰好取 3 片：最后一片不足 200 即停，不再多发一次空查询
    expect(runtime.fetched.filter((table) => table === cmsContents)).toHaveLength(3);

    // 断点随每片推进：内容是第 3 个阶段（index 2）
    const checkpoints = progress.mock.calls.map(([update]) => (update as { checkpoint: unknown }).checkpoint);
    expect(checkpoints).toEqual(expect.arrayContaining([
      { processed: 2, cursor: 200, stageCount: 200 },
      { processed: 2, cursor: 400, stageCount: 400 },
      { processed: 2, cursor: 450, stageCount: 450 },
      { processed: 3, cursor: 0, stageCount: 0 },
    ]));
    expect(reportItems).toHaveBeenCalledWith([expect.objectContaining({ key: 'stage-content', message: '已重建 450 个对象的引用' })]);
    expect(result).toEqual({ siteId: 1, processed: 8, total: 8 });
  });

  it('resumes from the checkpointed stage and cursor instead of restarting the stage', async () => {
    runtime.pages.set(cmsContents, [range(401, 450)]);
    const { ctx, reportItems } = makeCtx({ processed: 2, cursor: 400, stageCount: 400 });

    await handler.run(ctx);

    const calls = vi.mocked(rebuildCmsResourceRefsForOwners).mock.calls;
    expect(calls.map(([, ownerType]) => ownerType)).toEqual(['content']);
    expect(calls[0][3].map((owner) => owner.ownerId)).toEqual(range(401, 450).map((r) => r.id));
    // 站点 / 栏目阶段不再被重新取数
    expect(runtime.fetched).not.toContain(cmsSites);
    expect(reportItems).toHaveBeenCalledWith([expect.objectContaining({ key: 'stage-content', message: '已重建 450 个对象的引用' })]);
  });

  it('stops right after the chunk during which cancellation was requested', async () => {
    runtime.pages.set(cmsSites, [[{ id: 1 }]]);
    runtime.pages.set(cmsContents, [range(1, 200), range(201, 400)]);
    const { ctx } = makeCtx(null, 1);

    const result = await handler.run(ctx);

    expect(rebuildCmsResourceRefsForOwners).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ siteId: 1, processed: 0, total: 8, cancelled: true });
  });
});
