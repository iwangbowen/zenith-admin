import { wikiStatsContract } from '@zenith/shared/wiki';
import type { SettingsEnvelope } from '@zenith/shared/settings';
import { settingsKeys, useSaveSettings, useSettings } from './settings';
import { useApiQuery } from '@/lib/contract-query';
import { wikiDocDetailPrefix } from './wiki-docs';
import { wikiGovernanceKeys, wikiStatsKeys } from './wiki-query-keys';

export { wikiStatsKeys } from './wiki-query-keys';

export function useWikiStatsOverview() {
  return useApiQuery(wikiStatsContract.overview);
}

export function useWikiHotDocs(limit = 10) {
  return useApiQuery(wikiStatsContract.hotDocs, { query: { limit } });
}

export function useWikiContributors(limit = 10) {
  return useApiQuery(wikiStatsContract.contributors, { query: { limit } });
}

export function useWikiStaleDocs(limit = 10) {
  return useApiQuery(wikiStatsContract.staleDocs, { query: { limit } });
}

export function useWikiOpsStats() {
  return useApiQuery(wikiStatsContract.ops);
}

/** 知识库全局设置由运行时设置 wiki 模块承载（/api/settings/wiki）；返回读取信封（effective / inherited / version） */
export function useWikiSettings() {
  return useSettings('wiki');
}

/**
 * 保存设置：响应即最新设置，直接回填缓存；只有真正变化的开关才波及其消费者——
 * 评论开关影响文档详情的 commentsEnabled，审核积压时限影响治理「审核积压」清单与运营统计。
 */
export function useUpdateWikiSettings() {
  return useSaveSettings('wiki', (qc, saved) => {
    const previous = qc.getQueryData<SettingsEnvelope<'wiki'>>(settingsKeys.module('wiki'))?.effective;
    if (previous?.commentsEnabled !== saved.effective.commentsEnabled) {
      void qc.invalidateQueries({ queryKey: wikiDocDetailPrefix });
    }
    if (previous?.pendingRemindHours !== saved.effective.pendingRemindHours) {
      void qc.invalidateQueries({ queryKey: wikiGovernanceKeys.lists });
      void qc.invalidateQueries({ queryKey: wikiStatsKeys.ops });
    }
  });
}
