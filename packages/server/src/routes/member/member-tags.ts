import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  jsonContent, validationHook, commonErrorResponses, ok, okMsg, okBody, IdParam,
} from '../../lib/openapi-schemas';
import { MemberTagDTO } from '../../lib/openapi-dtos';
import {
  listMemberTags, createMemberTag, updateMemberTag, deleteMemberTag, ensureMemberTagExists, mapMemberTag,
} from '../../services/member/member-tags.service';

const memberTagsRouter = new OpenAPIHono({ defaultHook: validationHook });

const saveTagSchema = z.object({
  name: z.string().min(1).max(32),
  color: z.string().max(20).nullable().optional(),
  description: z.string().max(256).nullable().optional(),
  sort: z.number().int().optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['会员标签'], summary: '会员标签列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:member:list' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(MemberTagDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMemberTags()), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['会员标签'], summary: '创建会员标签',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:member:update', audit: { description: '创建会员标签', module: '会员标签' } })] as const,
    request: { body: { content: jsonContent(saveTagSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MemberTagDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createMemberTag(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['会员标签'], summary: '更新会员标签',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:member:update', audit: { description: '更新会员标签', module: '会员标签' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(saveTagSchema.partial()), required: true } },
    responses: { ...commonErrorResponses, ...ok(MemberTagDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapMemberTag(await ensureMemberTagExists(id)));
    return c.json(okBody(await updateMemberTag(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['会员标签'], summary: '删除会员标签',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:member:update', audit: { description: '删除会员标签', module: '会员标签' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapMemberTag(await ensureMemberTagExists(id)));
    await deleteMemberTag(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

memberTagsRouter.openapiRoutes([listRoute, createRoute_, updateRoute_, deleteRoute_] as const);

export default memberTagsRouter;
