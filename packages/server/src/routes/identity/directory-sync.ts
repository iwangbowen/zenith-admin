import { OpenAPIHono } from '@hono/zod-openapi';
import { directorySyncContract } from '@zenith/shared/identity';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody, errBody } from '../../lib/openapi-schemas';
import {
  listDirectorySyncRuns, getDirectorySyncRun, listDirectorySyncRunItems, retryDirectorySyncRun,
  listDirectorySyncConflicts, resolveDirectorySyncConflict, ignoreDirectorySyncConflicts,
  ensureDirectorySyncConflictExists,
  markDirectorySyncRunFailed,
} from '../../services/identity/directory-sync.service';
import { currentUserId } from '../../lib/context';

const directorySyncRouter = new OpenAPIHono({ defaultHook: validationHook });

// ─── 同步记录 ─────────────────────────────────────────────────────────────────
const listRunsRoute = defineContractRoute(directorySyncContract.listRuns, {
  handler: async (c) => c.json(okBody(await listDirectorySyncRuns(c.req.valid('query'))), 200),
});

const getRunRoute = defineContractRoute(directorySyncContract.runDetail, {
  handler: async (c) => c.json(okBody(await getDirectorySyncRun(c.req.valid('param').id)), 200),
});

const listRunItemsRoute = defineContractRoute(directorySyncContract.listRunItems, {
  handler: async (c) => c.json(okBody(await listDirectorySyncRunItems(c.req.valid('param').id, c.req.valid('query'))), 200),
});

const retryRunRoute = defineContractRoute(directorySyncContract.retryRun, {
  handler: async (c) => {
    const task = await retryDirectorySyncRun(c.req.valid('param').id);
    return c.json(okBody(task, '重试任务已提交'), 200);
  },
});

const markRunFailedRoute = defineContractRoute(directorySyncContract.markRunFailed, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getDirectorySyncRun(id));
    const row = await markDirectorySyncRunFailed(id);
    setAuditAfterData(c, row);
    return c.json(okBody(row, '已标记为失败'), 200);
  },
});

// ─── 冲突处理 ─────────────────────────────────────────────────────────────────
const listConflictsRoute = defineContractRoute(directorySyncContract.listConflicts, {
  handler: async (c) => c.json(okBody(await listDirectorySyncConflicts(c.req.valid('query'))), 200),
});

const ignoreConflictsRoute = defineContractRoute(directorySyncContract.ignoreConflicts, {
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    if (!ids?.length) return c.json(errBody('请选择要忽略的冲突'), 400);
    const count = await ignoreDirectorySyncConflicts(ids, currentUserId());
    return c.json(okBody(null, `已忽略 ${count} 条冲突`), 200);
  },
});

const resolveConflictRoute = defineContractRoute(directorySyncContract.resolveConflict, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDirectorySyncConflictExists(id));
    const row = await resolveDirectorySyncConflict(id, c.req.valid('json'), currentUserId());
    return c.json(okBody(row, '裁决成功'), 200);
  },
});

directorySyncRouter.openapiRoutes([
  listRunsRoute,
  getRunRoute,
  listRunItemsRoute,
  retryRunRoute,
  markRunFailedRoute,
  listConflictsRoute,
  ignoreConflictsRoute,
  resolveConflictRoute,
] as const);

export default directorySyncRouter;
