import { OpenAPIHono } from '@hono/zod-openapi';
import { aiConversationContract } from '@zenith/shared/ai';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { csvStreamBody, fileBody, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listConversations,
  createConversation,
  getConversation,
  deleteConversation,
  listMessages,
  submitMessageFeedback,
  listFeedbackMessages,
  getFeedbackContext,
  exportFeedbackMessages,
  deleteMessage,
  deleteMessageCascade,
  renameConversation,
  togglePinConversation,
  toggleArchiveConversation,
  setConversationSystemPrompt,
  updateFeedbackStatus,
  exportConversation,
} from '../../services/ai/ai-conversations.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const authed = [authMiddleware] as const;
const feedbackViewer = [authMiddleware, guard({ permission: 'ai:feedback:view' })] as const;

const list = defineContractRoute(aiConversationContract.list, {
  middleware: authed,
  handler: async (c) => {
    const { archived, keyword, tag, limit, offset } = c.req.valid('query');
    return c.json(okBody(await listConversations({ archived: archived === 'true', keyword, tag, limit, offset })), 200);
  },
});

const create = defineContractRoute(aiConversationContract.create, {
  middleware: authed,
  handler: async (c) => c.json(okBody(await createConversation(c.req.valid('json'))), 200),
});

const getOne = defineContractRoute(aiConversationContract.detail, {
  middleware: authed,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getConversation(id)), 200);
  },
});

const remove = defineContractRoute(aiConversationContract.remove, {
  middleware: authed,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteConversation(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const getMessages = defineContractRoute(aiConversationContract.messages, {
  middleware: authed,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listMessages(id)), 200);
  },
});

const submitFeedback = defineContractRoute(aiConversationContract.submitFeedback, {
  middleware: authed,
  handler: async (c) => {
    const { id, msgId } = c.req.valid('param');
    const { feedback, reason } = c.req.valid('json');
    await submitMessageFeedback(id, msgId, feedback, reason);
    return c.json(okBody(null, '反馈成功'), 200);
  },
});

/** 反馈类型查询串 '1' / '-1' → 数值 */
function parseFeedbackFilters(q: {
  feedback?: '1' | '-1';
  status?: 'pending' | 'resolved' | 'ignored';
  model?: string;
  startDate?: string;
  endDate?: string;
}) {
  return {
    feedback: q.feedback ? (Number(q.feedback) as 1 | -1) : undefined,
    status: q.status,
    model: q.model,
    startDate: q.startDate,
    endDate: q.endDate,
  };
}

const adminFeedbackList = defineContractRoute(aiConversationContract.feedbackList, {
  middleware: feedbackViewer,
  handler: async (c) => {
    const { page, pageSize, ...filters } = c.req.valid('query');
    return c.json(okBody(await listFeedbackMessages({ page, pageSize, ...parseFeedbackFilters(filters) })), 200);
  },
});

const adminFeedbackContext = defineContractRoute(aiConversationContract.feedbackContext, {
  middleware: feedbackViewer,
  handler: async (c) => {
    const { msgId } = c.req.valid('param');
    return c.json(okBody(await getFeedbackContext(msgId)), 200);
  },
});

const adminFeedbackExport = defineContractRoute(aiConversationContract.feedbackExport, {
  middleware: [authMiddleware, guard({ permission: 'ai:feedback:view', audit: { description: '导出 AI 反馈列表', module: '智能助手' } })],
  handler: async (c) => {
    const filters = c.req.valid('query');
    const { stream, filename } = await exportFeedbackMessages(parseFeedbackFilters(filters));
    return csvStreamBody(c, stream, filename);
  },
});

const updateFeedback = defineContractRoute(aiConversationContract.handleFeedback, {
  middleware: [authMiddleware, guard({ permission: 'ai:feedback:handle' })],
  handler: async (c) => {
    const { msgId } = c.req.valid('param');
    const { status, remark } = c.req.valid('json');
    await updateFeedbackStatus(msgId, status, remark);
    return c.json(okBody(null, '处理成功'), 200);
  },
});

const exportConv = defineContractRoute(aiConversationContract.exportFile, {
  middleware: authed,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { format } = c.req.valid('query');
    const { content, filename, contentType } = await exportConversation(id, format);
    return fileBody(content, filename, contentType);
  },
});

const deleteMsg = defineContractRoute(aiConversationContract.removeMessage, {
  middleware: authed,
  handler: async (c) => {
    const { id, msgId } = c.req.valid('param');
    await deleteMessage(id, msgId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const deleteMsgCascade = defineContractRoute(aiConversationContract.removeMessageCascade, {
  middleware: authed,
  handler: async (c) => {
    const { id, msgId } = c.req.valid('param');
    await deleteMessageCascade(id, msgId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const rename = defineContractRoute(aiConversationContract.rename, {
  middleware: authed,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { title } = c.req.valid('json');
    await renameConversation(id, title);
    return c.json(okBody(null, '重命名成功'), 200);
  },
});

const togglePin = defineContractRoute(aiConversationContract.pin, {
  middleware: authed,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const isPinned = await togglePinConversation(id);
    return c.json(okBody({ isPinned }), 200);
  },
});

const toggleArchive = defineContractRoute(aiConversationContract.archive, {
  middleware: authed,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const isArchived = await toggleArchiveConversation(id);
    return c.json(okBody({ isArchived }), 200);
  },
});

const setSystemPrompt = defineContractRoute(aiConversationContract.setSystemPrompt, {
  middleware: authed,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { systemPrompt } = c.req.valid('json');
    const value = await setConversationSystemPrompt(id, systemPrompt);
    return c.json(okBody({ systemPromptOverride: value }), 200);
  },
});

router.openapiRoutes([list, create, getOne, remove, getMessages, rename, togglePin, toggleArchive, setSystemPrompt, exportConv, submitFeedback, deleteMsg, deleteMsgCascade, adminFeedbackList, adminFeedbackExport, adminFeedbackContext, updateFeedback] as const);

export default router;
