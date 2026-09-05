import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsPageContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listCmsPages, getCmsPage, createCmsPage, updateCmsPage, deleteCmsPage,
} from '../../services/cms/cms-pages.service';
import { listCmsPageBlockAcls, setCmsPageBlockAcls } from '../../services/cms/cms-page-acl.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'cms:page:list' })] as const;

const listRoute = defineContractRoute(cmsPageContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsPages(c.req.valid('query'))), 200),
});

const detailRoute = defineContractRoute(cmsPageContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getCmsPage(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(cmsPageContract.create, {
  middleware: [authMiddleware, guard({ permission: 'cms:page:create', audit: { description: '创建 CMS 搭建页面', module: 'CMS内容管理' } })],
  handler: async (c) => c.json(okBody(await createCmsPage(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineContractRoute(cmsPageContract.update, {
  // 页面编辑者可改元数据；区块 ACL 受托人也可进入本端点只改区块，
  // 逐区块能力与不可变排序规则由 service 执行
  middleware: [authMiddleware, guard({ permission: ['cms:page:list', 'cms:page:update'], audit: { description: '更新 CMS 搭建页面', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getCmsPage(id);
    setAuditBeforeData(c, before);
    const row = await updateCmsPage(id, c.req.valid('json'));
    return c.json(okBody(row, '更新成功'), 200);
  },
});

const deleteRouteDef = defineContractRoute(cmsPageContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'cms:page:delete', audit: { description: '删除 CMS 搭建页面', module: 'CMS内容管理' } })],
  handler: async (c) => {
    await deleteCmsPage(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const listBlockAclsRoute = defineContractRoute(cmsPageContract.blockAcls, {
  middleware: [authMiddleware, guard({ permission: 'cms:page:acl' })],
  handler: async (c) => c.json(okBody(await listCmsPageBlockAcls(
    c.req.valid('param').id,
    c.req.valid('query').blockId,
  )), 200),
});

const setBlockAclsRoute = defineContractRoute(cmsPageContract.setBlockAcls, {
  middleware: [authMiddleware, guard({
    permission: 'cms:page:acl',
    audit: { description: '设置 CMS 页面区块 ACL', module: 'CMS内容管理' },
  })],
  handler: async (c) => {
    const pageId = c.req.valid('param').id;
    setAuditBeforeData(c, await listCmsPageBlockAcls(pageId));
    return c.json(okBody(await setCmsPageBlockAcls(pageId, c.req.valid('json')), '区块权限已更新'), 200);
  },
});

router.openapiRoutes([
  listRoute,
  listBlockAclsRoute,
  setBlockAclsRoute,
  detailRoute,
  createRouteDef,
  updateRouteDef,
  deleteRouteDef,
] as const);

export default router;
