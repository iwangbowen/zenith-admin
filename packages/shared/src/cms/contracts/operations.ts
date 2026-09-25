import * as z from 'zod';
import { auditFieldsSchema, dateRangeQuery, idParam, idQuery, keywordQuery, paginated, paginationQuery, queryEnum, requiredIdQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { workflowBusinessContextSchema, workflowBusinessPreviewSchema, WORKFLOW_INSTANCE_STATUSES } from '../../workflow';
import { CMS_ATTRIBUTION_EVENTS, CMS_EDITORIAL_TASK_SOURCES, CMS_EDITORIAL_TASK_STATUSES, CMS_FEEDBACK_STATUSES, CMS_WORKSPACE_QUEUES } from '../constants';
import { createCmsEditorialTaskSchema, previewCmsFeedbackWorkflowSchema, saveCmsFormHandlingPolicySchema, submitCmsFeedbackWorkflowSchema, updateCmsEditorialTaskSchema, updateCmsFeedbackSchema } from '../operations-validation';

export const cmsFeedbackHistorySchema = z.object({
  id: z.int(), feedbackId: z.int(), version: z.int(), action: z.string(), note: z.string().nullable(),
  actorId: z.int().nullable(), actorName: z.string().nullable(), snapshot: z.record(z.string(), z.unknown()), previousHash: z.string().nullable(), hash: z.string(), createdAt: z.string(),
}).meta({ id: 'CmsFeedbackHistory' });
export const cmsFeedbackSchema = z.object({
  id: z.int(), siteId: z.int(), formId: z.int(), submissionId: z.int(), formName: z.string(), title: z.string(),
  status: z.enum(CMS_FEEDBACK_STATUSES), version: z.int(), ownerId: z.int().nullable(), ownerName: z.string().nullable(), dueAt: z.string().nullable(),
  workflowDefinitionId: z.int().nullable(), workflowInstanceId: z.int().nullable(), workflowStatus: z.enum(WORKFLOW_INSTANCE_STATUSES).nullable(),
  resolution: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(), ...auditFieldsSchema,
}).meta({ id: 'CmsFeedback' });
export const cmsFeedbackDetailSchema = cmsFeedbackSchema.extend({ data: z.record(z.string(), z.unknown()), fields: z.array(z.object({ name: z.string(), label: z.string() })), history: z.array(cmsFeedbackHistorySchema) }).meta({ id: 'CmsFeedbackDetail' });
export type CmsFeedback = z.infer<typeof cmsFeedbackSchema>;
export type CmsFeedbackDetail = z.infer<typeof cmsFeedbackDetailSchema>;
export const cmsFormHandlingPolicySchema = z.object({ formId: z.int(), version: z.int(), workflowDefinitionId: z.int().nullable(), workflowName: z.string().nullable(), defaultOwnerId: z.int().nullable() }).meta({ id: 'CmsFormHandlingPolicy' });
export const cmsEditorialTaskSchema = z.object({
  id: z.int(), siteId: z.int(), title: z.string(), description: z.string(), source: z.enum(CMS_EDITORIAL_TASK_SOURCES), sourceKeyword: z.string().nullable(), feedbackId: z.int().nullable(),
  ownerId: z.int().nullable(), ownerName: z.string().nullable(), dueAt: z.string().nullable(), status: z.enum(CMS_EDITORIAL_TASK_STATUSES), version: z.int(),
  contentId: z.int().nullable(), contentTitle: z.string().nullable(), contentStatus: z.string().nullable(), editorialStatus: z.string().nullable(), publishedRevisionId: z.int().nullable(), hasUnpublishedChanges: z.boolean(),
  createdAt: z.string(), updatedAt: z.string(), ...auditFieldsSchema,
}).meta({ id: 'CmsEditorialTask' });
export type CmsEditorialTask = z.infer<typeof cmsEditorialTaskSchema>;
export const cmsWorkspaceItemSchema = z.object({ id: z.int(), kind: z.enum(['content', 'feedback', 'task']), title: z.string(), status: z.string(), ownerName: z.string().nullable(), dueAt: z.string().nullable(), href: z.string() }).meta({ id: 'CmsWorkspaceItem' });
export type CmsWorkspaceItem = z.infer<typeof cmsWorkspaceItemSchema>;
export type CmsFormHandlingPolicy = z.infer<typeof cmsFormHandlingPolicySchema>;
export const cmsWorkspaceSchema = paginated(cmsWorkspaceItemSchema).extend({ counters: z.array(z.object({ queue: z.enum(CMS_WORKSPACE_QUEUES), count: z.int(), available: z.boolean() })) }).meta({ id: 'CmsWorkspace' });
export const cmsAttributionSchema = z.object({
  totals: z.array(z.object({ event: z.enum(CMS_ATTRIBUTION_EVENTS), count: z.int(), visitors: z.int() })),
  journeys: z.array(z.object({ contentId: z.int().nullable(), contentTitle: z.string().nullable(), releaseId: z.int().nullable(), deploymentId: z.int().nullable(), entryPath: z.string(), source: z.string(), reads: z.int(), clicks: z.int(), downloads: z.int(), formCompletions: z.int(), voteCompletions: z.int() })),
}).meta({ id: 'CmsAttribution' });
export type CmsAttribution = z.infer<typeof cmsAttributionSchema>;
const siteScope = { siteId: requiredIdQuery() };
export const cmsOperationsContract = defineContract('/api/cms/operations', {
  assignees: op.get('/assignees', { access: { permission: ['cms:feedback:manage', 'cms:editorial-task:manage', 'cms:form:manage'] }, response: z.array(z.object({ id: z.int(), name: z.string() })), summary: 'CMS 办理可分派人员' }),
  handlingWorkflows: op.get('/handling-workflows', { access: { permission: 'cms:form:manage' }, response: z.array(z.object({ id: z.int(), name: z.string() })), summary: '已发布的 CMS 来信办理流程' }),
  workspace: op.get('/workspace', { access: { permission: ['cms:content:list', 'cms:form:list', 'cms:editorial-task:manage'] }, query: paginationQuery.extend({ ...siteScope, queue: queryEnum(CMS_WORKSPACE_QUEUES), keyword: keywordQuery('标题') }), response: cmsWorkspaceSchema, summary: '权限过滤的编辑与办理工作台' }),
  feedback: op.get('/feedback', { access: { permission: 'cms:form:list' }, query: paginationQuery.extend({ ...siteScope, formId: idQuery(), status: queryEnum(CMS_FEEDBACK_STATUSES), ownerId: idQuery(), keyword: keywordQuery('来信标题') }), response: paginated(cmsFeedbackSchema), summary: '读者反馈办理列表' }),
  feedbackDetail: op.get('/feedback/{id}', { access: { permission: 'cms:form:list' }, params: idParam, response: cmsFeedbackDetailSchema, summary: '反馈详情与不可变办理历史' }),
  handleFeedback: op.post('/feedback/{id}/handle', { access: { permission: 'cms:feedback:manage' }, audit: '办理 CMS 读者反馈', params: idParam, body: updateCmsFeedbackSchema, response: cmsFeedbackDetailSchema, summary: '按版本分派、备注与流转反馈' }),
  handlingPolicy: op.get('/forms/{id}/handling', { access: { permission: 'cms:form:list' }, params: idParam, response: cmsFormHandlingPolicySchema, summary: '表单办理分派与流程配置' }),
  saveHandlingPolicy: op.post('/forms/{id}/handling', { access: { permission: 'cms:form:manage' }, audit: '配置 CMS 表单办理策略', params: idParam, body: saveCmsFormHandlingPolicySchema, response: cmsFormHandlingPolicySchema, summary: '配置新来信的负责人及可选办理审批' }),
  workflowPreview: op.post('/feedback/{id}/workflow-preview', { access: { permission: 'cms:form:list' }, params: idParam, body: previewCmsFeedbackWorkflowSchema, response: workflowBusinessPreviewSchema, summary: '按当前办理结果预览审批链路' }),
  workflowContext: op.get('/feedback/{id}/workflow', { access: { permission: 'cms:form:list' }, params: idParam, query: z.object({ instanceId: idQuery() }), response: workflowBusinessContextSchema, summary: '办理审批当前与历史轮次' }),
  submitWorkflow: op.post('/feedback/{id}/submit', { access: { permission: 'cms:feedback:manage' }, audit: '提交 CMS 反馈办理审批', params: idParam, body: submitCmsFeedbackWorkflowSchema, response: cmsFeedbackDetailSchema, summary: '将办理结果提交现有工作流审批' }),
  approvalDetail: op.get('/feedback/{id}/approval-detail', { access: 'authenticated', params: idParam, query: z.object({ instanceId: requiredIdQuery() }), response: cmsFeedbackDetailSchema, summary: '按工作流参与者权限读取办理资料' }),
  tasks: op.get('/tasks', { access: { permission: 'cms:editorial-task:manage' }, query: paginationQuery.extend({ ...siteScope, status: queryEnum(CMS_EDITORIAL_TASK_STATUSES), ownerId: idQuery(), keyword: keywordQuery('事项标题') }), response: paginated(cmsEditorialTaskSchema), summary: '编辑事项及关联稿件发布状态' }),
  taskDetail: op.get('/tasks/{id}', { access: { permission: 'cms:editorial-task:manage' }, params: idParam, response: cmsEditorialTaskSchema, summary: '编辑事项详情' }),
  createTask: op.post('/tasks', { access: { permission: 'cms:editorial-task:manage' }, audit: '创建 CMS 编辑事项', body: createCmsEditorialTaskSchema, response: cmsEditorialTaskSchema, summary: '从来信或无结果词转为编辑事项' }),
  updateTask: op.put('/tasks/{id}', { access: { permission: 'cms:editorial-task:manage' }, audit: '更新 CMS 编辑事项', params: idParam, body: updateCmsEditorialTaskSchema, response: cmsEditorialTaskSchema, summary: '更新事项负责人、期限与稿件关系' }),
  attribution: op.get('/attribution', { access: { permission: 'cms:stat:view' }, query: z.object({ ...siteScope, ...dateRangeQuery('事件时间'), contentId: idQuery(), releaseId: idQuery(), deploymentId: idQuery() }), response: cmsAttributionSchema, summary: '内容与发布版本的入口转化归因' }),
}, { auditModule: 'CMS内容管理', tags: ['CMS-运营工作区'] });
