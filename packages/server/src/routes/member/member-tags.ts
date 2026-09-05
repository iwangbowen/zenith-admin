import { OpenAPIHono } from '@hono/zod-openapi';
import { memberTagContract } from '@zenith/shared/member';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMemberTags, createMemberTag, updateMemberTag, deleteMemberTag, ensureMemberTagExists, mapMemberTag,
} from '../../services/member/member-tags.service';

const memberTagsRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(memberTagContract.list, {
  middleware: [authMiddleware, guard({ permission: 'member:member:list' })],
  handler: async (c) => c.json(okBody(await listMemberTags()), 200),
});

const createRouteDef = defineContractRoute(memberTagContract.create, {
  middleware: [authMiddleware, guard({ permission: 'member:member:update', audit: { description: '创建会员标签', module: '会员标签' } })],
  handler: async (c) => c.json(okBody(await createMemberTag(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineContractRoute(memberTagContract.update, {
  middleware: [authMiddleware, guard({ permission: 'member:member:update', audit: { description: '更新会员标签', module: '会员标签' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapMemberTag(await ensureMemberTagExists(id)));
    return c.json(okBody(await updateMemberTag(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineContractRoute(memberTagContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'member:member:update', audit: { description: '删除会员标签', module: '会员标签' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapMemberTag(await ensureMemberTagExists(id)));
    await deleteMemberTag(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

memberTagsRouter.openapiRoutes([listRoute, createRouteDef, updateRouteDef, deleteRouteDef] as const);

export default memberTagsRouter;
