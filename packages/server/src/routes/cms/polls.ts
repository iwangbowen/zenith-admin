import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createCmsPollSchema, updateCmsPollSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import {
  jsonContent, PaginationQuery, IdParam, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, okBody,
} from '../../lib/openapi-schemas';
import { CmsPollDTO, CmsPollResultsDTO } from '../../lib/openapi-dtos';
import {
  listCmsPolls, createCmsPoll, updateCmsPoll, setCmsPollStatus, deleteCmsPoll, getCmsPollResultsById,
} from '../../services/cms/cms-polls.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['CMS-投票管理'], summary: '投票分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:poll:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        siteId: z.coerce.number().int().positive(),
        status: z.enum(['draft', 'published', 'closed']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsPollDTO, '投票列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsPolls(c.req.valid('query'))), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['CMS-投票管理'], summary: '新增投票',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:poll:manage', audit: { description: 'CMS 新增投票', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(createCmsPollSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsPollDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCmsPoll(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['CMS-投票管理'], summary: '编辑投票',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:poll:manage', audit: { description: 'CMS 编辑投票', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsPollSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsPollDTO, '已保存') },
  }),
  handler: async (c) => c.json(okBody(await updateCmsPoll(c.req.valid('param').id, c.req.valid('json')), '已保存'), 200),
});

const statusRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/status',
    tags: ['CMS-投票管理'], summary: '变更投票状态（发布/结束/回草稿）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:poll:manage', audit: { description: 'CMS 变更投票状态', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(z.object({ status: z.enum(['draft', 'published', 'closed']) })), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsPollDTO, '已更新') },
  }),
  handler: async (c) => c.json(okBody(await setCmsPollStatus(c.req.valid('param').id, c.req.valid('json').status), '已更新'), 200),
});

const resultsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/results',
    tags: ['CMS-投票管理'], summary: '投票结果（选项计票）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:poll:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsPollResultsDTO, '投票结果') },
  }),
  handler: async (c) => c.json(okBody(await getCmsPollResultsById(c.req.valid('param').id)), 200),
});

const deleteRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['CMS-投票管理'], summary: '删除投票（含全部投票记录）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:poll:manage', audit: { description: 'CMS 删除投票', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    await deleteCmsPoll(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, createRouteDef, updateRouteDef, statusRoute, resultsRoute, deleteRouteDef] as const);

export default router;
