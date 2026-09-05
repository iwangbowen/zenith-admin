import { OpenAPIHono } from '@hono/zod-openapi';
import { terminalRecordingContract } from '@zenith/shared/ops';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { currentUser } from '../../lib/context';
import { defineContractRoute } from '../../lib/contract-route';
import { fileBody, okBody, validationHook } from '../../lib/openapi-schemas';
import { parseDateRangeStart, parseDateRangeEnd } from '../../lib/datetime';
import {
  createRecording,
  listRecordings,
  getRecording,
  getRecordingBeforeAudit,
  exportRecordingAsciinema,
  deleteRecording,
  cleanRecordings,
} from '../../services/ops/terminal-recordings.service';

const recordingsRouter = new OpenAPIHono({ defaultHook: validationHook });

const PERM = 'system:terminal:execute';

const read = [authMiddleware, guard({ permission: PERM })] as const;

const listRoute = defineContractRoute(terminalRecordingContract.list, {
  middleware: read,
  handler: async (c) => {
    const { page = 1, pageSize = 20, keyword, operatorUserId, startTime, endTime } = c.req.valid('query');
    return c.json(okBody(await listRecordings({
      page: Number(page),
      pageSize: Number(pageSize),
      keyword,
      operatorUserId,
      startDate: parseDateRangeStart(startTime) ?? undefined,
      endDate: parseDateRangeEnd(endTime) ?? undefined,
    })), 200);
  },
});

const createRoute_ = defineContractRoute(terminalRecordingContract.create, {
  middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '保存终端录屏', module: 'Web 终端', recordBody: false } })],
  handler: async (c) => {
    const user = currentUser();
    const body = c.req.valid('json');
    const result = await createRecording(user.userId, user.tenantId ?? null, {
      title: body.title,
      shell: body.shell ?? null,
      cols: body.cols,
      rows: body.rows,
      duration: body.duration,
      events: body.events,
    });
    setAuditAfterData(c, result);
    return c.json(okBody(result, '保存成功'), 200);
  },
});

const getRoute = defineContractRoute(terminalRecordingContract.detail, {
  middleware: read,
  handler: async (c) => {
    const id = Number(c.req.valid('param').id);
    return c.json(okBody(await getRecording(id)), 200);
  },
});

const deleteRoute = defineContractRoute(terminalRecordingContract.remove, {
  middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '删除终端录屏', module: 'Web 终端' } })],
  handler: async (c) => {
    const id = Number(c.req.valid('param').id);
    setAuditBeforeData(c, await getRecordingBeforeAudit(id));
    await deleteRecording(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const exportAsciinemaRoute = defineContractRoute(terminalRecordingContract.asciinema, {
  middleware: read,
  handler: async (c) => {
    const result = await exportRecordingAsciinema(Number(c.req.valid('param').id));
    return fileBody(result.content, result.filename, result.contentType);
  },
});

const cleanRoute = defineContractRoute(terminalRecordingContract.clean, {
  middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '清除终端录屏', module: 'Web 终端' } })],
  handler: async (c) => {
    const { days } = c.req.valid('query');
    const deleted = await cleanRecordings(days);
    setAuditAfterData(c, { days, deleted });
    return c.json(okBody(null, `共删除 ${deleted} 条录屏记录`), 200);
  },
});

// 静态 DELETE /clean 必须先于 DELETE /{id} 注册
recordingsRouter.openapiRoutes([listRoute, createRoute_, cleanRoute, exportAsciinemaRoute, getRoute, deleteRoute] as const);

export default recordingsRouter;
