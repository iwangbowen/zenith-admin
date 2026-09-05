import { OpenAPIHono } from '@hono/zod-openapi';
import { reportCategoryContract } from '@zenith/shared/report';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import { listCategories, createCategory, updateCategory, deleteCategory, ensureCategoryExists, listCategoryLookup } from '../../services/report/report-ops.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;

const listRoute = defineContractRoute(reportCategoryContract.list, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })],
  handler: async (c) => c.json(okBody(await listCategories()), 200),
});

const lookupRoute = defineContractRoute(reportCategoryContract.lookup, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })],
  handler: async (c) => c.json(okBody(await listCategoryLookup(c.req.valid('query'))), 200),
});

const createRoute_ = defineContractRoute(reportCategoryContract.create, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '创建报表分类', module: '报表分类' } })],
  handler: async (c) => c.json(okBody(await createCategory(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineContractRoute(reportCategoryContract.update, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '更新报表分类', module: '报表分类' } })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureCategoryExists(id));
    return c.json(okBody(await updateCategory(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineContractRoute(reportCategoryContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '删除报表分类', module: '报表分类' } })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureCategoryExists(id));
    await deleteCategory(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, lookupRoute, createRoute_, updateRoute_, deleteRoute_] as const);

export default router;
