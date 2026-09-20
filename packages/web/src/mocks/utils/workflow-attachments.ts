import { fillPath } from '@zenith/shared/core';
import { mapWorkflowFormAttachments, resolveNodeFieldPermissions, workflowAttachmentContract, workflowTaskAttachmentsSchema,
  type WorkflowAttachment, type WorkflowFormField, type WorkflowInstance } from '@zenith/shared/workflow';
import { mockWorkflowInstances, mockWorkflowTasks } from '../data/workflow';
import { currentMockSession, mockUserPermissions, type MockSession } from './auth';
import { MockHttpError } from './contract';
import { badRequest, notFound } from './handlers';
import { mockDateTime } from './date';

export interface MockWorkflowAttachmentLink extends WorkflowAttachment {
  instanceId: number; taskId: number | null; commentId: number | null; fieldKeys: string[]; sourceKey: string; createdAt: string;
}
export const mockWorkflowAttachmentUploads = new Map<string, { file: File; userId: number; tenantId: number | null }>();
export const mockWorkflowAttachmentLinks: MockWorkflowAttachmentLink[] = mockWorkflowTasks.flatMap((task) => (task.attachments ?? []).map((attachment) => ({
  ...attachment, instanceId: task.instanceId, taskId: task.id, commentId: null, fieldKeys: [], sourceKey: `task:${task.id}`, createdAt: task.createdAt,
})));
const denied = () => new MockHttpError(notFound('附件不存在或无权查看', { status: 404 }));

export function canReadMockWorkflowAttachment(request: Request, link: MockWorkflowAttachmentLink): boolean {
  return canReadMockWorkflowAttachmentForSession(currentMockSession(request), link);
}

export function canReadMockWorkflowAttachmentForSession(session: MockSession | null, link: Pick<MockWorkflowAttachmentLink, 'instanceId' | 'fieldKeys'>): boolean {
  const instance = mockWorkflowInstances.find((row) => row.id === link.instanceId);
  if (!session || !instance) return false;
  const permissions = mockUserPermissions(session.user);
  const tenantId = session.viewingTenantId ?? session.user.tenantId ?? null;
  if (tenantId != null && (instance.tenantId ?? null) !== tenantId) return false;
  if (permissions.includes('*') || permissions.includes('workflow:instance:monitor')) return true;
  const tasks = mockWorkflowTasks.filter((task) => task.instanceId === instance.id && task.assigneeId === session.user.id);
  if (instance.initiatorId !== session.user.id && !tasks.length) return false;
  const flow = instance.definitionSnapshot?.flowData;
  const views = tasks.map((task) => resolveNodeFieldPermissions(flow, task.nodeKey));
  if (instance.initiatorId === session.user.id) views.push(flow?.nodes.find((node) => node.data.type === 'start')?.data.fieldPermissions);
  return !link.fieldKeys.some((key) => views.length > 0 && views.every((view) => view?.[key] === 'hidden'));
}

export function getMockWorkflowAttachment(request: Request, id: number) {
  const link = mockWorkflowAttachmentLinks.find((row) => row.id === id);
  if (!link || !canReadMockWorkflowAttachment(request, link)) throw denied();
  return link;
}

export function bindMockWorkflowAttachments(request: Request, instanceId: number,
  source: { taskId: number } | { commentId: number } | { path: string; fieldKeys: string[] }, input: unknown): WorkflowAttachment[] {
  const parsed = workflowTaskAttachmentsSchema.safeParse(input ?? []);
  if (!parsed.success) throw new MockHttpError(badRequest('附件无效，请重新上传', { status: 400 }));
  const user = currentMockSession(request)?.user;
  if (!user && parsed.data.length) throw denied();
  const sourceKey = 'taskId' in source ? `task:${source.taskId}` : 'commentId' in source ? `comment:${source.commentId}` : `form:${source.path}`;
  return [...new Set(parsed.data.map((row) => row.fileId))].map((fileId) => {
    const existing = mockWorkflowAttachmentLinks.find((link) => link.instanceId === instanceId && link.sourceKey === sourceKey && link.fileId === fileId);
    if (existing && canReadMockWorkflowAttachment(request, existing)) return existing;
    const upload = mockWorkflowAttachmentUploads.get(fileId);
    const instance = mockWorkflowInstances.find((row) => row.id === instanceId);
    if (!upload || upload.userId !== user?.id || (instance && (instance.tenantId ?? null) !== upload.tenantId)) throw denied();
    const id = Math.max(0, ...mockWorkflowAttachmentLinks.map((row) => row.id)) + 1;
    const link: MockWorkflowAttachmentLink = { id, fileId, name: upload.file.name, size: upload.file.size, mimeType: upload.file.type || null,
      url: fillPath(workflowAttachmentContract.content.fullPath, { id }), instanceId,
      taskId: 'taskId' in source ? source.taskId : null, commentId: 'commentId' in source ? source.commentId : null,
      fieldKeys: 'fieldKeys' in source ? source.fieldKeys : [], sourceKey, createdAt: mockDateTime() };
    mockWorkflowAttachmentLinks.push(link);
    return link;
  });
}

export async function bindMockWorkflowFormAttachments(request: Request, instanceId: number, fields: WorkflowFormField[], values: Record<string, unknown>) {
  const ids = new Set<number>();
  const result = await mapWorkflowFormAttachments(fields, values, async (value, _field, path, fieldKeys) => {
    const files = bindMockWorkflowAttachments(request, instanceId, { path, fieldKeys }, value);
    for (const file of files) ids.add(file.id);
    return files;
  });
  for (let i = mockWorkflowAttachmentLinks.length - 1; i >= 0; i--) {
    const link = mockWorkflowAttachmentLinks[i];
    if (link.instanceId === instanceId && link.sourceKey.startsWith('form:') && !ids.has(link.id)) mockWorkflowAttachmentLinks.splice(i, 1);
  }
  return result;
}

export function removeMockWorkflowAttachments(instance: Pick<WorkflowInstance, 'id'>) {
  for (let i = mockWorkflowAttachmentLinks.length - 1; i >= 0; i--) if (mockWorkflowAttachmentLinks[i].instanceId === instance.id) mockWorkflowAttachmentLinks.splice(i, 1);
}
