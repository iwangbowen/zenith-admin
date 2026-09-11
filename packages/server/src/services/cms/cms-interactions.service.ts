// 门面（facade）：cms-interactions.service 已按切面拆分为 forms/stats/responses/shared 四个子模块，
// 此文件仅保留 re-export，导出符号集与拆分前完全一致，外部导入方无需改动。
export { ensureCmsInteractionExists } from './cms-interactions-shared';
export {
  mapCmsInteractionQuestion,
  mapCmsInteraction,
  listCmsInteractions,
  getCmsInteraction,
  createCmsInteraction,
  updateCmsInteraction,
  setCmsInteractionStatus,
  deleteCmsInteraction,
  interactionCodeStem,
  nextInteractionCopyCode,
  copyCmsInteraction,
  getPublicCmsInteractionByCode,
  getPublicCmsInteractionById,
  resolveCmsInteractionCaptcha,
  submitCmsInteraction,
  getCmsInteractionPublicState,
} from './cms-interactions-forms.service';
export type {
  CmsInteractionCaptchaConfig,
  SubmitCmsInteractionMeta,
} from './cms-interactions-forms.service';
export {
  npsScoreOf,
  scaleStatsFromHistogram,
  listCmsInteractionTexts,
  getCmsInteractionCrossStats,
  getCmsInteractionTrend,
  toCmsInteractionPublicStats,
  getCmsInteractionStats,
} from './cms-interactions-stats.service';
export type { CmsInteractionTextsQuery } from './cms-interactions-stats.service';
export {
  buildCmsInteractionResponseWhere,
  toCmsInteractionAnswerDetail,
  listCmsInteractionResponses,
  streamCmsInteractionResponses,
  applyInteractionMarkers,
  canExposeCmsInteractionResults,
  cmsInteractionRepeatIdentity,
} from './cms-interactions-responses.service';
export type { CmsInteractionResponseListFilter } from './cms-interactions-responses.service';
