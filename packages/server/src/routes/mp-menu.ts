import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import {
  jsonContent, validationHook, commonErrorResponses, ok, okBody,
} from '../lib/openapi-schemas';
import { saveMpMenuSchema } from '@zenith/shared';
import { MpMenuDTO } from '../lib/openapi-dtos';
import { getMpMenu, saveMpMenu, publishMpMenu, pullMpMenu, deleteMpMenu } from '../services/mp-menu.service';

const mpMenuRouter = new OpenAPIHono({ defaultHook: validationHook });

const accountBody = z.object({ accountId: z.number().int().positive() });

const getRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['公众号菜单'], summary: '获取自定义菜单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:menu:list' })] as const,
    request: { query: z.object({ accountId: z.coerce.number().int().positive() }) },
    responses: { ...commonErrorResponses, ...ok(MpMenuDTO, '自定义菜单') },
  }),
  handler: async (c) => c.json(okBody(await getMpMenu(c.req.valid('query').accountId)), 200),
});

const saveRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/save', tags: ['公众号菜单'], summary: '保存菜单草稿',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:menu:save', audit: { description: '保存公众号菜单', module: '公众号菜单' } })] as const,
    request: { body: { content: jsonContent(saveMpMenuSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpMenuDTO, '保存成功') },
  }),
  handler: async (c) => {
    const { accountId, buttons } = c.req.valid('json');
    return c.json(okBody(await saveMpMenu(accountId, buttons), '保存成功'), 200);
  },
});

const publishRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/publish', tags: ['公众号菜单'], summary: '发布菜单到微信',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:menu:publish', audit: { description: '发布公众号菜单', module: '公众号菜单' } })] as const,
    request: { body: { content: jsonContent(accountBody), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpMenuDTO, '发布成功') },
  }),
  handler: async (c) => c.json(okBody(await publishMpMenu(c.req.valid('json').accountId), '发布成功'), 200),
});

const pullRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/pull', tags: ['公众号菜单'], summary: '从微信拉取菜单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:menu:pull', audit: { description: '拉取公众号菜单', module: '公众号菜单' } })] as const,
    request: { body: { content: jsonContent(accountBody), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpMenuDTO, '拉取成功') },
  }),
  handler: async (c) => c.json(okBody(await pullMpMenu(c.req.valid('json').accountId), '拉取成功'), 200),
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/delete', tags: ['公众号菜单'], summary: '删除微信菜单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:menu:delete', audit: { description: '删除公众号菜单', module: '公众号菜单' } })] as const,
    request: { body: { content: jsonContent(accountBody), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpMenuDTO, '删除成功') },
  }),
  handler: async (c) => c.json(okBody(await deleteMpMenu(c.req.valid('json').accountId), '删除成功'), 200),
});

mpMenuRouter.openapiRoutes([getRoute, saveRoute, publishRoute, pullRoute, deleteRoute] as const);

export default mpMenuRouter;
