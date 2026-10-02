import * as z from 'zod';
import { WORKFLOW_DEFINITION_STATUSES, WORKFLOW_FORM_TYPES } from '../constants';
import type {
  WorkflowCustomFormConfig,
  WorkflowDefinitionSnapshot,
  WorkflowFormSchema,
  WorkflowInstanceFormSnapshot,
} from '../types';
import {
  workflowCustomFormConfigSchema,
  workflowFormFieldSchema,
  workflowFormSettingsSchema,
} from '../validation';

export { workflowNodeDataSchema, workflowEdgeSchema, workflowAdvancedSettingsSchema, workflowFlowDataSchema } from '../graph-schema';
import { workflowFlowDataSchema } from '../graph-schema';

// ─── 表单结构 ────────────────────────────────────────────────────────────────

/** 表单 schema：字段 + 表单级设置（读侧；写侧字段默认值由 validation 的 workflowFormSchemaSchema 补齐） */
export const workflowFormSchemaShape: z.ZodType<WorkflowFormSchema> = z.object({
  fields: z.array(workflowFormFieldSchema),
  settings: workflowFormSettingsSchema.optional(),
}).meta({ id: 'WorkflowFormSchema' });

export const workflowCustomFormSchema: z.ZodType<WorkflowCustomFormConfig> = workflowCustomFormConfigSchema.meta({ id: 'WorkflowCustomFormConfig' });

/** 实例发起时冻结的表单快照 */
export const workflowInstanceFormSnapshotSchema: z.ZodType<WorkflowInstanceFormSnapshot> = z.object({
  formType: z.enum(WORKFLOW_FORM_TYPES).optional(),
  formId: z.int().nullable().optional(),
  formName: z.string().nullable().optional(),
  fields: z.array(workflowFormFieldSchema),
  settings: workflowFormSettingsSchema.nullable().optional(),
  customForm: workflowCustomFormSchema.nullable().optional(),
}).meta({ id: 'WorkflowInstanceFormSnapshot' });

/** 实例发起时冻结的流程定义快照 */
export const workflowDefinitionSnapshotSchema: z.ZodType<WorkflowDefinitionSnapshot> = z.object({
  id: z.int(),
  name: z.string(),
  description: z.string().nullable(),
  categoryId: z.int().nullable(),
  categoryName: z.string().nullable().optional(),
  categoryColor: z.string().nullable().optional(),
  categoryIcon: z.string().nullable().optional(),
  flowData: workflowFlowDataSchema.nullable(),
  formId: z.int().nullable(),
  formName: z.string().nullable().optional(),
  formFields: z.array(workflowFormFieldSchema).nullable().optional(),
  formSettings: workflowFormSettingsSchema.nullable().optional(),
  formType: z.enum(WORKFLOW_FORM_TYPES),
  customForm: workflowCustomFormSchema.nullable(),
  status: z.enum(WORKFLOW_DEFINITION_STATUSES).optional(),
  version: z.int().optional(),
  tenantId: z.int().nullable().optional(),
}).meta({ id: 'WorkflowDefinitionSnapshot' });
