import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createCmsChannelSchema, updateCmsChannelSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData, setAuditAfterData } from '../../middleware/guard';
import {
  ErrorResponse, jsonContent, validationHook, commonErrorResponses,
  ok, okMsg, IdParam, okBody,
} from '../../lib/openapi-schemas';
import { CmsChannelDTO, CmsChannelUsersDTO } from '../../lib/openapi-dtos';
import {
  listCmsChannelTree, getCmsChannel, createCmsChannel, updateCmsChannel, deleteCmsChannel,
  mergeCmsChannels, clearCmsChannel, batchCreateCmsChannels, getCmsChannelUsers, setCmsChannelUsers,
} from '../../services/cms/cms-channels.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const treeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/tree',
    tags: ['CMS-栏目管理'], summary: '站点栏目树',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:channel:list' })] as const,
    request: {
      query: z.object({
        siteId: z.coerce.number().int().positive(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...ok(z.array(CmsChannelDTO), '栏目树') },
  }),
  handler: async (c) => c.json(okBody(await listCmsChannelTree(c.req.valid('query'))), 200),
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}',
    tags: ['CMS-栏目管理'], summary: '栏目详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:channel:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsChannelDTO, '栏目详情'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await getCmsChannel(c.req.valid('param').id)), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['CMS-栏目管理'], summary: '创建栏目',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:channel:create', audit: { description: '创建 CMS 栏目', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(createCmsChannelSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsChannelDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCmsChannel(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['CMS-栏目管理'], summary: '更新栏目',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:channel:update', audit: { description: '更新 CMS 栏目', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsChannelSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsChannelDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsChannel(id));
    return c.json(okBody(await updateCmsChannel(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['CMS-栏目管理'], summary: '删除栏目',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:channel:delete', audit: { description: '删除 CMS 栏目', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsChannel(id));
    await deleteCmsChannel(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 栏目运维（P1：合并 / 清空 / 批量新增）──────────────────────────────────────
const mergeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/merge',
    tags: ['CMS-栏目管理'], summary: '栏目合并（来源栏目内容并入目标栏目后删除来源栏目）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:channel:update', audit: { description: 'CMS 栏目合并', module: 'CMS内容管理' } })] as const,
    request: {
      body: {
        content: jsonContent(z.object({
          sourceIds: z.array(z.number().int().positive()).min(1, '请选择来源栏目'),
          targetId: z.number().int().positive(),
        })),
        required: true,
      },
    },
    responses: { ...commonErrorResponses, ...okMsg('合并成功') },
  }),
  handler: async (c) => {
    const { sourceIds, targetId } = c.req.valid('json');
    const count = await mergeCmsChannels(sourceIds, targetId);
    return c.json(okBody(null, `合并完成，已迁移 ${count} 条内容`), 200);
  },
});

const clearRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/clear',
    tags: ['CMS-栏目管理'], summary: '清空栏目（栏目下内容全部移入回收站）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:channel:update', audit: { description: 'CMS 栏目清空', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('清空成功') },
  }),
  handler: async (c) => {
    const count = await clearCmsChannel(c.req.valid('param').id);
    return c.json(okBody(null, `已将 ${count} 条内容移入回收站`), 200);
  },
});

const batchCreateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/batch-create',
    tags: ['CMS-栏目管理'], summary: '批量新增栏目（slug 自动取拼音，路径冲突自动加序号）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:channel:create', audit: { description: 'CMS 栏目批量新增', module: 'CMS内容管理' } })] as const,
    request: {
      body: {
        content: jsonContent(z.object({
          siteId: z.number().int().positive(),
          parentId: z.number().int().min(0).default(0),
          names: z.array(z.string().min(1).max(100)).min(1, '请输入栏目名称').max(50, '单次最多创建 50 个栏目'),
        })),
        required: true,
      },
    },
    responses: { ...commonErrorResponses, ...okMsg('创建成功') },
  }),
  handler: async (c) => {
    const { siteId, parentId, names } = c.req.valid('json');
    const count = await batchCreateCmsChannels(siteId, parentId, names);
    return c.json(okBody(null, `已创建 ${count} 个栏目`), 200);
  },
});

// ─── 栏目授权用户（P5 栏目级数据权限：绑定后仅授权用户可管理该栏目下内容）────────
const getChannelUsersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/users',
    tags: ['CMS-栏目管理'], summary: '栏目授权用户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:channel:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsChannelUsersDTO, '授权用户') },
  }),
  handler: async (c) => c.json(okBody(await getCmsChannelUsers(c.req.valid('param').id)), 200),
});

const setChannelUsersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}/users',
    tags: ['CMS-栏目管理'], summary: '设置栏目授权用户（绑定后仅授权用户可管理该栏目下内容）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:channel:update', audit: { description: '设置 CMS 栏目授权用户', module: 'CMS内容管理' } })] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ userIds: z.array(z.number().int().positive()).default([]) })), required: true },
    },
    responses: { ...commonErrorResponses, ...okMsg('保存成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { userIds } = c.req.valid('json');
    setAuditBeforeData(c, await getCmsChannelUsers(id));
    const after = await setCmsChannelUsers(id, userIds);
    setAuditAfterData(c, after);
    return c.json(okBody(null, '保存成功'), 200);
  },
});

router.openapiRoutes([treeRoute, getOneRoute, createRoute_, updateRoute_, deleteRoute_, mergeRoute, clearRoute, batchCreateRoute, getChannelUsersRoute, setChannelUsersRoute] as const);

export default router;
