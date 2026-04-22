/**
 * 工作流相关 DTO
 */
import { z } from '@hono/zod-openapi';

export const WorkflowDefinitionDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    flowData: z.unknown().nullable(),
    formFields: z.unknown().nullable(),
    status: z.enum(['draft', 'published', 'disabled']),
    version: z.number().int(),
    tenantId: z.number().int().nullable(),
    createdBy: z.number().int().nullable(),
    createdByName: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('WorkflowDefinition');

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
    status: z.enum(['pending', 'approved', 'rejected', 'skipped']),
    comment: z.string().nullable(),
    actionAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('WorkflowTask');

export const WorkflowInstanceDTO = z
  .object({
    id: z.number().int(),
    definitionId: z.number().int(),
    definitionName: z.string().nullable().optional(),
    title: z.string(),
    formData: z.unknown().nullable(),
    status: z.enum(['draft', 'running', 'approved', 'rejected', 'withdrawn']),
    currentNodeKey: z.string().nullable(),
    initiatorId: z.number().int(),
    initiatorName: z.string().nullable().optional(),
    initiatorAvatar: z.string().nullable().optional(),
    tenantId: z.number().int().nullable(),
    tasks: z.array(WorkflowTaskDTO).nullable().optional(),
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
