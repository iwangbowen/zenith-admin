// 门面（facade）：cms-contents.service 已按切面拆分为 query/write/ops 三个子模块，
// 此文件仅保留 re-export，导出符号集与拆分前完全一致，外部导入方无需改动。
export {
  mapCmsContent,
  mapCmsContentListItem,
  ensureCmsContentExists,
  getCmsContent,
  listCmsContents,
  checkCmsContentTitle,
  listPublishedContents,
  listHomeContents,
  getPublishedContent,
  findPublishedContentByStaticPath,
  getPublishedContentById,
  getContentBodyExtendRaw,
  resolveContentBodyExtend,
  getAdjacentContents,
  increaseViewCount,
  flushViewCountBuffer,
  listContentTags,
  listRelatedContents,
  listPublishedContentsByTag,
} from './cms-contents-query.service';
export type { ResolvedCmsContentRow, ResolvedCmsContentListRow } from './cms-contents-query.service';
export {
  ensureCmsContentTargetAccess,
  detectContentFlags,
  createCmsContent,
  updateCmsContent,
  submitCmsContent,
  assertLockedCmsPublishPreconditions,
  publishCmsContent,
  rejectCmsContent,
  offlineCmsContent,
  restoreCmsContentToVersion,
} from './cms-contents-write.service';
export type { PublishCmsContentOptions } from './cms-contents-write.service';
export {
  recycleCmsContents,
  restoreCmsContents,
  purgeCmsContents,
  archiveCmsContents,
  unarchiveCmsContents,
  canAutoOfflineCmsContent,
  offlineExpiredCmsContents,
  cancelExpiredTopContents,
  batchMoveCmsContents,
  batchSetCmsContentFlags,
  batchAddCmsContentTags,
  batchTransitionCmsContents,
  duplicateCmsContent,
  distributeCmsContents,
  cleanupCmsRecycleBin,
} from './cms-contents-ops.service';
