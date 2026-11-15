import { and, desc, eq } from 'drizzle-orm';
import * as z from 'zod';
import type { QueryOutputOf } from '@zenith/shared/core';
import {
  SETTINGS_MODULES, diffSettingsSnapshots, mergeSettingsLayers, parseSettingsOverrides,
  settingsRevisionDetailSchema, settingsRevisionSummarySchema,
  type SettingsComparison, type SettingsDoc, type SettingsHistoryContract, type SettingsModuleKey,
  type SettingsRestorePreview, type SettingsRevisionDetail,
} from '@zenith/shared/settings';
import { db, readSnapshot } from '../../db';
import type { DbExecutor } from '../../db/types';
import { systemSettings, systemSettingsRevisions } from '../../db/schema';
import { requireRow } from '../../lib/db-assert';
import { pickEntity } from '../../lib/entity-map';
import { buildListResult, emptyListResult } from '../../lib/list-query';
import { assertSettingsBase, loadSettingsEntry, lockSettingsModule, settingsDefinition, settingsReadScope, settingsWriteScope } from '../../lib/settings';
import { exactTenantCondition } from '../../lib/tenant';
import { withPagination } from '../../lib/where-helpers';
import type { JwtPayload } from '../../middleware/auth';
import { HTTPException } from 'hono/http-exception';
import { assertIpAccessChange } from '../../lib/settings/ip-access-guard';
import type { IpAccessSettings } from '@zenith/shared/settings';

const revisionSummaryColumns = {
  id: systemSettingsRevisions.id, version: systemSettingsRevisions.version, action: systemSettingsRevisions.action,
  restoredFromVersion: systemSettingsRevisions.restoredFromVersion, note: systemSettingsRevisions.note,
  actorId: systemSettingsRevisions.actorId, actorName: systemSettingsRevisions.actorName,
  createdAt: systemSettingsRevisions.createdAt, changedPaths: systemSettingsRevisions.changedPaths,
};

/** 只投影列表元数据，完整 JSON 快照按版本详情请求。 */
export async function listSettingsVersions(module: SettingsModuleKey, user: JwtPayload, query: QueryOutputOf<SettingsHistoryContract['list']>) {
  const tenantId = settingsReadScope(module, user);
  const [head] = await db.select({ id: systemSettings.id }).from(systemSettings)
    .where(and(eq(systemSettings.module, module), exactTenantCondition(systemSettings.tenantId, tenantId)));
  if (!head) return emptyListResult(query.page, query.pageSize);
  const where = eq(systemSettingsRevisions.settingsId, head.id);
  return buildListResult({
    ...query,
    count: () => db.$count(systemSettingsRevisions, where),
    rows: () => withPagination(db.select(revisionSummaryColumns).from(systemSettingsRevisions)
      .where(where).orderBy(desc(systemSettingsRevisions.version)).$dynamic(), query.page, query.pageSize),
    map: (row) => pickEntity(settingsRevisionSummarySchema, row),
  });
}

/** 请求版本号只能在当前模块和精确作用域内寻址。v0 是当前的继承状态，不伪造过去的默认值。 */
async function readVersion(executor: DbExecutor, module: SettingsModuleKey, tenantId: number | null, version: number): Promise<SettingsRevisionDetail> {
  if (version === 0) {
    const current = await loadSettingsEntry(executor, module, tenantId);
    const definition = settingsDefinition(module);
    return {
      id: 0, version: 0, action: 'initial', restoredFromVersion: null, note: '当前继承状态（虚拟版本）',
      actorId: null, actorName: '系统默认', createdAt: null, changedPaths: [], overrides: {},
      inherited: current.inherited as SettingsDoc, effective: current.inherited as SettingsDoc,
      inheritedVersion: current.inheritedVersion, definitionHash: definition.hash, definition: definition.snapshot,
    };
  }
  const rows = await executor.select({ revision: systemSettingsRevisions }).from(systemSettingsRevisions)
    .innerJoin(systemSettings, eq(systemSettingsRevisions.settingsId, systemSettings.id))
    .where(and(eq(systemSettings.module, module), exactTenantCondition(systemSettings.tenantId, tenantId), eq(systemSettingsRevisions.version, version)))
    .limit(1);
  return pickEntity(settingsRevisionDetailSchema, requireRow(rows[0], '设置版本不存在').revision);
}

export async function getSettingsVersion(module: SettingsModuleKey, user: JwtPayload, version: number) {
  return readVersion(db, module, settingsReadScope(module, user), version);
}

export async function compareSettingsVersions(module: SettingsModuleKey, user: JwtPayload, query: QueryOutputOf<SettingsHistoryContract['compare']>): Promise<SettingsComparison> {
  const tenantId = settingsReadScope(module, user);
  return readSnapshot(async (tx) => {
    const from = await readVersion(tx, module, tenantId, query.from);
    const to = await readVersion(tx, module, tenantId, query.to);
    return { fromVersion: query.from, toVersion: query.to, changes: diffSettingsSnapshots(from, to, to.definition, from.definition) };
  });
}

/** 预览与写入使用同一模块锁和生效指纹；确认恢复时统一写入链路会再次校验。 */
export async function previewSettingsRestore(module: SettingsModuleKey, user: JwtPayload, version: number, input: { baseToken: string }): Promise<SettingsRestorePreview> {
  const tenantId = settingsWriteScope(module, user);
  return db.transaction(async (tx) => {
    await lockSettingsModule(tx, module);
    const current = await loadSettingsEntry(tx, module, tenantId);
    assertSettingsBase(current, input.baseToken);
    const target = await readVersion(tx, module, tenantId, version);
    let overrides = target.overrides;
    let restored = mergeSettingsLayers(current.inherited as SettingsDoc, overrides);
    const issues: SettingsRestorePreview['issues'] = [];
    try {
      overrides = parseSettingsOverrides(module, overrides);
      restored = SETTINGS_MODULES[module].schema.parse(mergeSettingsLayers(current.inherited as SettingsDoc, overrides)) as SettingsDoc;
      if (module === 'ipAccess') assertIpAccessChange(restored as IpAccessSettings);
    } catch (error) {
      if (error instanceof HTTPException) issues.push({ path: 'ipAccess', message: error.message });
      else {
        if (!(error instanceof z.ZodError)) throw error;
        issues.push(...error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })));
      }
    }
    return {
      baseToken: current.baseToken, currentVersion: current.version, targetVersion: version,
      current: current.effective as SettingsDoc, restored,
      changes: diffSettingsSnapshots({ effective: current.effective as SettingsDoc, overrides: current.own }, { effective: restored, overrides }, settingsDefinition(module).snapshot, target.definition),
      issues,
    };
  });
}
