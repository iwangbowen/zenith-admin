import type { QueryOutputOf } from '@zenith/shared/core';
/**
 * 审批单打印：实例 → PDF。
 *
 * 数据：复用 getInstanceDetail（发起人 / 参与人 / 监控权限判定与详情一致）→ 表单快照 → 引用批量解析
 * （人员 / 部门 / 字典 / 关联单）→ @zenith/shared/workflow 的 buildWorkflowPrintDatasets。
 * 版式：流程绑定的实体打印模板（报表打印设计器）→ 请求临时指定的模板 → 按表单快照自动生成。
 * 渲染：报表打印引擎 renderPrintContent → pdfkit（report-print-export 惰性加载，模块图大）。
 */
import { HTTPException } from 'hono/http-exception';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import {
  buildWorkflowPrintDatasets,
  collectWorkflowPrintLookupIds,
  emptyWorkflowPrintLookups,
  flattenWorkflowPrintLeafFields,
  generateWorkflowPrintContent,
  normalizeWorkflowFormSnapshot,
  WORKFLOW_INSTANCE_STATUS_LABELS,
  workflowInstanceContract,
  workflowPrintPageConfig,
  workflowPrintRenderParams,
} from '@zenith/shared/workflow';
import type { WorkflowFormField, WorkflowInstance, WorkflowPrintLookups, WorkflowPrintSettings } from '@zenith/shared/workflow';
import { renderPrintContent } from '@zenith/shared/report';
import type { ReportPrintContent, ReportPrintPageConfig, ReportPrintRenderResult } from '@zenith/shared/report';
import { applyMask } from '@zenith/shared/core';
import type { MaskType, SensitiveFieldRef } from '@zenith/shared/core';
import { config } from '../../config';
import { db } from '../../db';
import { departments, users, workflowInstances } from '../../db/schema';
import { currentUser, runWithCurrentUser } from '../../lib/context';
import { currentDateTime, formatDateTime } from '../../lib/datetime';
import { resolveMaskDecisions } from '../../lib/data-mask/policies';
import { registerSensitiveSource } from '../../lib/data-mask/registry';
import { readStoredFile } from '../../lib/file-storage';
import logger from '../../lib/logger';
import { SUPER_ADMIN_CODE } from '@zenith/shared/identity';
import { createSignedTokenCodec } from '../../lib/signed-token';
import type { JwtPayload } from '../../middleware/auth';
import { retainManagedFiles } from '../files/file-gc.service';
import { getRestrictedFileForRead, saveGeneratedManagedFile } from '../files/files.service';
import { loadEntityPrintTemplate } from '../report/report-print.service';
import { listDictItemsByCode } from '../platform/dicts.service';
import { getInstanceDetail } from './instances/queries';
import { loadDefinitionPrintConfig } from './workflow-print-config';
import { loadWorkflowUserDisplays } from './workflow-user-helpers';

export interface WorkflowInstancePdf {
  buffer: Buffer;
  filename: string;
  /** archive = 直接返回归档原件；live = 本次实时渲染 */
  source: 'archive' | 'live';
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

/** 表单里实际出现的 PII 字段类别（含明细子字段） */
function collectFormMaskKinds(fields: WorkflowFormField[]): Set<string> {
  const kinds = new Set<string>();
  const add = (type: string) => {
    const entry = FORM_FIELD_MASK_KINDS[type];
    if (entry) kinds.add(entry.field);
  };
  for (const field of flattenWorkflowPrintLeafFields(fields)) {
    if (field.type === 'detail') for (const child of field.children ?? []) add(child.type);
    else add(field.type);
  }
  return kinds;
}

/** 查看者对这张表单是否存在需要打码的字段（归档件是未脱敏原件，命中时不得直接下发） */
async function viewerNeedsMasking(fields: WorkflowFormField[]): Promise<boolean> {
  const kinds = collectFormMaskKinds(fields);
  if (kinds.size === 0) return false;
  const decisions = await resolveMaskDecisions(WORKFLOW_FORM_SENSITIVE_REFS);
  return decisions.some((d) => kinds.has(d.ref.field));
}

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
  templateId: number | null;
}

/** 模板优先级：请求临时指定 → 流程定义绑定 → 按表单快照自动生成 */
async function resolveLayout(
  instance: WorkflowInstance,
  fields: WorkflowFormField[],
  templateId: number | null,
  sections: { includeCc: boolean; includeComments: boolean; includeVerifyQr: boolean },
): Promise<ResolvedLayout> {
  if (templateId) {
    const template = await loadEntityPrintTemplate(templateId, { entityKind: 'workflow_instance', tenantId: instance.tenantId ?? null });
    const content = (template.content ?? {}) as ReportPrintContent;
    if (!content.grid && !content.sheets?.length) {
      throw new HTTPException(400, { message: '打印模板尚未设计网格，请先在设计器中保存' });
    }
    return { name: template.name, content, pageConfig: (template.pageConfig ?? {}) as ReportPrintPageConfig, templateId };
  }
  return {
    name: '审批单',
    content: generateWorkflowPrintContent(fields, sections),
    pageConfig: workflowPrintPageConfig(),
    templateId: null,
  };
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|\r\n]+/g, '_').trim() || '审批单';
}

function instanceFilename(instance: Pick<WorkflowInstance, 'id' | 'title' | 'serialNo'>): string {
  return `${sanitizeFilename(instance.serialNo || `${instance.title}-${instance.id}`)}.pdf`;
}

function resolveWatermark(settings: WorkflowPrintSettings, vars: { printer: string; time: string; serialNo: string }): string | undefined {
  if (!settings.watermark) return undefined;
  const template = settings.watermarkText?.trim() || '{printer} {time}';
  return template
    .replace(/\{printer\}/g, vars.printer)
    .replace(/\{time\}/g, vars.time)
    .replace(/\{serialNo\}/g, vars.serialNo);
}

// ─── 验真令牌 ─────────────────────────────────────────────────────────────────

export interface PrintVerifyPayload {
  /** 实例 ID */
  i: number;
  /** 签发时间（ms） */
  t: number;
}

/** 无状态 HMAC 令牌：只证明二维码由本系统签发；状态、归档校验值在验真页实时读取 */
const verifyCodec = createSignedTokenCodec<PrintVerifyPayload>({ purpose: 'workflow-print-verify' });

export function createPrintVerifyToken(instanceId: number): string {
  return verifyCodec.encode({ i: instanceId, t: Date.now() });
}

export function decodePrintVerifyToken(token: string): PrintVerifyPayload | null {
  const payload = verifyCodec.decode(token);
  if (!payload || !Number.isInteger(payload.i) || payload.i <= 0) return null;
  return payload;
}

export function printVerifyUrl(instanceId: number): string {
  return `${config.publicBaseUrl}${workflowInstanceContract.printVerify.fullPath.replace('{token}', createPrintVerifyToken(instanceId))}`;
}

// ─── 渲染 ─────────────────────────────────────────────────────────────────────

export interface WorkflowPrintDocument {
  result: ReportPrintRenderResult;
  watermark: string | undefined;
  filename: string;
  templateId: number | null;
  instance: WorkflowInstance;
}

interface RenderDocumentOptions {
  templateId?: number | null;
  /** 归档渲染：不打码（存证以原始值为准）、不受「仅通过后可打印」限制、打印人记为系统 */
  archive?: boolean;
  /** 调用方已通过 getInstanceDetail 加载的实例，避免重复查询 */
  instance?: WorkflowInstance;
}

/**
 * 渲染成打印引擎结果（未出 PDF）：单份打印、批量合并、归档共用。
 * 访问控制由 getInstanceDetail 承担（当前用户上下文）。
 */
export async function renderWorkflowInstancePrintDocument(id: number, options: RenderDocumentOptions = {}): Promise<WorkflowPrintDocument> {
  const instance = options.instance ?? await getInstanceDetail(id);
  const user = currentUser();
  const fields = normalizeWorkflowFormSnapshot(instance.formSnapshot)?.fields ?? [];
  const printedAt = currentDateTime();
  const definitionPrint = await loadDefinitionPrintConfig(instance.definitionId);
  if (!options.archive && definitionPrint.settings.onlyWhenApproved && instance.status !== 'approved') {
    throw new HTTPException(400, { message: '该流程仅允许打印审批通过的单据' });
  }

  const [lookups, initiatorDeptName, printer, formData] = await Promise.all([
    loadPrintLookups(fields, instance.formData),
    loadUserDepartmentName(instance.initiatorId),
    options.archive ? Promise.resolve(new Map<number, { name: string }>()) : loadWorkflowUserDisplays([user.userId]),
    options.archive ? Promise.resolve(instance.formData) : maskFormDataForViewer(fields, instance.formData),
  ]);
  const printerName = options.archive ? '系统归档' : (printer.get(user.userId)?.name ?? user.username);
  const datasets = buildWorkflowPrintDatasets({
    instance: { ...instance, formData },
    fields,
    lookups,
    initiatorDeptName,
    printerName,
    printedAt,
    verifyUrl: printVerifyUrl(instance.id),
  });
  const templateId = options.templateId ?? definitionPrint.templateId;
  const layout = await resolveLayout(instance, fields, templateId, {
    includeCc: datasets.cc.length > 0,
    includeComments: datasets.comments.length > 0,
    includeVerifyQr: true,
  });
  const result = renderPrintContent(
    layout.name, layout.content, datasets.instance,
    workflowPrintRenderParams({ printerName, printedAt }),
    layout.pageConfig, { datasets, renderedAt: printedAt },
  );
  return {
    result,
    watermark: options.archive ? undefined : resolveWatermark(definitionPrint.settings, { printer: printerName, time: printedAt, serialNo: instance.serialNo ?? '' }),
    filename: instanceFilename(instance),
    templateId: layout.templateId,
    instance,
  };
}

/** 读取归档件字节（校验 SHA-256，损坏 / 被替换即报错，不静默给出可疑文件） */
async function readArchivePdf(archive: NonNullable<WorkflowInstance['archive']>): Promise<Buffer> {
  const { file, storageConfig } = await getRestrictedFileForRead(archive.fileId);
  const stored = await readStoredFile(file, storageConfig);
  const buffer = Buffer.from(await new Response(stored.stream).arrayBuffer());
  const digest = createHash('sha256').update(buffer).digest('hex');
  if (digest !== archive.sha256) {
    throw new HTTPException(500, { message: '归档件校验值不匹配，文件可能已损坏，请联系管理员' });
  }
  return buffer;
}

/**
 * 出 PDF。source=auto 时优先归档原件（临时指定模板除外），否则实时渲染。
 * 归档件未脱敏：查看者存在脱敏字段时回退实时（打码）渲染，显式要求归档件则拒绝。
 */
export async function renderWorkflowInstancePdf(id: number, query: QueryOutputOf<typeof workflowInstanceContract.print> = {}): Promise<WorkflowInstancePdf> {
  const source = query.source ?? 'auto';
  const instance = await getInstanceDetail(id);
  const filename = instanceFilename(instance);
  if (source !== 'live' && !query.templateId) {
    if (!instance.archive) {
      if (source === 'archive') throw new HTTPException(404, { message: '该审批单尚未生成归档件' });
    } else if (await viewerNeedsMasking(normalizeWorkflowFormSnapshot(instance.formSnapshot)?.fields ?? [])) {
      if (source === 'archive') throw new HTTPException(403, { message: '当前账号对该单据存在脱敏字段，不能下载归档原件' });
    } else {
      const buffer = await readArchivePdf(instance.archive);
      logger.info(`[workflow-print] instance=${id} source=archive bytes=${buffer.length} user=${currentUser().userId}`);
      return { buffer, filename, source: 'archive' };
    }
  }
  const doc = await renderWorkflowInstancePrintDocument(id, { instance, templateId: query.templateId ?? null });
  // pdfkit / docx 模块图大，仅打印时加载
  const { renderPrintResultToPdf } = await import('../../lib/report-print-export');
  const buffer = await renderPrintResultToPdf(doc.result, { watermark: doc.watermark });
  logger.info(`[workflow-print] instance=${id} source=live template=${doc.templateId ?? 'auto'} pages=${doc.result.pages.length} bytes=${buffer.length} user=${currentUser().userId}`);
  return { buffer, filename, source: 'live' };
}

/** 批量：多份审批单合并为一个 PDF（顺序拼页，各自水印）；无权查看的实例按 403 中止整批 */
export async function renderWorkflowInstancesBatchPdf(ids: number[]): Promise<{ buffer: Buffer; count: number }> {
  const docs: WorkflowPrintDocument[] = [];
  for (const id of ids) docs.push(await renderWorkflowInstancePrintDocument(id));
  const { renderPrintDocumentsToPdf } = await import('../../lib/report-print-export');
  const buffer = await renderPrintDocumentsToPdf(docs.map((doc) => ({ result: doc.result, options: { watermark: doc.watermark } })));
  return { buffer, count: docs.length };
}

// ─── 归档 ─────────────────────────────────────────────────────────────────────

/** 归档执行身份：平台超管视角读取实例全量数据（不受参与关系 / 字段权限 / 脱敏影响），文件归属发起人 */
function archiveActor(instance: { initiatorId: number }): JwtPayload {
  return { userId: instance.initiatorId, username: 'system', roles: [SUPER_ADMIN_CODE], tenantId: null };
}

/** 生成并落盘归档件；已归档的实例幂等跳过 */
export async function archiveWorkflowInstancePrint(instanceId: number): Promise<{ archived: boolean; reason?: string }> {
  const [row] = await db.select({
    id: workflowInstances.id, initiatorId: workflowInstances.initiatorId, tenantId: workflowInstances.tenantId,
    status: workflowInstances.status, archiveFileId: workflowInstances.archiveFileId, definitionId: workflowInstances.definitionId,
  }).from(workflowInstances).where(eq(workflowInstances.id, instanceId)).limit(1);
  if (!row) return { archived: false, reason: '实例不存在' };
  if (row.archiveFileId) return { archived: false, reason: '已归档' };
  if (row.status !== 'approved' && row.status !== 'rejected') return { archived: false, reason: `状态 ${row.status} 不归档` };
  const definitionPrint = await loadDefinitionPrintConfig(row.definitionId);
  if (!definitionPrint.settings.autoArchive) return { archived: false, reason: '流程未开启自动归档' };

  const doc = await runWithCurrentUser(archiveActor(row), () => renderWorkflowInstancePrintDocument(instanceId, { archive: true }));
  const { renderPrintResultToPdf } = await import('../../lib/report-print-export');
  const buffer = await renderPrintResultToPdf(doc.result);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const file = await saveGeneratedManagedFile({
    buffer,
    filename: doc.filename,
    mimeType: 'application/pdf',
    tenantId: row.tenantId ?? null,
    createdBy: row.initiatorId,
    visibility: 'restricted',
  });
  await db.transaction(async (tx) => {
    const updated = await tx.update(workflowInstances)
      .set({ archiveFileId: file.id, archiveSha256: sha256, archiveTemplateId: doc.templateId, archivedAt: new Date() })
      .where(and(eq(workflowInstances.id, instanceId), isNull(workflowInstances.archiveFileId)))
      .returning({ id: workflowInstances.id });
    // 并发重复归档：晚到的一份不落库，交给托管文件 GC 回收孤儿对象
    if (updated.length > 0) await retainManagedFiles(tx, [file.id]);
  });
  logger.info(`[workflow-print] archived instance=${instanceId} file=${file.id} sha256=${sha256.slice(0, 12)} bytes=${buffer.length}`);
  return { archived: true };
}

// ─── 验真页数据 ───────────────────────────────────────────────────────────────

export interface PrintVerifyView {
  valid: boolean;
  title?: string;
  serialNo?: string | null;
  definitionName?: string | null;
  statusText?: string;
  createdAt?: string;
  finishedAt?: string | null;
  archive?: { sha256: string; archivedAt: string } | null;
}

/** 公开验真：只暴露单据身份与终态事实，不含表单内容与参与人 */
export async function loadPrintVerifyView(token: string): Promise<PrintVerifyView> {
  const payload = decodePrintVerifyToken(token);
  if (!payload) return { valid: false };
  const row = await db.query.workflowInstances.findFirst({
    where: eq(workflowInstances.id, payload.i),
    columns: { id: true, title: true, serialNo: true, status: true, createdAt: true, updatedAt: true, archiveSha256: true, archivedAt: true },
    with: { definition: { columns: { name: true } } },
  });
  if (!row) return { valid: false };
  const terminal = row.status === 'approved' || row.status === 'rejected' || row.status === 'withdrawn' || row.status === 'cancelled';
  return {
    valid: true,
    title: row.title,
    serialNo: row.serialNo ?? null,
    definitionName: row.definition?.name ?? null,
    statusText: WORKFLOW_INSTANCE_STATUS_LABELS[row.status] ?? row.status,
    createdAt: formatDateTime(row.createdAt),
    finishedAt: terminal ? formatDateTime(row.updatedAt) : null,
    archive: row.archiveSha256 && row.archivedAt ? { sha256: row.archiveSha256, archivedAt: formatDateTime(row.archivedAt) } : null,
  };
}
