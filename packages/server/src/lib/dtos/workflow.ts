/**
 * 工作流相关 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

export const WorkflowCategoryDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    code: z.string().nullable(),
    icon: z.string().nullable(),
    color: z.string().nullable(),
    sort: z.number().int(),
    description: z.string().nullable(),
    tenantId: z.number().int().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('WorkflowCategory');

export const WorkflowDefinitionDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    categoryId: z.number().int().nullable(),
    initiatorScopeType: z.enum(['all', 'users', 'departments', 'roles']),
    initiatorScopeIds: z.array(z.number().int()).nullable(),
    categoryName: z.string().nullable().optional(),
    categoryColor: z.string().nullable().optional(),
    categoryIcon: z.string().nullable().optional(),
    flowData: z.unknown().nullable(),
    formFields: z.unknown().nullable(),
    status: z.enum(['draft', 'published', 'disabled']),
    version: z.number().int(),
    tenantId: z.number().int().nullable(),
    ...auditFields,
    createdByName: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('WorkflowDefinition');

export const WorkflowDefinitionVersionDTO = z
  .object({
    id: z.number().int(),
    definitionId: z.number().int(),
    version: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    flowData: z.unknown().nullable(),
    formFields: z.unknown().nullable(),
    publishedAt: z.string(),
    publishedBy: z.number().int().nullable(),
    publishedByName: z.string().nullable().optional(),
    tenantId: z.number().int().nullable(),
  })
  .openapi('WorkflowDefinitionVersion');

export const WorkflowTaskDTO = z
  .object({
    id: z.number().int(),
    instanceId: z.number().int(),
    nodeKey: z.string(),
    nodeName: z.string(),
    nodeType: z.string().nullable(),
    assigneeId: z.number().int().nullable(),
    assigneeName: z.string().nullable().optional(),
    assigneeAvatar: z.string().nullable().optional(),
    status: z.enum(['pending', 'approved', 'rejected', 'skipped', 'waiting']),
    comment: z.string().nullable(),
    actionAt: z.string().nullable(),
    originalAssigneeId: z.number().int().nullable().optional(),
    transferChain: z.array(z.number().int()).optional(),
    delegatedFromId: z.number().int().nullable().optional(),
    actionButtons: z.record(z.string(), z.object({
      enabled: z.boolean(),
      displayName: z.string().optional(),
      opinionName: z.string().optional(),
      jumpToNodeKey: z.string().optional(),
      uploadRequired: z.boolean().optional(),
    })).nullable().optional(),
    createdAt: z.string(),
  })
  .openapi('WorkflowTask');

export const WorkflowTaskUrgeDTO = z
  .object({
    id: z.number().int(),
    taskId: z.number().int(),
    instanceId: z.number().int(),
    urgerId: z.number().int().nullable(),
    urgerName: z.string().nullable(),
    message: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('WorkflowTaskUrge');

export const WorkflowInstanceDTO = z
  .object({
    id: z.number().int(),
    definitionId: z.number().int(),
    definitionName: z.string().nullable().optional(),
    categoryId: z.number().int().nullable().optional(),
    categoryName: z.string().nullable().optional(),
    title: z.string(),
    formData: z.unknown().nullable(),
    status: z.enum(['draft', 'running', 'approved', 'rejected', 'withdrawn']),
    currentNodeKey: z.string().nullable(),
    initiatorId: z.number().int(),
    initiatorName: z.string().nullable().optional(),
    initiatorAvatar: z.string().nullable().optional(),
    tenantId: z.number().int().nullable(),
    tasks: z.array(WorkflowTaskDTO).nullable().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('WorkflowInstance');

export const WorkflowInstanceListItemDTO = WorkflowInstanceDTO.omit({
  formData: true,
  tasks: true,
}).extend({ pendingTaskId: z.number().int().optional() }).openapi('WorkflowInstanceListItem');

export const WorkflowInstanceAllDTO = z
  .object({
    stats: z.record(z.string(), z.number().int()),
    list: z.array(WorkflowInstanceListItemDTO),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  })
  .openapi('WorkflowInstanceAll');

export const WorkflowAutomationDTO = z
  .object({
    id: z.number().int(),
    definitionId: z.number().int(),
    definitionName: z.string().nullable().optional(),
    name: z.string(),
    trigger: z.enum(['approved', 'rejected', 'withdrawn']),
    actions: z.array(z.unknown()),
    status: z.enum(['enabled', 'disabled']),
    sort: z.number().int(),
    tenantId: z.number().int().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('WorkflowAutomation');
