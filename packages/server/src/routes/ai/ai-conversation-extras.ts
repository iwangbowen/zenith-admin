import { OpenAPIHono } from '@hono/zod-openapi';
import { aiConversationContract } from '@zenith/shared/ai';
import { authMiddleware } from '../../middleware/auth';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { shareConversation, getConversationShare, revokeConversationShare } from '../../services/ai/ai-share.service';
import { setConversationKnowledgeBase } from '../../services/ai/ai-knowledge.service';
import { updateConversationTags, switchConversationBranch, ensureConversationOwner } from '../../services/ai/ai-conversations.service';
import { getActiveGeneration } from '../../lib/ai/generation-buffer';

/** 会话资源的扩展能力：分享管理 + 知识库挂载 + 标签 / 分支 / 生成续传 */
const router = new OpenAPIHono({ defaultHook: validationHook });

const authed = [authMiddleware] as const;

const createShare = defineContractRoute(aiConversationContract.share, {
  middleware: authed,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { expiresDays } = c.req.valid('json');
    return c.json(okBody(await shareConversation(id, expiresDays), '已生成分享链接'), 200);
  },
});

const getShare = defineContractRoute(aiConversationContract.shareInfo, {
  middleware: authed,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getConversationShare(id)), 200);
  },
});

const revokeShare = defineContractRoute(aiConversationContract.revokeShare, {
  middleware: authed,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await revokeConversationShare(id);
    return c.json(okBody(null, '已取消分享'), 200);
  },
});

const setKb = defineContractRoute(aiConversationContract.setKnowledgeBase, {
  middleware: authed,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { kbId } = c.req.valid('json');
    await setConversationKnowledgeBase(id, kbId);
    return c.json(okBody(null, kbId ? '已挂载知识库' : '已清除知识库'), 200);
  },
});

const setTags = defineContractRoute(aiConversationContract.setTags, {
  middleware: authed,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { tags } = c.req.valid('json');
    return c.json(okBody({ tags: await updateConversationTags(id, tags) }, '标签已更新'), 200);
  },
});

const switchBranch = defineContractRoute(aiConversationContract.switchBranch, {
  middleware: authed,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { leafMsgId } = c.req.valid('json');
    const activeLeafMsgId = await switchConversationBranch(id, leafMsgId);
    return c.json(okBody({ activeLeafMsgId }), 200);
  },
});

const activeGeneration = defineContractRoute(aiConversationContract.activeGeneration, {
  middleware: authed,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await ensureConversationOwner(id);
    const genId = await getActiveGeneration(id);
    return c.json(okBody({ genId }), 200);
  },
});

router.openapiRoutes([createShare, getShare, revokeShare, setKb, setTags, switchBranch, activeGeneration] as const);

export default router;
