import { and, eq, inArray, isNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { CmsPageBlock, SetCmsPageBlockAclInput } from '@zenith/shared';
import { db } from '../../db';
import { cmsPageBlockAcls, cmsPages, roles, userRoles, users } from '../../db/schema';
import type { CmsPageBlockAclRow, CmsPageRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { currentUser, hasPermission } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { assertCompleteCmsBatch, isCmsPlatformAdmin } from './cms-access';
import { assertSiteAccess } from './cms-sites.service';
import { assertCmsPageBlockMutationAllowed } from './cms-page-blocks';
import { lockCmsSiteForMutation } from './cms-site-publish-lock.service';

async function ensureCmsPageRow(id: number): Promise<CmsPageRow> {
  const [row] = await db.select().from(cmsPages).where(eq(cmsPages.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '页面不存在' });
  await assertSiteAccess(row.siteId);
  return row;
}

async function currentRoleIds(executor: DbExecutor = db): Promise<number[]> {
  const user = currentUser();
  const rows = await executor.select({ roleId: userRoles.roleId }).from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(userRoles.userId, user.userId), eq(roles.status, 'enabled')));
  return rows.map((row) => row.roleId);
}

export interface CmsBlockManagementState {
  canManage: boolean;
  aclConfigured: boolean;
  disabledReason: string | null;
}

export async function resolveCmsPageBlockManagement(
  page: Pick<CmsPageRow, 'id' | 'blocks'>,
  executor: DbExecutor = db,
): Promise<Map<string, CmsBlockManagementState>> {
  return (await resolveCmsPageBlockManagementBatch([page], executor)).get(page.id) ?? new Map();
}

export async function resolveCmsPageBlockManagementBatch(
  pages: Array<Pick<CmsPageRow, 'id' | 'blocks'>>,
  executor: DbExecutor = db,
): Promise<Map<number, Map<string, CmsBlockManagementState>>> {
  const result = new Map<number, Map<string, CmsBlockManagementState>>();
  if (pages.length === 0) return result;
  const pageIds = pages.map((page) => page.id);
  if (isCmsPlatformAdmin()) {
    const rows = await executor.select({
      pageId: cmsPageBlockAcls.pageId,
      blockId: cmsPageBlockAcls.blockId,
    }).from(cmsPageBlockAcls).where(inArray(cmsPageBlockAcls.pageId, pageIds));
    const configured = new Set(rows.map((grant) => `${grant.pageId}:${grant.blockId}`));
    for (const page of pages) {
      result.set(page.id, new Map(((page.blocks ?? []) as CmsPageBlock[]).map((block) => [block.id, {
        canManage: true,
        aclConfigured: configured.has(`${page.id}:${block.id}`),
        disabledReason: null,
      }])));
    }
    return result;
  }
  const [canUpdatePage, roleIds, grants] = await Promise.all([
    hasPermission('cms:page:update'),
    currentRoleIds(executor),
    executor.select().from(cmsPageBlockAcls).where(inArray(cmsPageBlockAcls.pageId, pageIds)),
  ]);
  const userId = currentUser().userId;
  const byBlock = new Map<string, CmsPageBlockAclRow[]>();
  for (const grant of grants) {
    const key = `${grant.pageId}:${grant.blockId}`;
    const list = byBlock.get(key) ?? [];
    list.push(grant);
    byBlock.set(key, list);
  }
  for (const page of pages) {
    const states = new Map<string, CmsBlockManagementState>();
    for (const block of (page.blocks ?? []) as CmsPageBlock[]) {
      const configured = byBlock.get(`${page.id}:${block.id}`) ?? [];
      const aclConfigured = configured.length > 0;
      const granted = configured.some((grant) =>
        (grant.subjectType === 'user' && grant.subjectId === userId)
        || (grant.subjectType === 'role' && roleIds.includes(grant.subjectId)));
      const canManage = aclConfigured ? granted : canUpdatePage;
      states.set(block.id, {
        canManage,
        aclConfigured,
        disabledReason: canManage
          ? null
          : aclConfigured
            ? '该区块已配置独立权限，当前用户未获授权'
            : '当前用户没有页面编辑权限',
      });
    }
    result.set(page.id, states);
  }
  return result;
}

export async function decorateCmsPageBlocks(
  page: Pick<CmsPageRow, 'id' | 'blocks'>,
  executor: DbExecutor = db,
): Promise<CmsPageBlock[]> {
  const states = await resolveCmsPageBlockManagement(page, executor);
  return ((page.blocks ?? []) as CmsPageBlock[]).map((block) => ({
    ...block,
    ...(states.get(block.id) ?? {
      canManage: false,
      aclConfigured: false,
      disabledReason: '区块权限状态不可用',
    }),
  }));
}

export async function decorateCmsPageBlocksBatch(
  pages: Array<Pick<CmsPageRow, 'id' | 'blocks'>>,
): Promise<Map<number, CmsPageBlock[]>> {
  const statesByPage = await resolveCmsPageBlockManagementBatch(pages);
  return new Map(pages.map((page) => [
    page.id,
    ((page.blocks ?? []) as CmsPageBlock[]).map((block) => ({
      ...block,
      ...(statesByPage.get(page.id)?.get(block.id) ?? {
        canManage: false,
        aclConfigured: false,
        disabledReason: '区块权限状态不可用',
      }),
    })),
  ]));
}

export async function assertCmsPageBlocksUpdateAllowed(
  page: Pick<CmsPageRow, 'id' | 'blocks'>,
  after: readonly CmsPageBlock[],
  executor: DbExecutor = db,
): Promise<void> {
  const states = await resolveCmsPageBlockManagement(page, executor);
  const manageableBlockIds = new Set(
    [...states].filter(([, state]) => state.canManage).map(([blockId]) => blockId),
  );
  assertCmsPageBlockMutationAllowed({
    before: (page.blocks ?? []) as CmsPageBlock[],
    after,
    manageableBlockIds,
    canCreate: await hasPermission('cms:page:update'),
  });
}

export async function listCmsPageBlockAcls(pageId: number, blockId?: string) {
  const page = await ensureCmsPageRow(pageId);
  const blockIds = new Set(((page.blocks ?? []) as CmsPageBlock[]).map((block) => block.id));
  if (blockId && !blockIds.has(blockId)) throw new HTTPException(404, { message: '页面区块不存在' });
  const rows = await db.select().from(cmsPageBlockAcls).where(and(
    eq(cmsPageBlockAcls.pageId, pageId),
    blockId ? eq(cmsPageBlockAcls.blockId, blockId) : undefined,
  ));
  const userIds = [...new Set(rows.filter((row) => row.subjectType === 'user').map((row) => row.subjectId))];
  const roleIds = [...new Set(rows.filter((row) => row.subjectType === 'role').map((row) => row.subjectId))];
  const [userRows, roleRows] = await Promise.all([
    userIds.length
      ? db.select({ id: users.id, name: users.nickname, username: users.username }).from(users).where(inArray(users.id, userIds))
      : Promise.resolve([]),
    roleIds.length
      ? db.select({ id: roles.id, name: roles.name }).from(roles).where(inArray(roles.id, roleIds))
      : Promise.resolve([]),
  ]);
  const userNames = new Map(userRows.map((row) => [row.id, row.name || row.username]));
  const roleNames = new Map(roleRows.map((row) => [row.id, row.name]));
  return rows.map((row) => ({
    id: row.id,
    pageId: row.pageId,
    blockId: row.blockId,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    subjectName: row.subjectType === 'user'
      ? userNames.get(row.subjectId) ?? null
      : roleNames.get(row.subjectId) ?? null,
    createdAt: formatDateTime(row.createdAt),
  }));
}

export async function setCmsPageBlockAcls(pageId: number, input: SetCmsPageBlockAclInput) {
  if (!(await hasPermission('cms:page:acl'))) {
    throw new HTTPException(403, { message: '无区块 ACL 管理权限' });
  }
  const initial = await ensureCmsPageRow(pageId);
  const userIds = [...new Set(input.grants.filter((grant) => grant.subjectType === 'user').map((grant) => grant.subjectId))];
  const roleIds = [...new Set(input.grants.filter((grant) => grant.subjectType === 'role').map((grant) => grant.subjectId))];
  const grants = [...new Map(input.grants.map((grant) => [`${grant.subjectType}:${grant.subjectId}`, grant])).values()];
  await db.transaction(async (tx) => {
    await lockCmsSiteForMutation(tx, initial.siteId);
    const [page] = await tx.select().from(cmsPages).where(eq(cmsPages.id, pageId)).for('update').limit(1);
    if (!page) throw new HTTPException(404, { message: '页面不存在' });
    const existingBlockIds = new Set(((page.blocks ?? []) as CmsPageBlock[]).map((block) => block.id));
    if (input.blockIds.some((blockId) => !existingBlockIds.has(blockId))) {
      throw new HTTPException(404, { message: '所选页面区块包含不存在或已被替换的 blockId' });
    }
    const [validUsers, validRoles] = await Promise.all([
      userIds.length
        ? tx.select({ id: users.id }).from(users).where(and(
          inArray(users.id, userIds),
          isNull(users.tenantId),
          eq(users.status, 'enabled'),
        ))
        : Promise.resolve([]),
      roleIds.length
        ? tx.select({ id: roles.id }).from(roles).where(and(
          inArray(roles.id, roleIds),
          isNull(roles.tenantId),
          eq(roles.status, 'enabled'),
        ))
        : Promise.resolve([]),
    ]);
    assertCompleteCmsBatch(userIds, validUsers.map((row) => row.id), '平台用户');
    assertCompleteCmsBatch(roleIds, validRoles.map((row) => row.id), '已启用平台角色');
    await tx.delete(cmsPageBlockAcls).where(and(
      eq(cmsPageBlockAcls.pageId, pageId),
      inArray(cmsPageBlockAcls.blockId, input.blockIds),
    ));
    if (grants.length > 0) {
      await tx.insert(cmsPageBlockAcls).values(input.blockIds.flatMap((currentBlockId) =>
        grants.map((grant) => ({
          pageId,
          blockId: currentBlockId,
          subjectType: grant.subjectType,
          subjectId: grant.subjectId,
        }))));
    }
  });
  return listCmsPageBlockAcls(pageId);
}
