import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createCmsErrorProneWordSchema, updateCmsErrorProneWordSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  ErrorResponse, jsonContent, PaginationQuery, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../../lib/openapi-schemas';
import { CmsErrorProneWordDTO } from '../../lib/openapi-dtos';
import {
  listCmsErrorProneWords, createCmsErrorProneWord, updateCmsErrorProneWord,
  deleteCmsErrorProneWord, mapCmsErrorProneWord, ensureCmsErrorProneWordExists,
} from '../../services/cms/cms-error-prone-words.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['CMS-易错词库'], summary: '易错词分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:word:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsErrorProneWordDTO, '易错词列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsErrorProneWords(c.req.valid('query'))), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['CMS-易错词库'], summary: '新增易错词',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:word:manage', audit: { description: '新增 CMS 易错词', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(createCmsErrorProneWordSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsErrorProneWordDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCmsErrorProneWord(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['CMS-易错词库'], summary: '更新易错词',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:word:manage', audit: { description: '更新 CMS 易错词', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsErrorProneWordSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsErrorProneWordDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsErrorProneWord(await ensureCmsErrorProneWordExists(id)));
    return c.json(okBody(await updateCmsErrorProneWord(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['CMS-易错词库'], summary: '删除易错词',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:word:manage', audit: { description: '删除 CMS 易错词', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsErrorProneWord(await ensureCmsErrorProneWordExists(id)));
    await deleteCmsErrorProneWord(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, createRoute_, updateRoute_, deleteRoute_] as const);

export default router;
