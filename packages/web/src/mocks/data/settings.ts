import * as z from 'zod';
import {
  SETTINGS_MODULES, SETTINGS_MODULE_KEYS, diffSettingsSnapshots, getSettingsDefinition,
  evaluateIpAccess, type IpAccessSettings,
  mergeSettingsLayers, parseSettingsOverrides, resolveSettings, settingsOverriddenPaths, stableSettingsSerialize,
  type SettingsDoc, type SettingsEnvelope, type SettingsModuleKey, type SettingsOf,
  type SettingsRevisionDetail, type SettingsRevisionSummary, type SettingsRestorePreview, type SettingsWriteBody,
} from '@zenith/shared/settings';
import { MockHttpError } from '@/mocks/utils/contract';
import { badRequest, conflict, notFound } from '@/mocks/utils/handlers';
import { mockDateTime } from '@/mocks/utils/date';

/** Demo 以平台管理员运行；不可变版本正文与当前指针复用真实设置的显式继承规则。 */
const store = new Map<SettingsModuleKey, SettingsRevisionDetail[]>();
const definitions = new Map<string, string>();
let nextRevisionId = 1;

function revisions(module: SettingsModuleKey): SettingsRevisionDetail[] {
  return store.get(module) ?? [];
}

function definition(module: SettingsModuleKey) {
  const snapshot = getSettingsDefinition(module);
  const serialized = stableSettingsSerialize(snapshot);
  let hash = definitions.get(serialized);
  if (!hash) {
    hash = `demo-definition-${definitions.size + 1}`;
    definitions.set(serialized, hash);
  }
  return { snapshot, hash };
}

export function getMockSettings<M extends SettingsModuleKey>(module: M): SettingsOf<M> {
  return resolveSettings(module, [revisions(module).at(-1)?.overrides ?? {}]).value;
}

export function mockSettingsEnvelope<M extends SettingsModuleKey>(module: M): SettingsEnvelope<M> {
  const current = revisions(module).at(-1);
  const { hash } = definition(module);
  const overrides = structuredClone(current?.overrides ?? {});
  return {
    module, scope: SETTINGS_MODULES[module].scope, tenantId: null, version: current?.version ?? 0,
    currentRevisionId: current?.id ?? null, baseToken: `demo:${module}:${current?.id ?? 0}:${hash}`,
    inheritedVersion: 0, definitionHash: hash, overrides,
    effective: getMockSettings(module), inherited: resolveSettings(module, []).value,
    overriddenPaths: settingsOverriddenPaths(overrides), updatedAt: current?.createdAt ?? null,
  };
}

export function mockSettingsVersion(module: SettingsModuleKey): number {
  return revisions(module).at(-1)?.version ?? 0;
}

export function assertMockSettingsBase(module: SettingsModuleKey, baseToken: string) {
  if (mockSettingsEnvelope(module).baseToken !== baseToken) {
    throw new MockHttpError(conflict('设置或继承来源已发生变化，请查看最新配置后重试；未保存的修改已保留', { status: 409 }));
  }
}

function validationError(error: unknown): never {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    throw new MockHttpError(badRequest(`${issue.path.join('.') || '设置'}：${issue.message}`, { status: 400 }));
  }
  throw error;
}

/** 校验与指针推进同步完成；模拟真实事务的冲突、无变化与失败不落库语义。 */
export function putMockSettings<M extends SettingsModuleKey>(
  module: M, input: SettingsWriteBody<M>, restoredFromVersion?: number,
): SettingsEnvelope<M> {
  assertMockSettingsBase(module, input.baseToken);
  const before = mockSettingsEnvelope(module);
  const candidate = restoredFromVersion === undefined ? input.overrides : mockSettingsRevision(module, restoredFromVersion).overrides;
  let overrides: SettingsDoc;
  let effective: SettingsDoc;
  try {
    overrides = parseSettingsOverrides(module, candidate);
    effective = SETTINGS_MODULES[module].schema.parse(mergeSettingsLayers(before.inherited as SettingsDoc, overrides)) as SettingsDoc;
  } catch (error) { return validationError(error); }
  if (module === 'ipAccess' && !evaluateIpAccess(effective as IpAccessSettings, '192.0.2.10').allowed) {
    throw new MockHttpError(badRequest('该配置会阻断当前来源 IP（192.0.2.10），请先调整名单', { status: 400 }));
  }
  if (stableSettingsSerialize(overrides) === stableSettingsSerialize(before.overrides)) return before;
  const { snapshot, hash } = definition(module);
  const revision: SettingsRevisionDetail = {
    id: nextRevisionId++, version: before.version + 1,
    action: restoredFromVersion === undefined ? 'save' : 'restore', restoredFromVersion: restoredFromVersion ?? null,
    note: input.note ?? '', actorId: 1, actorName: '演示管理员', createdAt: mockDateTime(),
    changedPaths: diffSettingsSnapshots({ effective: before.effective as SettingsDoc, overrides: before.overrides }, { effective, overrides }, snapshot).map((change) => change.path),
    overrides, inherited: structuredClone(before.inherited as SettingsDoc), effective,
    definitionHash: hash, definition: snapshot, inheritedVersion: 0,
  };
  store.set(module, [...revisions(module), structuredClone(revision)]);
  return mockSettingsEnvelope(module);
}

export function mockSettingsRevision(module: SettingsModuleKey, version: number): SettingsRevisionDetail {
  if (version === 0) {
    const inherited = resolveSettings(module, []).value as SettingsDoc;
    const { snapshot, hash } = definition(module);
    return {
      id: 0, version: 0, action: 'initial', restoredFromVersion: null, note: '当前上级配置的默认继承状态',
      actorId: null, actorName: '系统默认', createdAt: null, changedPaths: [], overrides: {},
      inherited, effective: structuredClone(inherited), definitionHash: hash, definition: snapshot, inheritedVersion: 0,
    };
  }
  const revision = revisions(module).find((item) => item.version === version);
  if (!revision) throw new MockHttpError(notFound('设置版本不存在', { status: 404 }));
  return structuredClone(revision);
}

export function mockSettingsRevisions(module: SettingsModuleKey): SettingsRevisionSummary[] {
  return [...revisions(module)].reverse().map(({ id, version, action, restoredFromVersion, note, actorId, actorName, createdAt, changedPaths }) =>
    ({ id, version, action, restoredFromVersion, note, actorId, actorName, createdAt, changedPaths: [...changedPaths] }));
}

export function previewMockSettingsRestore(module: SettingsModuleKey, version: number, baseToken: string): SettingsRestorePreview {
  assertMockSettingsBase(module, baseToken);
  const current = mockSettingsEnvelope(module);
  const target = mockSettingsRevision(module, version);
  let overrides = target.overrides;
  let restored = mergeSettingsLayers(current.inherited as SettingsDoc, overrides);
  const issues: SettingsRestorePreview['issues'] = [];
  try {
    overrides = parseSettingsOverrides(module, overrides);
    restored = SETTINGS_MODULES[module].schema.parse(mergeSettingsLayers(current.inherited as SettingsDoc, overrides)) as SettingsDoc;
    if (module === 'ipAccess' && !evaluateIpAccess(restored as IpAccessSettings, '192.0.2.10').allowed) {
      issues.push({ path: 'ipAccess', message: '该配置会阻断当前来源 IP（192.0.2.10）' });
    }
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    issues.push(...error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })));
  }
  return {
    baseToken, currentVersion: current.version, targetVersion: version, current: current.effective as SettingsDoc, restored,
    changes: diffSettingsSnapshots({ effective: current.effective as SettingsDoc, overrides: current.overrides }, { effective: restored, overrides }, definition(module).snapshot), issues,
  };
}

export const mockSettingsModuleKeys = SETTINGS_MODULE_KEYS;
