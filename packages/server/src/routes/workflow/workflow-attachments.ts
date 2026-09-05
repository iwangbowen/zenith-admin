import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowAttachmentContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { uploadManagedFileFromBody } from '../../services/files/files.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

// 审批表单附件上传：面向流程发起/审批人，按工作流权限放行（system:file:upload 属于文件管理员权限，
// 普通审批角色不持有，不能复用 /api/files/upload-one）
const uploadRoute = defineContractRoute(workflowAttachmentContract.upload, {
  middleware: [authMiddleware, guard({ permission: ['workflow:instance:create', 'workflow:task:handle'], audit: { description: '上传审批表单附件', module: '工作流管理', recordBody: false } })] as const,
  handler: async (c) => {
    const body = await c.req.parseBody();
    const result = await uploadManagedFileFromBody(body.file);
    return c.json(okBody(result, '上传成功'), 200);
  },
});

router.openapiRoutes([uploadRoute] as const);

export default router;
