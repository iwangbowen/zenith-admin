import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createCmsSensitiveWordSchema, updateCmsSensitiveWordSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  ErrorResponse, jsonContent, PaginationQuery, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../../lib/openapi-schemas';
import { CmsSensitiveWordDTO } from '../../lib/openapi-dtos';
import {
  listCmsSensitiveWords, createCmsSensitiveWord, updateCmsSensitiveWord, deleteCmsSensitiveWord,
  ensureCmsSensitiveWordExists, mapCmsSensitiveWord,
} from '../../services/cms/cms-sensitive-words.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['CMS-敏感词库'], summary: '敏感词分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:sensitive:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsSensitiveWordDTO, '敏感词列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsSensitiveWords(c.req.valid('query'))), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['CMS-敏感词库'], summary: '创建敏感词',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:sensitive:manage', audit: { description: '创建 CMS 敏感词', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(createCmsSensitiveWordSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsSensitiveWordDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCmsSensitiveWord(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['CMS-敏感词库'], summary: '更新敏感词',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:sensitive:manage', audit: { description: '更新 CMS 敏感词', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsSensitiveWordSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsSensitiveWordDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsSensitiveWord(await ensureCmsSensitiveWordExists(id)));
    return c.json(okBody(await updateCmsSensitiveWord(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['CMS-敏感词库'], summary: '删除敏感词',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:sensitive:manage', audit: { description: '删除 CMS 敏感词', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsSensitiveWord(await ensureCmsSensitiveWordExists(id)));
    await deleteCmsSensitiveWord(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, createRoute_, updateRoute_, deleteRoute_] as const);

export default router;
