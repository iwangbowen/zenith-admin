import { OpenAPIHono } from '@hono/zod-openapi';
import { userContract } from '@zenith/shared/identity';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  listAlertRecipientUsers,
  listAllUsers,
  listUsers,
  createUser,
  batchDeleteUsers,
  batchUpdateUserStatus,
  batchResetUsersPassword,
  updateUser,
  updateUserOrganization,
  manageUser,
  deleteUser,
  updateUserPassword,
  unlockUserById,
  getUserBeforeAudit,
  getUsersBeforeAudit,
  getUser,
  getUserMenuPermissions,
  assignUserMenus,
  getUserDataPermission,
  updateUserDataPermission,
  getUserEffectivePermissions,
  getUserPreferences,
  getUserPreferencesBeforeAudit,
  updateUserPreferences,
  assignRolesToUser,
  getUserRoleAssignmentAudit,
  getUserMenuPermissionsBeforeAudit,
  getUserDataPermissionBeforeAudit,
} from '../../services/identity/users.service';
import { mountCrud } from '../_crud';

const usersRouter = new OpenAPIHono({ defaultHook: validationHook });

const manageUserRoute = defineContractRoute(userContract.manage, {
  handler: async c => c.json(okBody(await manageUser(c.req.valid('param').id, c.req.valid('json'))), 200),
});

const updateOrganizationRoute = defineContractRoute(userContract.organization, {
  handler: async c => c.json(okBody(await updateUserOrganization(c.req.valid('param').id, c.req.valid('json'))), 200),
});

const getAllUsersRoute = defineContractRoute(userContract.all, {
  handler: async (c) => c.json(okBody(await listAllUsers()), 200),
});

const getAlertRecipientUsersRoute = defineContractRoute(userContract.alertRecipients, {
  handler: async (c) => c.json(okBody(await listAlertRecipientUsers()), 200),
});
const batchDeleteUsersRoute = defineContractRoute(userContract.removeBatch, {
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const before = await getUsersBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const count = await batchDeleteUsers(ids);
    return c.json(okBody(null, `已删除 ${count} 个用户`), 200);
  },
});

const batchResetPasswordRoute = defineContractRoute(userContract.batchResetPassword, {
  handler: async (c) => {
    const { ids, password } = c.req.valid('json');
    await batchResetUsersPassword(ids, password);
    return c.json(okBody(null, '密码重置成功'), 200);
  },
});

const batchStatusUsersRoute = defineContractRoute(userContract.batchStatus, {
  handler: async (c) => {
    const { ids, status } = c.req.valid('json');
    const before = await getUsersBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    await batchUpdateUserStatus(ids, status);
    return c.json(okBody(null, '状态已更新'), 200);
  },
});

const updateUserPasswordRoute = defineContractRoute(userContract.resetPassword, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { password } = c.req.valid('json');
    const before = await getUserBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await updateUserPassword(id, password);
    return c.json(okBody(null, '密码修改成功'), 200);
  },
});

const unlockUserRoute = defineContractRoute(userContract.unlock, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getUserBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await unlockUserById(id);
    return c.json(okBody(null, '解锁成功'), 200);
  },
});
const assignUserRolesRoute = defineContractRoute(userContract.assignRoles, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { roleIds } = c.req.valid('json');
    const before = await getUserRoleAssignmentAudit(id);
    if (before) setAuditBeforeData(c, before);
    await assignRolesToUser(id, roleIds);
    const after = await getUserRoleAssignmentAudit(id);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, '保存成功'), 200);
  },
});

const getUserMenusRoute = defineContractRoute(userContract.menus, {
  handler: async (c) => c.json(okBody(await getUserMenuPermissions(c.req.valid('param').id)), 200),
});

const assignUserMenusRoute = defineContractRoute(userContract.assignMenus, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { menuIds } = c.req.valid('json');
    const before = await getUserMenuPermissionsBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await assignUserMenus(id, menuIds);
    const after = await getUserMenuPermissionsBeforeAudit(id);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, '保存成功'), 200);
  },
});

const getUserDataPermissionRoute = defineContractRoute(userContract.dataPermission, {
  handler: async (c) => c.json(okBody(await getUserDataPermission(c.req.valid('param').id)), 200),
});

const updateUserDataPermissionRoute = defineContractRoute(userContract.updateDataPermission, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const before = await getUserDataPermissionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await updateUserDataPermission(id, data);
    const after = await getUserDataPermissionBeforeAudit(id);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, '保存成功'), 200);
  },
});

const getUserEffectivePermissionsRoute = defineContractRoute(userContract.effectivePermissions, {
  handler: async (c) => c.json(okBody(await getUserEffectivePermissions(c.req.valid('param').id)), 200),
});

const getUserPreferencesRoute = defineContractRoute(userContract.preferences, {
  handler: async (c) => c.json(okBody(await getUserPreferences(c.req.valid('param').id)), 200),
});

const updateUserPreferencesRoute = defineContractRoute(userContract.updatePreferences, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getUserPreferencesBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const saved = await updateUserPreferences(id, c.req.valid('json'));
    const after = await getUserPreferencesBeforeAudit(id);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(saved), 200);
  },
});

mountCrud(usersRouter, userContract,
  { list: listUsers, get: getUser, create: createUser, update: updateUser, remove: deleteUser },
  { exclude: ['removeBatch'] },
  [
    updateOrganizationRoute,
    manageUserRoute,
    getAlertRecipientUsersRoute,
    getAllUsersRoute,
    batchDeleteUsersRoute,
    batchStatusUsersRoute,
    batchResetPasswordRoute,
    updateUserPasswordRoute,
    unlockUserRoute,
    getUserMenusRoute,
    assignUserMenusRoute,
    assignUserRolesRoute,
    getUserDataPermissionRoute,
    updateUserDataPermissionRoute,
    getUserEffectivePermissionsRoute,
    getUserPreferencesRoute,
    updateUserPreferencesRoute,
  ],
);

export default usersRouter;
