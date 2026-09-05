import { OpenAPIHono } from '@hono/zod-openapi';
import { aiKnowledgeBaseContract } from '@zenith/shared/ai';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listKnowledgeBases,
  createKnowledgeBase,
  updateKnowledgeBase,
  deleteKnowledgeBase,
  listKbDocuments,
  listKbChunks,
  addKbDocument,
  importKbUrl,
  deleteKbDocument,
} from '../../services/ai/ai-knowledge.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'ai:kb:list' })] as const;
const edit = [authMiddleware, guard({ permission: 'ai:kb:edit' })] as const;

const list = defineContractRoute(aiKnowledgeBaseContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listKnowledgeBases()), 200),
});

/** 聊天页挂载选择器用：无需 kb:list 权限，仅登录即可读取自己的知识库 */
const available = defineContractRoute(aiKnowledgeBaseContract.all, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await listKnowledgeBases()), 200),
});

const create = defineContractRoute(aiKnowledgeBaseContract.create, {
  middleware: [authMiddleware, guard({ permission: 'ai:kb:create', audit: { description: '创建知识库', module: '智能助手' } })],
  handler: async (c) => c.json(okBody(await createKnowledgeBase(c.req.valid('json')), '创建成功'), 200),
});

const update = defineContractRoute(aiKnowledgeBaseContract.update, {
  middleware: edit,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateKnowledgeBase(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const remove = defineContractRoute(aiKnowledgeBaseContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'ai:kb:delete', audit: { description: '删除知识库', module: '智能助手' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteKnowledgeBase(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const listDocs = defineContractRoute(aiKnowledgeBaseContract.documents, {
  middleware: read,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listKbDocuments(id)), 200);
  },
});

const addDoc = defineContractRoute(aiKnowledgeBaseContract.addDocument, {
  middleware: edit,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await addKbDocument(id, c.req.valid('json')), '文档已入库'), 200);
  },
});

const importUrl = defineContractRoute(aiKnowledgeBaseContract.importUrl, {
  middleware: edit,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await importKbUrl(id, c.req.valid('json')), '网页已入库'), 200);
  },
});

const listChunks = defineContractRoute(aiKnowledgeBaseContract.chunks, {
  middleware: read,
  handler: async (c) => {
    const { id, docId } = c.req.valid('param');
    return c.json(okBody(await listKbChunks(id, docId)), 200);
  },
});

const removeDoc = defineContractRoute(aiKnowledgeBaseContract.removeDocument, {
  middleware: edit,
  handler: async (c) => {
    const { id, docId } = c.req.valid('param');
    await deleteKbDocument(id, docId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([list, available, create, update, remove, listDocs, addDoc, importUrl, listChunks, removeDoc] as const);

export default router;
