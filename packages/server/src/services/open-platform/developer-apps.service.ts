import dayjs from 'dayjs';
import { requireFirstRow, requireRow } from '../../lib/db-assert';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { CreateDeveloperOAuth2ClientInput, UpdateDeveloperOAuth2ClientInput } from '@zenith/shared/open-platform';
import { db } from '../../db';
import { oauth2Clients, roles, userRoles, users } from '../../db/schema';
import { config } from '../../config';
import { currentUser } from '../../lib/context';
import { tenantCondition } from '../../lib/tenant';
import { APP_TIME_ZONE, formatDateTime } from '../../lib/datetime';
import redis from '../../lib/redis';
import logger from '../../lib/logger';
import { HTTPException } from 'hono/http-exception';
import { notify } from '../messaging/notification-outbox.service';
import {
  createOAuth2Client,
  deleteOAuth2Client,
  getOAuth2Client,
  listOAuth2Clients,
  regenerateOAuth2ClientSecret,
  updateOAuth2Client,
} from './oauth2-clients.service';
import { getDefaultRatePlanRow, getRatePlanRowById } from './rate-plans.service';

async function ensureOwnedApp(id: number) {
  const user = currentUser();
  return requireFirstRow(
    db.select().from(oauth2Clients).where(and(
      eq(oauth2Clients.id, id),
      eq(oauth2Clients.ownerId, user.userId),
      tenantCondition(oauth2Clients, user),
    )).limit(1),
    '应用不存在或不属于当前用户',
  );
}

export function listMyOAuth2Clients(opts: {
  page: number;
  pageSize: number;
  keyword?: string;
  environment?: 'production' | 'sandbox';
  reviewStatus?: 'draft' | 'pending' | 'approved' | 'rejected';
}) {
  return listOAuth2Clients({ ...opts, ownerId: currentUser().userId });
}

export async function getMyOAuth2Client(id: number) {
  await ensureOwnedApp(id);
  return getOAuth2Client(id);
}

export function createMyOAuth2Client(input: CreateDeveloperOAuth2ClientInput) {
  return createOAuth2Client({ ...input, ratePlanId: null }, { reviewStatus: 'draft' });
}

export async function updateMyOAuth2Client(id: number, input: UpdateDeveloperOAuth2ClientInput) {
  const user = currentUser();
  const app = await ensureOwnedApp(id);
  if (app.reviewStatus === 'pending') {
    throw new HTTPException(400, { message: '应用正在审核中，暂不可修改' });
  }
  return updateOAuth2Client(id, {
    ...input,
    ratePlanId: undefined,
    status: undefined,
  }, {
    resetReview: true,
    revokeTokens: true,
    ownerId: user.userId,
    allowedReviewStatuses: ['draft', 'approved', 'rejected'],
  });
}

export async function deleteMyOAuth2Client(id: number) {
  const user = currentUser();
  const app = await ensureOwnedApp(id);
  if (app.reviewStatus === 'pending') {
    throw new HTTPException(400, { message: '应用正在审核中，暂不可删除' });
  }
  return deleteOAuth2Client(id, {
    ownerId: user.userId,
    allowedReviewStatuses: ['draft', 'approved', 'rejected'],
  });
}

export async function regenerateMyOAuth2ClientSecret(id: number) {
  await ensureOwnedApp(id);
  return regenerateOAuth2ClientSecret(id);
}

export async function submitMyOAuth2ClientForReview(id: number) {
  const user = currentUser();
  const [updated] = await db.update(oauth2Clients).set({
    reviewStatus: 'pending',
    submittedAt: new Date(),
    reviewComment: null,
    reviewedAt: null,
    reviewedBy: null,
  }).where(and(
    eq(oauth2Clients.id, id),
    eq(oauth2Clients.ownerId, user.userId),
    tenantCondition(oauth2Clients, user),
    inArray(oauth2Clients.reviewStatus, ['draft', 'rejected']),
  )).returning();
  requireRow(updated, '应用状态已变化，请刷新后重试', 409);

  const reviewers = await db.selectDistinct({ userId: users.id })
    .from(users)
    .innerJoin(userRoles, eq(users.id, userRoles.userId))
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(
      eq(roles.code, 'super_admin'),
      eq(roles.status, 'enabled'),
      isNull(users.tenantId),
    ));
  await notify('open-platform.app.review_requested', {
    recipients: reviewers.map((reviewer) => ({ type: 'user', id: reviewer.userId })),
    vars: { appName: updated.name },
    tenantId: null,
    link: '/open-platform/apps',
  }).catch((err) => logger.error('[developer-apps] reviewer notification failed', { appId: id, err }));
  return getOAuth2Client(id);
}

function usageItem(used: number, limit: number) {
  return {
    used,
    limit,
    percentage: limit > 0 ? Math.min(100, Math.round((used / limit) * 10_000) / 100) : 0,
  };
}

export async function getMyOAuth2ClientQuotaUsage(id: number) {
  const app = await ensureOwnedApp(id);
  const plan = app.ratePlanId ? await getRatePlanRowById(app.ratePlanId) : await getDefaultRatePlanRow();
  if (!plan || app.environment === 'sandbox') {
    return {
      clientId: app.clientId,
      environment: app.environment,
      planCode: plan?.code ?? null,
      planName: plan?.name ?? null,
      qps: usageItem(0, 0),
      daily: usageItem(0, 0),
      monthly: usageItem(0, 0),
    };
  }

  const prefix = `${config.redis.keyPrefix}openrl:`;
  const day = dayjs().tz(APP_TIME_ZONE).format('YYYY-MM-DD');
  const month = dayjs().tz(APP_TIME_ZONE).format('YYYY-MM');
  const [qpsRaw, dailyRaw, monthlyRaw] = await redis.mget(
    `${prefix}qps:${app.clientId}`,
    `${prefix}daily:${app.clientId}:${day}`,
    `${prefix}monthly:${app.clientId}:${month}`,
  );
  return {
    clientId: app.clientId,
    environment: app.environment,
    planCode: plan.code,
    planName: plan.name,
    qps: usageItem(Number(qpsRaw ?? 0), plan.qpsLimit),
    daily: usageItem(Number(dailyRaw ?? 0), plan.dailyQuota),
    monthly: usageItem(Number(monthlyRaw ?? 0), plan.monthlyQuota),
  };
}

export async function notifyAppReviewResult(id: number): Promise<void> {
  const [app] = await db.select({
    name: oauth2Clients.name,
    ownerId: oauth2Clients.ownerId,
    reviewStatus: oauth2Clients.reviewStatus,
    reviewComment: oauth2Clients.reviewComment,
    tenantId: oauth2Clients.tenantId,
  }).from(oauth2Clients)
    .leftJoin(users, eq(oauth2Clients.ownerId, users.id))
    .where(eq(oauth2Clients.id, id))
    .limit(1);
  if (!app?.ownerId) return;
  await notify('open-platform.app.reviewed', {
    recipients: [{ type: 'user', id: app.ownerId }],
    vars: {
      appName: app.name,
      resultText: app.reviewStatus === 'approved'
        ? `已于 ${formatDateTime(new Date())} 审核通过。`
        : `审核未通过：${app.reviewComment || '未填写原因'}`,
    },
    tenantId: app.tenantId,
    link: '/open-platform/my-apps',
  }).catch((err) => logger.error('[developer-apps] review notification failed', { appId: id, err }));
}
