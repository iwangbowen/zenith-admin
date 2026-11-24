import { OpenAPIHono } from '@hono/zod-openapi';
import { roleContract } from '@zenith/shared/identity';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, conflictResponse, okBody } from '../../lib/openapi-schemas';
import { defineScopeMembersRoute } from './_scope-members';
import {
  listAllRoles,
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  assignRoleMenus,
  getRoleUsers,
  assignRoleUsers,
  getRoleBeforeAudit,
} from '../../services/identity/roles.service';
import { mountCrud } from '../_crud';

const memberPreviewRoute = defineScopeMembersRoute({
  op: roleContract.memberPreview,
  scopeType: 'role',
});

const rolesRouter = new OpenAPIHono({ defaultHook: validationHook });

const allRoute = defineContractRoute(roleContract.all, {
  handler: async (c) => c.json(okBody(await listAllRoles()), 200),
});
const assignMenusRoute = defineContractRoute(roleContract.assignMenus, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const before = await getRoleBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await assignRoleMenus(id, data.menuIds, data.permissionCodes);
    return c.json(okBody(null, '页面与能力权限已更新'), 200);
  },
});

const getUsersRoute = defineContractRoute(roleContract.users, {
  handler: async (c) => c.json(okBody(await getRoleUsers(c.req.valid('param').id)), 200),
});

const assignUsersRoute = defineContractRoute(roleContract.assignUsers, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const before = await getRoleBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await assignRoleUsers(id, data.userIds);
    return c.json(okBody(null, '用户分配已更新'), 200);
  },
});

mountCrud(rolesRouter, roleContract,
  { list: listRoles, get: getRole, create: createRole, update: updateRole, remove: deleteRole },
  { responses: { remove: conflictResponse } },
  [allRoute, assignMenusRoute, getUsersRoute, assignUsersRoute, memberPreviewRoute],
);

export default rolesRouter;
