import type { QueryClient } from '@tanstack/react-query';
import { resourceKeyOf } from '@zenith/shared/core';
import { analyticsContract } from '@zenith/shared/analytics';
import { ipAccessContract } from '@zenith/shared/platform';
import { driveAdminContract, driveSpaceContract } from '@zenith/shared/drive';
import { wikiDocContract, wikiGovernanceContract, wikiStatsContract } from '@zenith/shared/wiki';
import type { SettingsEnvelope, SettingsModuleKey } from '@zenith/shared/settings';
import { contractKey } from '@/lib/contract-query';

/** 保存与恢复共用业务联动；只依赖契约，避免 settings 与各域 hooks 互相导入。 */
export function invalidateSettingsEffects<M extends SettingsModuleKey>(
  qc: QueryClient,
  module: M,
  saved: SettingsEnvelope<M>,
  previous: SettingsEnvelope<M> | undefined,
) {
  if (module === 'ipAccess') void qc.invalidateQueries({ queryKey: contractKey(ipAccessContract.context) });
  if (module === 'drive') {
    // 全局配额影响每个空间的派生值，所有空间列表及详情均需重新计算。
    for (const op of [driveSpaceContract.my, driveSpaceContract.list, driveSpaceContract.detail, driveAdminContract.spaces]) {
      void qc.invalidateQueries({ queryKey: contractKey(op) });
    }
  }
  if (module === 'wiki') {
    const before = previous?.effective as SettingsEnvelope<'wiki'>['effective'] | undefined;
    const after = saved.effective as SettingsEnvelope<'wiki'>['effective'];
    if (before?.commentsEnabled !== after.commentsEnabled) {
      void qc.invalidateQueries({ queryKey: contractKey(wikiDocContract.detail) });
    }
    if (before?.pendingRemindHours !== after.pendingRemindHours) {
      void qc.invalidateQueries({ queryKey: contractKey(wikiGovernanceContract.listDocs) });
      void qc.invalidateQueries({ queryKey: contractKey(wikiStatsContract.ops) });
    }
  }
  if (module === 'analytics') {
    // 全局采集及聚合规则改变整个行为分析资源的统计口径。
    void qc.invalidateQueries({ queryKey: [resourceKeyOf(analyticsContract.basePath)] });
  }
}
