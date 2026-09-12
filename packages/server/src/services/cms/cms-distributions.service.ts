// 该文件已按业务切面拆分，仅保留 re-export 以维持既有导入路径。
// - cms-distributions-shared.ts: 共享常量与规则存在性校验
// - cms-distributions-rules.service.ts: 分发规则 CRUD
// - cms-distributions-sync.service.ts: 规则删除解绑、分发执行与同步引擎、任务处理器
// - cms-distributions-runs.service.ts: 执行记录查询、导出与调度派发
export { ensureCmsDistributionRuleExists } from './cms-distributions-shared';
export {
  createCmsDistributionRule,
  getCmsDistributionRule,
  listCmsDistributionRules,
  updateCmsDistributionRule,
} from './cms-distributions-rules.service';
export {
  deleteCmsDistributionRule,
  registerCmsDistributionTaskHandler,
  submitCmsDistributionRun,
  submitCmsMappingDistributionSideEffects,
} from './cms-distributions-sync.service';
export {
  buildCmsDistributionRunWhere,
  dispatchDueCmsDistributionRules,
  getCmsDistributionRunDetail,
  listCmsDistributionRuns,
  loadCmsDistributionExportRows,
} from './cms-distributions-runs.service';
export type { CmsDistributionRunListFilter } from './cms-distributions-runs.service';
