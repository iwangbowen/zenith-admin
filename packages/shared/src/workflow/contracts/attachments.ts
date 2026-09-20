import * as z from 'zod';
import { defineContract, fileField, multipart, op } from '../../core/contract';
import { managedFileSchema } from '../../platform/contracts';
import { idParam, idQuery } from '../../core/api-schemas';

export const workflowAttachmentSchema = z.object({
  id: z.number().int().positive(),
  fileId: z.uuid(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  mimeType: z.string().nullable(),
  url: z.string(),
}).meta({ id: 'WorkflowAttachment' });
export type WorkflowAttachment = z.infer<typeof workflowAttachmentSchema>;

/**
 * 审批表单附件上传：面向流程发起 / 审批人，按工作流权限放行
 * （system:file:upload 属于文件管理员权限，普通审批角色不持有，不能复用文件中心的 `fileContract.uploadOne`）。
 */
export const workflowAttachmentUploadBody = multipart(z.object({
  file: fileField('附件文件'),
  instanceId: idQuery('所属审批实例'),
}));

export const workflowAttachmentContract = defineContract('/api/workflows/attachments', {
  detail: op.get('/{id}', { access: { permission: ['workflow:instance:list', 'workflow:task:handle', 'workflow:instance:monitor'] }, params: idParam, response: workflowAttachmentSchema, summary: '审批附件详情' }),
  upload: op.post('/', { access: { permission: ['workflow:instance:create', 'workflow:task:handle', 'workflow:instance:list'] }, audit: { description: '上传审批表单附件', recordBody: false }, body: workflowAttachmentUploadBody, response: managedFileSchema, summary: '上传审批表单附件' }),
  content: op.get('/{id}/content', { access: { permission: ['workflow:instance:list', 'workflow:task:handle', 'workflow:instance:monitor'] }, params: idParam, kind: 'file', summary: '读取有权查看的审批附件' }),
  uploadContent: op.get('/uploads/{fileId}/content', { access: { permission: ['workflow:instance:create', 'workflow:task:handle', 'workflow:instance:list'] }, params: z.object({ fileId: z.uuid() }), kind: 'file', summary: '预览本人待绑定的审批附件' }),
}, { auditModule: '工作流管理', tags: ['Workflows'] });
