import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../lib/openapi-schemas';
import { createMpMaterialSchema, updateMpMaterialSchema, MP_MATERIAL_TYPES } from '@zenith/shared';
import type { MpMaterialType } from '@zenith/shared';
import { MpMaterialDTO, MpTagSyncResultDTO } from '../lib/openapi-dtos';
import {
  listMpMaterials, createMpMaterial, updateMpMaterial, deleteMpMaterial, getMpMaterialBeforeAudit, syncMpMaterials, uploadMpMaterial,
} from '../services/mp-material.service';

const mpMaterialsRouter = new OpenAPIHono({ defaultHook: validationHook });

const syncBody = z.object({ accountId: z.number().int().positive() });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['公众号素材'], summary: '素材列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:material:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        accountId: z.coerce.number().int().positive(),
        type: z.enum(MP_MATERIAL_TYPES).optional(),
        keyword: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(MpMaterialDTO, '素材列表') },
  }),
  handler: async (c) => c.json(okBody(await listMpMaterials(c.req.valid('query'))), 200),
});

const syncRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/sync', tags: ['公众号素材'], summary: '从微信同步永久素材',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:material:sync', audit: { description: '同步公众号素材', module: '公众号素材' } })] as const,
    request: { body: { content: jsonContent(syncBody), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpTagSyncResultDTO, '同步完成') },
  }),
  handler: async (c) => c.json(okBody(await syncMpMaterials(c.req.valid('json').accountId), '同步完成'), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['公众号素材'], summary: '新增素材',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:material:create', audit: { description: '新增公众号素材', module: '公众号素材' } })] as const,
    request: { body: { content: jsonContent(createMpMaterialSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpMaterialDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createMpMaterial(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['公众号素材'], summary: '重命名素材',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:material:update', audit: { description: '更新公众号素材', module: '公众号素材' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateMpMaterialSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpMaterialDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpMaterialBeforeAudit(id));
    return c.json(okBody(await updateMpMaterial(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['公众号素材'], summary: '删除素材',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:material:delete', audit: { description: '删除公众号素材', module: '公众号素材' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpMaterialBeforeAudit(id));
    await deleteMpMaterial(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const uploadRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/upload', tags: ['公众号素材'], summary: '上传二进制素材到微信',
    description: '上传图片/语音/视频/缩略图文件到微信永久素材库，成功后登记本地素材。',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:material:create', audit: { description: '上传公众号素材', module: '公众号素材', recordBody: false } })] as const,
    request: {
      body: {
        content: {
          'multipart/form-data': {
            schema: z.object({
              accountId: z.string(),
              type: z.string(),
              name: z.string().optional(),
              title: z.string().optional(),
              introduction: z.string().optional(),
              file: z.any().openapi({ type: 'string', format: 'binary' }),
            }),
          },
        },
        required: true,
      },
    },
    responses: { ...commonErrorResponses, ...ok(MpMaterialDTO, '上传成功') },
  }),
  handler: async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw new HTTPException(400, { message: '请选择要上传的文件' });
    const accountId = Number(body.accountId);
    if (!Number.isInteger(accountId) || accountId <= 0) throw new HTTPException(400, { message: '公众号参数无效' });
    const type = String(body.type ?? '');
    if (!(MP_MATERIAL_TYPES as readonly string[]).includes(type)) throw new HTTPException(400, { message: '素材类型无效' });
    const name = body.name ? String(body.name) : '';
    const videoMeta = type === 'video'
      ? { title: body.title ? String(body.title) : (name || file.name), introduction: body.introduction ? String(body.introduction) : '' }
      : undefined;
    const result = await uploadMpMaterial(accountId, type as MpMaterialType, file, file.name, name, videoMeta);
    return c.json(okBody(result, '上传成功'), 200);
  },
});

mpMaterialsRouter.openapiRoutes([listRoute, syncRoute, uploadRoute, createRouteDef, updateRoute, deleteRoute] as const);

export default mpMaterialsRouter;
