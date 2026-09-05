import { OpenAPIHono } from '@hono/zod-openapi';
import { driveSpaceContract } from '@zenith/shared/drive';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createTeamSpace,
  deleteDriveSpace,
  ensureDriveSpaceExists,
  getDriveSpace,
  getSpaceMembersBeforeAudit,
  listDriveSpaces,
  listMySpaces,
  listSpaceMembers,
  saveSpaceMembers,
  transferDriveSpace,
  updateDriveSpace,
} from '../../services/drive/drive-spaces.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const AUDIT = { module: '企业网盘' } as const;

const read = [authMiddleware, guard({ permission: 'drive:node:list' })] as const;

const mySpacesRoute = defineContractRoute(driveSpaceContract.my, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listMySpaces()), 200),
});

const listRoute = defineContractRoute(driveSpaceContract.list, {
  middleware: [authMiddleware, guard({ permission: 'drive:space:list' })],
  handler: async (c) => c.json(okBody(await listDriveSpaces(c.req.valid('query'))), 200),
});

const getOneRoute = defineContractRoute(driveSpaceContract.detail, {
  middleware: read,
  responses: { 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  handler: async (c) => c.json(okBody(await getDriveSpace(c.req.valid('param').id)), 200),
});

const createRoute = defineContractRoute(driveSpaceContract.create, {
  middleware: [authMiddleware, guard({ permission: 'drive:space:create', audit: { description: '创建协作空间', ...AUDIT } })],
  handler: async (c) => c.json(okBody(await createTeamSpace(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineContractRoute(driveSpaceContract.update, {
  middleware: [authMiddleware, guard({ permission: 'drive:space:edit', audit: { description: '更新网盘空间', ...AUDIT } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDriveSpaceExists(id));
    return c.json(okBody(await updateDriveSpace(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(driveSpaceContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'drive:space:delete', audit: { description: '删除网盘空间', ...AUDIT } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDriveSpaceExists(id));
    await deleteDriveSpace(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const membersRoute = defineContractRoute(driveSpaceContract.members, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listSpaceMembers(c.req.valid('param').id)), 200),
});

const saveMembersRoute = defineContractRoute(driveSpaceContract.saveMembers, {
  middleware: [authMiddleware, guard({ permission: 'drive:space:grant', audit: { description: '保存网盘空间成员', ...AUDIT } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSpaceMembersBeforeAudit(id));
    await saveSpaceMembers(id, c.req.valid('json'));
    setAuditAfterData(c, await getSpaceMembersBeforeAudit(id));
    return c.json(okBody(null, '保存成功'), 200);
  },
});

const transferRoute = defineContractRoute(driveSpaceContract.transfer, {
  middleware: [authMiddleware, guard({ permission: 'drive:space:edit', audit: { description: '转让网盘空间', ...AUDIT } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDriveSpaceExists(id));
    return c.json(okBody(await transferDriveSpace(id, c.req.valid('json').ownerId), '转让成功'), 200);
  },
});

// 静态 /my 先于动态 /{id}
router.openapiRoutes([mySpacesRoute, listRoute, createRoute, getOneRoute, updateRoute, deleteRoute, membersRoute, saveMembersRoute, transferRoute] as const);

export default router;
