import { OpenAPIHono } from '@hono/zod-openapi';
import { tagContract } from '@zenith/shared/platform';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listTags,
  createTag,
  updateTag,
  deleteTag,
  batchDeleteTags,
  listTagGroups,
  ensureTagExists,
  getTag,
  getTagsBeforeAudit,
} from '../../services/platform/tags.service';

const tagsRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'system:tag:list' })] as const;

const listTagsRoute = defineContractRoute(tagContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listTags(c.req.valid('query'))), 200),
});

const listGroupsRoute = defineContractRoute(tagContract.groups, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listTagGroups()), 200),
});

const getOneTagRoute = defineContractRoute(tagContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getTag(c.req.valid('param').id)), 200),
});

const createTagRoute = defineContractRoute(tagContract.create, {
  middleware: [authMiddleware, guard({ permission: 'system:tag:create', audit: { description: '创建标签', module: '标签管理' } })],
  handler: async (c) => c.json(okBody(await createTag(c.req.valid('json')), '创建成功'), 200),
});

const updateTagRoute = defineContractRoute(tagContract.update, {
  middleware: [authMiddleware, guard({ permission: 'system:tag:update', audit: { description: '更新标签', module: '标签管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureTagExists(id);
    setAuditBeforeData(c, before);
    return c.json(okBody(await updateTag(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteTagRoute = defineContractRoute(tagContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'system:tag:delete', audit: { description: '删除标签', module: '标签管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureTagExists(id);
    setAuditBeforeData(c, before);
    await deleteTag(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// `DELETE /batch` 必须注册在 `DELETE /{id}` 之前
const batchDeleteTagsRoute = defineContractRoute(tagContract.removeBatch, {
  middleware: [authMiddleware, guard({ permission: 'system:tag:delete', audit: { description: '批量删除标签', module: '标签管理' } })],
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const before = await getTagsBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    await batchDeleteTags(ids);
    return c.json(okBody(null, '批量删除成功'), 200);
  },
});

tagsRouter.openapiRoutes([
  listTagsRoute,
  listGroupsRoute,
  getOneTagRoute,
  createTagRoute,
  updateTagRoute,
  batchDeleteTagsRoute,
  deleteTagRoute,
] as const);

export default tagsRouter;
