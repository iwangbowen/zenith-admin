import {
  SETTINGS_MODULES,
  SETTINGS_MODULE_KEYS,
  diffSettings,
  resolveSettings,
  settingsOverriddenPaths,
  type SettingsDoc,
  type SettingsEnvelope,
  type SettingsModuleKey,
  type SettingsOf,
} from '@zenith/shared/settings';
import { mockDateTime } from '@/mocks/utils/date';

/**
 * 运行时设置 Demo 存储：每个模块一份平台级稀疏覆盖文档 + 版本号，解析语义与服务端共用
 * `@zenith/shared/settings` 的 resolveSettings / diffSettings（默认值来自 schema，不写静态数组）。
 */
interface StoredModule {
  data: SettingsDoc;
  version: number;
  updatedAt: string | null;
}

const store = new Map<SettingsModuleKey, StoredModule>();

function stored(module: SettingsModuleKey): StoredModule {
  let entry = store.get(module);
  if (!entry) {
    entry = { data: {}, version: 0, updatedAt: null };
    store.set(module, entry);
  }
  return entry;
}

/** 模块生效文档（默认 ← 平台覆盖） */
export function getMockSettings<M extends SettingsModuleKey>(module: M): SettingsOf<M> {
  return resolveSettings(module, [stored(module).data]).value;
}

/** 写入完整生效文档：落库只存与默认值不同的叶子；返回新版本 */
export function putMockSettings<M extends SettingsModuleKey>(module: M, effective: SettingsOf<M>): SettingsEnvelope<M> {
  const entry = stored(module);
  const inherited = resolveSettings(module, []).value as SettingsDoc;
  entry.data = diffSettings(effective as SettingsDoc, inherited);
  entry.version += 1;
  entry.updatedAt = mockDateTime();
  return mockSettingsEnvelope(module);
}

export function mockSettingsVersion(module: SettingsModuleKey): number {
  return stored(module).version;
}

export function mockSettingsEnvelope<M extends SettingsModuleKey>(module: M): SettingsEnvelope<M> {
  const entry = stored(module);
  return {
    module,
    scope: SETTINGS_MODULES[module].scope,
    tenantId: null,
    version: entry.version,
    effective: getMockSettings(module),
    inherited: resolveSettings(module, []).value,
    overriddenPaths: settingsOverriddenPaths(entry.data),
    updatedAt: entry.updatedAt,
  };
}

export const mockSettingsModuleKeys = SETTINGS_MODULE_KEYS;
