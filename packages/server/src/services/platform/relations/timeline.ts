import { and, desc, eq, exists, inArray, lt, or, sql, type AnyColumn } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { DOMAIN_EVENT_CATALOG, getDomainEventDefinition, canonicalEntityTypeSchema, type EntityTimelineResponse, type CanonicalEntityType } from '@zenith/shared/platform';
import type { TimelineEvent } from '@zenith/shared/core';
import { permissionList } from '@zenith/shared/core';
import { hasPermission } from '../../../lib/context';
import { domainEventSubjects, domainEvents, operationLogSubjects, operationLogs } from '../../../db/schema';
import { exactTenantCondition, tenantCondition } from '../../../lib/tenant';
import { buildWhere } from '../../../lib/where-helpers';
import { readRelationCursor, signRelationCursor } from './cursor';
import { relationCursorScope, resolveVisibleEntityAnchor } from './registry';
import { assertRelationBudget, isStatementTimeout, withRelationRead } from './runtime';
import type { RelationAccessContext } from './types';

type Position = { at: string; id: number; kind: 'audit' | 'event' };
function decode(value?: string): Position | undefined {
  if (!value) return undefined;
  try {
    const p = JSON.parse(value) as Position;
    if (!Number.isFinite(Date.parse(p.at)) || !Number.isSafeInteger(p.id) || p.id < 1 || !['audit', 'event'].includes(p.kind)) throw new Error();
    return p;
  } catch { throw new HTTPException(400, { message: '时间线分页游标无效' }); }
}
function before(at: AnyColumn, id: AnyColumn, kind: Position['kind'], cursor?: Position) {
  if (!cursor) return undefined;
  const date = sql`${cursor.at}::timestamptz`;
  const sameTime = kind < cursor.kind ? sql`true` : kind === cursor.kind ? lt(id, cursor.id) : sql`false`;
  return or(lt(at, date), and(eq(at, date), sameTime));
}
function compare(a: Position, b: Position): number {
  return b.at.localeCompare(a.at) || b.kind.localeCompare(a.kind) || b.id - a.id;
}
export async function listEntityTimeline(input: { type: CanonicalEntityType; key: string; cursor?: string; limit: number }, caller: Pick<RelationAccessContext, 'user'>): Promise<EntityTimelineResponse> {
  return withRelationRead('timeline', caller, async (access) => {
    const anchor = await resolveVisibleEntityAnchor(input.type, input.key, access);
    const scope = relationCursorScope(anchor, 'timeline', access);
    let position = decode(readRelationCursor(input.cursor, scope));
    const auditAllowed = await hasPermission('system:log:operation');
    const allowedTypes: string[] = [];
    for (const [type, definition] of Object.entries(DOMAIN_EVENT_CATALOG)) if (await hasPermission(...permissionList(definition.permission))) allowedTypes.push(type);
    const visible: Array<{ event: TimelineEvent; position: Position }> = [];
    const sourceAccess = new Map<string, boolean>();
    for (let scanned = 0; scanned < 512 && visible.length <= input.limit; scanned += input.limit + 1) {
      assertRelationBudget(access);
      const audit = auditAllowed ? await access.db.select({ id: operationLogs.id, description: operationLogs.description, createdAt: operationLogs.createdAt, responseCode: operationLogs.responseCode, cursorAt: sql<string>`to_char(${operationLogs.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` })
        .from(operationLogs).where(buildWhere(exactTenantCondition(operationLogs.tenantId, anchor.tenantId), tenantCondition(operationLogs, access.user),
          exists(access.db.select({ id: operationLogSubjects.operationLogId }).from(operationLogSubjects).where(and(
            eq(operationLogSubjects.operationLogId, operationLogs.id), eq(operationLogSubjects.entityType, anchor.ref.type), eq(operationLogSubjects.entityKey, anchor.ref.key), exactTenantCondition(operationLogSubjects.tenantId, anchor.tenantId)))),
          before(operationLogs.createdAt, operationLogs.id, 'audit', position))).orderBy(desc(operationLogs.createdAt), desc(operationLogs.id)).limit(input.limit + 1) : [];
      const events = allowedTypes.length ? await access.db.select({ id: domainEvents.id, eventType: domainEvents.eventType, payload: domainEvents.payload, sourceType: domainEvents.sourceType, sourceKey: domainEvents.sourceKey, occurredAt: domainEvents.occurredAt, cursorAt: sql<string>`to_char(${domainEvents.occurredAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` })
        .from(domainEvents).where(buildWhere(exactTenantCondition(domainEvents.tenantId, anchor.tenantId), tenantCondition(domainEvents, access.user), inArray(domainEvents.eventType, allowedTypes),
          exists(access.db.select({ id: domainEventSubjects.eventId }).from(domainEventSubjects).where(and(
            eq(domainEventSubjects.eventId, domainEvents.id), eq(domainEventSubjects.entityType, anchor.ref.type), eq(domainEventSubjects.entityKey, anchor.ref.key), exactTenantCondition(domainEventSubjects.tenantId, anchor.tenantId)))),
          before(domainEvents.occurredAt, domainEvents.id, 'event', position))).orderBy(desc(domainEvents.occurredAt), desc(domainEvents.id)).limit(input.limit + 1) : [];
      const candidates = [
        ...audit.map((row) => ({ position: { at: row.cursorAt, id: row.id, kind: 'audit' as const }, audit: row, domain: null })),
        ...events.map((row) => ({ position: { at: row.cursorAt, id: row.id, kind: 'event' as const }, audit: null, domain: row })),
      ].sort((a, b) => compare(a.position, b.position)).slice(0, input.limit + 1);
      if (candidates.length === 0) break;
      for (const candidate of candidates) {
        position = candidate.position;
        if (candidate.audit) {
          visible.push({ position, event: { id: `audit:${candidate.audit.id}`, eventType: 'platform.audit.operation', occurredAt: position.at,
            sourceRef: { type: 'platform.operation-log', key: String(candidate.audit.id) }, subjectRefs: [{ ...anchor.ref, role: 'related' }], visibility: 'restricted',
            payload: { description: candidate.audit.description, responseCode: candidate.audit.responseCode } } });
        } else if (candidate.domain) {
          const row = candidate.domain;
          const definition = getDomainEventDefinition(row.eventType);
          const summary = definition?.summarySchema.safeParse(row.payload);
          const sourceType = canonicalEntityTypeSchema.safeParse(row.sourceType);
          if (!summary?.success || !sourceType.success || !row.sourceKey) continue;
          const sourceId = `${sourceType.data}:${row.sourceKey}`;
          let canRead = sourceAccess.get(sourceId);
          if (canRead === undefined) {
            try {
              const source = await resolveVisibleEntityAnchor(sourceType.data, row.sourceKey, access);
              canRead = source.tenantId === anchor.tenantId;
            } catch (error) {
              if (!(error instanceof HTTPException) || error.status !== 404) throw error;
              canRead = false;
            }
            sourceAccess.set(sourceId, canRead);
          }
          if (!canRead) continue;
          visible.push({ position, event: { id: `event:${row.id}`, eventType: row.eventType, occurredAt: position.at,
            sourceRef: { type: sourceType.data, key: row.sourceKey }, subjectRefs: [{ ...anchor.ref, role: 'related' }], visibility: 'restricted', payload: summary.data } });
        }
        if (visible.length > input.limit) break;
      }
      if (candidates.length < input.limit + 1) break;
      if (scanned + input.limit + 1 >= 512 && visible.length <= input.limit) throw new HTTPException(503, { message: '时间线查询超出预算，请缩小对象范围后重试' });
    }
    const page = visible.slice(0, input.limit);
    const hasMore = visible.length > input.limit;
    return { items: page.map(({ event }) => event), hasMore, nextCursor: hasMore ? signRelationCursor(JSON.stringify(page[page.length - 1].position), scope) : null };
  }).catch((error: unknown) => {
    if (isStatementTimeout(error)) throw new HTTPException(503, { message: '时间线查询超时，请稍后重试' });
    throw error;
  });
}
