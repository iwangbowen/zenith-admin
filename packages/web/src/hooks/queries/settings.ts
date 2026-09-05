import type { QueryClient } from '@tanstack/react-query';
import {
  settingsContract,
  settingsGetOp,
  settingsUpdateOp,
  type SettingsEnvelope,
  type SettingsGetOperation,
  type SettingsModuleKey,
  type SettingsUpdateOperation,
} from '@zenith/shared/settings';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

/**
 * 运行时设置（/api/settings）域 hooks。
 *
 * key 树以契约 basePath 派生的资源键 `settings` 为根：
 * - `['settings', 'getXxx']`：某模块的读取信封（生效值 / 上级值 / 覆盖路径 / 版本）
 * - `['settings', 'me']`：登录用户投影（布局开关、密码规则、终端录屏…），布局与多个页面共用一次请求
 * - `['settings', 'public', { tenantCode }]`：匿名投影（登录 / 注册页）
 * - `['settings', 'list']`：通用设置页的模块清单
 * 保存某模块后：直接写回该模块信封（写接口与读接口同源），并失效 me / public / list——
 * 它们都是同一份数据的投影，而不是别的域。
 */
export const settingsKeys = {
  all: ['settings'] as const,
  list: contractKey(settingsContract.list),
  me: contractKey(settingsContract.me),
  publicPrefix: contractKey(settingsContract.public),
  public: (tenantCode?: string) => contractKey(settingsContract.public, { query: { tenantCode: tenantCode || undefined } }),
  module: (module: SettingsModuleKey) => contractKey(settingsGetOp(module)),
};

/** 泛型调用点用参数化操作类型保住 `SettingsEnvelope<M>`；运行时仍是契约上的原操作 */
const getOp = <M extends SettingsModuleKey>(module: M) => settingsGetOp(module) as unknown as SettingsGetOperation<M>;
const updateOp = <M extends SettingsModuleKey>(module: M) => settingsUpdateOp(module) as unknown as SettingsUpdateOperation<M>;

/** 某模块的读取信封；`enabled` 用于按权限跳过请求 */
export function useSettings<M extends SettingsModuleKey>(module: M, enabled = true) {
  return useApiQuery(getOp(module), { enabled });
}

export function invalidateSettingsProjections(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: settingsKeys.me });
  void qc.invalidateQueries({ queryKey: settingsKeys.publicPrefix });
  void qc.invalidateQueries({ queryKey: settingsKeys.list });
}

/**
 * 保存某模块（整体替换，携带 version）。409 = 他人已修改，调用方提示后重载。
 * 保存成功后除写回本模块外，还会失效投影；有额外副作用的域（网盘配额影响空间展示）在自己的 hook 里追加。
 */
export function useSaveSettings<M extends SettingsModuleKey>(
  module: M,
  /** 先于缓存回填执行：此时 qc.getQueryData(settingsKeys.module(module)) 仍是保存前的信封，可与 saved 比对决定波及范围 */
  extraInvalidate?: (qc: QueryClient, saved: SettingsEnvelope<M>) => void,
) {
  return useApiMutation(updateOp(module), {
    invalidate: (qc, saved) => {
      extraInvalidate?.(qc, saved);
      qc.setQueryData(settingsKeys.module(module), saved);
      invalidateSettingsProjections(qc);
    },
  });
}

/** 登录用户可见的设置投影：布局（水印 / 快捷聊天 / 反馈入口）、密码规则、终端录屏、规则审批开关 */
export function useMySettings(enabled = true) {
  return useApiQuery(settingsContract.me, { enabled, staleTime: LOOKUP_STALE_TIME, requestOptions: { silent: true } });
}

/** 匿名投影（登录 / 注册页）；多租户模式下随租户编码变化 */
export function usePublicSettings(tenantCode?: string) {
  return useApiQuery(settingsContract.public, { query: { tenantCode: tenantCode || undefined } }, { staleTime: LOOKUP_STALE_TIME, requestOptions: { silent: true } });
}

/** 当前用户可读的设置模块清单（通用设置页导航） */
export function useSettingsModules() {
  return useApiQuery(settingsContract.list);
}
