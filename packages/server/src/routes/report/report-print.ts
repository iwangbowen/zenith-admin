import { OpenAPIHono } from '@hono/zod-openapi';
import { reportPrintContract } from '@zenith/shared/report';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listPrintTemplates, getPrintTemplate, createPrintTemplate, updatePrintTemplate,
  deletePrintTemplate, ensurePrintTemplateExists, renderPrintTemplate,
  batchSetPrintTemplateStatus, clonePrintTemplate, listPrintTemplateLookup,
} from '../../services/report/report-print.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;

const listRoute = defineContractRoute(reportPrintContract.list, {
  middleware: [authMiddleware, guard({ permission: 'report:print:list' })],
  handler: async (c) => c.json(okBody(await listPrintTemplates(c.req.valid('query'))), 200),
});

const lookupRoute = defineContractRoute(reportPrintContract.lookup, {
  middleware: [authMiddleware, guard({ permission: 'report:print:list' })],
  handler: async (c) => c.json(okBody(await listPrintTemplateLookup(c.req.valid('query'))), 200),
});

const getOneRoute = defineContractRoute(reportPrintContract.detail, {
  middleware: [authMiddleware, guard({ permission: 'report:print:list' })],
  responses: notFound,
  handler: async (c) => c.json(okBody(await getPrintTemplate(c.req.valid('param').id)), 200),
});

const createRoute_ = defineContractRoute(reportPrintContract.create, {
  middleware: [authMiddleware, guard({ permission: 'report:print:create', audit: { description: '创建打印报表', module: '报表打印' } })],
  handler: async (c) => c.json(okBody(await createPrintTemplate(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineContractRoute(reportPrintContract.update, {
  middleware: [authMiddleware, guard({ permission: 'report:print:update', audit: { description: '更新打印报表', module: '报表打印' } })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensurePrintTemplateExists(id);
    setAuditBeforeData(c, before);
    return c.json(okBody(await updatePrintTemplate(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineContractRoute(reportPrintContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'report:print:delete', audit: { description: '删除打印报表', module: '报表打印' } })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensurePrintTemplateExists(id);
    setAuditBeforeData(c, before);
    await deletePrintTemplate(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const batchStatusRoute = defineContractRoute(reportPrintContract.batchStatus, {
  middleware: [authMiddleware, guard({ permission: 'report:print:update', audit: { description: '批量更新打印模板状态', module: '报表打印' } })],
  handler: async (c) => {
    const { ids, status } = c.req.valid('json');
    const count = await batchSetPrintTemplateStatus(ids, status);
    return c.json(okBody(null, `已更新 ${count} 个打印模板状态`), 200);
  },
});

const renderRoute = defineContractRoute(reportPrintContract.render, {
  middleware: [authMiddleware, guard({ permission: 'report:print:list' })],
  responses: notFound,
  handler: async (c) => c.json(okBody(await renderPrintTemplate(c.req.valid('param').id, c.req.valid('json'))), 200),
});

const cloneRoute = defineContractRoute(reportPrintContract.clone, {
  middleware: [authMiddleware, guard({ permission: 'report:print:create', audit: { description: '复制打印模板', module: '报表打印' } })],
  handler: async (c) => c.json(okBody(await clonePrintTemplate(c.req.valid('param').id, c.req.valid('json')), '复制成功'), 200),
});

router.openapiRoutes([listRoute, lookupRoute, batchStatusRoute, getOneRoute, createRoute_, updateRoute_, deleteRoute_, renderRoute, cloneRoute] as const);

export default router;
