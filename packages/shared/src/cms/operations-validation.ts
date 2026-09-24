import * as z from 'zod';
import { dateTimeStringSchema, partialForUpdate } from '../core/validation';
import { CMS_EDITORIAL_TASK_SOURCES, CMS_EDITORIAL_TASK_STATUSES, CMS_FEEDBACK_STATUSES } from './constants';

export const cmsAttributionContextSchema = z.object({
  contentId: z.int().positive().nullish(), releaseId: z.int().positive().nullish(), deploymentId: z.int().positive().nullish(),
  entryPath: z.string().startsWith('/').max(500), entrySource: z.string().max(128), visitorId: z.string().max(64).optional(),
});
export type CmsAttributionContext = z.infer<typeof cmsAttributionContextSchema>;

export const updateCmsFeedbackSchema = z.object({
  expectedVersion: z.int().positive(), status: z.enum(CMS_FEEDBACK_STATUSES).optional(), ownerId: z.int().positive().nullable().optional(),
  dueAt: dateTimeStringSchema.nullable().optional(), note: z.string().trim().max(5000).optional(),
}).refine((value) => value.status !== undefined || value.ownerId !== undefined || value.dueAt !== undefined || Boolean(value.note), '请填写办理意见或修改办理信息');
export const submitCmsFeedbackWorkflowSchema = z.object({ expectedVersion: z.int().positive(), note: z.string().trim().min(1).max(5000) });
export const previewCmsFeedbackWorkflowSchema = z.object({ note: z.string().trim().max(5000).optional() });
export const saveCmsFormHandlingPolicySchema = z.object({
  expectedVersion: z.int().min(0), workflowDefinitionId: z.int().positive().nullable(), defaultOwnerId: z.int().positive().nullable(),
});
export const createCmsEditorialTaskSchema = z.object({
  siteId: z.int().positive(), title: z.string().trim().min(1).max(255), description: z.string().trim().max(5000).default(''),
  source: z.enum(CMS_EDITORIAL_TASK_SOURCES).default('manual'), sourceKeyword: z.string().trim().min(1).max(64).nullable().optional(), feedbackId: z.int().positive().nullable().optional(),
  ownerId: z.int().positive().nullable().optional(), dueAt: dateTimeStringSchema.nullable().optional(), contentId: z.int().positive().nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.source === 'search' && !value.sourceKeyword) ctx.addIssue({ code: 'custom', path: ['sourceKeyword'], message: '请选择无结果搜索词' });
  if (value.source === 'submission' && !value.feedbackId) ctx.addIssue({ code: 'custom', path: ['feedbackId'], message: '请选择来信办理记录' });
  if (value.source !== 'search' && value.sourceKeyword) ctx.addIssue({ code: 'custom', path: ['sourceKeyword'], message: '来源与搜索词不一致' });
  if (value.source !== 'submission' && value.feedbackId) ctx.addIssue({ code: 'custom', path: ['feedbackId'], message: '来源与来信不一致' });
});
export const updateCmsEditorialTaskSchema = partialForUpdate(z.object({
  title: z.string().trim().min(1).max(255), description: z.string().trim().max(5000), ownerId: z.int().positive().nullable(),
  dueAt: dateTimeStringSchema.nullable(), contentId: z.int().positive().nullable(), status: z.enum(CMS_EDITORIAL_TASK_STATUSES),
})).extend({ expectedVersion: z.int().positive() });

export function canTransitionCmsFeedback(from: (typeof CMS_FEEDBACK_STATUSES)[number], to: (typeof CMS_FEEDBACK_STATUSES)[number]): boolean {
  if (from === to) return true;
  return ({ new: ['processing', 'closed'], processing: ['resolved', 'closed'], resolved: ['processing', 'closed'], closed: ['processing'] } as Record<string, readonly string[]>)[from].includes(to);
}
