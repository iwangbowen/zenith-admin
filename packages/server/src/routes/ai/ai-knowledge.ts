import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import {
  jsonContent,
  validationHook,
  commonErrorResponses,
  ok,
  okMsg,
  IdParam,
  okBody,
} from '../../lib/openapi-schemas';
import { AiKnowledgeBaseDTO, AiKbDocumentDTO } from '../../lib/openapi-dtos';
import {
  listKnowledgeBases,
  createKnowledgeBase,
  updateKnowledgeBase,
  deleteKnowledgeBase,
  listKbDocuments,
  addKbDocument,
  importKbUrl,
  deleteKbDocument,
} from '../../services/ai/ai-knowledge.service';
import { createAiKnowledgeBaseSchema, updateAiKnowledgeBaseSchema, addAiKbDocumentSchema, importAiKbUrlSchema } from '@zenith/shared';

const router = new OpenAPIHono({ defaultHook: validationHook });

const list = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['AI'],
    summary: '获取我的知识库列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:kb:list' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(AiKnowledgeBaseDTO), '知识库列表') },
  }),
  handler: async (c) => c.json(okBody(await listKnowledgeBases()), 200),
});

/** 聊天页挂载选择器用：无需 kb:list 权限，仅登录即可读取自己的知识库 */
const available = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/available',
    tags: ['AI'],
    summary: '获取我的知识库（聊天挂载选择器用）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(AiKnowledgeBaseDTO), '知识库列表') },
  }),
  handler: async (c) => c.json(okBody(await listKnowledgeBases()), 200),
});

const create = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['AI'],
    summary: '创建知识库',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:kb:create', audit: { description: '创建知识库', module: '智能助手' } })] as const,
    request: { body: { content: jsonContent(createAiKnowledgeBaseSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(AiKnowledgeBaseDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createKnowledgeBase(c.req.valid('json')), '创建成功'), 200),
});

const update = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['AI'],
    summary: '更新知识库',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:kb:edit' })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateAiKnowledgeBaseSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(AiKnowledgeBaseDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateKnowledgeBase(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const remove = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['AI'],
    summary: '删除知识库（级联删除文档与分块）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:kb:delete', audit: { description: '删除知识库', module: '智能助手' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteKnowledgeBase(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const listDocs = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}/documents',
    tags: ['AI'],
    summary: '获取知识库文档列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:kb:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(AiKbDocumentDTO), '文档列表') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listKbDocuments(id)), 200);
  },
});

const addDoc = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/documents',
    tags: ['AI'],
    summary: '添加文档（纯文本，自动分块与向量化）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:kb:edit' })] as const,
    request: { params: IdParam, body: { content: jsonContent(addAiKbDocumentSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(AiKbDocumentDTO, '文档已入库') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await addKbDocument(id, c.req.valid('json')), '文档已入库'), 200);
  },
});

const importUrl = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/documents/import-url',
    tags: ['AI'],
    summary: '从 URL 抓取网页正文入库',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:kb:edit' })] as const,
    request: { params: IdParam, body: { content: jsonContent(importAiKbUrlSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(AiKbDocumentDTO, '网页已入库') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await importKbUrl(id, c.req.valid('json')), '网页已入库'), 200);
  },
});

const removeDoc = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}/documents/{docId}',
    tags: ['AI'],
    summary: '删除知识库文档（级联删除分块）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:kb:edit' })] as const,
    request: { params: z.object({ id: z.coerce.number(), docId: z.coerce.number() }) },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id, docId } = c.req.valid('param');
    await deleteKbDocument(id, docId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// 路由注册
router.openapiRoutes([list, available, create, update, remove, listDocs, addDoc, importUrl, removeDoc] as const);

export default router;
