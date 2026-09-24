import type { CmsEditorialTask, CmsFeedbackDetail, CmsFormHandlingPolicy } from '@zenith/shared/cms';
import type { WorkflowInstance } from '@zenith/shared/workflow';
import { mockCmsContents, mockCmsForms, mockCmsFormSubmissions } from './cms';
import { mockDateTime } from '../utils/date';
import { nextIdFrom } from '../utils/handlers';

export const mockCmsFeedback: CmsFeedbackDetail[] = [];
export const mockCmsEditorialTasks: CmsEditorialTask[] = [];
export const mockCmsHandlingPolicies: CmsFormHandlingPolicy[] = [];
export const mockCmsNoResultKeywords = [{ keyword: '小程序模板', count: 9 }, { keyword: '价格表', count: 5 }];
/** 归因演示从现有内容浏览量派生一次快照，可按内容和日期筛选。 */
export const mockCmsAttributionReads = mockCmsContents.filter((content) => content.viewCount > 0).map((content) => ({
  siteId: content.siteId, contentId: content.id, contentTitle: content.title, entryPath: `/${content.id}.html`,
  createdAt: mockDateTime(), count: content.viewCount, visitors: Math.max(1, Math.round(content.viewCount * 0.7)),
}));

export function appendMockCmsFeedbackHistory(row: CmsFeedbackDetail, action: string, note: string | null = null, actorName = '演示管理员') {
  const previous = row.history[0];
  row.updatedAt = mockDateTime();
  row.history.unshift({ id: nextIdFrom(mockCmsFeedback.flatMap((item) => item.history)), feedbackId: row.id, version: row.version, action, note,
    actorId: actorName === '演示管理员' ? 1 : null, actorName,
    snapshot: { status: row.status, ownerId: row.ownerId, dueAt: row.dueAt, resolution: row.resolution, workflowDefinitionId: row.workflowDefinitionId, workflowInstanceId: row.workflowInstanceId, workflowStatus: row.workflowStatus },
    previousHash: previous?.hash ?? null, hash: `demo-feedback-${row.id}-v${row.version}`, createdAt: row.updatedAt,
  });
}

/** Demo 现有提交同样进入办理台账；资料快照随后不随表单字段编辑变化。 */
export function syncMockCmsFeedbackSubmissions() {
  for (const submission of mockCmsFormSubmissions) {
    if (mockCmsFeedback.some((row) => row.submissionId === submission.id)) continue;
    const form = mockCmsForms.find((item) => item.id === submission.formId);
    if (!form) continue;
    const policy = mockCmsHandlingPolicies.find((row) => row.formId === form.id);
    const titleField = form.fields.find((field) => /title|subject|message|content/i.test(field.name));
    const title = titleField && typeof submission.data[titleField.name] === 'string' ? String(submission.data[titleField.name]).slice(0, 180) : `${form.name} #${submission.id}`;
    const row: CmsFeedbackDetail = { id: nextIdFrom(mockCmsFeedback), siteId: form.siteId, formId: form.id, submissionId: submission.id,
      title, formName: form.name, status: 'new', version: 1, ownerId: policy?.defaultOwnerId ?? null, ownerName: null, dueAt: null,
      workflowDefinitionId: policy?.workflowDefinitionId ?? null, workflowInstanceId: null, workflowStatus: null, resolution: null,
      data: structuredClone(submission.data), fields: form.fields.map(({ name, label }) => ({ name, label })), history: [],
      createdAt: submission.createdAt, updatedAt: submission.createdAt,
    };
    mockCmsFeedback.push(row);
    appendMockCmsFeedbackHistory(row, 'received', null, '读者提交');
  }
}

export function syncMockCmsFeedbackWorkflow(instance: WorkflowInstance) {
  if (instance.bizType !== 'cms_feedback') return;
  const row = mockCmsFeedback.find((item) => String(item.id) === instance.bizId);
  if (!row || row.workflowInstanceId !== instance.id || row.workflowStatus === instance.status) return;
  row.workflowStatus = instance.status;
  if (instance.status === 'approved') row.status = 'resolved';
  else if (['rejected', 'withdrawn', 'cancelled'].includes(instance.status)) row.status = 'processing';
  row.version += 1;
  appendMockCmsFeedbackHistory(row, `workflow:${instance.status}`, null, '工作流');
}
