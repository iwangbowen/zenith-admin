import type { DriveSpaceType } from '@zenith/shared/drive';
import type { DriveSettings } from '@zenith/shared/settings';
import { getSettings } from '../../lib/settings';

export type { DriveSettings };

/**
 * 网盘全局设置由运行时设置 `drive` 模块承载（平台级，License 特性 drive）；
 * 管理界面读写走 `/api/settings/drive`。这里只保留域内读取别名与配额换算。
 *
 * ⚠ 本函数命中副本时零查询，但冷加载会向全局连接池借连接：
 * 持有 `db.transaction` 的代码路径不得调用它，必须在事务外读取后作为参数传入
 * （见 drive-upload / drive-spaces / drive-nodes 的 `settings` 形参）。
 */
export async function getDriveSettings(): Promise<DriveSettings> {
  return getSettings('drive');
}

const GB = 1024 * 1024 * 1024;

/** 空间类型对应的默认配额（字节）；0 = 不限 */
export function defaultQuotaBytes(settings: DriveSettings, type: DriveSpaceType): number {
  const gb = type === 'personal' ? settings.personalQuotaGb : type === 'department' ? settings.departmentQuotaGb : settings.teamQuotaGb;
  return Math.round(gb * GB);
}

/** 生效配额：空间显式配额优先，否则按类型取系统默认 */
export function effectiveQuotaBytes(settings: DriveSettings, space: { type: DriveSpaceType; quotaBytes: number | null }): number {
  return space.quotaBytes ?? defaultQuotaBytes(settings, space.type);
}

/** 扩展名黑名单：统一小写、去前导点 */
export function blockedExtensionSet(settings: DriveSettings): Set<string> {
  return new Set(settings.blockedExtensions.map((s) => s.trim().toLowerCase().replace(/^\./, '')).filter(Boolean));
}