import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { cmsUploadContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import { processCmsImageUpload } from '../../services/cms/cms-image.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const uploadImageRoute = defineContractRoute(cmsUploadContract.uploadImage, {
  middleware: [authMiddleware, guard({ permission: 'cms:content:create', audit: { description: 'CMS 上传图片', module: 'CMS内容管理', recordBody: false } })],
  responses: { 400: { content: jsonContent(ErrorResponse), description: '未选择文件或无可用存储' } },
  handler: async (c) => {
    const { siteId } = c.req.valid('query');
    const body = await c.req.parseBody();
    const file = body.file;
    if (!file || typeof (file as File).arrayBuffer !== 'function') {
      throw new HTTPException(400, { message: '请选择要上传的图片' });
    }
    const result = await processCmsImageUpload(file as File, siteId);
    return c.json(okBody(result, '上传成功'), 200);
  },
});

router.openapiRoutes([uploadImageRoute] as const);

export default router;
