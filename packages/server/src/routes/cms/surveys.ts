import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createCmsSurveySchema, updateCmsSurveySchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  ErrorResponse, jsonContent, PaginationQuery, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../../lib/openapi-schemas';
import { CmsSurveyDTO, CmsSurveyStatsDTO } from '../../lib/openapi-dtos';
import {
  listCmsSurveys, getCmsSurvey, createCmsSurvey, updateCmsSurvey, deleteCmsSurvey, getCmsSurveyStats,
} from '../../services/cms/cms-surveys.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['CMS-问卷调查'], summary: '问卷分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:survey:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        siteId: z.coerce.number().int().positive(),
        keyword: z.string().optional(),
        status: z.enum(['draft', 'published', 'closed']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsSurveyDTO, '问卷列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsSurveys(c.req.valid('query'))), 200),
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}',
    tags: ['CMS-问卷调查'], summary: '问卷详情（含题目）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:survey:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsSurveyDTO, '问卷详情'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await getCmsSurvey(c.req.valid('param').id)), 200),
});

const statsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/stats',
    tags: ['CMS-问卷调查'], summary: '问卷结果统计（选项占比 + 文字题样本）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:survey:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsSurveyStatsDTO, '统计结果') },
  }),
  handler: async (c) => c.json(okBody(await getCmsSurveyStats(c.req.valid('param').id)), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['CMS-问卷调查'], summary: '创建问卷',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:survey:manage', audit: { description: '创建 CMS 问卷', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(createCmsSurveySchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsSurveyDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCmsSurvey(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['CMS-问卷调查'], summary: '更新问卷（题目全量替换）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:survey:manage', audit: { description: '更新 CMS 问卷', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsSurveySchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsSurveyDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsSurvey(id));
    return c.json(okBody(await updateCmsSurvey(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['CMS-问卷调查'], summary: '删除问卷（答卷级联删除）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:survey:manage', audit: { description: '删除 CMS 问卷', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsSurvey(id));
    await deleteCmsSurvey(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, getOneRoute, statsRoute, createRoute_, updateRoute_, deleteRoute_] as const);

export default router;
