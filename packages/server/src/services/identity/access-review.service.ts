import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { ALL_PERMISSIONS } from '@zenith/shared/permissions';
import { higherAccessRisk, accessGovernanceContract, type AccessPolicySnapshot, type AccessRiskLevel, type CreateAccessReviewCampaignInput, type DecideAccessReviewItemInput, type AssignAccessReviewCampaignInput } from '@zenith/shared/identity';
import type { QueryOutputOf } from '@zenith/shared/core';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { departments, identityAccessGrantItems, identityAccessGrants, identityAccessReviewCampaigns, identityAccessReviewItems, roles, userGroupMembers, userGroupRoles, userGroups, identityUserPermissions, userRoles, users, userMfaFactors, type IdentityAccessReviewCampaignRow } from '../../db/schema';
import { currentUser, setAuditBefore } from '../../lib/context';
import { randomUUID } from 'node:crypto';
import { exactTenantCondition, getCreateTenantId, tenantCondition } from '../../lib/tenant';
import { requireRow } from '../../lib/db-assert';
import { parseDateTimeInput, formatDateTime } from '../../lib/datetime';
import { buildWhere } from '../../lib/where-helpers';
import { buildListResult } from '../../lib/list-query';
import { pageOffset } from '../../lib/pagination';
import { getUserPermissions, isSuperAdmin, notifyUserPermissionsChanged, runWithFreshUserPermissions } from '../../lib/permissions';
import { forceLogoutAllByUsers } from '../../lib/session-manager';
import { requireTenantUser, resolveUserNames } from '../../lib/user-nicknames';
import { persistSystemAsyncTask, taskTransaction, lockSystemTask, retrySystemTaskInTransaction } from '../../lib/task-center';
import { notifyWithin } from '../messaging/notification-outbox.service';
import { assertAccessSnapshotDuration, loadEffectiveAccessPolicies } from './access-policy.service';
import { verifyAccessMfa } from './access-approval.service';
import { refreshAccessGrantHeader, revokeAccessGrantItemInTransaction } from './access-grants.service';
import { formatReviewCampaign, formatReviewItem } from './access-formatters';
import { collectAccessReviewSourceBatch, expandReviewDepartmentIds } from './access-review-sources.service';
import { assertNoOverlappingAccessRequest } from './access-reservations.service';
import { assertUserRolesRemovable, lockIdentityAuthority } from './authority-write.service';

function reviewPolicy(policies: readonly AccessPolicySnapshot[], minimumRisk: AccessRiskLevel) {
  const riskLevel = policies.reduce((risk, policy) => higherAccessRisk(risk, policy.riskLevel), minimumRisk);
  return { riskLevel, mfaRequired: riskLevel === 'critical' || policies.some(policy => policy.mfaRequired) };
}

function futureDate(value: string, label: string): Date {
  const date = parseDateTimeInput(value);
  if (!date || date.getTime() <= Date.now()) throw new HTTPException(400, { message: `${label}必须晚于当前时间` });
  return date;
}

function reviewerCondition(executor: DbExecutor) {
  const roleCanReview = sql`${roles.permissionCodes} @> '["system:access-governance:review"]'::jsonb`;
  return or(
    inArray(users.id, executor.select({ userId: userRoles.userId }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(and(eq(roles.status, 'enabled'), roleCanReview))),
    inArray(users.id, executor.select({ userId: identityUserPermissions.userId }).from(identityUserPermissions).where(eq(identityUserPermissions.permissionCode, 'system:access-governance:review'))),
    inArray(users.id, executor.select({ userId: userGroupMembers.userId }).from(userGroupMembers).innerJoin(userGroups, eq(userGroups.id, userGroupMembers.groupId)).innerJoin(userGroupRoles, eq(userGroupRoles.groupId, userGroups.id)).innerJoin(roles, eq(roles.id, userGroupRoles.roleId)).where(and(eq(userGroups.status, 'enabled'), eq(roles.status, 'enabled'), roleCanReview))),
    inArray(users.id, executor.select({ userId: identityAccessGrants.userId }).from(identityAccessGrants).innerJoin(identityAccessGrantItems, eq(identityAccessGrantItems.grantId, identityAccessGrants.id)).where(and(inArray(identityAccessGrants.status, ['scheduled', 'active']), inArray(identityAccessGrantItems.status, ['scheduled', 'active']), eq(identityAccessGrantItems.permissionCode, 'system:access-governance:review'), lte(identityAccessGrantItems.startsAt, new Date()), or(isNull(identityAccessGrantItems.expiresAt), gt(identityAccessGrantItems.expiresAt, new Date()))))),
  );
}

async function reviewerRows(tenantId: number | null, executor: DbExecutor = db) {
  return executor.select({ id: users.id, name: users.nickname, username: users.username }).from(users)
    .where(and(exactTenantCondition(users.tenantId, tenantId), eq(users.status, 'enabled'), reviewerCondition(executor))).orderBy(asc(users.id));
}

async function ensureReviewer(id: number, tenantId: number | null) {
  const reviewer = await requireTenantUser(id, '复核负责人不存在或已停用', { enabledOnly: true, tenantId });
  const capable = await runWithFreshUserPermissions(id, async () => (await getUserPermissions(id)).includes('system:access-governance:review'));
  if (!capable) throw new HTTPException(400, { message: '所选负责人没有权限复核办理能力' });
  return reviewer;
}

export async function getAccessReviewOptions() {
  const tenantId = getCreateTenantId(currentUser());
  const [people, reviewers, depts, roleRows, groups] = await Promise.all([
    db.select({ id: users.id, nickname: users.nickname, username: users.username, status: users.status }).from(users).where(exactTenantCondition(users.tenantId, tenantId)).orderBy(asc(users.id)),
    reviewerRows(tenantId),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(exactTenantCondition(departments.tenantId, tenantId)),
    db.select({ id: roles.id, name: roles.name }).from(roles).where(and(exactTenantCondition(roles.tenantId, tenantId), eq(roles.status, 'enabled'))),
    db.select({ id: userGroups.id, name: userGroups.name }).from(userGroups).where(and(exactTenantCondition(userGroups.tenantId, tenantId), eq(userGroups.status, 'enabled'))),
  ]);
  return { users: people.map(user => ({ id: user.id, name: `${user.nickname || user.username}${user.status === 'disabled' ? '（已停用）' : ''}` })), reviewers: reviewers.map(user => ({ id: user.id, name: user.name || user.username })), departments: depts, roles: roleRows, groups };
}

async function readReviewCampaign(id: number) {
  const campaign = requireRow(await db.query.identityAccessReviewCampaigns.findFirst({ where: and(eq(identityAccessReviewCampaigns.id, id), tenantCondition(identityAccessReviewCampaigns, currentUser())), with: { reviewer: true } }), '复核批次不存在');
  const where = and(eq(identityAccessReviewItems.campaignId, id), exactTenantCondition(identityAccessReviewItems.tenantId, campaign.tenantId));
  const [itemCount, pendingCount] = await Promise.all([db.$count(identityAccessReviewItems, where), db.$count(identityAccessReviewItems, and(where, eq(identityAccessReviewItems.decision, 'pending')))]);
  return formatReviewCampaign({ ...campaign, itemCount, pendingCount });
}

async function createCampaignRecord(input: CreateAccessReviewCampaignInput, tenantId: number | null, dueOnly = false) {
  const dueAt = futureDate(input.dueAt, '复核截止时间');
  return taskTransaction(async tx => {
    const [campaign] = await tx.insert(identityAccessReviewCampaigns).values({ tenantId, name: input.name, scopeType: input.scopeType, scopeIds: [...new Set(input.scopeIds)], reviewerId: input.reviewerId, dueAt, status: 'preparing', dueOnly }).returning();
    await persistSystemAsyncTask(tx, { taskType: 'identity-access-review-build', payload: { campaignId: campaign.id }, idempotencyKey: `identity-access-review-build:${campaign.id}` }, tenantId);
    return campaign;
  });
}

export async function createAccessReviewCampaign(input: CreateAccessReviewCampaignInput) {
  const tenantId = getCreateTenantId(currentUser());
  const reviewer = await ensureReviewer(input.reviewerId, tenantId);
  if (['department', 'role', 'group', 'user'].includes(input.scopeType)) {
    const table = input.scopeType === 'department' ? departments : input.scopeType === 'role' ? roles : input.scopeType === 'group' ? userGroups : users;
    const ids = [...new Set(input.scopeIds)];
    const found = await db.select({ id: table.id }).from(table).where(and(inArray(table.id, ids), exactTenantCondition(table.tenantId, tenantId)));
    if (found.length !== ids.length) throw new HTTPException(400, { message: '复核范围包含无效或跨租户对象' });
  }
  const campaign = await createCampaignRecord(input, tenantId);
  return formatReviewCampaign({ ...campaign, reviewer, itemCount: 0, pendingCount: 0 });
}

export async function buildAccessReviewCampaign(campaignId: number, tenantId: number | null): Promise<void> {
  let campaign = requireRow(await db.query.identityAccessReviewCampaigns.findFirst({ where: and(eq(identityAccessReviewCampaigns.id, campaignId), exactTenantCondition(identityAccessReviewCampaigns.tenantId, tenantId)) }), '权限复核批次不存在');
  if (!['preparing', 'failed'].includes(campaign.status)) return;
  const policies = new Map((await loadEffectiveAccessPolicies(Object.keys(ALL_PERMISSIONS), tenantId)).map(policy => [policy.permissionCode, policy]));
  const departmentIds = campaign.scopeType === 'department' ? await expandReviewDepartmentIds(campaign.scopeIds, tenantId) : [];
  while (true) {
    const batch = await collectAccessReviewSourceBatch(campaign, campaign.buildCursorUserId, policies, departmentIds);
    campaign = await taskTransaction(async tx => {
      const [locked] = await tx.select().from(identityAccessReviewCampaigns).where(and(eq(identityAccessReviewCampaigns.id, campaignId), exactTenantCondition(identityAccessReviewCampaigns.tenantId, tenantId))).for('update').limit(1);
      if (!locked || !['preparing', 'failed'].includes(locked.status)) throw new Error('复核批次准备状态已变化');
      const sources = batch.sources.map(({ previousReviewItemId: _previous, ...source }) => ({ ...source, campaignId, reviewerId: locked.reviewerId, dueAt: locked.dueAt }));
      for (let offset = 0; offset < sources.length; offset += 200) await tx.insert(identityAccessReviewItems).values(sources.slice(offset, offset + 200)).onConflictDoNothing();
      const previousIds = batch.sources.flatMap(source => source.previousReviewItemId ? [source.previousReviewItemId] : []);
      if (previousIds.length) await tx.update(identityAccessReviewItems).set({ nextReviewAt: null }).where(and(inArray(identityAccessReviewItems.id, previousIds), exactTenantCondition(identityAccessReviewItems.tenantId, tenantId), ne(identityAccessReviewItems.decision, 'pending')));
      let status: IdentityAccessReviewCampaignRow['status'] = 'preparing';
      let completedAt: Date | null = null;
      if (batch.exhausted) {
        const itemCount = await tx.$count(identityAccessReviewItems, eq(identityAccessReviewItems.campaignId, campaignId));
        status = itemCount === 0 ? 'completed' : locked.dueAt.getTime() <= Date.now() ? 'overdue' : 'open';
        completedAt = itemCount === 0 ? new Date() : null;
        if (itemCount) await notifyWithin(tx, 'identity.access.review_due', { recipients: [{ type: 'user', id: locked.reviewerId }], vars: { campaignId, campaignName: locked.name, pendingCount: itemCount, dueAt: formatDateTime(locked.dueAt) }, tenantId, link: `/system/access-governance?tab=reviews&campaignId=${campaignId}`, dedupeKey: `identity-access-review-ready:${campaignId}` });
      }
      const [updated] = await tx.update(identityAccessReviewCampaigns).set({ status, completedAt, buildCursorUserId: batch.cursor, failureReason: null }).where(eq(identityAccessReviewCampaigns.id, campaignId)).returning();
      return updated;
    });
    if (batch.exhausted) return;
  }
}

export async function listReviewCampaigns(q: QueryOutputOf<typeof accessGovernanceContract.reviewCampaignList>) {
  const where = tenantCondition(identityAccessReviewCampaigns, currentUser());
  return buildListResult({ page: q.page, pageSize: q.pageSize, count: () => db.$count(identityAccessReviewCampaigns, where), rows: async () => {
    const campaigns = await db.query.identityAccessReviewCampaigns.findMany({ where, with: { reviewer: true }, orderBy: [desc(identityAccessReviewCampaigns.createdAt), desc(identityAccessReviewCampaigns.id)], limit: q.pageSize, offset: pageOffset(q.page, q.pageSize) });
    if (!campaigns.length) return [];
    const counts = await db.select({ campaignId: identityAccessReviewItems.campaignId, total: sql<number>`count(*)::integer`, pending: sql<number>`count(*) filter (where ${identityAccessReviewItems.decision} = 'pending')::integer` }).from(identityAccessReviewItems)
      .where(inArray(identityAccessReviewItems.campaignId, campaigns.map(campaign => campaign.id))).groupBy(identityAccessReviewItems.campaignId);
    const map = new Map(counts.map(count => [count.campaignId, count]));
    return campaigns.map(campaign => ({ ...campaign, itemCount: map.get(campaign.id)?.total ?? 0, pendingCount: map.get(campaign.id)?.pending ?? 0 }));
  }, map: formatReviewCampaign });
}

export async function listReviewItems(q: QueryOutputOf<typeof accessGovernanceContract.reviewItemList>) {
  const where = buildWhere(tenantCondition(identityAccessReviewItems, currentUser()), q.campaignId ? eq(identityAccessReviewItems.campaignId, q.campaignId) : undefined,
    q.reviewerId ? eq(identityAccessReviewItems.reviewerId, q.reviewerId) : undefined, q.decision ? eq(identityAccessReviewItems.decision, q.decision) : undefined,
    q.riskLevel ? eq(identityAccessReviewItems.riskLevel, q.riskLevel) : undefined, q.sourceType ? eq(identityAccessReviewItems.sourceType, q.sourceType) : undefined, q.userId ? eq(identityAccessReviewItems.userId, q.userId) : undefined);
  return buildListResult({ page: q.page, pageSize: q.pageSize, count: () => db.$count(identityAccessReviewItems, where), rows: () => db.query.identityAccessReviewItems.findMany({ where, with: { user: true, reviewer: true }, orderBy: [desc(identityAccessReviewItems.createdAt), desc(identityAccessReviewItems.id)], limit: q.pageSize, offset: pageOffset(q.page, q.pageSize) }), map: formatReviewItem });
}

export async function assignAccessReviewCampaign(id: number, input: AssignAccessReviewCampaignInput) {
  const where = and(eq(identityAccessReviewCampaigns.id, id), tenantCondition(identityAccessReviewCampaigns, currentUser()));
  const visible = requireRow(await db.query.identityAccessReviewCampaigns.findFirst({ where }), '复核批次不存在');
  await ensureReviewer(input.reviewerId, visible.tenantId);
  setAuditBefore(await readReviewCampaign(id));
  await db.transaction(async tx => {
    const [campaign] = await tx.select().from(identityAccessReviewCampaigns).where(where).for('update').limit(1);
    requireRow(campaign, '复核批次不存在');
    if (campaign.status === 'completed') throw new HTTPException(409, { message: '已完成批次不需要调整负责人' });
    if (campaign.reviewerId === input.reviewerId) return;
    await tx.update(identityAccessReviewCampaigns).set({ reviewerId: input.reviewerId }).where(where);
    const changed = await tx.update(identityAccessReviewItems).set({ reviewerId: input.reviewerId, remark: input.reason }).where(and(eq(identityAccessReviewItems.campaignId, id), eq(identityAccessReviewItems.reviewerId, campaign.reviewerId), eq(identityAccessReviewItems.decision, 'pending'))).returning({ id: identityAccessReviewItems.id });
    if (changed.length) await notifyWithin(tx, 'identity.access.review_due', { recipients: [{ type: 'user', id: input.reviewerId }], vars: { campaignId: id, campaignName: campaign.name, pendingCount: changed.length, dueAt: formatDateTime(campaign.dueAt) }, tenantId: campaign.tenantId, link: `/system/access-governance?tab=reviews&campaignId=${id}`, dedupeKey: `identity-access-review-assigned:${id}:${randomUUID()}` });
  });
  return readReviewCampaign(id);
}

export async function retryAccessReviewCampaign(id: number) {
  const where = and(eq(identityAccessReviewCampaigns.id, id), tenantCondition(identityAccessReviewCampaigns, currentUser()));
  const visible = requireRow(await db.query.identityAccessReviewCampaigns.findFirst({ where, columns: { tenantId: true } }), '复核批次不存在');
  await taskTransaction(async tx => {
    const task = await lockSystemTask(tx, { taskType: 'identity-access-review-build', idempotencyKey: `identity-access-review-build:${id}`, tenantId: visible.tenantId });
    const [campaign] = await tx.select().from(identityAccessReviewCampaigns).where(where).for('update').limit(1);
    if (!campaign || campaign.status !== 'failed') throw new HTTPException(409, { message: '仅准备失败的复核批次可以重试' });
    await retrySystemTaskInTransaction(tx, task);
    await tx.update(identityAccessReviewCampaigns).set({ status: 'preparing', failureReason: null }).where(where);
  });
  return readReviewCampaign(id);
}

async function aggregateCampaign(executor: DbExecutor, campaignId: number, tenantId: number | null) {
  const pending = await executor.$count(identityAccessReviewItems, and(eq(identityAccessReviewItems.campaignId, campaignId), eq(identityAccessReviewItems.decision, 'pending')));
  const campaign = requireRow(await executor.query.identityAccessReviewCampaigns.findFirst({ where: and(eq(identityAccessReviewCampaigns.id, campaignId), exactTenantCondition(identityAccessReviewCampaigns.tenantId, tenantId)) }), '复核批次不存在');
  await executor.update(identityAccessReviewCampaigns).set({ status: pending === 0 ? 'completed' : campaign.dueAt.getTime() <= Date.now() ? 'overdue' : 'in_progress', completedAt: pending === 0 ? new Date() : null }).where(and(eq(identityAccessReviewCampaigns.id, campaignId), exactTenantCondition(identityAccessReviewCampaigns.tenantId, tenantId)));
}

function snapshotCodes(snapshot: Record<string, unknown>): string[] {
  return Array.isArray(snapshot.permissionCodes) ? snapshot.permissionCodes.filter((code): code is string => typeof code === 'string') : [];
}

export async function decideReviewItem(id: number, input: DecideAccessReviewItemInput) {
  const actor = currentUser();
  const where = and(eq(identityAccessReviewItems.id, id), tenantCondition(identityAccessReviewItems, actor));
  const initial = requireRow(await db.query.identityAccessReviewItems.findFirst({ where, with: { user: true, reviewer: true } }), '权限复核项不存在');
  setAuditBefore(formatReviewItem(initial));
  if (initial.reviewerId !== actor.userId && !isSuperAdmin(actor)) throw new HTTPException(403, { message: '仅指定负责人可以办理该复核项' });
  if (initial.userId === actor.userId && !['revoke', 'escalate'].includes(input.decision)) throw new HTTPException(403, { message: '不能复核保留自己的权限，请升级给独立复核人' });
  const policies = await loadEffectiveAccessPolicies(snapshotCodes(initial.snapshot), initial.tenantId);
  const policy = reviewPolicy(policies, initial.riskLevel);
  const mfa = policy.mfaRequired && ['keep', 'extend', 'exception'].includes(input.decision) ? await verifyAccessMfa(actor.userId, input.mfaCode) : null;
  const expiresAt = input.expiresAt ? futureDate(input.expiresAt, '新的截止时间') : null;
  const escalationDueAt = input.dueAt ? futureDate(input.dueAt, '升级截止时间') : null;
  if (input.targetReviewerId) {
    await ensureReviewer(input.targetReviewerId, initial.tenantId);
    if (input.targetReviewerId === initial.userId || input.targetReviewerId === actor.userId) throw new HTTPException(400, { message: '升级负责人必须是另一名独立复核人' });
  }
  if (input.exceptionOwnerId) {
    await requireTenantUser(input.exceptionOwnerId, '例外责任人不存在或已停用', { enabledOnly: true, tenantId: initial.tenantId });
    if (input.exceptionOwnerId === initial.userId) throw new HTTPException(400, { message: '例外必须由独立责任人承担风险' });
  }
  const changedUsers = new Set<number>();
  const logoutUsers = new Set<number>();
  let sourceRefreshed = false;
  await db.transaction(async tx => {
    await tx.select({ id: identityAccessReviewCampaigns.id }).from(identityAccessReviewCampaigns).where(and(eq(identityAccessReviewCampaigns.id, initial.campaignId), exactTenantCondition(identityAccessReviewCampaigns.tenantId, initial.tenantId))).for('update');
    const [item] = await tx.select().from(identityAccessReviewItems).where(where).for('update').limit(1);
    if (!item || item.decision !== 'pending') throw new HTTPException(409, { message: '复核项已被处理，请刷新后重试' });
    if (item.reviewerId !== initial.reviewerId) throw new HTTPException(409, { message: '复核负责人已变化，请刷新后重试' });
    await lockIdentityAuthority(tx, item.tenantId);
    if (['keep', 'extend', 'exception'].includes(input.decision)) {
      const currentSources = await collectAccessReviewSourceBatch({ tenantId: item.tenantId, scopeType: 'user', scopeIds: [item.userId], dueOnly: false }, item.userId - 1, new Map(policies.map(policy => [policy.permissionCode, policy])), [], tx, true);
      const source = currentSources.sources.find(source => source.sourceType === item.sourceType && source.sourceId === item.sourceId);
      if (!source) throw new HTTPException(409, { message: '授权来源已经失效，请选择撤销完成此项复核' });
      const sourceSignature = (snapshot: Record<string, unknown>) => JSON.stringify(Object.entries(snapshot).filter(([key]) => !['capturedAt', 'reviewIntervalDays'].includes(key)).sort(([a], [b]) => a.localeCompare(b)));
      if (sourceSignature(source.snapshot ?? {}) !== sourceSignature(item.snapshot)) {
        const refreshedPolicies = await loadEffectiveAccessPolicies(snapshotCodes(source.snapshot ?? {}), item.tenantId, tx);
        await tx.update(identityAccessReviewItems).set({ snapshot: source.snapshot, sourceLabel: source.sourceLabel, riskLevel: reviewPolicy(refreshedPolicies, source.riskLevel ?? 'low').riskLevel }).where(where);
        sourceRefreshed = true;
        return;
      }
    }
    const activeActor = await tx.query.users.findFirst({ where: and(eq(users.id, actor.userId), eq(users.status, 'enabled')), columns: { id: true } });
    if (!activeActor) throw new HTTPException(403, { message: '当前账号已停用，不能继续办理' });
    const campaign = requireRow(await tx.query.identityAccessReviewCampaigns.findFirst({ where: and(eq(identityAccessReviewCampaigns.id, item.campaignId), exactTenantCondition(identityAccessReviewCampaigns.tenantId, item.tenantId)) }), '复核批次不存在');
    if (!['open', 'in_progress', 'overdue'].includes(campaign.status)) throw new HTTPException(409, { message: '复核批次尚未准备完成或已关闭' });
    const currentPolicies = await loadEffectiveAccessPolicies(snapshotCodes(item.snapshot), item.tenantId, tx);
    const currentRisk = reviewPolicy(currentPolicies, item.riskLevel);
    if (currentRisk.mfaRequired && ['keep', 'extend', 'exception'].includes(input.decision) && !mfa) throw new HTTPException(403, { message: '当前策略要求 MFA，请填写动态验证码后重试' });
    if (mfa) {
      const factor = await tx.query.userMfaFactors.findFirst({ where: and(eq(userMfaFactors.id, mfa.factorId), eq(userMfaFactors.userId, actor.userId), eq(userMfaFactors.status, 'enabled')), columns: { id: true } });
      if (!factor || Date.now() - mfa.verifiedAt.getTime() > 120_000) throw new HTTPException(403, { message: 'MFA 状态已变化，请重新验证' });
    }
    if (input.decision === 'extend') {
      if (item.sourceType !== 'temporary_grant' || !item.sourceId || !expiresAt) throw new HTTPException(400, { message: '只有临时授权项支持延期，永久授权无需延期' });
      const grantItem = requireRow(await tx.query.identityAccessGrantItems.findFirst({ where: eq(identityAccessGrantItems.id, item.sourceId), with: { grant: true } }), '来源授权项不存在');
      if (!grantItem.expiresAt) throw new HTTPException(409, { message: '此授权项永久有效，无需延期' });
      if (grantItem.grant.tenantId !== item.tenantId || grantItem.grant.userId !== item.userId || !['active', 'scheduled'].includes(grantItem.status) || grantItem.expiresAt.getTime() <= Date.now() || expiresAt <= grantItem.expiresAt) throw new HTTPException(409, { message: '只能延长仍有效的来源授权项，且新时间必须晚于原到期时间' });
      await tx.select({ id: identityAccessGrants.id }).from(identityAccessGrants).where(and(eq(identityAccessGrants.id, grantItem.grantId), exactTenantCondition(identityAccessGrants.tenantId, item.tenantId))).for('update');
      const currentItem = requireRow(await tx.query.identityAccessGrantItems.findFirst({ where: eq(identityAccessGrantItems.id, grantItem.id) }), '来源授权项不存在');
      if (!currentItem.expiresAt || !['active', 'scheduled'].includes(currentItem.status) || currentItem.expiresAt.getTime() <= Date.now() || expiresAt <= currentItem.expiresAt) throw new HTTPException(409, { message: '来源授权已永久有效、撤销、到期或被其他人修改，请刷新后重试' });
      await assertAccessSnapshotDuration([currentItem.policySnapshot], currentItem.startsAt, expiresAt, item.tenantId, tx);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity-access:${item.tenantId ?? 'platform'}:${item.userId}`}, 0))`);
      await assertNoOverlappingAccessRequest({ targetUserId: item.userId, tenantId: item.tenantId, startsAt: currentItem.expiresAt, expiresAt, items: [currentItem], excludeGrantItemId: currentItem.id }, tx);
      await tx.update(identityAccessGrantItems).set({ expiresAt }).where(and(eq(identityAccessGrantItems.id, grantItem.id), eq(identityAccessGrantItems.grantId, grantItem.grantId)));
      await refreshAccessGrantHeader(tx, grantItem.grantId, item.tenantId);
      changedUsers.add(item.userId);
    } else if (input.decision === 'revoke') {
      if (!item.sourceId) throw new HTTPException(409, { message: '复核项缺少有效授权来源' });
      if (item.sourceType === 'temporary_grant') {
        const source = await tx.query.identityAccessGrantItems.findFirst({ where: eq(identityAccessGrantItems.id, item.sourceId), with: { grant: true } });
        if (source && (source.grant.tenantId !== item.tenantId || source.grant.userId !== item.userId)) throw new HTTPException(409, { message: '授权项与复核对象不匹配' });
        if (source) await revokeAccessGrantItemInTransaction(tx, item.sourceId, item.tenantId, actor.userId, input.remark);
      } else if (item.sourceType === 'direct_permission') {
        await tx.delete(identityUserPermissions).where(and(eq(identityUserPermissions.userId, item.userId), eq(identityUserPermissions.id, item.sourceId)));
      } else if (item.sourceType === 'group_membership') {
        const group = await tx.query.userGroups.findFirst({ where: and(eq(userGroups.id, item.sourceId), exactTenantCondition(userGroups.tenantId, item.tenantId)), columns: { memberMode: true } });
        if (group?.memberMode === 'dynamic') throw new HTTPException(409, { message: '动态用户组由规则维护，请升级给用户组负责人调整源规则后再完成复核，避免资格被自动恢复' });
        await tx.delete(userGroupMembers).where(and(eq(userGroupMembers.userId, item.userId), eq(userGroupMembers.groupId, item.sourceId)));
      } else {
        await lockIdentityAuthority(tx, item.tenantId);
        await assertUserRolesRemovable(tx, [item.userId], [item.sourceId]);
        const role = await tx.query.roles.findFirst({ where: and(eq(roles.id, item.sourceId), exactTenantCondition(roles.tenantId, item.tenantId)), columns: { code: true } });
        if (role?.code === 'super_admin' && item.tenantId === null) {
          if (!isSuperAdmin(actor)) throw new HTTPException(403, { message: '平台管理员身份必须交由另一名平台管理员处理' });
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('identity-platform-super-admin', 0))`);
          const remaining = await tx.select({ id: users.id }).from(userRoles).innerJoin(users, eq(users.id, userRoles.userId)).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(and(eq(roles.code, 'super_admin'), isNull(roles.tenantId), eq(users.status, 'enabled'), ne(users.id, item.userId))).limit(1);
          if (!remaining.length) throw new HTTPException(409, { message: '必须至少保留一名启用的平台管理员' });
          logoutUsers.add(item.userId);
        }
        await tx.delete(userRoles).where(and(eq(userRoles.userId, item.userId), eq(userRoles.roleId, item.sourceId)));
      }
      changedUsers.add(item.userId);
    }
    const intervals = currentPolicies.map(entry => entry.reviewIntervalDays).filter(days => days > 0);
    if (currentRisk.riskLevel === 'critical') intervals.push(30);
    else if (currentRisk.riskLevel === 'high') intervals.push(90);
    if (input.decision === 'exception' && expiresAt && expiresAt.getTime() - Date.now() > Math.min(...intervals, currentRisk.riskLevel === 'high' ? 90 : 30) * 86_400_000) throw new HTTPException(400, { message: '例外期限不能超过当前策略的复核周期' });
    const nextReviewAt = input.decision === 'exception' ? expiresAt : intervals.length ? new Date(Date.now() + Math.min(...intervals) * 86_400_000) : null;
    await tx.update(identityAccessReviewItems).set({
      decision: input.decision === 'escalate' ? 'pending' : input.decision,
      reviewerId: input.decision === 'escalate' ? input.targetReviewerId! : item.reviewerId,
      dueAt: input.decision === 'escalate' ? escalationDueAt! : item.dueAt,
      exceptionOwnerId: input.decision === 'exception' ? input.exceptionOwnerId! : null,
      exceptionUntil: input.decision === 'exception' ? expiresAt : null,
      nextReviewAt: input.decision === 'revoke' || input.decision === 'escalate' ? null : nextReviewAt,
      decidedBy: actor.userId, decidedAt: new Date(), remark: input.remark,
      history: [...item.history, { decision: input.decision, actorId: actor.userId, actorName: actor.username, decidedAt: formatDateTime(new Date()), remark: input.remark, targetReviewerId: input.targetReviewerId ?? null, expiresAt: input.expiresAt ?? null, mfaVerifiedAt: mfa ? formatDateTime(mfa.verifiedAt) : null, policies: currentPolicies }],
    }).where(and(eq(identityAccessReviewItems.id, id), exactTenantCondition(identityAccessReviewItems.tenantId, item.tenantId)));
    if (input.decision === 'escalate') await notifyWithin(tx, 'identity.access.review_due', { recipients: [{ type: 'user', id: input.targetReviewerId! }], vars: { campaignId: campaign.id, campaignName: campaign.name, pendingCount: 1, dueAt: formatDateTime(escalationDueAt!) }, tenantId: item.tenantId, link: `/system/access-governance?tab=reviews&campaignId=${campaign.id}`, dedupeKey: `identity-access-review-escalated:${id}:${item.history.length + 1}` });
    if (input.decision !== 'escalate') {
      const names = await resolveUserNames([item.userId], tx);
      await notifyWithin(tx, 'identity.access.review_decided', { recipients: [{ type: 'user', id: item.userId }], vars: { campaignId: campaign.id, itemId: id, targetName: names.get(item.userId) ?? `用户 ${item.userId}`, sourceLabel: item.sourceLabel ?? item.permissionCode ?? '权限来源', decisionLabel: ({ keep: '保留', revoke: '撤销', extend: '延期', exception: '限期例外' } as const)[input.decision], summary: input.remark }, tenantId: item.tenantId, link: '/workflow/launchpad', dedupeKey: `identity-access-review-decided:${id}:${item.history.length + 1}` });
    }
    await aggregateCampaign(tx, item.campaignId, item.tenantId);
  });
  if (sourceRefreshed) throw new HTTPException(409, { message: '授权来源内容或范围已变化，复核快照已更新，请刷新后重新确认' });
  for (const userId of changedUsers) await notifyUserPermissionsChanged(userId);
  if (logoutUsers.size) await forceLogoutAllByUsers([...logoutUsers]);
  return formatReviewItem(requireRow(await db.query.identityAccessReviewItems.findFirst({ where, with: { user: true, reviewer: true } }), '复核项不存在'));
}

export async function runAccessReviewLifecycle(options: { scanNewSources?: boolean } = {}): Promise<string> {
  const now = new Date();
  await db.update(identityAccessReviewCampaigns).set({ status: 'overdue' }).where(and(inArray(identityAccessReviewCampaigns.status, ['open', 'in_progress']), lte(identityAccessReviewCampaigns.dueAt, now)));
  const active = await db.query.identityAccessReviewCampaigns.findMany({ where: inArray(identityAccessReviewCampaigns.status, ['open', 'in_progress', 'overdue']), columns: { id: true, tenantId: true }, limit: 200 });
  for (const campaign of active) await db.transaction(async tx => {
    await tx.select({ id: identityAccessReviewCampaigns.id }).from(identityAccessReviewCampaigns).where(eq(identityAccessReviewCampaigns.id, campaign.id)).for('update');
    await aggregateCampaign(tx, campaign.id, campaign.tenantId);
  });
  const tenants = options.scanNewSources
    ? await db.selectDistinct({ tenantId: users.tenantId }).from(users)
    : await db.selectDistinct({ tenantId: identityAccessReviewItems.tenantId }).from(identityAccessReviewItems).where(and(ne(identityAccessReviewItems.decision, 'pending'), lte(identityAccessReviewItems.nextReviewAt, now)));
  let scheduled = 0;
  for (const { tenantId } of tenants) {
    const existing = await db.query.identityAccessReviewCampaigns.findFirst({ where: and(exactTenantCondition(identityAccessReviewCampaigns.tenantId, tenantId), eq(identityAccessReviewCampaigns.dueOnly, true), inArray(identityAccessReviewCampaigns.status, ['preparing', 'open', 'in_progress', 'overdue'])) });
    if (existing) continue;
    const reviewers = await reviewerRows(tenantId);
    if (!reviewers.length) continue;
    const input = { name: `周期权限复核 · ${formatDateTime(now)}`, scopeType: 'tenant' as const, scopeIds: [], reviewerId: reviewers[0].id, dueAt: formatDateTime(new Date(now.getTime() + 7 * 86_400_000)) };
    const prototype = { tenantId, scopeType: 'tenant' as const, scopeIds: [], dueOnly: true };
    const policies = new Map((await loadEffectiveAccessPolicies(Object.keys(ALL_PERMISSIONS), tenantId)).map(policy => [policy.permissionCode, policy]));
    let cursor = 0;
    while (true) {
      const batch = await collectAccessReviewSourceBatch(prototype, cursor, policies);
      if (batch.sources.length) { await createCampaignRecord(input, tenantId, true); scheduled++; break; }
      if (batch.exhausted) break;
      cursor = batch.cursor;
    }
  }
  return `检查 ${active.length} 个批次，准备 ${scheduled} 个到期复核批次`;
}
