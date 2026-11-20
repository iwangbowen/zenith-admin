import { OpenAPIHono } from '@hono/zod-openapi';
import { fileStorageConfigContract } from '@zenith/shared/platform';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listFileStorageConfigs,
  getDefaultFileStorageConfig,
  createFileStorageConfig,
  updateFileStorageConfig,
  setDefaultFileStorageConfig,
  deleteFileStorageConfig,
  getFileStorageConfigBeforeAudit,
  getFileStorageConfig,
  probeFileStorageConfigBucketAccess,
  probeDraftFileStorageConfigBucketAccess,
  updateDraftFileStorageConfigBucketAccess,
  updateFileStorageConfigBucketAccess,
  testFileStorageConfig,
  testExistingFileStorageConfig,
} from '../../services/files/file-storage-configs.service';
import { mountCrud } from '../_crud';

const fileStorageConfigsRouter = new OpenAPIHono({ defaultHook: validationHook });

const testFailedResponse = { 400: { content: jsonContent(ErrorResponse), description: '测试失败' } } as const;
const defaultRoute = defineContractRoute(fileStorageConfigContract.defaultConfig, {
  handler: async (c) => c.json(okBody(await getDefaultFileStorageConfig()), 200),
});
const testRoute = defineContractRoute(fileStorageConfigContract.test, {
  responses: testFailedResponse,
  handler: async (c) => {
    const result = await testFileStorageConfig(c.req.valid('json'));
    return c.json(okBody(null, result.message), 200);
  },
});

const testExistingRoute = defineContractRoute(fileStorageConfigContract.testExisting, {
  responses: testFailedResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const result = await testExistingFileStorageConfig(id, c.req.valid('json'));
    return c.json(okBody(null, result.message), 200);
  },
});
const probeDraftBucketAccessRoute = defineContractRoute(fileStorageConfigContract.probeDraftBucketAccess, {
  handler: async (c) => c.json(okBody(await probeDraftFileStorageConfigBucketAccess(c.req.valid('json'))), 200),
});
const updateDraftBucketAccessRoute = defineContractRoute(fileStorageConfigContract.updateDraftBucketAccess, {
  handler: async (c) => {
    const { config, changes } = c.req.valid('json');
    setAuditBeforeData(c, await probeDraftFileStorageConfigBucketAccess(config));
    const info = await updateDraftFileStorageConfigBucketAccess(config, changes);
    setAuditAfterData(c, info);
    return c.json(okBody(info, 'Bucket 权限已更新'), 200);
  },
});
const setDefaultRoute = defineContractRoute(fileStorageConfigContract.setDefault, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getFileStorageConfigBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await setDefaultFileStorageConfig(id), '默认文件服务已更新'), 200);
  },
});
const probeBucketAccessRoute = defineContractRoute(fileStorageConfigContract.probeBucketAccess, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await probeFileStorageConfigBucketAccess(id)), 200);
  },
});
const updateBucketAccessRoute = defineContractRoute(fileStorageConfigContract.updateBucketAccess, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getFileStorageConfigBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateFileStorageConfigBucketAccess(id, c.req.valid('json')), 'Bucket 权限已更新'), 200);
  },
});

mountCrud(fileStorageConfigsRouter, fileStorageConfigContract,
  {
    list: listFileStorageConfigs,
    get: getFileStorageConfig,
    create: createFileStorageConfig,
    update: updateFileStorageConfig,
    remove: deleteFileStorageConfig,
  },
  {},
  [defaultRoute, testRoute, testExistingRoute, probeDraftBucketAccessRoute, updateDraftBucketAccessRoute, setDefaultRoute, probeBucketAccessRoute, updateBucketAccessRoute],
);

export default fileStorageConfigsRouter;
