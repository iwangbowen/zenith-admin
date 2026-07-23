import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { activateCmsThemePackageSchema, cmsThemeDeploymentActionSchema, previewCmsThemePackageSchema } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import {
  commonErrorResponses,
  errBody,
  IdParam,
  jsonContent,
  ok,
  okBody,
  okPaginated,
  PaginationQuery,
  validationHook,
} from '../../lib/openapi-schemas';
import {
  AsyncTaskDTO,
  CmsBuiltinThemeActivationDTO,
  CmsThemeImpactDTO,
  CmsThemePackageActivationDTO,
  CmsThemePackageDTO,
  CmsThemePackageValidationReportDTO,
} from '../../lib/openapi-dtos';
import {
  exportSignedCmsThemePackage,
  getCmsThemeImpact,
  getCmsThemePackage,
  listCmsThemePackages,
  previewCmsThemePackage,
  submitCmsThemeImport,
  validateCmsThemePackage,
} from '../../services/cms/cms-themes.service';
import {
  activateBuiltinCmsTheme,
  activateCmsThemePackage,
  deactivateCmsThemeForSite,
  rollbackCmsThemePackage,
  setCmsThemePackageStatus,
} from '../../services/cms/cms-theme-lifecycle.service';
import { CMS_THEME_PACKAGE_LIMITS } from '../../services/cms/cms-theme-package-security';

const router = new OpenAPIHono({ defaultHook: validationHook });
const themeUploadBodyLimit = bodyLimit({
  maxSize: CMS_THEME_PACKAGE_LIMITS.maxArchiveBytes + 64 * 1024,
  onError: (c) => c.json(errBody('主题包上传请求不能超过 10MB', 413), 413),
});
const UploadBody = {
  content: {
    'multipart/form-data': {
      schema: z.object({ file: z.any().openapi({ type: 'string', format: 'binary' }) }),
    },
  },
  required: true as const,
};

async function uploadedFile(c: { req: { parseBody(): Promise<Record<string, string | File>> } }): Promise<File> {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!file || typeof (file as File).arrayBuffer !== 'function') {
    throw new HTTPException(400, { message: '请选择 ZIP 主题包文件' });
  }
  return file as File;
}

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['CMS-主题包'], summary: '签名主题包版本列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:theme:view' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().max(100).optional(),
        code: z.string().max(50).optional(),
        status: z.enum(['validated', 'disabled']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsThemePackageDTO, '主题包列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsThemePackages(c.req.valid('query'))), 200),
});

const validateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/validate', tags: ['CMS-主题包'], summary: '校验主题包签名、安全边界与 DSL（不导入）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:theme:import' }), themeUploadBodyLimit] as const,
    request: { body: UploadBody },
    responses: { ...commonErrorResponses, ...ok(CmsThemePackageValidationReportDTO, '校验报告') },
  }),
  handler: async (c) => {
    const file = await uploadedFile(c);
    if (file.size > CMS_THEME_PACKAGE_LIMITS.maxArchiveBytes) throw new HTTPException(400, { message: '主题包不能超过 10MB' });
    return c.json(okBody(validateCmsThemePackage(Buffer.from(await file.arrayBuffer()))), 200);
  },
});

const importRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/import', tags: ['CMS-主题包'], summary: '提交签名主题包导入任务',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:theme:import', audit: { description: '导入 CMS 签名主题包', module: 'CMS内容管理', recordBody: false } }), themeUploadBodyLimit] as const,
    request: { body: UploadBody },
    responses: { ...commonErrorResponses, ...ok(AsyncTaskDTO, '导入任务') },
  }),
  handler: async (c) => c.json(okBody(await submitCmsThemeImport(await uploadedFile(c)), '主题包校验通过，导入任务已提交'), 200),
});

const impactRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/impact', tags: ['CMS-主题包'], summary: '主题/模板健康与影响分析',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:theme:view' })] as const,
    request: { query: z.object({ siteId: z.coerce.number().int().positive(), themeCode: z.string().max(50).optional(), packageId: z.coerce.number().int().positive().optional() }) },
    responses: { ...commonErrorResponses, ...ok(CmsThemeImpactDTO, '影响报告') },
  }),
  handler: async (c) => {
    const { siteId, themeCode, packageId } = c.req.valid('query');
    return c.json(okBody(await getCmsThemeImpact(siteId, themeCode, packageId)), 200);
  },
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['CMS-主题包'], summary: '主题包详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:theme:view' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsThemePackageDTO, '主题包详情') },
  }),
  handler: async (c) => c.json(okBody(await getCmsThemePackage(c.req.valid('param').id)), 200),
});

const previewRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/preview', tags: ['CMS-主题包'], summary: '使用正式渲染链预览主题包',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:theme:view' })] as const,
    request: { params: IdParam, body: { content: jsonContent(previewCmsThemePackageSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(z.object({ html: z.string(), status: z.number().int() }), '预览 HTML') },
  }),
  handler: async (c) => {
    const input = c.req.valid('json');
    return c.json(okBody(await previewCmsThemePackage(c.req.valid('param').id, input.siteId, input.path)), 200);
  },
});

const activateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/activate', tags: ['CMS-主题包'], summary: '事务化激活站点主题包版本并提交重建',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:theme:activate', audit: { description: '激活 CMS 主题包', module: 'CMS内容管理' } }), idempotencyGuard({ ttlSeconds: 60 })] as const,
    request: { params: IdParam, body: { content: jsonContent(activateCmsThemePackageSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsThemePackageActivationDTO, '激活结果') },
  }),
  handler: async (c) => {
    const { siteId } = c.req.valid('json');
    return c.json(okBody(await activateCmsThemePackage(c.req.valid('param').id, siteId), '主题已激活，影响重建已提交'), 200);
  },
});

const activateBuiltinRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/builtin/{code}/activate', tags: ['CMS-主题包'], summary: '事务化激活内置可信主题并提交重建',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:theme:activate', audit: { description: '激活 CMS 内置主题', module: 'CMS内容管理' } }), idempotencyGuard({ ttlSeconds: 60 })] as const,
    request: {
      params: z.object({ code: z.enum(['default', 'docs']).openapi({ param: { name: 'code', in: 'path' } }) }),
      body: { content: jsonContent(z.object({ siteId: z.number().int().positive() })), required: true },
    },
    responses: { ...commonErrorResponses, ...ok(CmsBuiltinThemeActivationDTO, '激活结果') },
  }),
  handler: async (c) => {
    const { code } = c.req.valid('param');
    return c.json(okBody(await activateBuiltinCmsTheme(c.req.valid('json').siteId, code), '内置主题已激活，影响重建已提交'), 200);
  },
});

const rollbackRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/rollback', tags: ['CMS-主题包'], summary: '回滚站点主题包至上一版本',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:theme:activate', audit: { description: '回滚 CMS 主题包', module: 'CMS内容管理' } }), idempotencyGuard({ ttlSeconds: 60 })] as const,
    request: { body: { content: jsonContent(cmsThemeDeploymentActionSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsThemePackageActivationDTO, '回滚结果') },
  }),
  handler: async (c) => {
    const { siteId, themeCode, packageId } = c.req.valid('json');
    return c.json(okBody(await rollbackCmsThemePackage(siteId, themeCode, packageId), '主题已回滚，影响重建已提交'), 200);
  },
});

const deactivateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/deactivate', tags: ['CMS-主题包'], summary: '停用站点主题包并回退内置 default',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:theme:activate', audit: { description: '停用 CMS 主题包', module: 'CMS内容管理' } }), idempotencyGuard({ ttlSeconds: 60 })] as const,
    request: { body: { content: jsonContent(cmsThemeDeploymentActionSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(z.object({ task: AsyncTaskDTO }), '停用结果') },
  }),
  handler: async (c) => {
    const { siteId, themeCode, packageId } = c.req.valid('json');
    return c.json(okBody(await deactivateCmsThemeForSite(siteId, themeCode, packageId), '主题已停用，回退重建已提交'), 200);
  },
});

const statusRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}/status', tags: ['CMS-主题包'], summary: '停用或恢复主题包版本',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:theme:activate', audit: { description: '更新 CMS 主题包状态', module: 'CMS内容管理' } }), idempotencyGuard({ ttlSeconds: 60 })] as const,
    request: { params: IdParam, body: { content: jsonContent(z.object({ status: z.enum(['validated', 'disabled']) })), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsThemePackageDTO, '更新结果') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsThemePackage(id));
    return c.json(okBody(await setCmsThemePackageStatus(id, c.req.valid('json').status), '状态已更新'), 200);
  },
});

const exportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/export', tags: ['CMS-主题包'], summary: '使用环境私钥重新签名并导出主题包',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:theme:export', audit: { description: '导出 CMS 签名主题包', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      200: {
        content: { 'application/zip': { schema: z.string().openapi({ format: 'binary' }) } },
        description: '签名主题包 ZIP',
      },
    },
  }),
  handler: async (c) => {
    const result = await exportSignedCmsThemePackage(c.req.valid('param').id);
    const body = result.buffer.buffer.slice(
      result.buffer.byteOffset,
      result.buffer.byteOffset + result.buffer.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
        'Cache-Control': 'no-store',
      },
    });
  },
});

router.openapiRoutes([
  listRoute, validateRoute, importRoute, impactRoute, activateBuiltinRoute, rollbackRoute, deactivateRoute,
  getOneRoute, previewRoute, activateRoute, statusRoute, exportRoute,
] as const);

export default router;
