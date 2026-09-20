import { mockWorkflowInstances } from '../data/workflow';
import { fillPath } from '@zenith/shared/core';
import { workflowAttachmentContract, workflowAttachmentUploadBody } from '@zenith/shared/workflow';
import { mock } from '../utils/contract';
import { currentMockSession } from '../utils/auth';
import { badRequest, notFound } from '../utils/handlers';
import { mockDateTime } from '../utils/date';
import { demoPdfResponse } from '../utils/pdf';
import { canReadMockWorkflowAttachmentForSession, getMockWorkflowAttachment, mockWorkflowAttachmentLinks, mockWorkflowAttachmentUploads } from '../utils/workflow-attachments';

const fileResponse = (file: File) => new Response(file, { headers: { 'Content-Type': file.type || 'application/octet-stream', 'Cache-Control': 'private, no-store' } });

export const workflowAttachmentHandlers = [
  mock(workflowAttachmentContract.upload, ({ body, request, ok }) => {
    const file = body.get('file');
    const session = currentMockSession(request);
    if (!(file instanceof File) || !session) return badRequest('请选择要上传的文件');
    const parsed = workflowAttachmentUploadBody.safeParse({ file, instanceId: body.get('instanceId') ?? undefined });
    if (!parsed.success) return badRequest('上传上下文无效', { status: 400 });
    const instanceId = parsed.data.instanceId;
    if (instanceId !== undefined && !canReadMockWorkflowAttachmentForSession(session, { instanceId, fieldKeys: [] })) return notFound('流程不存在', { status: 404 });
    const tenantId = instanceId === undefined ? session.viewingTenantId ?? session.user.tenantId ?? null : mockWorkflowInstances.find((instance) => instance.id === instanceId)?.tenantId ?? null;
    const id = crypto.randomUUID();
    mockWorkflowAttachmentUploads.set(id, { file, userId: session.user.id, tenantId });
    return ok({ id, originalName: file.name, size: file.size, mimeType: file.type || null, extension: file.name.split('.').pop() ?? null,
      visibility: 'restricted', directUrl: null, storageConfigId: 1, storageName: 'Demo', provider: 'local', objectKey: id,
      url: fillPath(workflowAttachmentContract.uploadContent.fullPath, { fileId: id }), createdAt: mockDateTime(), updatedAt: mockDateTime() });
  }),
  mock(workflowAttachmentContract.detail, ({ params, request, ok }) => {
    const { id, fileId, name, size, mimeType, url } = getMockWorkflowAttachment(request, params.id);
    return ok({ id, fileId, name, size, mimeType, url });
  }),
  mock(workflowAttachmentContract.content, ({ params, request }) => {
    const attachment = getMockWorkflowAttachment(request, params.id);
    const upload = mockWorkflowAttachmentUploads.get(attachment.fileId);
    return upload ? fileResponse(upload.file) : demoPdfResponse(['Workflow attachment demo'], attachment.name);
  }),
  mock(workflowAttachmentContract.uploadContent, ({ params, request }) => {
    const upload = mockWorkflowAttachmentUploads.get(params.fileId);
    if (!upload || upload.userId !== currentMockSession(request)?.user.id || mockWorkflowAttachmentLinks.some((row) => row.fileId === params.fileId)) return notFound('附件不存在', { status: 404 });
    return fileResponse(upload.file);
  }),
];
