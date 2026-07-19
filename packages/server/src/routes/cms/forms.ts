import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createCmsFormSchema, updateCmsFormSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  ErrorResponse, jsonContent, PaginationQuery, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, BatchIdsBody, okBody,
} from '../../lib/openapi-schemas';
import { CmsFormDTO, CmsFormSubmissionDTO } from '../../lib/openapi-dtos';
import {
  listCmsForms, createCmsForm, updateCmsForm, deleteCmsForm, ensureCmsFormExists, mapCmsForm,
  listCmsFormSubmissions, deleteCmsFormSubmissions,
} from '../../services/cms/cms-forms.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['CMS-表单管理'], summary: '表单分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:form:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        siteId: z.coerce.number().int().positive(),
        keyword: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsFormDTO, '表单列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsForms(c.req.valid('query'))), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['CMS-表单管理'], summary: '创建表单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:form:manage', audit: { description: '创建 CMS 表单', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(createCmsFormSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsFormDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCmsForm(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['CMS-表单管理'], summary: '更新表单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:form:manage', audit: { description: '更新 CMS 表单', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsFormSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsFormDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsForm(await ensureCmsFormExists(id)));
    return c.json(okBody(await updateCmsForm(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['CMS-表单管理'], summary: '删除表单（含全部提交数据）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:form:manage', audit: { description: '删除 CMS 表单', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsForm(await ensureCmsFormExists(id)));
    await deleteCmsForm(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const listSubmissionsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/submissions',
    tags: ['CMS-表单管理'], summary: '表单提交数据列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:form:list' })] as const,
    request: { params: IdParam, query: PaginationQuery },
    responses: { ...commonErrorResponses, ...okPaginated(CmsFormSubmissionDTO, '提交数据') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listCmsFormSubmissions(id, page, pageSize)), 200);
  },
});

const deleteSubmissionsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/submissions/delete',
    tags: ['CMS-表单管理'], summary: '批量删除提交数据',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:form:manage', audit: { description: '删除 CMS 表单提交数据', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { ids } = c.req.valid('json');
    await deleteCmsFormSubmissions(id, ids);
    return c.json(okBody(null, `已删除 ${ids.length} 条提交数据`), 200);
  },
});

router.openapiRoutes([listRoute, createRoute_, updateRoute_, deleteRoute_, listSubmissionsRoute, deleteSubmissionsRoute] as const);

export default router;
