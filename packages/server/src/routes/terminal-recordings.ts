import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { currentUser } from '../lib/context';
import {
  validationHook,
  commonErrorResponses,
  ok,
  okPaginated,
  okMsg,
  okBody,
  jsonContent,
  IdParam,
  PaginationQuery,
} from '../lib/openapi-schemas';
import { TerminalRecordingDTO, TerminalRecordingDetailDTO } from '../lib/openapi-dtos';
import {
  createRecording,
  listRecordings,
  getRecording,
  deleteRecording,
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

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['TerminalRecordings'], summary: '我的录屏列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(TerminalRecordingDTO, '录屏列表') },
  }),
  handler: async (c) => {
    const user = currentUser();
    const { page = 1, pageSize = 20, keyword } = c.req.valid('query');
    return c.json(okBody(await listRecordings(user.userId, Number(page), Number(pageSize), keyword)), 200);
  },
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['TerminalRecordings'], summary: '保存录屏',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM })] as const,
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
      events: body.events as [number, 'o' | 'i', string][],
    });
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
    const user = currentUser();
    const id = Number(c.req.valid('param').id);
    return c.json(okBody(await getRecording(id, user.userId)), 200);
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
    const user = currentUser();
    await deleteRecording(Number(c.req.valid('param').id), user.userId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

recordingsRouter.openapiRoutes([listRoute, createRoute_, getRoute, deleteRoute] as const);

export default recordingsRouter;
