import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import {
  ErrorResponse, jsonContent, validationHook, commonErrorResponses, ok, okBody,
} from '../../lib/openapi-schemas';
import { CmsImageUploadDTO } from '../../lib/openapi-dtos';
import { processCmsImageUpload } from '../../services/cms/cms-image.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const uploadImageRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/upload-image',
    tags: ['CMS-内容管理'], summary: '上传图片（按站点配置执行压缩/水印/缩略图）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:create', audit: { description: 'CMS 上传图片', module: 'CMS内容管理', recordBody: false } })] as const,
    request: {
      query: z.object({ siteId: z.coerce.number().int().positive() }),
      body: {
        content: {
          'multipart/form-data': {
            schema: z.object({
              file: z.any().openapi({ type: 'string', format: 'binary' }),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsImageUploadDTO, '上传成功'),
      400: { content: jsonContent(ErrorResponse), description: '未选择文件或无可用存储' },
    },
  }),
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
