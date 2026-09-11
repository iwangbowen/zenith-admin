/**
 * 审批单打印：实例 → PDF。
 *
 * 数据：复用 getInstanceDetail（发起人 / 参与人 / 监控权限判定与详情一致）→ 表单快照 → 引用批量解析
 * （人员 / 部门 / 字典 / 关联单）→ @zenith/shared/workflow 的 buildWorkflowPrintDatasets。
 * 版式：流程绑定的实体打印模板（报表打印设计器）→ 请求临时指定的模板 → 按表单快照自动生成。
 * 渲染：报表打印引擎 renderPrintContent → pdfkit（report-print-export 惰性加载，模块图大）。
 */
import { HTTPException } from 'hono/http-exception';
import { eq, inArray } from 'drizzle-orm';
import {
  buildWorkflowPrintDatasets,
  collectWorkflowPrintLookupIds,
  emptyWorkflowPrintLookups,
  flattenWorkflowPrintLeafFields,
  generateWorkflowPrintContent,
  normalizeWorkflowFormSnapshot,
  workflowPrintPageConfig,
} from '@zenith/shared/workflow';
import type { WorkflowFlowData, WorkflowFormField, WorkflowInstance, WorkflowInstancePrintQueryInput, WorkflowPrintLookups, WorkflowPrintSettings } from '@zenith/shared/workflow';
import { renderPrintContent } from '@zenith/shared/report';
import type { ReportPrintContent, ReportPrintPageConfig } from '@zenith/shared/report';
import { applyMask } from '@zenith/shared/core';
import type { MaskType, SensitiveFieldRef } from '@zenith/shared/core';
import { db } from '../../db';
import { departments, users, workflowDefinitions, workflowInstances } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { currentDateTime } from '../../lib/datetime';
import { resolveMaskDecisions } from '../../lib/data-mask/policies';
import { registerSensitiveSource } from '../../lib/data-mask/registry';
import logger from '../../lib/logger';
import { loadEntityPrintTemplate } from '../report/report-print.service';
import { listDictItemsByCode } from '../platform/dicts.service';
import { getInstanceDetail } from './instances/queries';
import { loadWorkflowUserDisplays } from './workflow-user-helpers';

export interface WorkflowInstancePdf {
  buffer: Buffer;
  filename: string;
}

/**
 * 审批表单中的 PII 字段类型 → 脱敏策略字段。表单字段是动态的，按字段类型归并到固定实体 `WorkflowForm`，
 * 登记进敏感字段注册表后可在「数据脱敏」页配置停用 / 豁免权限，与契约字段共用同一套策略与决策。
 */
const FORM_FIELD_MASK_KINDS: Record<string, { field: string; kind: MaskType; label: string }> = {
  phone: { field: 'phone', kind: 'phone', label: '审批表单·手机号' },
  email: { field: 'email', kind: 'email', label: '审批表单·邮箱' },
  idCard: { field: 'idCard', kind: 'id_card', label: '审批表单·证件号' },
};

const WORKFLOW_FORM_SENSITIVE_REFS: readonly SensitiveFieldRef[] = Object.values(FORM_FIELD_MASK_KINDS).map((entry) => ({
  path: ['formData', entry.field],
  entity: 'WorkflowForm',
  field: entry.field,
  kind: entry.kind,
  label: entry.label,
}));

registerSensitiveSource('PRINT workflow_instance', WORKFLOW_FORM_SENSITIVE_REFS);

/** 按查看者的脱敏决策打码表单值（含明细子字段）；超管 / 豁免权限持有者原样返回 */
async function maskFormDataForViewer(fields: WorkflowFormField[], formData: WorkflowInstance['formData']): Promise<WorkflowInstance['formData']> {
  if (!formData) return formData;
  const decisions = await resolveMaskDecisions(WORKFLOW_FORM_SENSITIVE_REFS);
  if (decisions.length === 0) return formData;
  const byField = new Map(decisions.map((d) => [d.ref.field, d.decision]));
  const maskValue = (type: string, value: unknown): unknown => {
    const entry = FORM_FIELD_MASK_KINDS[type];
    const decision = entry ? byField.get(entry.field) : undefined;
    if (!decision || typeof value !== 'string') return value;
    return applyMask(value, decision.maskType, decision.customRule);
  };
  const masked: Record<string, unknown> = { ...formData };
  for (const field of flattenWorkflowPrintLeafFields(fields)) {
    if (field.type === 'detail') {
      const rows = masked[field.key];
      if (!Array.isArray(rows)) continue;
      masked[field.key] = rows.map((row) => {
        if (typeof row !== 'object' || row === null) return row;
        const out: Record<string, unknown> = { ...(row as Record<string, unknown>) };
        for (const child of field.children ?? []) out[child.key] = maskValue(child.type, out[child.key]);
        return out;
      });
      continue;
    }
    if (FORM_FIELD_MASK_KINDS[field.type]) masked[field.key] = maskValue(field.type, masked[field.key]);
  }
  return masked;
}

async function loadPrintLookups(fields: WorkflowFormField[], formData: WorkflowInstance['formData']): Promise<WorkflowPrintLookups> {
  const ids = collectWorkflowPrintLookupIds(fields, formData);
  const lookups = emptyWorkflowPrintLookups();
  const [userDisplays, deptRows, relationRows, dictEntries] = await Promise.all([
    loadWorkflowUserDisplays(ids.userIds),
    ids.deptIds.length
      ? db.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, ids.deptIds))
      : Promise.resolve([]),
    ids.relationIds.length
      ? db.select({ id: workflowInstances.id, title: workflowInstances.title }).from(workflowInstances).where(inArray(workflowInstances.id, ids.relationIds))
      : Promise.resolve([]),
    Promise.all(ids.dictCodes.map(async (code) => {
      // 字典被删除 / 越租户时退回原值展示，不让一个字典拖垮整张审批单
      const items = await listDictItemsByCode(code).catch(() => []);
      return [code, new Map(items.map((item) => [item.value, item.label]))] as const;
    })),
  ]);
  for (const [id, display] of userDisplays) lookups.userNames.set(id, display.name);
  for (const row of deptRows) lookups.deptNames.set(row.id, row.name);
  for (const row of relationRows) lookups.relationTitles.set(row.id, row.title);
  for (const [code, labels] of dictEntries) lookups.dictLabels.set(code, labels);
  return lookups;
}

async function loadUserDepartmentName(userId: number): Promise<string | null> {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true },
    with: { department: { columns: { name: true } } },
  });
  return row?.department?.name ?? null;
}

interface ResolvedLayout {
  name: string;
  content: ReportPrintContent;
  pageConfig: ReportPrintPageConfig;
}

interface DefinitionPrintConfig {
  templateId: number | null;
  settings: WorkflowPrintSettings;
}

/** 流程定义上的打印配置：绑定模板列 + flowData.settings.print（实例快照的设置随定义变化，打印按当前定义生效） */
async function loadDefinitionPrintConfig(definitionId: number): Promise<DefinitionPrintConfig> {
  const [row] = await db.select({ printTemplateId: workflowDefinitions.printTemplateId, flowData: workflowDefinitions.flowData })
    .from(workflowDefinitions).where(eq(workflowDefinitions.id, definitionId)).limit(1);
  const settings = (row?.flowData as WorkflowFlowData | null)?.settings?.print ?? {};
  return { templateId: row?.printTemplateId ?? null, settings };
}

/** 模板优先级：请求临时指定 → 流程定义绑定 → 按表单快照自动生成 */
async function resolveLayout(
  instance: WorkflowInstance,
  fields: WorkflowFormField[],
  templateId: number | null,
  sections: { includeCc: boolean; includeComments: boolean },
): Promise<ResolvedLayout> {
  if (templateId) {
    const template = await loadEntityPrintTemplate(templateId, { entityKind: 'workflow_instance', tenantId: instance.tenantId ?? null });
    const content = (template.content ?? {}) as ReportPrintContent;
    if (!content.grid && !content.sheets?.length) {
      throw new HTTPException(400, { message: '打印模板尚未设计网格，请先在设计器中保存' });
    }
    return { name: template.name, content, pageConfig: (template.pageConfig ?? {}) as ReportPrintPageConfig };
  }
  return {
    name: '审批单',
    content: generateWorkflowPrintContent(fields, sections),
    pageConfig: workflowPrintPageConfig(),
  };
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|\r\n]+/g, '_').trim() || '审批单';
}

function resolveWatermark(settings: WorkflowPrintSettings, vars: { printer: string; time: string; serialNo: string }): string | undefined {
  if (!settings.watermark) return undefined;
  const template = settings.watermarkText?.trim() || '{printer} {time}';
  return template
    .replace(/\{printer\}/g, vars.printer)
    .replace(/\{time\}/g, vars.time)
    .replace(/\{serialNo\}/g, vars.serialNo);
}

export async function renderWorkflowInstancePdf(id: number, query: WorkflowInstancePrintQueryInput = {}): Promise<WorkflowInstancePdf> {
  const instance = await getInstanceDetail(id);
  const user = currentUser();
  const fields = normalizeWorkflowFormSnapshot(instance.formSnapshot)?.fields ?? [];
  const printedAt = currentDateTime();
  const definitionPrint = await loadDefinitionPrintConfig(instance.definitionId);
  if (definitionPrint.settings.onlyWhenApproved && instance.status !== 'approved') {
    throw new HTTPException(400, { message: '该流程仅允许打印审批通过的单据' });
  }

  const [lookups, initiatorDeptName, printer, maskedFormData] = await Promise.all([
    loadPrintLookups(fields, instance.formData),
    loadUserDepartmentName(instance.initiatorId),
    loadWorkflowUserDisplays([user.userId]),
    maskFormDataForViewer(fields, instance.formData),
  ]);
  const printerName = printer.get(user.userId)?.name ?? user.username;
  const datasets = buildWorkflowPrintDatasets({
    instance: { ...instance, formData: maskedFormData },
    fields,
    lookups,
    initiatorDeptName,
    printerName,
    printedAt,
  });
  const templateId = query.templateId ?? definitionPrint.templateId;
  const layout = await resolveLayout(instance, fields, templateId, {
    includeCc: datasets.cc.length > 0,
    includeComments: datasets.comments.length > 0,
  });
  const result = renderPrintContent(layout.name, layout.content, datasets.instance, {}, layout.pageConfig, { datasets, renderedAt: printedAt });
  // pdfkit / docx 模块图大，仅打印时加载
  const { renderPrintResultToPdf } = await import('../../lib/report-print-export');
  const buffer = await renderPrintResultToPdf(result, {
    watermark: resolveWatermark(definitionPrint.settings, { printer: printerName, time: printedAt, serialNo: instance.serialNo ?? '' }),
  });
  logger.info(`[workflow-print] instance=${instance.id} template=${templateId ?? 'auto'} pages=${result.pages.length} bytes=${buffer.length} user=${user.userId}`);
  return { buffer, filename: `${sanitizeFilename(instance.serialNo || `${instance.title}-${instance.id}`)}.pdf` };
}
