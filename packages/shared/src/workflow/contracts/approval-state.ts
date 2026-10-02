import * as z from 'zod';
import {
  WORKFLOW_APPROVAL_ACTIVATION_STATUSES, WORKFLOW_APPROVAL_SLOT_ORIGINS,
  WORKFLOW_APPROVAL_SLOT_STATUSES, WORKFLOW_SIGN_GROUP_STATUSES,
  WORKFLOW_SIGN_MODES, WORKFLOW_SIGN_POSITIONS,
} from '../constants';

/** 一份正式审批意见。委派建议与回执任务始终归属于同一席位。 */
export const workflowApprovalSlotSchema = z.object({
  id: z.int(),
  activationId: z.string(),
  origin: z.enum(WORKFLOW_APPROVAL_SLOT_ORIGINS),
  groupId: z.int().nullable(),
  originalAssigneeId: z.int().nullable(),
  currentAssigneeId: z.int().nullable(),
  assigneeName: z.string().nullable(),
  status: z.enum(WORKFLOW_APPROVAL_SLOT_STATUSES),
  order: z.int().nullable(),
  mandatory: z.boolean(),
  currentTaskId: z.int().nullable(),
}).meta({ id: 'WorkflowApprovalSlot' });
export type WorkflowApprovalSlot = z.infer<typeof workflowApprovalSlotSchema>;

export const workflowSignGroupSchema = z.object({
  id: z.int(),
  activationId: z.string(),
  anchorSlotId: z.int(),
  position: z.enum(WORKFLOW_SIGN_POSITIONS),
  signMode: z.enum(WORKFLOW_SIGN_MODES),
  status: z.enum(WORKFLOW_SIGN_GROUP_STATUSES),
  createdBy: z.int().nullable(),
  createdAt: z.string(),
  canReduce: z.boolean(),
  slots: z.array(workflowApprovalSlotSchema),
}).meta({ id: 'WorkflowSignGroup' });
export type WorkflowSignGroup = z.infer<typeof workflowSignGroupSchema>;

/** 本次进入节点的基础审批策略和冻结阈值。任务行数不是计票来源。 */
export const workflowNodeActivationSchema = z.object({
  id: z.string(),
  nodeKey: z.string(),
  nodeName: z.string(),
  tokenId: z.int().nullable(),
  status: z.enum(WORKFLOW_APPROVAL_ACTIVATION_STATUSES),
  approveMethod: z.enum(['and', 'or', 'sequential', 'ratio']).nullable(),
  approveRatio: z.int().nullable(),
  baseTotal: z.int(),
  baseRequired: z.int(),
  baseApproved: z.int(),
  baseRejected: z.int(),
  baseSatisfied: z.boolean(),
  slots: z.array(workflowApprovalSlotSchema),
  signGroups: z.array(workflowSignGroupSchema),
}).meta({ id: 'WorkflowNodeActivation' });
export type WorkflowNodeActivation = z.infer<typeof workflowNodeActivationSchema>;
