import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createReportPrintTemplateSchema, updateReportPrintTemplateSchema, reportPrintRenderSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../lib/openapi-schemas';
import { ReportPrintTemplateDTO, ReportPrintRenderResultDTO } from '../lib/openapi-dtos';
import {
  listPrintTemplates, getPrintTemplate, createPrintTemplate, updatePrintTemplate,
  deletePrintTemplate, ensurePrintTemplateExists, renderPrintTemplate,
} from '../services/report-print.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['报表打印'], summary: '打印报表列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:print:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(ReportPrintTemplateDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listPrintTemplates(c.req.valid('query'))), 200),
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}',
    tags: ['报表打印'], summary: '打印报表详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:print:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(ReportPrintTemplateDTO, '详情'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => c.json(okBody(await getPrintTemplate(c.req.valid('param').id)), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['报表打印'], summary: '创建打印报表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:print:create', audit: { description: '创建打印报表', module: '报表打印' } })] as const,
    request: { body: { content: jsonContent(createReportPrintTemplateSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportPrintTemplateDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createPrintTemplate(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['报表打印'], summary: '更新打印报表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:print:update', audit: { description: '更新打印报表', module: '报表打印' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateReportPrintTemplateSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportPrintTemplateDTO, '更新成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensurePrintTemplateExists(id);
    setAuditBeforeData(c, before);
    return c.json(okBody(await updatePrintTemplate(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['报表打印'], summary: '删除打印报表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:print:delete', audit: { description: '删除打印报表', module: '报表打印' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensurePrintTemplateExists(id);
    setAuditBeforeData(c, before);
    await deletePrintTemplate(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const renderRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/render',
    tags: ['报表打印'], summary: '取数渲染打印报表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:print:list' })] as const,
    request: { params: IdParam, body: { content: jsonContent(reportPrintRenderSchema), required: false } },
    responses: { ...commonErrorResponses, ...ok(ReportPrintRenderResultDTO, '渲染结果'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => c.json(okBody(await renderPrintTemplate(c.req.valid('param').id, c.req.valid('json'))), 200),
});

router.openapiRoutes([listRoute, getOneRoute, createRoute_, updateRoute_, deleteRoute_, renderRoute] as const);

export default router;
