import * as z from 'zod';
import { defineContract, fileField, multipart, op } from '../../core/contract';
import { managedFileSchema } from '../../platform/contracts';

/**
 * 审批表单附件上传：面向流程发起 / 审批人，按工作流权限放行
 * （system:file:upload 属于文件管理员权限，普通审批角色不持有，不能复用 /api/files/upload-one）。
 */
export const workflowAttachmentUploadBody = multipart(z.object({
  file: fileField('附件文件'),
}));

export const workflowAttachmentContract = defineContract('/api/workflows/attachments', {
  upload: op.post('/', { body: workflowAttachmentUploadBody, response: managedFileSchema, summary: '上传审批表单附件' }),
}, { tags: ['Workflows'] });
