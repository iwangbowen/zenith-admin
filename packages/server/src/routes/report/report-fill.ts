import { OpenAPIHono } from '@hono/zod-openapi';
import { reportFillContract } from '@zenith/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { namedRateLimit } from '../../middleware/rate-limit';
import {
  changeReportFillTemplateLifecycle,
  cloneReportFillTemplate,
  createReportFillTemplate,
  deleteReportFillTemplate,
  getReportFillTemplate,
  listReportFillTemplateLookup,
  listReportFillTemplates,
  updateReportFillTemplate,
} from '../../services/report/report-fill-template.service';
import {
  cancelReportFillRecord,
  createReportFillRecord,
  getReportFillRecord,
  listAdminReportFillRecords,
  listMyReportFillRecords,
  reviewReportFillRecord,
  submitReportFillRecord,
  updateReportFillRecord,
} from '../../services/report/report-fill-record.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const writeLimit = namedRateLimit('report_fill_write');

const templateListRoute = defineContractRoute(reportFillContract.templates, {
  middleware: [authMiddleware, guard({ permission: 'report:fill:template:list' })],
  handler: async (c) => c.json(okBody(await listReportFillTemplates(c.req.valid('query'))), 200),
});

const templateLookupRoute = defineContractRoute(reportFillContract.templateLookup, {
  middleware: [authMiddleware, guard({ permission: 'report:fill:record:create' })],
  handler: async (c) => c.json(okBody(await listReportFillTemplateLookup()), 200),
});

const templateCreateRoute = defineContractRoute(reportFillContract.createTemplate, {
  middleware: [authMiddleware, writeLimit, guard({
    permission: 'report:fill:template:create',
    audit: { module: '报表填报', description: '创建填报模板' },
  })],
  handler: async (c) => c.json(okBody(await createReportFillTemplate(c.req.valid('json')), '创建成功'), 200),
});

const templateDetailRoute = defineContractRoute(reportFillContract.templateDetail, {
  middleware: [authMiddleware, guard({ permission: 'report:fill:template:list' })],
  handler: async (c) => c.json(okBody(await getReportFillTemplate(c.req.valid('param').id)), 200),
});

const templateUpdateRoute = defineContractRoute(reportFillContract.updateTemplate, {
  middleware: [authMiddleware, writeLimit, guard({
    permission: 'report:fill:template:update',
    audit: { module: '报表填报', description: '更新填报模板' },
  })],
  handler: async (c) => c.json(okBody(
    await updateReportFillTemplate(c.req.valid('param').id, c.req.valid('json')),
    '更新成功',
  ), 200),
});

const templateLifecycleRoute = defineContractRoute(reportFillContract.templateLifecycle, {
  middleware: [authMiddleware, writeLimit, guard({
    permission: 'report:fill:template:publish',
    audit: { module: '报表填报', description: '变更填报模板生命周期' },
  })],
  handler: async (c) => c.json(okBody(
    await changeReportFillTemplateLifecycle(c.req.valid('param').id, c.req.valid('json')),
    '操作成功',
  ), 200),
});

const templateCloneRoute = defineContractRoute(reportFillContract.cloneTemplate, {
  middleware: [authMiddleware, writeLimit, guard({
    permission: 'report:fill:template:clone',
    audit: { module: '报表填报', description: '克隆填报模板' },
  })],
  handler: async (c) => c.json(okBody(
    await cloneReportFillTemplate(c.req.valid('param').id, c.req.valid('json')),
    '克隆成功',
  ), 200),
});

const templateDeleteRoute = defineContractRoute(reportFillContract.removeTemplate, {
  middleware: [authMiddleware, writeLimit, guard({
    permission: 'report:fill:template:delete',
    audit: { module: '报表填报', description: '删除填报模板' },
  })],
  handler: async (c) => {
    await deleteReportFillTemplate(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const mineRoute = defineContractRoute(reportFillContract.myRecords, {
  middleware: [authMiddleware, guard({ permission: 'report:fill:record:list' })],
  handler: async (c) => c.json(okBody(await listMyReportFillRecords(c.req.valid('query'))), 200),
});

const adminRecordsRoute = defineContractRoute(reportFillContract.adminRecords, {
  middleware: [authMiddleware, guard({ permission: 'report:fill:record:review' })],
  handler: async (c) => c.json(okBody(await listAdminReportFillRecords(c.req.valid('query'))), 200),
});

const recordCreateRoute = defineContractRoute(reportFillContract.createRecord, {
  middleware: [authMiddleware, writeLimit, guard({
    permission: 'report:fill:record:create',
    audit: { module: '报表填报', description: '创建填报草稿' },
  })],
  handler: async (c) => c.json(okBody(await createReportFillRecord(c.req.valid('json')), '创建成功'), 200),
});

const recordDetailRoute = defineContractRoute(reportFillContract.recordDetail, {
  middleware: [authMiddleware, guard({ permission: ['report:fill:record:list', 'report:fill:record:review'] })],
  handler: async (c) => c.json(okBody(await getReportFillRecord(c.req.valid('param').id)), 200),
});

const recordUpdateRoute = defineContractRoute(reportFillContract.updateRecord, {
  middleware: [authMiddleware, writeLimit, guard({
    permission: 'report:fill:record:update',
    audit: { module: '报表填报', description: '编辑填报草稿' },
  })],
  handler: async (c) => c.json(okBody(
    await updateReportFillRecord(c.req.valid('param').id, c.req.valid('json')),
    '更新成功',
  ), 200),
});

const recordSubmitRoute = defineContractRoute(reportFillContract.submitRecord, {
  middleware: [authMiddleware, writeLimit, guard({
    permission: 'report:fill:record:submit',
    audit: { module: '报表填报', description: '提交填报记录' },
  })],
  handler: async (c) => c.json(okBody(
    await submitReportFillRecord(c.req.valid('param').id, c.req.valid('json')),
    '提交成功',
  ), 200),
});

const recordCancelRoute = defineContractRoute(reportFillContract.cancelRecord, {
  middleware: [authMiddleware, writeLimit, guard({
    permission: 'report:fill:record:cancel',
    audit: { module: '报表填报', description: '取消填报记录' },
  })],
  handler: async (c) => c.json(okBody(
    await cancelReportFillRecord(c.req.valid('param').id, c.req.valid('json')),
    '操作成功',
  ), 200),
});

const recordWithdrawRoute = defineContractRoute(reportFillContract.withdrawRecord, {
  middleware: [authMiddleware, writeLimit, guard({
    permission: 'report:fill:record:cancel',
    audit: { module: '报表填报', description: '撤回填报记录' },
  })],
  handler: async (c) => c.json(okBody(
    await cancelReportFillRecord(c.req.valid('param').id, c.req.valid('json')),
    '操作成功',
  ), 200),
});

const recordReviewRoute = defineContractRoute(reportFillContract.reviewRecord, {
  middleware: [authMiddleware, writeLimit, guard({
    permission: 'report:fill:record:review',
    audit: { module: '报表填报', description: '审核填报记录' },
  })],
  handler: async (c) => c.json(okBody(
    await reviewReportFillRecord(c.req.valid('param').id, c.req.valid('json')),
    '审核成功',
  ), 200),
});

router.openapiRoutes([
  templateListRoute,
  templateLookupRoute,
  templateCreateRoute,
  templateDetailRoute,
  templateUpdateRoute,
  templateLifecycleRoute,
  templateCloneRoute,
  templateDeleteRoute,
  mineRoute,
  adminRecordsRoute,
  recordCreateRoute,
  recordDetailRoute,
  recordUpdateRoute,
  recordSubmitRoute,
  recordCancelRoute,
  recordWithdrawRoute,
  recordReviewRoute,
] as const);

export default router;
