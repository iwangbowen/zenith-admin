import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { licenses, licenseEvents, systemInstallations, systemSchedulerNodes } from '../../db/schema';
import { config } from '../../config';
import { formatDateTime } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { requireFirstRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import logger from '../../lib/logger';
import {
  verifyLicenseEnvelope,
  ensureInstallation,
  bumpLicenseEpoch,
  getLicenseSnapshot,
  invalidateLicenseSnapshot,
  evaluatePayloadStatus,
  usingTestIssuerKey,
} from '../../lib/licensing';
import {
  LICENSE_EDITION_LABELS,
  LICENSE_EVENT_TYPE_LABELS,
  LICENSE_FEATURES,
  type LicenseEdition,
  type LicenseEventType,
  type LicenseInfo,
  type LicenseStatus,
  type LicenseEffectiveState,
  type LicenseInstallationInfo,
} from '@zenith/shared/licensing';
import { notify } from '../messaging/notification-outbox.service';
import { listEnabledPlatformSuperAdmins } from '../identity/platform-admins.service';
import type { LicenseRow } from '../../db/schema/licensing';

const isoToDisplay = (iso: string | null): string | null => (iso ? formatDateTime(new Date(iso)) : null);

function mapLicenseInfo(row: LicenseRow, override?: { status?: LicenseStatus; invalidReason?: string | null }): LicenseInfo {
  const p = row.payload;
  const status = (override?.status ?? row.status) as LicenseStatus;
  return {
    id: row.id,
    licenseId: row.licenseId,
    status,
    edition: p.edition,
    editionLabel: LICENSE_EDITION_LABELS[p.edition as LicenseEdition] ?? p.edition,
    customerId: p.customerId,
    customerName: p.customerName,
    features: p.features,
    limits: p.limits,
    issuedAt: isoToDisplay(p.issuedAt)!,
    notBefore: isoToDisplay(p.notBefore)!,
    expiresAt: isoToDisplay(p.expiresAt)!,
    graceUntil: isoToDisplay(p.graceUntil)!,
    maintenanceUntil: isoToDisplay(p.maintenanceUntil),
    keyId: row.keyId,
    activatedAt: formatDateTime(row.activatedAt),
    lastVerifiedAt: row.lastVerifiedAt ? formatDateTime(row.lastVerifiedAt) : null,
    invalidReason: override?.invalidReason !== undefined ? override.invalidReason : row.invalidReason,
    replacedById: row.replacedById,
  };
}

async function writeEvent(licenseId: number | null, type: LicenseEventType, detail?: string | null): Promise<void> {
  await db.insert(licenseEvents).values({ licenseId, type, detail: detail ?? null });
}

/** 状态页聚合：安装身份 + 当前 License + 最终生效状态 */
export async function getLicensingStatus(): Promise<{
  installation: LicenseInstallationInfo;
  license: LicenseInfo | null;
  effective: LicenseEffectiveState;
  usingTestKey: boolean;
}> {
  const installation = await ensureInstallation();
  const snapshot = await getLicenseSnapshot();

  const [epochRow] = await db
    .select({ licenseEpoch: systemInstallations.licenseEpoch })
    .from(systemInstallations)
    .orderBy(systemInstallations.id)
    .limit(1);

  const heartbeatCutoff = new Date(Date.now() - 2 * 60 * 1000);
  const activeNodes = await db.$count(systemSchedulerNodes, gte(systemSchedulerNodes.lastHeartbeatAt, heartbeatCutoff));

  let license: LicenseInfo | null = null;
  if (snapshot.licenseRowId != null) {
    const [row] = await db.select().from(licenses).where(eq(licenses.id, snapshot.licenseRowId)).limit(1);
    if (row) {
      license = mapLicenseInfo(row, {
        status: snapshot.status === 'unlicensed' ? undefined : snapshot.status,
        invalidReason: snapshot.invalidReason,
      });
    }
  }

  const effective: LicenseEffectiveState = config.licenseMode === 'off'
    ? {
        mode: 'off',
        status: snapshot.status,
        features: [...LICENSE_FEATURES],
        limits: snapshot.payload?.limits ?? null,
        expiresAt: license?.expiresAt ?? null,
        graceUntil: license?.graceUntil ?? null,
        restricted: false,
      }
    : {
        mode: config.licenseMode,
        status: snapshot.status,
        features: config.licenseMode === 'warn' ? [...LICENSE_FEATURES] : [...snapshot.features],
        limits: snapshot.payload?.limits ?? null,
        expiresAt: license?.expiresAt ?? null,
        graceUntil: license?.graceUntil ?? null,
        restricted: snapshot.restricted,
      };

  return {
    installation: {
      installationId: installation.installationId,
      licenseEpoch: epochRow?.licenseEpoch ?? 0,
      createdAt: formatDateTime(installation.createdAt),
      mode: config.licenseMode,
      activeNodes,
    },
    license,
    effective,
    usingTestKey: usingTestIssuerKey(),
  };
}

/** 激活（或替换）License：验签 → 绑定校验 → 落库 → epoch+1 → 快照失效 */
export async function activateLicense(envelopeRaw: string, operatorUserId: number | null): Promise<LicenseInfo> {
  const verified = verifyLicenseEnvelope(envelopeRaw);
  if (!verified.ok) {
    await writeEvent(null, 'invalid_signature', verified.reason);
    throw new HTTPException(400, { message: verified.reason });
  }
  const { payload, envelope } = verified;

  const installation = await ensureInstallation();
  if (payload.installationId !== installation.installationId) {
    const reason = `License 绑定的安装 ID（${payload.installationId}）与当前部署（${installation.installationId}）不匹配`;
    await writeEvent(null, 'invalid_signature', reason);
    throw new HTTPException(400, { message: reason });
  }

  const { status } = evaluatePayloadStatus(payload, new Date());
  if (status === 'expired') {
    throw new HTTPException(400, { message: 'License 已过期且超出宽限期，无法激活' });
  }

  const [existingSame] = await db.select({ id: licenses.id, status: licenses.status }).from(licenses).where(eq(licenses.licenseId, payload.licenseId)).limit(1);
  if (existingSame && existingSame.status === 'active') {
    throw new HTTPException(400, { message: '该 License 已处于激活状态' });
  }

  const inserted = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(licenses)
      .values({
        licenseId: payload.licenseId,
        envelope: envelopeRaw,
        payload,
        status: 'active',
        keyId: envelope.keyId,
        edition: payload.edition,
        customerName: payload.customerName,
        features: payload.features,
        expiresAt: new Date(payload.expiresAt),
        graceUntil: new Date(payload.graceUntil),
        activatedBy: operatorUserId,
        lastVerifiedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: licenses.licenseId,
        set: {
          envelope: envelopeRaw,
          payload,
          status: 'active',
          keyId: envelope.keyId,
          activatedBy: operatorUserId,
          activatedAt: new Date(),
          lastVerifiedAt: new Date(),
          invalidReason: null,
          replacedById: null,
        },
      })
      .returning();

    // 旧的激活中 License 标记为已替换
    await tx
      .update(licenses)
      .set({ status: 'replaced', replacedById: row.id })
      .where(and(eq(licenses.status, 'active'), sql`${licenses.id} <> ${row.id}`));

    await tx.insert(licenseEvents).values({
      licenseId: row.id,
      type: 'activated',
      detail: `激活 License「${payload.licenseId}」（${payload.customerName} / ${LICENSE_EDITION_LABELS[payload.edition as LicenseEdition] ?? payload.edition}，${payload.features.length} 项功能，到期 ${isoToDisplay(payload.expiresAt)}）`,
    });
    await bumpLicenseEpoch(tx);
    return row;
  });

  invalidateLicenseSnapshot();
  return mapLicenseInfo(inserted);
}

/** 停用当前 License（回到未授权状态；required 模式将进入受限） */
export async function deactivateLicense(): Promise<void> {
  const row = await requireFirstRow(
    db.select({ id: licenses.id, licenseId: licenses.licenseId }).from(licenses).where(eq(licenses.status, 'active')).limit(1),
    '当前没有已激活的 License',
  );

  await db.transaction(async (tx) => {
    await tx.update(licenses).set({ status: 'revoked', invalidReason: '管理员手动停用' }).where(eq(licenses.id, row.id));
    await tx.insert(licenseEvents).values({ licenseId: row.id, type: 'deactivated', detail: `停用 License「${row.licenseId}」` });
    await bumpLicenseEpoch(tx);
  });
  invalidateLicenseSnapshot();
}

export async function listLicenseEvents(q: { page?: number; pageSize?: number }) {
  const { page = 1, pageSize = 20 } = q;
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(licenseEvents),
    rows: () => db.select().from(licenseEvents).orderBy(desc(licenseEvents.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
    map: (r) => ({
      id: r.id,
      licenseId: r.licenseId,
      type: r.type as LicenseEventType,
      typeLabel: LICENSE_EVENT_TYPE_LABELS[r.type as LicenseEventType] ?? r.type,
      detail: r.detail,
      createdAt: formatDateTime(r.createdAt),
    }),
  });
}

/** 到期前提醒节点（天）：每日巡检命中当天恰好剩余 N 天时发送，天然防重复 */
const REMIND_DAYS = [30, 7, 3, 1];
const DAY_MS = 86_400_000;

/**
 * License 每日巡检：
 *  1. 重新验签并评估当前 License 状态，同步 DB status / lastVerifiedAt，记录状态迁移事件
 *  2. 到期前 30/7/3/1 天、进入宽限期、彻底失效时通知平台超管
 *  3. 时钟回拨检测（lastVerifiedAt 晚于当前时间超过容差）
 */
export async function runLicenseInspection(): Promise<string> {
  if (config.licenseMode === 'off') return 'License 模式为 off，跳过巡检';

  const [row] = await db.select().from(licenses).where(eq(licenses.status, 'active')).orderBy(licenses.id).limit(1);
  const graceRows = await db.select().from(licenses).where(eq(licenses.status, 'grace')).orderBy(licenses.id);
  const current = row ?? graceRows[0] ?? null;
  if (!current) return '无已激活 License，跳过巡检';

  const now = new Date();

  // 时钟回拨检测：容差 10 分钟
  if (current.lastVerifiedAt && now.getTime() < current.lastVerifiedAt.getTime() - 10 * 60 * 1000) {
    await writeEvent(current.id, 'clock_anomaly', `系统时间（${formatDateTime(now)}）早于上次校验时间（${formatDateTime(current.lastVerifiedAt)}），疑似时钟回拨`);
  }

  const verified = verifyLicenseEnvelope(current.envelope);
  const platformAdminIds = (await listEnabledPlatformSuperAdmins()).map((admin) => admin.id);
  const recipients = platformAdminIds.map((id) => ({ type: 'user' as const, id }));

  if (!verified.ok) {
    await db.update(licenses).set({ status: 'invalid', invalidReason: verified.reason, lastVerifiedAt: now }).where(eq(licenses.id, current.id));
    await writeEvent(current.id, 'invalid_signature', verified.reason);
    await bumpLicenseEpoch();
    invalidateLicenseSnapshot();
    if (recipients.length > 0) {
      await notify('ops.license.invalid', {
        recipients,
        vars: { reason: verified.reason },
        tenantId: null,
        link: '/system/license',
        dedupeKey: `license-invalid:${current.id}`,
      }).catch((err) => logger.warn(`License 失效通知发送失败: ${err}`));
    }
    return `License「${current.licenseId}」验签失败已标记 invalid`;
  }

  const { status: evaluated } = evaluatePayloadStatus(verified.payload, now);
  const summary: string[] = [];

  if (evaluated !== current.status && (evaluated === 'grace' || evaluated === 'expired')) {
    await db.update(licenses).set({ status: evaluated, lastVerifiedAt: now }).where(eq(licenses.id, current.id));
    await writeEvent(current.id, evaluated === 'grace' ? 'entered_grace' : 'expired',
      evaluated === 'grace'
        ? `License 已过期，进入宽限期（截止 ${isoToDisplay(verified.payload.graceUntil)}）`
        : 'License 已过期且超出宽限期');
    await bumpLicenseEpoch();
    invalidateLicenseSnapshot();
    summary.push(`状态迁移 ${current.status} → ${evaluated}`);

    if (recipients.length > 0) {
      if (evaluated === 'grace') {
        await notify('ops.license.expiring', {
          recipients,
          vars: {
            statusText: '已进入宽限期',
            expiresAt: isoToDisplay(verified.payload.expiresAt)!,
            graceUntil: isoToDisplay(verified.payload.graceUntil)!,
          },
          tenantId: null,
          link: '/system/license',
          dedupeKey: `license-grace:${current.id}`,
        }).catch((err) => logger.warn(`License 宽限通知发送失败: ${err}`));
      } else {
        await notify('ops.license.invalid', {
          recipients,
          vars: { reason: 'License 已过期且超出宽限期' },
          tenantId: null,
          link: '/system/license',
          dedupeKey: `license-expired:${current.id}`,
        }).catch((err) => logger.warn(`License 过期通知发送失败: ${err}`));
      }
    }
  } else {
    await db.update(licenses).set({ lastVerifiedAt: now }).where(eq(licenses.id, current.id));
    await writeEvent(current.id, 'verified', null);
  }

  // 到期前 N 天提醒（仅 active 状态需要）
  if (evaluated === 'active' && recipients.length > 0) {
    const daysLeft = Math.ceil((Date.parse(verified.payload.expiresAt) - now.getTime()) / DAY_MS);
    if (REMIND_DAYS.includes(daysLeft)) {
      await notify('ops.license.expiring', {
        recipients,
        vars: {
          statusText: `将于 ${daysLeft} 天后到期`,
          expiresAt: isoToDisplay(verified.payload.expiresAt)!,
          graceUntil: isoToDisplay(verified.payload.graceUntil)!,
        },
        tenantId: null,
        link: '/system/license',
        dedupeKey: `license-expiring:${current.id}:${daysLeft}`,
      }).catch((err) => logger.warn(`License 到期提醒发送失败: ${err}`));
      summary.push(`发送 ${daysLeft} 天到期提醒`);
    }
  }

  return summary.length > 0 ? summary.join('；') : `License「${current.licenseId}」巡检正常（${evaluated}）`;
}
