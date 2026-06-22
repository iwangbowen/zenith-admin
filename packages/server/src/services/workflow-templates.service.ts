import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { workflowTemplates, workflowDefinitions, workflowForms } from '../db/schema';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../lib/context';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { formatDateTime } from '../lib/datetime';
import type {
  WorkflowTemplate, WorkflowFlowData, WorkflowFormSchema,
  CreateWorkflowTemplateInput, UpdateWorkflowTemplateInput, SaveAsTemplateInput,
} from '@zenith/shared';
import { createDefinition } from './workflow-definitions.service';
import { createWorkflowForm } from './workflow-forms.service';

type TemplateRow = typeof workflowTemplates.$inferSelect;

export function mapTemplate(row: TemplateRow): WorkflowTemplate {
  return {
    id: row.id,
    name: row.name,
    code: row.code ?? null,
    description: row.description ?? null,
    categoryName: row.categoryName ?? null,
    icon: row.icon ?? null,
    color: row.color ?? null,
    flowData: (row.flowData ?? null) as WorkflowFlowData | null,
    formSchema: (row.formSchema ?? null) as WorkflowFormSchema | null,
    sort: row.sort,
    builtin: row.builtin,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

async function ensureTemplate(id: number): Promise<TemplateRow> {
  const tc = tenantCondition(workflowTemplates, currentUser());
  const conds = [eq(workflowTemplates.id, id)];
  if (tc) conds.push(tc);
  const [row] = await db.select().from(workflowTemplates).where(and(...conds)).limit(1);
  if (!row) throw new HTTPException(404, { message: '模板不存在' });
  return row;
}

export async function listWorkflowTemplates(): Promise<WorkflowTemplate[]> {
  const tc = tenantCondition(workflowTemplates, currentUser());
  const rows = await db.select().from(workflowTemplates).where(tc)
    .orderBy(desc(workflowTemplates.builtin), asc(workflowTemplates.sort), desc(workflowTemplates.id));
  return rows.map(mapTemplate);
}

export async function createWorkflowTemplate(input: CreateWorkflowTemplateInput): Promise<WorkflowTemplate> {
  try {
    const [row] = await db.insert(workflowTemplates).values({
      name: input.name,
      code: input.code ?? null,
      description: input.description ?? null,
      categoryName: input.categoryName ?? null,
      icon: input.icon ?? null,
      color: input.color ?? null,
      flowData: input.flowData ?? null,
      formSchema: input.formSchema ?? null,
      sort: input.sort ?? 0,
      builtin: false,
      tenantId: getCreateTenantId(currentUser()),
    }).returning();
    return mapTemplate(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '模板编码已存在');
  }
}

export async function updateWorkflowTemplate(id: number, input: UpdateWorkflowTemplateInput): Promise<WorkflowTemplate> {
  await ensureTemplate(id);
  const patch: Partial<typeof workflowTemplates.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.code !== undefined) patch.code = input.code ?? null;
  if (input.description !== undefined) patch.description = input.description ?? null;
  if (input.categoryName !== undefined) patch.categoryName = input.categoryName ?? null;
  if (input.icon !== undefined) patch.icon = input.icon ?? null;
  if (input.color !== undefined) patch.color = input.color ?? null;
  if (input.flowData !== undefined) patch.flowData = input.flowData ?? null;
  if (input.formSchema !== undefined) patch.formSchema = input.formSchema ?? null;
  if (input.sort !== undefined) patch.sort = input.sort;
  try {
    const [row] = await db.update(workflowTemplates).set(patch).where(eq(workflowTemplates.id, id)).returning();
    return mapTemplate(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '模板编码已存在');
  }
}

export async function deleteWorkflowTemplate(id: number): Promise<void> {
  const row = await ensureTemplate(id);
  if (row.builtin) throw new HTTPException(400, { message: '系统内置模板不可删除' });
  await db.delete(workflowTemplates).where(eq(workflowTemplates.id, id));
}

/** 从模板克隆出一个新的流程定义（草稿）；若模板含表单则同时创建表单并绑定 */
export async function cloneTemplateToDefinition(templateId: number, input: { name?: string; categoryId?: number | null } = {}) {
  const tpl = await ensureTemplate(templateId);
  let formId: number | null = null;
  const formSchema = tpl.formSchema as WorkflowFormSchema | null;
  if (formSchema && Array.isArray(formSchema.fields) && formSchema.fields.length > 0) {
    const form = await createWorkflowForm({ name: `${tpl.name}表单`, schema: formSchema });
    formId = form.id;
  }
  return createDefinition({
    name: input.name?.trim() || tpl.name,
    description: tpl.description ?? null,
    categoryId: input.categoryId ?? null,
    flowData: tpl.flowData ?? null,
    formId,
    status: 'draft',
  });
}

/** 将现有流程定义另存为模板 */
export async function saveAsTemplate(input: SaveAsTemplateInput): Promise<WorkflowTemplate> {
  const user = currentUser();
  const tc = tenantCondition(workflowDefinitions, user);
  const conds = [eq(workflowDefinitions.id, input.definitionId)];
  if (tc) conds.push(tc);
  const [def] = await db.select().from(workflowDefinitions).where(and(...conds)).limit(1);
  if (!def) throw new HTTPException(404, { message: '流程定义不存在' });
  if (def.formType !== 'designer') {
    throw new HTTPException(400, { message: '模板库暂仅支持表单库设计器流程；自定义业务表单或业务系统主导流程请使用复制流程或导出导入复用' });
  }
  let formSchema: unknown = null;
  if (def.formId) {
    const [form] = await db.select({ schema: workflowForms.schema }).from(workflowForms).where(eq(workflowForms.id, def.formId)).limit(1);
    formSchema = form?.schema ?? null;
  }
  try {
    const [row] = await db.insert(workflowTemplates).values({
      name: input.name,
      code: input.code ?? null,
      description: input.description ?? def.description ?? null,
      categoryName: null,
      icon: input.icon ?? null,
      color: input.color ?? null,
      flowData: def.flowData ?? null,
      formSchema,
      sort: 0,
      builtin: false,
      tenantId: getCreateTenantId(user),
    }).returning();
    return mapTemplate(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '模板编码已存在');
  }
}
