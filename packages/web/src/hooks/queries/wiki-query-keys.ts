import { resourceKeyOf, type QueryOf } from '@zenith/shared/core';
import { wikiGovernanceContract, wikiStatsContract, type WikiGovernanceKind } from '@zenith/shared/wiki';
import { contractKey } from '@/lib/contract-query';

/**
 * 统计 / 设置 / 治理三组 query key 单独成文件：wiki-docs 的失效需要引用统计 key，
 * 而 wiki-stats / wiki-governance 又依赖 wiki-docs 导出的详情前缀与目录树 key，放在各自文件里会形成循环导入。
 */

export const wikiStatsKeys = {
  all: [resourceKeyOf(wikiStatsContract.basePath)] as const,
  overview: contractKey(wikiStatsContract.overview),
  hotDocs: contractKey(wikiStatsContract.hotDocs),
  contributors: contractKey(wikiStatsContract.contributors),
  staleDocs: contractKey(wikiStatsContract.staleDocs),
  ops: contractKey(wikiStatsContract.ops),
};


export type WikiGovernanceDocListParams = Omit<NonNullable<QueryOf<typeof wikiGovernanceContract.listDocs>>, 'kind'>;

export const wikiGovernanceKeys = {
  all: [resourceKeyOf(wikiGovernanceContract.basePath)] as const,
  lists: contractKey(wikiGovernanceContract.listDocs),
  list: (kind: WikiGovernanceKind, params: WikiGovernanceDocListParams) =>
    contractKey(wikiGovernanceContract.listDocs, { query: { ...params, kind } }),
  noResultKeywords: contractKey(wikiGovernanceContract.noResultKeywords),
};
