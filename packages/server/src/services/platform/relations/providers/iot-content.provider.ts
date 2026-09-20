import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { EntityRef } from '@zenith/shared/core';
import type { EntityRelationPage } from '@zenith/shared/platform';
import { hasPermission, runWithCurrentUser } from '../../../../lib/context';
import { tenantCondition } from '../../../../lib/tenant';
import { getDataScopeCondition } from '../../../../lib/data-scope';
import { buildWhere } from '../../../../lib/where-helpers';
import { db } from '../../../../db';
import {
  cmsChannels,
  cmsContents,
  cmsContentRelations,
  iotAlarms,
  iotDevices,
} from '../../../../db/schema';
import { assertChannelAccess, getAccessibleChannelIds } from '../../../cms/cms-channels.service';
import { assertSiteAccess, getAccessibleSiteIds } from '../../../cms/cms-sites.service';
import type { RelationAccessContext, RelationProvider, VisibleEntityAnchor } from '../types';
import { decodeRelationCursor, encodeRelationCursor } from '../cursor';

const IOT_DEVICE_TYPE = 'iot.device' as const;
const IOT_ALARM_TYPE = 'iot.alarm' as const;
const IOT_DEVICE_ALARMS_KEY = 'iot.device.alarms' as const;

const CMS_CONTENT_TYPE = 'cms.content' as const;
const CMS_CONTENT_RELATED_KEY = 'cms.content.related' as const;

function emptyPage(): EntityRelationPage {
  return { items: [], nextCursor: null, hasMore: false };
}

/**
 * Relation requests normally already execute inside the authenticated request
 * context. Re-entering it with the explicit access user keeps provider calls
 * fail-closed when they are exercised by a worker or an isolated test.
 */
function withAccess<T>(access: RelationAccessContext, fn: () => T | Promise<T>): Promise<T> {
  return runWithCurrentUser(access.user, fn);
}

async function resolveIotDevice(ref: EntityRef, access: RelationAccessContext): Promise<VisibleEntityAnchor | null> {
  if (ref.type !== IOT_DEVICE_TYPE) return null;
  return withAccess(access, async () => {
    if (!(await hasPermission('iot:device:list'))) return null;
    const id = Number(ref.key);
    if (!Number.isInteger(id) || id <= 0) return null;
    const [device] = await db.select({
      id: iotDevices.id,
      name: iotDevices.name,
      sn: iotDevices.sn,
      tenantId: iotDevices.tenantId,
      productId: iotDevices.productId,
    })
      .from(iotDevices)
      .where(and(eq(iotDevices.id, id), tenantCondition(iotDevices, access.user)))
      .limit(1);
    if (!device) return null;
    return {
      ref: { type: IOT_DEVICE_TYPE, key: String(device.id) },
      title: device.name || device.sn,
      tenantId: device.tenantId,
      metadata: { id: device.id, sn: device.sn, productId: device.productId },
    };
  });
}

export const iotDeviceAlarmsProvider: RelationProvider = {
  sourceType: IOT_DEVICE_TYPE,
  key: IOT_DEVICE_ALARMS_KEY,
  permissions: ['iot:alarm:list'],
  descriptor: {
    key: IOT_DEVICE_ALARMS_KEY,
    labelKey: 'relation.iot.device.alarms',
    targetTypes: [IOT_ALARM_TYPE],
    kind: 'direct',
    cardinality: 'many',
    capabilities: { view: true, open: true },
  },
  resolveAnchor: resolveIotDevice,
  async list(anchor, { cursor, limit, access }) {
    return withAccess(access, async () => {
      if (!(await hasPermission('iot:alarm:list'))) return emptyPage();
      const deviceId = Number(anchor.metadata?.id);
      if (!Number.isInteger(deviceId) || deviceId <= 0) return emptyPage();
      // iot_alarms has no tenant column; the parent device is the security
      // boundary, so every target row is filtered through the visible device.
      const rows = await db.select({
        alarm: iotAlarms,
        deviceName: iotDevices.name,
        deviceSn: iotDevices.sn,
      })
        .from(iotAlarms)
        .innerJoin(iotDevices, eq(iotAlarms.deviceId, iotDevices.id))
        .where(and(
          eq(iotAlarms.deviceId, deviceId),
          tenantCondition(iotDevices, access.user),
        ))
        .orderBy(desc(iotAlarms.firedAt), desc(iotAlarms.id));
      const offset = decodeRelationCursor(cursor);
      const page = rows.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      const hasMore = nextOffset < rows.length;
      return {
        items: page.map(({ alarm, deviceName, deviceSn }) => ({
          ref: { type: IOT_ALARM_TYPE, key: String(alarm.id) },
          relationKey: IOT_DEVICE_ALARMS_KEY,
          title: alarm.ruleName,
          subtitle: [deviceName, deviceSn, alarm.ruleType].filter(Boolean).join(' · '),
          description: alarm.message,
          status: alarm.status,
          occurredAt: alarm.firedAt.toISOString(),
          capabilities: { view: true, open: true },
        })),
        nextCursor: hasMore ? encodeRelationCursor(nextOffset) : null,
        hasMore,
        total: rows.length,
      } satisfies EntityRelationPage;
    });
  },
};

/**
 * CMS has no tenant column: site and channel ACLs are the tenant-equivalent
 * boundary. The same data-scope predicate used by the CMS list is applied to
 * both the anchor and every related target.
 */
async function resolveCmsContent(ref: EntityRef, access: RelationAccessContext): Promise<VisibleEntityAnchor | null> {
  if (ref.type !== CMS_CONTENT_TYPE) return null;
  return withAccess(access, async () => {
    if (!(await hasPermission('cms:content:list'))) return null;
    const id = Number(ref.key);
    if (!Number.isInteger(id) || id <= 0) return null;

    const [candidate] = await db.select({
      id: cmsContents.id,
      siteId: cmsContents.siteId,
      channelId: cmsContents.channelId,
      title: cmsContents.title,
      status: cmsContents.status,
      updatedAt: cmsContents.updatedAt,
    })
      .from(cmsContents)
      .where(and(eq(cmsContents.id, id), isNull(cmsContents.deletedAt)))
      .limit(1);
    if (!candidate) return null;
    try {
      await assertSiteAccess(candidate.siteId);
      await assertChannelAccess(candidate.channelId);
    } catch {
      return null;
    }

    const scope = await getDataScopeCondition({
      currentUserId: access.user.userId,
      deptColumn: cmsContents.deptId,
      ownerColumn: cmsContents.createdBy,
    });
    const [visible] = await db.select({
      id: cmsContents.id,
      siteId: cmsContents.siteId,
      channelId: cmsContents.channelId,
      title: cmsContents.title,
      status: cmsContents.status,
      updatedAt: cmsContents.updatedAt,
    })
      .from(cmsContents)
      .where(and(eq(cmsContents.id, id), isNull(cmsContents.deletedAt), scope))
      .limit(1);
    if (!visible) return null;
    return {
      ref: { type: CMS_CONTENT_TYPE, key: String(visible.id) },
      title: visible.title,
      tenantId: null,
      metadata: { id: visible.id, siteId: visible.siteId, channelId: visible.channelId },
    };
  });
}

export const cmsContentRelatedProvider: RelationProvider = {
  sourceType: CMS_CONTENT_TYPE,
  key: CMS_CONTENT_RELATED_KEY,
  permissions: ['cms:content:list'],
  descriptor: {
    key: CMS_CONTENT_RELATED_KEY,
    labelKey: 'relation.cms.content.related',
    targetTypes: [CMS_CONTENT_TYPE],
    kind: 'direct',
    cardinality: 'many',
    capabilities: { view: true, open: true },
  },
  resolveAnchor: resolveCmsContent,
  async list(anchor, { cursor, limit, access }) {
    return withAccess(access, async () => {
      if (!(await hasPermission('cms:content:list'))) return emptyPage();
      const contentId = Number(anchor.metadata?.id);
      const siteId = Number(anchor.metadata?.siteId);
      if (!Number.isInteger(contentId) || contentId <= 0 || !Number.isInteger(siteId) || siteId <= 0) return emptyPage();

      const [accessibleSiteIds, accessibleChannelIds, scope] = await Promise.all([
        getAccessibleSiteIds(),
        getAccessibleChannelIds(),
        getDataScopeCondition({
          currentUserId: access.user.userId,
          deptColumn: cmsContents.deptId,
          ownerColumn: cmsContents.createdBy,
        }),
      ]);
      const rows = await db.select({
        related: cmsContents,
        channelName: cmsChannels.name,
      })
        .from(cmsContentRelations)
        .innerJoin(cmsContents, eq(cmsContentRelations.relatedId, cmsContents.id))
        .innerJoin(cmsChannels, eq(cmsContents.channelId, cmsChannels.id))
        .where(buildWhere(
          eq(cmsContentRelations.contentId, contentId),
          eq(cmsContents.siteId, siteId),
          isNull(cmsContents.deletedAt),
          accessibleSiteIds !== null ? inArray(cmsContents.siteId, accessibleSiteIds) : undefined,
          accessibleChannelIds !== null ? inArray(cmsContents.channelId, accessibleChannelIds) : undefined,
          scope,
        ))
        .orderBy(asc(cmsContentRelations.sort), asc(cmsContents.id));
      const offset = decodeRelationCursor(cursor);
      const page = rows.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      const hasMore = nextOffset < rows.length;
      return {
        items: page.map(({ related, channelName }) => ({
          ref: { type: CMS_CONTENT_TYPE, key: String(related.id) },
          relationKey: CMS_CONTENT_RELATED_KEY,
          title: related.title,
          subtitle: [channelName, related.contentType].filter(Boolean).join(' · '),
          description: related.summary?.slice(0, 500) ?? null,
          status: related.status,
          occurredAt: related.updatedAt.toISOString(),
          capabilities: { view: true, open: true },
        })),
        nextCursor: hasMore ? encodeRelationCursor(nextOffset) : null,
        hasMore,
        total: rows.length,
      } satisfies EntityRelationPage;
    });
  },
};
