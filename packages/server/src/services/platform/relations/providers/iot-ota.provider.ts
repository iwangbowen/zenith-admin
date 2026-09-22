import { and, desc, eq, exists, lt, sql } from 'drizzle-orm';
import { IOT_OTA_DEVICE_STATUS_OPTIONS, IOT_OTA_TASK_STATUS_OPTIONS } from '@zenith/shared/iot';
import { iotDevices, iotFirmwares, iotOtaTaskDevices, iotOtaTasks } from '../../../../db/schema';
import { hasPermission } from '../../../../lib/context';
import { exactTenantCondition, tenantCondition } from '../../../../lib/tenant';
import { buildWhere } from '../../../../lib/where-helpers';
import { decodeRelationCursor } from '../cursor';
import { relationPage } from '../page';
import { relationFilterWhere } from '../filters';
import { relationSummaryQuery } from '../summary-query';
import type { EntityAnchorResolver, RelationAccessContext, RelationProvider, VisibleEntityAnchor } from '../types';

const otaTypes = ['iot.ota-task', 'iot.ota-device', 'iot.firmware'] as const;
function idOf(key: string) { const id = Number(key); return /^[1-9]\d*$/.test(key) && Number.isSafeInteger(id) && id <= 2_147_483_647 ? id : null; }

export const iotOtaAnchors: readonly EntityAnchorResolver[] = otaTypes.map((type) => ({ type,
  async resolve(ref, access): Promise<VisibleEntityAnchor | null> {
    const id = idOf(ref.key);
    if (id === null || !await hasPermission('iot:ota:list')) return null;
    if (type === 'iot.firmware') {
      const [row] = await access.db.select({ id: iotFirmwares.id, version: iotFirmwares.version, name: iotFirmwares.fileName, tenantId: iotFirmwares.tenantId })
        .from(iotFirmwares).where(buildWhere(eq(iotFirmwares.id, id), tenantCondition(iotFirmwares, access.user))).limit(1);
      return row ? { ref: { type, key: String(id) }, title: `${row.version} · ${row.name}`.slice(0, 160), tenantId: row.tenantId } : null;
    }
    if (type === 'iot.ota-task') {
      const [row] = await access.db.select({ title: iotOtaTasks.title, firmwareId: iotOtaTasks.firmwareId, tenantId: iotOtaTasks.tenantId })
        .from(iotOtaTasks).where(buildWhere(eq(iotOtaTasks.id, id), tenantCondition(iotOtaTasks, access.user))).limit(1);
      return row ? { ref: { type, key: String(id) }, title: row.title, tenantId: row.tenantId, metadata: { firmwareId: row.firmwareId } } : null;
    }
    const [row] = await access.db.select({ taskId: iotOtaTasks.id, deviceId: iotDevices.id, title: iotOtaTasks.title, name: iotDevices.name,
      firmwareId: iotOtaTasks.firmwareId, tenantId: iotOtaTasks.tenantId })
      .from(iotOtaTaskDevices).innerJoin(iotOtaTasks, eq(iotOtaTaskDevices.taskId, iotOtaTasks.id))
      .innerJoin(iotDevices, eq(iotOtaTaskDevices.deviceId, iotDevices.id))
      .where(buildWhere(eq(iotOtaTaskDevices.id, id), tenantCondition(iotOtaTasks, access.user), tenantCondition(iotDevices, access.user),
        sql`${iotDevices.tenantId} is not distinct from ${iotOtaTasks.tenantId}`)).limit(1);
    return row ? { ref: { type, key: String(id) }, title: `${row.name} · ${row.title}`.slice(0, 160), tenantId: row.tenantId,
      metadata: { taskId: row.taskId, deviceId: row.deviceId, firmwareId: row.firmwareId } } : null;
  },
}));

function taskWhere(anchor: VisibleEntityAnchor, access: RelationAccessContext) {
  return buildWhere(tenantCondition(iotOtaTasks, access.user), exactTenantCondition(iotOtaTasks.tenantId, anchor.tenantId),
    anchor.ref.type === 'iot.firmware' ? eq(iotOtaTasks.firmwareId, Number(anchor.ref.key))
      : anchor.ref.type === 'iot.ota-device' ? eq(iotOtaTasks.id, Number(anchor.metadata?.taskId))
        : exists(access.db.select({ id: iotOtaTaskDevices.id }).from(iotOtaTaskDevices)
          .where(and(eq(iotOtaTaskDevices.taskId, iotOtaTasks.id), eq(iotOtaTaskDevices.deviceId, Number(anchor.ref.key))))));
}
const taskAttention = eq(iotOtaTasks.status, 'paused');
const taskColumns = { keyword: [iotOtaTasks.title, iotOtaTasks.firmwareVersion], status: iotOtaTasks.status, occurredAt: iotOtaTasks.createdAt, attention: taskAttention };
function tasksProvider(sourceType: 'iot.device' | 'iot.firmware' | 'iot.ota-device'): RelationProvider {
  const key = `${sourceType}.ota-tasks`;
  return { sourceType, key, permissions: ['iot:ota:list'], descriptor: { key, labelKey: `relation.${key}`, targetTypes: ['iot.ota-task'],
    kind: 'direct', cardinality: sourceType === 'iot.ota-device' ? 'one' : 'many', capabilities: { view: true, open: true },
    filters: { keyword: true, dateRange: true, attentionOnly: true, statusOptions: [...IOT_OTA_TASK_STATUS_OPTIONS] } },
    summaryQuery: (anchor, { access }) => relationSummaryQuery(
      access.db.select({ id: iotOtaTasks.id }).from(iotOtaTasks).where(taskWhere(anchor, access)),
      access.db.select({ id: iotOtaTasks.id }).from(iotOtaTasks).where(buildWhere(taskWhere(anchor, access), taskAttention))),
    async list(anchor, { access, cursor, limit, filters }) {
      const before = decodeRelationCursor(cursor);
      const rows = await access.db.select({ id: iotOtaTasks.id, title: iotOtaTasks.title, version: iotOtaTasks.firmwareVersion, status: iotOtaTasks.status, createdAt: iotOtaTasks.createdAt })
        .from(iotOtaTasks).where(buildWhere(taskWhere(anchor, access), relationFilterWhere(filters, taskColumns), before ? lt(iotOtaTasks.id, before) : undefined))
        .orderBy(desc(iotOtaTasks.id)).limit(limit + 1);
      return relationPage(rows, limit, (row) => ({ ref: { type: 'iot.ota-task', key: String(row.id) }, relationKey: key,
        title: row.title, subtitle: row.version, status: row.status, occurredAt: row.createdAt.toISOString(), attention: row.status === 'paused', capabilities: { view: true, open: true } }));
    },
  };
}
function resultWhere(anchor: VisibleEntityAnchor, access: RelationAccessContext) {
  return buildWhere(tenantCondition(iotOtaTasks, access.user), tenantCondition(iotDevices, access.user),
    exactTenantCondition(iotOtaTasks.tenantId, anchor.tenantId), exactTenantCondition(iotDevices.tenantId, anchor.tenantId),
    anchor.ref.type === 'iot.device' ? eq(iotOtaTaskDevices.deviceId, Number(anchor.ref.key)) : eq(iotOtaTaskDevices.taskId, Number(anchor.ref.key)));
}
const resultAttention = eq(iotOtaTaskDevices.status, 'failed');
const resultColumns = { keyword: [iotDevices.name, iotDevices.sn, iotOtaTasks.title, iotOtaTaskDevices.errorMsg],
  status: iotOtaTaskDevices.status, occurredAt: iotOtaTaskDevices.createdAt, attention: resultAttention };
function resultsProvider(sourceType: 'iot.device' | 'iot.ota-task'): RelationProvider {
  const key = `${sourceType}.ota-devices`;
  const query = (access: RelationAccessContext) => access.db.select({ id: iotOtaTaskDevices.id }).from(iotOtaTaskDevices)
    .innerJoin(iotOtaTasks, eq(iotOtaTaskDevices.taskId, iotOtaTasks.id)).innerJoin(iotDevices, eq(iotOtaTaskDevices.deviceId, iotDevices.id));
  return { sourceType, key, permissions: ['iot:ota:list'], descriptor: { key, labelKey: `relation.${key}`, targetTypes: ['iot.ota-device'], kind: 'direct', cardinality: 'many', capabilities: { view: true, open: true },
    filters: { keyword: true, dateRange: true, attentionOnly: true, statusOptions: [...IOT_OTA_DEVICE_STATUS_OPTIONS] } },
    summaryQuery: (anchor, { access }) => relationSummaryQuery(query(access).where(resultWhere(anchor, access)), query(access).where(buildWhere(resultWhere(anchor, access), resultAttention))),
    async list(anchor, { access, cursor, limit, filters }) {
      const before = decodeRelationCursor(cursor);
      const rows = await access.db.select({ id: iotOtaTaskDevices.id, name: iotDevices.name, sn: iotDevices.sn,
        task: iotOtaTasks.title, status: iotOtaTaskDevices.status, error: iotOtaTaskDevices.errorMsg,
        version: iotOtaTasks.firmwareVersion, createdAt: iotOtaTaskDevices.createdAt })
        .from(iotOtaTaskDevices).innerJoin(iotOtaTasks, eq(iotOtaTaskDevices.taskId, iotOtaTasks.id))
        .innerJoin(iotDevices, eq(iotOtaTaskDevices.deviceId, iotDevices.id))
        .where(buildWhere(resultWhere(anchor, access), relationFilterWhere(filters, resultColumns), before ? lt(iotOtaTaskDevices.id, before) : undefined))
        .orderBy(desc(iotOtaTaskDevices.id)).limit(limit + 1);
      return relationPage(rows, limit, (row) => ({ ref: { type: 'iot.ota-device', key: String(row.id) }, relationKey: key,
        title: `${row.name || row.sn} · ${row.task}`.slice(0, 160), subtitle: row.version, description: row.error || undefined,
        status: row.status, attention: row.status === 'failed', occurredAt: row.createdAt.toISOString(), capabilities: { view: true, open: true } }));
    },
  };
}
function firmwareProvider(sourceType: 'iot.ota-task' | 'iot.ota-device'): RelationProvider {
  const key = `${sourceType}.firmware`;
  return { sourceType, key, permissions: ['iot:ota:list'], descriptor: { key, labelKey: `relation.${key}`, targetTypes: ['iot.firmware'], kind: 'direct', cardinality: 'one', capabilities: { view: true, open: true } },
    async list(anchor, { access, cursor, limit }) {
      if (cursor) return { items: [], hasMore: false, nextCursor: null };
      const rows = await access.db.select({ id: iotFirmwares.id, version: iotFirmwares.version, fileName: iotFirmwares.fileName, status: iotFirmwares.status })
        .from(iotFirmwares).where(buildWhere(eq(iotFirmwares.id, Number(anchor.metadata?.firmwareId)),
          tenantCondition(iotFirmwares, access.user), exactTenantCondition(iotFirmwares.tenantId, anchor.tenantId))).limit(1);
      return relationPage(rows, limit, (row) => ({ ref: { type: 'iot.firmware', key: String(row.id) }, relationKey: key,
        title: row.version, subtitle: row.fileName.slice(0, 240), status: row.status, capabilities: { view: true, open: true } }));
    },
  };
}
const resultDevice: RelationProvider = { sourceType: 'iot.ota-device', key: 'iot.ota-device.device', permissions: ['iot:device:list'],
  descriptor: { key: 'iot.ota-device.device', labelKey: 'relation.iot.ota-device.device', targetTypes: ['iot.device'], kind: 'direct', cardinality: 'one', capabilities: { view: true, open: true } },
  async list(anchor, { access, cursor, limit }) {
    if (cursor) return { items: [], hasMore: false, nextCursor: null };
    const rows = await access.db.select({ id: iotDevices.id, name: iotDevices.name, sn: iotDevices.sn }).from(iotDevices)
      .where(buildWhere(eq(iotDevices.id, Number(anchor.metadata?.deviceId)), exactTenantCondition(iotDevices.tenantId, anchor.tenantId), tenantCondition(iotDevices, access.user))).limit(1);
    return relationPage(rows, limit, (row) => ({ ref: { type: 'iot.device', key: String(row.id) }, relationKey: 'iot.ota-device.device',
      title: row.name || row.sn, subtitle: row.sn, capabilities: { view: true, open: true } }));
  },
};
export const iotOtaProviders: readonly RelationProvider[] = [tasksProvider('iot.device'), tasksProvider('iot.firmware'), tasksProvider('iot.ota-device'),
  resultsProvider('iot.device'), resultsProvider('iot.ota-task'), firmwareProvider('iot.ota-task'), firmwareProvider('iot.ota-device'), resultDevice];
