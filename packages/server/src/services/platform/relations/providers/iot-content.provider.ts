import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { EntityRef } from '@zenith/shared/core';
import type { EntityRelationPage } from '@zenith/shared/platform';
import { hasPermission, runWithCurrentUser } from '../../../../lib/context';
import { exactTenantCondition, tenantCondition } from '../../../../lib/tenant';
import { getDataScopeCondition } from '../../../../lib/data-scope';
import { buildWhere } from '../../../../lib/where-helpers';
import { cmsChannels, cmsContents, cmsContentRelations, cmsSites, iotAlarms, iotDevices } from '../../../../db/schema';
import { getAccessibleChannelIds } from '../../../cms/cms-channels.service';
import { getAccessibleSiteIds } from '../../../cms/cms-sites.service';
import type { EntityAnchorResolver, RelationAccessContext, RelationProvider, VisibleEntityAnchor } from '../types';
import { decodeRelationCursor } from '../cursor';
import { relationPage as page } from '../page';

const emptyPage = (): EntityRelationPage => ({ items: [], nextCursor: null, hasMore: false });
function parseId(key: string): number | null {
  const id = Number(key);
  return /^[1-9]\d*$/.test(key) && Number.isSafeInteger(id) && id <= 2_147_483_647 ? id : null;
}

async function resolveIotDevice(ref: EntityRef, access: RelationAccessContext): Promise<VisibleEntityAnchor | null> {
  return runWithCurrentUser(access.user, async () => {
    if (ref.type !== 'iot.device' || !(await hasPermission('iot:device:list'))) return null;
    const id = parseId(ref.key);
    if (id == null) return null;
    const [row] = await access.db.select({ id: iotDevices.id, name: iotDevices.name, sn: iotDevices.sn, tenantId: iotDevices.tenantId })
      .from(iotDevices).where(buildWhere(eq(iotDevices.id, id), tenantCondition(iotDevices, access.user))).limit(1);
    return row ? { ref: { type: 'iot.device', key: String(row.id) }, title: row.name || row.sn, tenantId: row.tenantId } : null;
  });
}

async function resolveIotAlarm(ref: EntityRef, access: RelationAccessContext): Promise<VisibleEntityAnchor | null> {
  return runWithCurrentUser(access.user, async () => {
    if (ref.type !== 'iot.alarm' || !(await hasPermission('iot:alarm:list'))) return null;
    const id = parseId(ref.key);
    if (id == null) return null;
    // Alarms have no tenant column; the owning device is their tenant boundary.
    const [row] = await access.db.select({ id: iotAlarms.id, title: iotAlarms.ruleName, deviceId: iotDevices.id, tenantId: iotDevices.tenantId })
      .from(iotAlarms).innerJoin(iotDevices, eq(iotAlarms.deviceId, iotDevices.id))
      .where(buildWhere(eq(iotAlarms.id, id), tenantCondition(iotDevices, access.user))).limit(1);
    return row ? { ref: { type: 'iot.alarm', key: String(row.id) }, title: row.title, tenantId: row.tenantId, metadata: { deviceId: row.deviceId } } : null;
  });
}

async function cmsVisibility(access: RelationAccessContext) {
  const [siteIds, channelIds, scope] = await Promise.all([
    getAccessibleSiteIds(), getAccessibleChannelIds(),
    getDataScopeCondition({ currentUserId: access.user.userId, deptColumn: cmsContents.deptId, ownerColumn: cmsContents.createdBy }),
  ]);
  return buildWhere(
    isNull(cmsContents.deletedAt),
    siteIds !== null ? inArray(cmsContents.siteId, siteIds) : undefined,
    channelIds !== null ? inArray(cmsContents.channelId, channelIds) : undefined,
    scope,
  );
}

async function resolveCmsContent(ref: EntityRef, access: RelationAccessContext): Promise<VisibleEntityAnchor | null> {
  return runWithCurrentUser(access.user, async () => {
    if (ref.type !== 'cms.content' || !(await hasPermission('cms:content:list'))) return null;
    const id = parseId(ref.key);
    if (id == null) return null;
    // CMS is platform-owned; explicit site/channel grants replace a tenant column.
    const [row] = await access.db.select({ id: cmsContents.id, siteId: cmsContents.siteId, channelId: cmsContents.channelId, title: cmsContents.title })
      .from(cmsContents).innerJoin(cmsSites, eq(cmsSites.id, cmsContents.siteId))
      .innerJoin(cmsChannels, and(eq(cmsChannels.id, cmsContents.channelId), eq(cmsChannels.siteId, cmsContents.siteId)))
      .where(buildWhere(eq(cmsContents.id, id), await cmsVisibility(access))).limit(1);
    return row ? { ref: { type: 'cms.content', key: String(row.id) }, title: row.title.slice(0, 160), tenantId: null, metadata: { siteId: row.siteId, channelId: row.channelId } } : null;
  });
}

export const iotDeviceAlarmsProvider: RelationProvider = {
  sourceType: 'iot.device', key: 'iot.device.alarms', permissions: ['iot:alarm:list'],
  descriptor: { key: 'iot.device.alarms', labelKey: 'relation.iot.device.alarms', targetTypes: ['iot.alarm'], kind: 'direct', cardinality: 'many', capabilities: { view: true, open: true } },
  async list(anchor, { cursor, limit, access }) {
    return runWithCurrentUser(access.user, async () => {
      if (!(await hasPermission('iot:alarm:list'))) return emptyPage();
      const deviceId = parseId(anchor.ref.key);
      if (deviceId == null) return emptyPage();
      const beforeId = decodeRelationCursor(cursor);
      const rows = await access.db.select({ id: iotAlarms.id, name: iotAlarms.ruleName, ruleType: iotAlarms.ruleType, message: iotAlarms.message, status: iotAlarms.status, firedAt: iotAlarms.firedAt })
        .from(iotAlarms).innerJoin(iotDevices, eq(iotAlarms.deviceId, iotDevices.id))
        .where(buildWhere(eq(iotAlarms.deviceId, deviceId), exactTenantCondition(iotDevices.tenantId, anchor.tenantId), tenantCondition(iotDevices, access.user), beforeId ? lt(iotAlarms.id, beforeId) : undefined))
        .orderBy(desc(iotAlarms.id)).limit(limit + 1);
      return page(rows, limit, (row) => ({ ref: { type: 'iot.alarm', key: String(row.id) }, relationKey: 'iot.device.alarms', title: row.name, subtitle: row.ruleType, description: row.message.slice(0, 500), status: row.status, occurredAt: row.firedAt.toISOString(), capabilities: { view: true, open: true } }));
    });
  },
};

export const iotAlarmDeviceProvider: RelationProvider = {
  sourceType: 'iot.alarm', key: 'iot.alarm.device', permissions: ['iot:device:list'],
  descriptor: { key: 'iot.alarm.device', labelKey: 'relation.iot.alarm.device', targetTypes: ['iot.device'], kind: 'direct', cardinality: 'one', capabilities: { view: true, open: true } },
  async list(anchor, { cursor, limit, access }) {
    return runWithCurrentUser(access.user, async () => {
      if (!(await hasPermission('iot:device:list'))) return emptyPage();
      const deviceId = anchor.metadata?.deviceId;
      if (typeof deviceId !== 'number') return emptyPage();
      const beforeId = decodeRelationCursor(cursor);
      const rows = await access.db.select({ id: iotDevices.id, name: iotDevices.name, sn: iotDevices.sn, status: iotDevices.status, createdAt: iotDevices.createdAt })
        .from(iotDevices).where(buildWhere(eq(iotDevices.id, deviceId), exactTenantCondition(iotDevices.tenantId, anchor.tenantId), tenantCondition(iotDevices, access.user), beforeId ? lt(iotDevices.id, beforeId) : undefined))
        .orderBy(desc(iotDevices.id)).limit(limit + 1);
      return page(rows, limit, (row) => ({ ref: { type: 'iot.device', key: String(row.id) }, relationKey: 'iot.alarm.device', title: row.name || row.sn, subtitle: row.sn, status: row.status, occurredAt: row.createdAt.toISOString(), capabilities: { view: true, open: true } }));
    });
  },
};

export const cmsContentRelatedProvider: RelationProvider = {
  sourceType: 'cms.content', key: 'cms.content.related', permissions: ['cms:content:list'],
  descriptor: { key: 'cms.content.related', labelKey: 'relation.cms.content.related', targetTypes: ['cms.content'], kind: 'direct', cardinality: 'many', capabilities: { view: true, open: true } },
  async list(anchor, { cursor, limit, access }) {
    return runWithCurrentUser(access.user, async () => {
      if (!(await hasPermission('cms:content:list'))) return emptyPage();
      const contentId = parseId(anchor.ref.key);
      const siteId = anchor.metadata?.siteId;
      if (contentId == null || typeof siteId !== 'number' || anchor.tenantId !== null) return emptyPage();
      const beforeId = decodeRelationCursor(cursor);
      const rows = await access.db.select({ id: cmsContents.id, title: cmsContents.title, contentType: cmsContents.contentType, status: cmsContents.status, updatedAt: cmsContents.updatedAt, channelName: cmsChannels.name })
        .from(cmsContentRelations).innerJoin(cmsContents, eq(cmsContentRelations.relatedId, cmsContents.id))
        .innerJoin(cmsChannels, and(eq(cmsContents.channelId, cmsChannels.id), eq(cmsChannels.siteId, siteId)))
        .where(buildWhere(eq(cmsContentRelations.contentId, contentId), eq(cmsContents.siteId, siteId), await cmsVisibility(access), beforeId ? lt(cmsContents.id, beforeId) : undefined))
        .orderBy(desc(cmsContents.id)).limit(limit + 1);
      return page(rows, limit, (row) => ({ ref: { type: 'cms.content', key: String(row.id) }, relationKey: 'cms.content.related', title: row.title.slice(0, 160), subtitle: `${row.channelName} · ${row.contentType}`.slice(0, 240), status: row.status, occurredAt: row.updatedAt.toISOString(), capabilities: { view: true, open: true } }));
    });
  },
};

export const iotContentAnchorResolvers: readonly EntityAnchorResolver[] = [
  { type: 'iot.device', resolve: resolveIotDevice },
  { type: 'iot.alarm', resolve: resolveIotAlarm },
  { type: 'cms.content', resolve: resolveCmsContent },
];
export const iotContentRelationProviders: readonly RelationProvider[] = [iotDeviceAlarmsProvider, iotAlarmDeviceProvider, cmsContentRelatedProvider];
