import * as z from 'zod';
import { WORKFLOW_DEFINITION_STATUSES, WORKFLOW_FORM_TYPES, WORKFLOW_TRIGGER_TYPES } from '../constants';
import type {
  WorkflowAdvancedSettings,
  WorkflowCustomFormConfig,
  WorkflowDefinitionSnapshot,
  WorkflowEdge,
  WorkflowFlowData,
  WorkflowFormSchema,
  WorkflowInstanceFormSnapshot,
  WorkflowNodeConfig,
} from '../types';
import {
  workflowConditionGroupSchema,
  workflowCustomFormConfigSchema,
  workflowEdgeConditionSchema,
  workflowFormFieldSchema,
  workflowFormSettingsSchema,
  workflowNodeConfigSchema,
} from '../validation';

/**
 * 流程图 / 表单结构等 JSON 字段的响应 schema。
 *
 * 结构类型（WorkflowFlowData / WorkflowNodeConfig / WorkflowFormField …）由引擎运行时定义在 `../types`，
 * 这里的 schema 以它们为准描述形状供 OpenAPI 与 TS 推导；写接口对 flowData 的校验仍由 `../validation`
 * 的创建 / 更新 schema 决定。
 */

// ─── 流程图 ──────────────────────────────────────────────────────────────────

/** 节点配置：在设计器节点 schema 基础上补齐运行时扩展字段（触发器 / 外部审批 / 延迟 / 退回 / 决策） */
export const workflowNodeDataSchema: z.ZodType<WorkflowNodeConfig> = workflowNodeConfigSchema.extend({
  rejectStrategy: z.enum(['terminate', 'returnPrev', 'returnStart', 'returnToNode']).optional(),
  rejectToNodeKey: z.string().optional(),
  triggerConfig: z.object({
    triggerType: z.enum(WORKFLOW_TRIGGER_TYPES),
    connectorId: z.int().optional(),
    webhookUrl: z.string().optional(),
    httpMethod: z.enum(['GET', 'POST', 'PUT']).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    bodyTemplate: z.string().optional(),
    fieldKeys: z.array(z.string()).optional(),
    fieldValues: z.record(z.string(), z.string()).optional(),
    onFailure: z.enum(['continue', 'retry', 'block']).optional(),
    maxRetries: z.int().optional(),
    timeoutMs: z.int().optional(),
    callbackSignMode: z.enum(['none', 'hmacSha256']).optional(),
    callbackSecret: z.string().optional(),
  }).optional(),
  externalApproval: z.object({
    enabled: z.boolean(),
    connectorId: z.int().optional(),
    url: z.string(),
    secret: z.string(),
    signMode: z.enum(['hmacSha256', 'none']).optional(),
    timeoutMs: z.int().optional(),
    fallbackStrategy: z.enum(['manual', 'autoApprove', 'autoReject']).optional(),
  }).optional(),
  delayType: z.enum(['fixed', 'toDate']).optional(),
  delayValue: z.number().optional(),
  delayUnit: z.enum(['minute', 'hour', 'day']).optional(),
  targetDate: z.string().optional(),
  returnMode: z.enum(['reexecute', 'backToOrigin']).optional(),
  decisionRuleKey: z.string().nullable().optional(),
  decisionRefKind: z.enum(['table', 'scorecard', 'flow']).nullable().optional(),
}).meta({ id: 'WorkflowNodeConfig' });

export const workflowEdgeSchema: z.ZodType<WorkflowEdge> = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: z.string().optional(),
  label: z.string().optional(),
  condition: workflowEdgeConditionSchema.nullable().optional(),
  conditions: z.array(workflowConditionGroupSchema).nullable().optional(),
  isDefault: z.boolean().optional(),
  isException: z.boolean().optional(),
}).meta({ id: 'WorkflowEdge' });

export const workflowAdvancedSettingsSchema: z.ZodType<WorkflowAdvancedSettings> = z.object({
  allowWithdraw: z.boolean(),
  allowResubmit: z.boolean(),
  notifyInitiator: z.boolean(),
  approverDedupMode: z.enum(['none', 'all', 'consecutive']).optional(),
  allowComment: z.boolean().optional(),
  summaryFields: z.array(z.string()).optional(),
  serialNo: z.object({
    enabled: z.boolean(),
    mode: z.enum(['structured', 'template']).optional(),
    prefix: z.string().optional(),
    suffix: z.string().optional(),
    separator: z.string().optional(),
    dateFormat: z.enum(['none', 'YYYYMMDD', 'YYYY-MM-DD', 'YYYY/MM/DD', 'YYYYMM', 'YYYY-MM', 'YYYY', 'YY', 'YYYYMMDDHHmmss']).optional(),
    seqLength: z.int().optional(),
    seqStart: z.int().optional(),
    seqStep: z.int().optional(),
    template: z.string().optional(),
    resetPeriod: z.enum(['never', 'daily', 'monthly', 'yearly']).optional(),
  }).optional(),
  notifyChannels: z.object({
    email: z.boolean().optional(),
    sms: z.boolean().optional(),
    smsTemplateId: z.int().optional(),
  }).optional(),
}).meta({ id: 'WorkflowAdvancedSettings' });

/** React Flow 节点 + 边 + 高级设置（流程定义 / 版本 / 模板 / 快照共用） */
export const workflowFlowDataSchema: z.ZodType<WorkflowFlowData> = z.object({
  nodes: z.array(z.object({
    id: z.string(),
    type: z.string().optional(),
    position: z.object({ x: z.number(), y: z.number() }),
    data: workflowNodeDataSchema,
  })),
  edges: z.array(workflowEdgeSchema),
  process: z.record(z.string(), z.unknown()).optional().meta({ description: '钉钉 / 飞书风格流程树（新版设计器）' }),
  settings: workflowAdvancedSettingsSchema.optional(),
}).meta({ id: 'WorkflowFlowData' });

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
