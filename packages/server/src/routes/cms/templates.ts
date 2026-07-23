import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import {
  activateCmsTemplateSchema,
  createCmsTemplateSchema,
  previewCmsTemplateSchema,
  saveCmsTemplateVersionSchema,
  updateCmsTemplateSchema,
} from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import {
  commonErrorResponses,
  IdParam,
  jsonContent,
  ok,
  okBody,
  okPaginated,
  PaginationQuery,
  validationHook,
} from '../../lib/openapi-schemas';
import {
  CmsTemplateActionResultDTO,
  CmsTemplateDetailDTO,
  CmsTemplateDiffDTO,
  CmsTemplateDTO,
  CmsTemplateValidationReportDTO,
  CmsTemplateVersionDTO,
} from '../../lib/openapi-dtos';
import {
  createCmsTemplate,
  diffCmsTemplateVersions,
  ensureCmsTemplateExists,
  getCmsTemplateDetail,
  listCmsTemplates,
  mapCmsTemplate,
  saveCmsTemplateVersion,
  updateCmsTemplate,
  validateCmsTemplateDsl,
} from '../../services/cms/cms-templates.service';
import {
  activateCmsTemplate,
  deactivateCmsTemplate,
  rollbackCmsTemplate,
} from '../../services/cms/cms-template-lifecycle.service';
import { previewCmsTemplate } from '../../services/cms/cms-themes.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['CMS-模板管理'], summary: '模板分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:template:view' })] as const,
    request: {
      query: PaginationQuery.extend({
        siteId: z.coerce.number().int().positive().optional(),
        themeCode: z.string().max(50).optional(),
        type: z.enum(['layout', 'index', 'list', 'detail', 'page', 'search', 'tag', 'not_found', 'custom_page', 'block', 'interaction']).optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
        keyword: z.string().max(100).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsTemplateDTO, '模板列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsTemplates(c.req.valid('query'))), 200),
});

const validateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/validate', tags: ['CMS-模板管理'], summary: '验证声明式模板 DSL',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:template:view' })] as const,
    request: { body: { content: jsonContent(z.object({ dsl: z.unknown() })), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsTemplateValidationReportDTO, '验证报告') },
  }),
  handler: async (c) => c.json(okBody(validateCmsTemplateDsl(c.req.valid('json').dsl)), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['CMS-模板管理'], summary: '创建模板与初始版本',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:template:manage', audit: { description: '创建 CMS 模板', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(createCmsTemplateSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsTemplateDetailDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCmsTemplate(c.req.valid('json')), '创建成功'), 200),
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['CMS-模板管理'], summary: '模板详情与版本',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:template:view' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsTemplateDetailDTO, '模板详情') },
  }),
  handler: async (c) => c.json(okBody(await getCmsTemplateDetail(c.req.valid('param').id)), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['CMS-模板管理'], summary: '更新模板元数据',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:template:manage', audit: { description: '更新 CMS 模板', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsTemplateSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsTemplateDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsTemplate(await ensureCmsTemplateExists(id)));
    return c.json(okBody(await updateCmsTemplate(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const saveVersionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/versions', tags: ['CMS-模板管理'], summary: '追加模板版本',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:template:manage', audit: { description: '保存 CMS 模板新版本', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(saveCmsTemplateVersionSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsTemplateVersionDTO, '新版本') },
  }),
  handler: async (c) => c.json(okBody(await saveCmsTemplateVersion(c.req.valid('param').id, c.req.valid('json')), '新版本已保存'), 200),
});

const diffRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/diff', tags: ['CMS-模板管理'], summary: '模板版本结构化差异',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:template:view' })] as const,
    request: {
      params: IdParam,
      query: z.object({ from: z.coerce.number().int().positive(), to: z.coerce.number().int().positive() }),
    },
    responses: { ...commonErrorResponses, ...ok(CmsTemplateDiffDTO, '版本差异') },
  }),
  handler: async (c) => {
    const { from, to } = c.req.valid('query');
    return c.json(okBody(await diffCmsTemplateVersions(c.req.valid('param').id, from, to)), 200);
  },
});

const previewRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/preview', tags: ['CMS-模板管理'], summary: '使用正式渲染链预览模板版本',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:template:view' })] as const,
    request: { params: IdParam, body: { content: jsonContent(previewCmsTemplateSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(z.object({ html: z.string(), status: z.number().int() }), '预览 HTML') },
  }),
  handler: async (c) => {
    const input = c.req.valid('json');
    return c.json(okBody(await previewCmsTemplate(c.req.valid('param').id, input.siteId, input.path, input.version)), 200);
  },
});

const activateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/activate', tags: ['CMS-模板管理'], summary: '激活模板版本并提交影响重建',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:template:activate', audit: { description: '激活 CMS 模板', module: 'CMS内容管理' } }), idempotencyGuard({ ttlSeconds: 60 })] as const,
    request: { params: IdParam, body: { content: jsonContent(activateCmsTemplateSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsTemplateActionResultDTO, '激活结果') },
  }),
  handler: async (c) => c.json(okBody(await activateCmsTemplate(c.req.valid('param').id, c.req.valid('json').version), '模板已激活，影响重建已提交'), 200),
});

const deactivateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/deactivate', tags: ['CMS-模板管理'], summary: '停用模板并提交影响重建',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:template:activate', audit: { description: '停用 CMS 模板', module: 'CMS内容管理' } }), idempotencyGuard({ ttlSeconds: 60 })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsTemplateActionResultDTO, '停用结果') },
  }),
  handler: async (c) => c.json(okBody(await deactivateCmsTemplate(c.req.valid('param').id), '模板已停用'), 200),
});

const rollbackRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/rollback', tags: ['CMS-模板管理'], summary: '回滚模板（复制目标版本为新版本后激活）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:template:activate', audit: { description: '回滚 CMS 模板', module: 'CMS内容管理' } }), idempotencyGuard({ ttlSeconds: 60 })] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ version: z.number().int().positive(), changeNote: z.string().max(500).optional() })), required: true },
    },
    responses: { ...commonErrorResponses, ...ok(CmsTemplateActionResultDTO, '回滚结果') },
  }),
  handler: async (c) => {
    const input = c.req.valid('json');
    return c.json(okBody(await rollbackCmsTemplate(c.req.valid('param').id, input.version, input.changeNote), '模板已回滚并激活'), 200);
  },
});

router.openapiRoutes([
  listRoute, validateRoute, createRoute_, getOneRoute, updateRoute_, saveVersionRoute,
  diffRoute, previewRoute, activateRoute, deactivateRoute, rollbackRoute,
] as const);

export default router;
