import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../middleware/guard';
import { currentUser } from '../lib/context';
import {
  validationHook,
  commonErrorResponses,
  ok,
  okPaginated,
  okMsg,
  okBody,
  jsonContent,
  okFile,
  fileBody,
  IdParam,
  PaginationQuery,
} from '../lib/openapi-schemas';
import { parseDateRangeStart, parseDateRangeEnd } from '../lib/datetime';
import { TerminalRecordingDTO, TerminalRecordingDetailDTO } from '../lib/openapi-dtos';
import {
  createRecording,
  listRecordings,
  getRecording,
  getRecordingBeforeAudit,
  exportRecordingAsciinema,
  deleteRecording,
  cleanRecordings,
} from '../services/terminal-recordings.service';

const recordingsRouter = new OpenAPIHono({ defaultHook: validationHook });

const PERM = 'system:terminal:execute';

const CreateRecordingBody = z.object({
  title: z.string().max(256).optional().default(''),
  shell: z.string().max(64).nullable().optional(),
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(500),
  duration: z.number().min(0),
  events: z.array(z.tuple([z.number(), z.enum(['o', 'i']), z.string()])),
});

const RecordingListQuery = PaginationQuery.extend({
  keyword: z.string().optional(),
  operatorUserId: z.coerce.number().int().positive().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['TerminalRecordings'], summary: '我的录屏列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM })] as const,
    request: { query: RecordingListQuery },
    responses: { ...commonErrorResponses, ...okPaginated(TerminalRecordingDTO, '录屏列表') },
  }),
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

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['TerminalRecordings'], summary: '保存录屏',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '保存终端录屏', module: 'Web 终端', recordBody: false } })] as const,
    request: { body: { content: jsonContent(CreateRecordingBody), required: true } },
    responses: { ...commonErrorResponses, ...ok(TerminalRecordingDTO, '保存成功') },
  }),
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

const getRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/:id', tags: ['TerminalRecordings'], summary: '获取录屏详情（含 events）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(TerminalRecordingDetailDTO, '录屏详情') },
  }),
  handler: async (c) => {
    const id = Number(c.req.valid('param').id);
    return c.json(okBody(await getRecording(id)), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/:id', tags: ['TerminalRecordings'], summary: '删除录屏',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '删除终端录屏', module: 'Web 终端' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const id = Number(c.req.valid('param').id);
    setAuditBeforeData(c, await getRecordingBeforeAudit(id));
    await deleteRecording(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const exportAsciinemaRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/:id/asciinema', tags: ['TerminalRecordings'], summary: '导出 asciinema 录屏',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okFile('asciinema cast 文件') },
  }),
  handler: async (c) => {
    const result = await exportRecordingAsciinema(Number(c.req.valid('param').id));
    return fileBody(result.content, result.filename, result.contentType);
  },
});

const cleanRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/clean', tags: ['TerminalRecordings'], summary: '清除录屏记录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '清除终端录屏', module: 'Web 终端' } })] as const,
    request: { query: z.object({ months: z.coerce.number().int().min(0).default(0) }) },
    responses: { ...commonErrorResponses, ...okMsg('清除成功') },
  }),
  handler: async (c) => {
    const { months } = c.req.valid('query');
    const deleted = await cleanRecordings(months);
    setAuditAfterData(c, { months, deleted });
    return c.json(okBody(null, `共删除 ${deleted} 条录屏记录`), 200);
  },
});

recordingsRouter.openapiRoutes([listRoute, createRoute_, cleanRoute, exportAsciinemaRoute, getRoute, deleteRoute] as const);

export default recordingsRouter;
