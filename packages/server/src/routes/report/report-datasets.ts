import { OpenAPIHono } from '@hono/zod-openapi';
import { reportDatasetContract } from '@zenith/shared/report';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, errBody, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listDatasets, getDataset, createDataset, updateDataset, deleteDataset,
  ensureDatasetExists, previewDataset, getDatasetData, collectDatasetRefs,
  batchSetDatasetStatus, cloneDataset, listDatasetLookup,
} from '../../services/report/report-dataset.service';
import { submitDatasetMaterializeTask } from '../../services/report/report-dataset-tasks';
import { parseDataFile } from '../../lib/report-file-parse';

const router = new OpenAPIHono({ defaultHook: validationHook });

const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;

const listRoute = defineContractRoute(reportDatasetContract.list, {
  middleware: [authMiddleware, guard({ permission: 'report:dataset:list' })],
  handler: async (c) => c.json(okBody(await listDatasets(c.req.valid('query'))), 200),
});

const lookupRoute = defineContractRoute(reportDatasetContract.lookup, {
  middleware: [authMiddleware, guard({ permission: 'report:dataset:list' })],
  handler: async (c) => c.json(okBody(await listDatasetLookup(c.req.valid('query'))), 200),
});

// 试跑预览（不落库）—— 放在 /{id} 之前
const previewRoute = defineContractRoute(reportDatasetContract.preview, {
  middleware: [authMiddleware, guard({ permission: ['report:dataset:create', 'report:dataset:update'] })],
  handler: async (c) => c.json(okBody(await previewDataset(c.req.valid('json'))), 200),
});

// 文件数据集解析（Excel / CSV 上传 → { columns, rows }）：缓冲与 exceljs 解压前先按元数据校验大小，防止超大文件耗尽内存
const MAX_PARSE_FILE_BYTES = 20 * 1024 * 1024;

const parseFileRoute = defineContractRoute(reportDatasetContract.parseFile, {
  middleware: [authMiddleware, guard({ permission: 'report:dataset:create' })],
  responses: { 413: { content: jsonContent(ErrorResponse), description: '文件过大' } },
  handler: async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json(errBody('请上传文件（字段名 file）', 400), 400);
    if (file.size > MAX_PARSE_FILE_BYTES) {
      return c.json(errBody(`文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），超出解析上限 ${MAX_PARSE_FILE_BYTES / 1024 / 1024}MB`, 413), 413);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await parseDataFile(buffer, file.name);
    return c.json(okBody(result), 200);
  },
});

const dataRoute = defineContractRoute(reportDatasetContract.data, {
  middleware: [authMiddleware, guard({ permission: 'report:dataset:list' })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    return c.json(okBody(await getDatasetData(id, body.params, body, { scene: 'dataset', sourceRefId: id })), 200);
  },
});

const getOneRoute = defineContractRoute(reportDatasetContract.detail, {
  middleware: [authMiddleware, guard({ permission: 'report:dataset:list' })],
  responses: notFound,
  handler: async (c) => c.json(okBody(await getDataset(c.req.valid('param').id)), 200),
});

const createRoute_ = defineContractRoute(reportDatasetContract.create, {
  middleware: [authMiddleware, guard({ permission: 'report:dataset:create', audit: { description: '创建报表数据集', module: '报表数据集' } })],
  handler: async (c) => c.json(okBody(await createDataset(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineContractRoute(reportDatasetContract.update, {
  middleware: [authMiddleware, guard({ permission: 'report:dataset:update', audit: { description: '更新报表数据集', module: '报表数据集' } })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDatasetExists(id);
    setAuditBeforeData(c, before);
    return c.json(okBody(await updateDataset(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineContractRoute(reportDatasetContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'report:dataset:delete', audit: { description: '删除报表数据集', module: '报表数据集' } })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDatasetExists(id);
    setAuditBeforeData(c, before);
    await deleteDataset(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const batchStatusRoute = defineContractRoute(reportDatasetContract.batchStatus, {
  middleware: [authMiddleware, guard({ permission: 'report:dataset:update', audit: { description: '批量更新报表数据集状态', module: '报表数据集' } })],
  handler: async (c) => {
    const { ids, status } = c.req.valid('json');
    const count = await batchSetDatasetStatus(ids, status);
    return c.json(okBody(null, `已更新 ${count} 个数据集状态`), 200);
  },
});

const materializeRoute = defineContractRoute(reportDatasetContract.materialize, {
  middleware: [authMiddleware, guard({ permission: 'report:dataset:update' })],
  responses: notFound,
  handler: async (c) => c.json(okBody(await submitDatasetMaterializeTask(c.req.valid('param').id), '任务已提交，可在任务中心查看进度'), 200),
});

const refsRoute = defineContractRoute(reportDatasetContract.refs, {
  middleware: [authMiddleware, guard({ permission: 'report:dataset:list' })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await ensureDatasetExists(id);
    return c.json(okBody(await collectDatasetRefs(id)), 200);
  },
});

const cloneRoute = defineContractRoute(reportDatasetContract.clone, {
  middleware: [authMiddleware, guard({ permission: 'report:dataset:create', audit: { description: '复制报表数据集', module: '报表数据集' } })],
  handler: async (c) => c.json(okBody(await cloneDataset(c.req.valid('param').id, c.req.valid('json')), '复制成功'), 200),
});

router.openapiRoutes([
  listRoute, lookupRoute, previewRoute, dataRoute, batchStatusRoute, materializeRoute, refsRoute, getOneRoute, createRoute_, updateRoute_, deleteRoute_, cloneRoute,
  parseFileRoute,
] as const);

export default router;
