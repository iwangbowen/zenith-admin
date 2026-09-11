/**
 * 打印设计器「实体模板」（sourceType=entity）的纯逻辑：字段目录、数据集键集合、生成版式 → Univer 种子。
 * 只依赖 shared，便于单测；PrintDesignerPage 负责状态与渲染。
 */
import type { ReportPrintContent, ReportPrintEntityKind, ReportPrintSheet } from '@zenith/shared/report';
import type { WorkflowFormField, WorkflowPrintDatasetDescriptor } from '@zenith/shared/workflow';
import { describeWorkflowPrintDatasets, generateWorkflowPrintContent, workflowPrintPageConfig } from '@zenith/shared/workflow';

export interface EntityPrintCatalog {
  kind: ReportPrintEntityKind;
  /** 数据集目录（首个为主数据集 main） */
  datasets: WorkflowPrintDatasetDescriptor[];
}

/** 按实体类型与设计参照的表单字段计算数据集目录；目前只有审批单一种实体 */
export function buildEntityPrintCatalog(kind: ReportPrintEntityKind, fields: WorkflowFormField[]): EntityPrintCatalog {
  return { kind, datasets: describeWorkflowPrintDatasets(fields) };
}

/** 模板内可被单元格 / 重复块引用的数据集键（渲染时由实体所属域注入） */
export function entityDatasetKeys(catalog: EntityPrintCatalog): string[] {
  return catalog.datasets.map((dataset) => dataset.key);
}

/** 主数据集（渲染时作为 main 行，单元格可直接 `${key}` 引用，无需 datasetKey） */
export function entityMainDatasetKey(catalog: EntityPrintCatalog): string {
  return catalog.datasets[0]?.key ?? 'instance';
}

/** 「从流程表单生成模板」：自动版式 + 页面配置，直接作为设计器工作簿种子 */
export function buildEntityTemplateDraft(kind: ReportPrintEntityKind, fields: WorkflowFormField[]): { content: ReportPrintContent; sheets: ReportPrintSheet[] } {
  void kind;
  const content = generateWorkflowPrintContent(fields, { includeCc: true, includeComments: true });
  const pageConfig = workflowPrintPageConfig();
  const sheets = (content.sheets ?? []).map((sheet) => ({ ...sheet, pageConfig: { ...pageConfig, ...(sheet.pageConfig ?? {}) } }));
  return { content: { ...content, sheets }, sheets };
}

/**
 * 校验模板引用的数据集键：实体模板允许 main / 实体数据集 / 附加绑定；返回首个非法引用的说明，合法返回 null。
 */
export function findInvalidEntityDatasetRef(content: ReportPrintContent, allowedKeys: Iterable<string>): string | null {
  const allowed = new Set(['main', ...[...allowedKeys].map((key) => key.toLowerCase())]);
  for (const sheet of content.sheets ?? []) {
    if (sheet.datasetKey && !allowed.has(sheet.datasetKey.toLowerCase())) return `页签「${sheet.name}」引用了不存在的数据集 ${sheet.datasetKey}`;
    for (const block of sheet.repeatBlocks ?? []) {
      if (!allowed.has(block.datasetKey.toLowerCase())) return `重复块「${block.id}」引用了不存在的数据集 ${block.datasetKey}`;
    }
    for (const cell of sheet.grid.cells) {
      for (const key of [cell.datasetKey, cell.subreport?.datasetKey]) {
        if (key && !allowed.has(key.toLowerCase())) return `页签「${sheet.name}」的单元格引用了不存在的数据集 ${key}`;
      }
    }
  }
  return null;
}
