import { HTTPException } from 'hono/http-exception';
import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowAttachmentContract, workflowAttachmentUploadBody } from '@zenith/shared/workflow';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getWorkflowAttachmentDetail, readWorkflowAttachment, readWorkflowAttachmentUpload, uploadWorkflowAttachment } from '../../services/workflow/workflow-attachments.service';
import { readStoredFile } from '../../lib/file-storage';
import { inlineOrAttachmentDisposition } from '../../lib/content-disposition';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

// 审批表单附件上传：面向流程发起/审批人，按工作流权限放行（system:file:upload 属于文件管理员权限，
// 普通审批角色不持有，不能复用文件中心的 `fileContract.uploadOne`）
const uploadRoute = defineContractRoute(workflowAttachmentContract.upload, {
  handler: async (c) => {
    const body = await c.req.parseBody();
    const input = workflowAttachmentUploadBody.safeParse(body);
    if (!input.success) throw new HTTPException(400, { message: '上传上下文无效' });
    const result = await uploadWorkflowAttachment(input.data.file, input.data.instanceId);
    return c.json(okBody(result, '上传成功'), 200);
  },
});

async function contentResponse(source: Awaited<ReturnType<typeof readWorkflowAttachment>>) {
  const stored = await readStoredFile(source.file, source.storageConfig);
  return new Response(stored.stream, { headers: {
    'Content-Type': stored.contentType,
    'Content-Disposition': inlineOrAttachmentDisposition(stored.contentType, stored.fileName),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  } });
}

const contentRoute = defineContractRoute(workflowAttachmentContract.content, {
  handler: async (c) => contentResponse(await readWorkflowAttachment(c.req.valid('param').id)),
});
const uploadContentRoute = defineContractRoute(workflowAttachmentContract.uploadContent, {
  handler: async (c) => contentResponse(await readWorkflowAttachmentUpload(c.req.valid('param').fileId)),
});

mountCrud(router, workflowAttachmentContract, { get: getWorkflowAttachmentDetail }, {}, [uploadRoute, contentRoute, uploadContentRoute]);

export default router;
