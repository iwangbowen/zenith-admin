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
  generateWorkflowPrintContent,
  normalizeWorkflowFormSnapshot,
  workflowPrintPageConfig,
} from '@zenith/shared/workflow';
import type { WorkflowFormField, WorkflowInstance, WorkflowInstancePrintQueryInput, WorkflowPrintLookups } from '@zenith/shared/workflow';
import { renderPrintContent } from '@zenith/shared/report';
import type { ReportPrintContent, ReportPrintPageConfig } from '@zenith/shared/report';
import { db } from '../../db';
import { departments, users, workflowDefinitions, workflowInstances } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { currentDateTime } from '../../lib/datetime';
import logger from '../../lib/logger';
import { loadEntityPrintTemplate } from '../report/report-print.service';
import { listDictItemsByCode } from '../platform/dicts.service';
import { getInstanceDetail } from './instances/queries';
import { loadWorkflowUserDisplays } from './workflow-user-helpers';

export interface WorkflowInstancePdf {
  buffer: Buffer;
  filename: string;
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

/** 模板优先级：请求临时指定 → 流程定义绑定 → 按表单快照自动生成 */
async function resolveLayout(
  instance: WorkflowInstance,
  fields: WorkflowFormField[],
  query: WorkflowInstancePrintQueryInput,
  sections: { includeCc: boolean; includeComments: boolean },
): Promise<ResolvedLayout> {
  let templateId = query.templateId ?? null;
  if (!templateId) {
    const [definition] = await db.select({ printTemplateId: workflowDefinitions.printTemplateId })
      .from(workflowDefinitions).where(eq(workflowDefinitions.id, instance.definitionId)).limit(1);
    templateId = definition?.printTemplateId ?? null;
  }
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

export async function renderWorkflowInstancePdf(id: number, query: WorkflowInstancePrintQueryInput = {}): Promise<WorkflowInstancePdf> {
  const instance = await getInstanceDetail(id);
  const user = currentUser();
  const fields = normalizeWorkflowFormSnapshot(instance.formSnapshot)?.fields ?? [];
  const printedAt = currentDateTime();

  const [lookups, initiatorDeptName, printer] = await Promise.all([
    loadPrintLookups(fields, instance.formData),
    loadUserDepartmentName(instance.initiatorId),
    loadWorkflowUserDisplays([user.userId]),
  ]);
  const datasets = buildWorkflowPrintDatasets({
    instance,
    fields,
    lookups,
    initiatorDeptName,
    printerName: printer.get(user.userId)?.name ?? user.username,
    printedAt,
  });
  const layout = await resolveLayout(instance, fields, query, {
    includeCc: datasets.cc.length > 0,
    includeComments: datasets.comments.length > 0,
  });
  const result = renderPrintContent(layout.name, layout.content, datasets.instance, {}, layout.pageConfig, { datasets, renderedAt: printedAt });
  // pdfkit / docx 模块图大，仅打印时加载
  const { renderPrintResultToPdf } = await import('../../lib/report-print-export');
  const buffer = await renderPrintResultToPdf(result);
  logger.info(`[workflow-print] instance=${instance.id} template=${query.templateId ?? 'bound/auto'} pages=${result.pages.length} bytes=${buffer.length} user=${user.userId}`);
  return { buffer, filename: `${sanitizeFilename(instance.serialNo || `${instance.title}-${instance.id}`)}.pdf` };
}
