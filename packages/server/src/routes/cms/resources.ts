import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { cmsResourceContract } from '@zenith/shared/cms';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listCmsResources,
  uploadCmsResource,
  updateCmsResource,
  deleteCmsResources,
  listCmsResourceReferences,
  cropCmsResource,
  replaceCmsResource,
} from '../../services/cms/cms-resources.service';
import {
  createCmsResourceFolder,
  deleteCmsResourceFolder,
  listCmsResourceFolderTree,
  updateCmsResourceFolder,
} from '../../services/cms/cms-resource-folders.service';
import { mapAsyncTask } from '../../lib/task-center';
import { submitCmsResourceTask, submitCmsResourceRefRebuildTask } from '../../services/cms/cms-resource-task-submit.service';
import { mountCrud } from '../_crud';
import { getCmsAssetRights, listCmsAssetVersions, updateCmsAssetRights } from '../../services/cms/cms-asset-rights.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const uploadRoute = defineContractRoute(cmsResourceContract.upload, {
  responses: { 400: { content: jsonContent(ErrorResponse), description: '未选择文件或无可用存储' } },
  handler: async (c) => {
    const { siteId, folderId } = c.req.valid('query');
    const body = await c.req.parseBody();
    const file = body.file;
    if (!file || typeof (file as File).arrayBuffer !== 'function') {
      throw new HTTPException(400, { message: '请选择要上传的文件' });
    }
    return c.json(okBody(await uploadCmsResource(file as File, siteId, folderId), '上传成功'), 200);
  },
});

const updateRoute = defineContractRoute(cmsResourceContract.update, {
  handler: async (c) => c.json(okBody(await updateCmsResource(c.req.valid('param').id, c.req.valid('json')), '已保存'), 200),
});

const referencesRoute = defineContractRoute(cmsResourceContract.references, {
  handler: async (c) => c.json(okBody(await listCmsResourceReferences(c.req.valid('param').id)), 200),
});

const cropRoute = defineContractRoute(cmsResourceContract.crop, {
  handler: async (c) => c.json(okBody(await cropCmsResource(c.req.valid('param').id, c.req.valid('json')), '裁剪成功，已另存为新素材'), 200),
});

const deleteRoute = defineContractRoute(cmsResourceContract.batchDelete, {
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await deleteCmsResources(ids);
    return c.json(okBody(null, `已删除 ${count} 个素材`), 200);
  },
});

const folderTreeRoute = defineContractRoute(cmsResourceContract.folders, {
  handler: async (c) => c.json(okBody(await listCmsResourceFolderTree(c.req.valid('query').siteId)), 200),
});

const createFolderRoute = defineContractRoute(cmsResourceContract.folderCreate, {
  handler: async (c) => c.json(okBody(await createCmsResourceFolder(c.req.valid('json')), '创建成功'), 200),
});

const updateFolderRoute = defineContractRoute(cmsResourceContract.folderUpdate, {
  handler: async (c) => c.json(okBody(await updateCmsResourceFolder(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const deleteFolderRoute = defineContractRoute(cmsResourceContract.folderRemove, {
  handler: async (c) => {
    await deleteCmsResourceFolder(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const governanceRoute = defineContractRoute(cmsResourceContract.governance, {
  handler: async (c) => {
    const payload = c.req.valid('json');
    const row = await submitCmsResourceTask(
      payload,
      payload.operation === 'scan' ? 'CMS 孤立素材扫描' : (payload.dryRun ? 'CMS 素材清理预演' : 'CMS 孤立素材清理'),
    );
    return c.json(okBody(mapAsyncTask(row), '任务已提交'), 200);
  },
});

const moveResourcesRoute = defineContractRoute(cmsResourceContract.move, {
  handler: async (c) => {
    const body = c.req.valid('json');
    const row = await submitCmsResourceTask({
      operation: 'move',
      siteId: body.siteId,
      resourceIds: body.ids,
      folderId: body.folderId,
    }, 'CMS 素材批量移动');
    return c.json(okBody(mapAsyncTask(row), '移动任务已提交'), 200);
  },
});

const replaceRoute = defineContractRoute(cmsResourceContract.replace, {
  responses: { 400: { content: jsonContent(ErrorResponse), description: '未选择文件或类型不匹配' } },
  handler: async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!file || typeof (file as File).arrayBuffer !== 'function') {
      throw new HTTPException(400, { message: '请选择要上传的文件' });
    }
    const row = await replaceCmsResource(c.req.valid('param').id, file as File);
    return c.json(okBody(row, '素材新版本已保存，已发布稿件保持原文件'), 200);
  },
});

const rebuildRefsRoute = defineContractRoute(cmsResourceContract.rebuildRefs, {
  handler: async (c) => {
    const row = await submitCmsResourceRefRebuildTask(c.req.valid('json').siteId);
    return c.json(okBody(mapAsyncTask(row), '任务已提交'), 200);
  },
});

mountCrud(router, cmsResourceContract,
  { list: listCmsResources },
  {
    messages: { update: '已保存' },
    exclude: ['update'],
  },
  [
    defineContractRoute(cmsResourceContract.versions, { handler: async (c) => c.json(okBody(await listCmsAssetVersions(c.req.valid('param').id)), 200) }),
    defineContractRoute(cmsResourceContract.rights, { handler: async (c) => c.json(okBody(await getCmsAssetRights(c.req.valid('param').id)), 200) }),
    defineContractRoute(cmsResourceContract.updateRights, { handler: async (c) => c.json(okBody(await updateCmsAssetRights(c.req.valid('param').id, c.req.valid('json'))), 200) }),
    folderTreeRoute,
    createFolderRoute,
    updateFolderRoute,
    deleteFolderRoute,
    uploadRoute,
    updateRoute,
    referencesRoute,
    cropRoute,
    replaceRoute,
    deleteRoute,
    governanceRoute,
    rebuildRefsRoute,
    moveResourcesRoute,
  ],
);

export default router;
