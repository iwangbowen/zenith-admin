import type { DriveSpaceType } from '@zenith/shared/drive';
import type { DriveSettings } from '@zenith/shared/settings';
import { getSettings } from '../../lib/settings';

export type { DriveSettings };

/**
 * 网盘设置由运行时设置 `drive` 模块承载（租户可覆盖平台值，License 特性 drive）；
 * 管理界面读写走 `/api/settings/drive`。这里只保留域内读取别名与配额换算。
 *
 * 作用域：有请求上下文时按当前用户的有效租户解析；**无请求上下文的后台任务 / 匿名公开入口必须显式传
 * `tenantId`**（空间 / 外链 / 节点行上的 tenantId），否则会静默退回平台值。
 *
 * ⚠ 本函数命中副本时零查询，但冷加载会向全局连接池借连接：
 * 持有 `db.transaction` 的代码路径不得调用它，必须在事务外读取后作为参数传入
 * （见 drive-upload / drive-spaces / drive-nodes 的 `settings` 形参）。
 */
export async function getDriveSettings(options?: { tenantId?: number | null }): Promise<DriveSettings> {
  return getSettings('drive', options);
}

/** 1 GB 的字节数：配额相关的 GB ↔ 字节换算统一经此常量 / `gbToBytes()`，不要在各 service 里重复定义 */
export const GB_BYTES = 1024 * 1024 * 1024;

/** GB → 字节（四舍五入到整字节）；`null` / `undefined` 透传为 `null`（表示「未设置 / 跟随默认」） */
export function gbToBytes(gb: number | null | undefined): number | null {
  if (gb === null || gb === undefined) return null;
  return Math.round(gb * GB_BYTES);
}

/** 空间类型对应的默认配额（字节）；0 = 不限 */
export function defaultQuotaBytes(settings: DriveSettings, type: DriveSpaceType): number {
  const gb = type === 'personal' ? settings.personalQuotaGb : type === 'department' ? settings.departmentQuotaGb : settings.teamQuotaGb;
  return Math.round(gb * GB_BYTES);
}

/** 生效配额：空间显式配额优先，否则按类型取系统默认 */
export function effectiveQuotaBytes(settings: DriveSettings, space: { type: DriveSpaceType; quotaBytes: number | null }): number {
  return space.quotaBytes ?? defaultQuotaBytes(settings, space.type);
}

/** 扩展名黑名单：统一小写、去前导点 */
export function blockedExtensionSet(settings: DriveSettings): Set<string> {
  return new Set(settings.blockedExtensions.map((s) => s.trim().toLowerCase().replace(/^\./, '')).filter(Boolean));
}