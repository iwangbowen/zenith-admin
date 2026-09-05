import { OpenAPIHono } from '@hono/zod-openapi';
import { channelContract, channelCsContract, channelDashboardContract, channelMessageContract } from '@zenith/shared/messaging';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMyChannels, listChannelMessages, markChannelRead,
  listChannelsAdmin, createChannel, updateChannel, deleteChannel, publishToChannel,
  subscribeChannel, unsubscribeChannel, listDiscoverableChannels,
  listChannelMessageRecords, updateDeferredMessage, deleteDeferredMessage, publishDeferredMessageNow,
  estimateAudience, retractMessage, testSend,
  listChannelSubscribers, addChannelSubscribers, removeChannelSubscriber, exportChannelSubscribers,
  getChannelBeforeAudit, getChannelMessageBeforeAudit,
} from '../../services/messaging/channel.service';
import { getChannelDashboard } from '../../services/messaging/channel-dashboard.service';
import {
  listChannelTemplates, createChannelTemplate, updateChannelTemplate, deleteChannelTemplate, getChannelTemplateBeforeAudit,
} from '../../services/messaging/channel-template.service';
import {
  getChannelMenus, saveChannelMenus,
  listChannelAutoReplies, createChannelAutoReply, updateChannelAutoReply, deleteChannelAutoReply, getChannelAutoReplyBeforeAudit,
  sendUserMessage, replyAsAgent, handleSubscribeAutoReply,
  listCsChannels, listChannelConversations, listConversationMessages,
  listChannelQuickReplies, createChannelQuickReply, updateChannelQuickReply, deleteChannelQuickReply, getChannelQuickReplyBeforeAudit,
  assignConversation, resolveConversation, setConversationTags, listCsAgents,
  rateConversation, getCsPerformance, getConversationBeforeAudit,
} from '../../services/messaging/channel-cs.service';

const channelsRoute = new OpenAPIHono({ defaultHook: validationHook });

const publisher = [authMiddleware, guard({ permission: 'channel:message:publish' })] as const;
const cs = [authMiddleware, guard({ permission: 'channel:cs' })] as const;

// ─── 用户侧 ──────────────────────────────────────────────────────────────────

const listMine = defineContractRoute(channelContract.mine, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await listMyChannels()), 200),
});

const listMessages = defineContractRoute(channelContract.messages, {
  middleware: [authMiddleware],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listChannelMessages(id, page, pageSize)), 200);
  },
});

const read = defineContractRoute(channelContract.markRead, {
  middleware: [authMiddleware],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await markChannelRead(id);
    return c.json(okBody(null, '已标记已读'), 200);
  },
});

// ─── 管理后台 ────────────────────────────────────────────────────────────────

const adminList = defineContractRoute(channelContract.list, {
  middleware: [authMiddleware, guard({ permission: 'channel:channel:list' })],
  handler: async (c) => {
    const { page, pageSize, keyword } = c.req.valid('query');
    return c.json(okBody(await listChannelsAdmin(page, pageSize, keyword)), 200);
  },
});

const create = defineContractRoute(channelContract.create, {
  middleware: [authMiddleware, guard({ permission: 'channel:channel:create', audit: { description: '新建频道', module: '消息中心' } })],
  handler: async (c) => c.json(okBody(await createChannel(c.req.valid('json')), '创建成功'), 200),
});

const update = defineContractRoute(channelContract.update, {
  middleware: [authMiddleware, guard({ permission: 'channel:channel:update', audit: { description: '编辑频道', module: '消息中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChannelBeforeAudit(id));
    return c.json(okBody(await updateChannel(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const remove = defineContractRoute(channelContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'channel:channel:delete', audit: { description: '删除频道', module: '消息中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChannelBeforeAudit(id));
    await deleteChannel(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const publish = defineContractRoute(channelMessageContract.publish, {
  middleware: [authMiddleware, guard({ permission: 'channel:message:publish', audit: { description: '频道群发', module: '消息中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await publishToChannel(id, c.req.valid('json')), '已发布'), 200);
  },
});

// ─── 订阅（运营号） ───────────────────────────────────────────────────────────

const discoverable = defineContractRoute(channelContract.discoverable, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await listDiscoverableChannels(c.req.valid('query').keyword)), 200),
});

const subscribe = defineContractRoute(channelContract.subscribe, {
  middleware: [authMiddleware],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const firstTime = await subscribeChannel(id);
    if (firstTime) await handleSubscribeAutoReply(id);
    return c.json(okBody(null, '已订阅'), 200);
  },
});

const unsubscribe = defineContractRoute(channelContract.unsubscribe, {
  middleware: [authMiddleware],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await unsubscribeChannel(id);
    return c.json(okBody(null, '已退订'), 200);
  },
});

// ─── 双向消息（用户侧） ───────────────────────────────────────────────────────

const sendMessage = defineContractRoute(channelContract.send, {
  middleware: [authMiddleware],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { content } = c.req.valid('json');
    return c.json(okBody(await sendUserMessage(id, content), '已发送'), 200);
  },
});

// ─── 公众号底部菜单 ───────────────────────────────────────────────────────────

const listMenus = defineContractRoute(channelContract.menus, {
  middleware: [authMiddleware],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getChannelMenus(id)), 200);
  },
});

const saveMenus = defineContractRoute(channelContract.saveMenus, {
  middleware: [authMiddleware, guard({ permission: 'channel:menu:save', audit: { description: '保存频道菜单', module: '消息中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChannelMenus(id));
    return c.json(okBody(await saveChannelMenus(id, c.req.valid('json')), '保存成功'), 200);
  },
});

// ─── 自动回复 ─────────────────────────────────────────────────────────────────

const listAutoReplies = defineContractRoute(channelContract.autoReplies, {
  middleware: [authMiddleware, guard({ permission: 'channel:reply:list' })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listChannelAutoReplies(id)), 200);
  },
});

const createAutoReply = defineContractRoute(channelContract.createAutoReply, {
  middleware: [authMiddleware, guard({ permission: 'channel:reply:save', audit: { description: '新建自动回复', module: '消息中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await createChannelAutoReply(id, c.req.valid('json')), '创建成功'), 200);
  },
});

const updateAutoReply = defineContractRoute(channelContract.updateAutoReply, {
  middleware: [authMiddleware, guard({ permission: 'channel:reply:save', audit: { description: '编辑自动回复', module: '消息中心' } })],
  handler: async (c) => {
    const { replyId } = c.req.valid('param');
    setAuditBeforeData(c, await getChannelAutoReplyBeforeAudit(replyId));
    return c.json(okBody(await updateChannelAutoReply(replyId, c.req.valid('json')), '更新成功'), 200);
  },
});

const removeAutoReply = defineContractRoute(channelContract.removeAutoReply, {
  middleware: [authMiddleware, guard({ permission: 'channel:reply:delete', audit: { description: '删除自动回复', module: '消息中心' } })],
  handler: async (c) => {
    const { replyId } = c.req.valid('param');
    setAuditBeforeData(c, await getChannelAutoReplyBeforeAudit(replyId));
    await deleteChannelAutoReply(replyId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 客服工作台 ───────────────────────────────────────────────────────────────

const csChannels = defineContractRoute(channelCsContract.csChannels, {
  middleware: cs,
  handler: async (c) => c.json(okBody(await listCsChannels()), 200),
});

const csConversations = defineContractRoute(channelCsContract.conversations, {
  middleware: cs,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { status, assignee, keyword, tag } = c.req.valid('query');
    return c.json(okBody(await listChannelConversations(id, { status, assignee, keyword, tag })), 200);
  },
});

const csMessages = defineContractRoute(channelCsContract.conversationMessages, {
  middleware: cs,
  handler: async (c) => {
    const { id, userId } = c.req.valid('param');
    const { page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listConversationMessages(id, userId, page, pageSize)), 200);
  },
});

const csReply = defineContractRoute(channelCsContract.reply, {
  middleware: [authMiddleware, guard({ permission: 'channel:cs', audit: { description: '客服回复', module: '消息中心' } })],
  handler: async (c) => {
    const { id, userId } = c.req.valid('param');
    const { content } = c.req.valid('json');
    return c.json(okBody(await replyAsAgent(id, userId, content), '已回复'), 200);
  },
});

// ─── 群发消息记录管理（草稿 / 定时 / 已发） ────────────────────────────────────

const adminMessages = defineContractRoute(channelMessageContract.adminMessages, {
  middleware: publisher,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { page, pageSize, status } = c.req.valid('query');
    return c.json(okBody(await listChannelMessageRecords(id, page, pageSize, status)), 200);
  },
});

const updateDraft = defineContractRoute(channelMessageContract.updateDraft, {
  middleware: [authMiddleware, guard({ permission: 'channel:message:publish', audit: { description: '编辑草稿消息', module: '消息中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChannelMessageBeforeAudit(id));
    return c.json(okBody(await updateDeferredMessage(id, c.req.valid('json')), '已保存'), 200);
  },
});

const deleteDraft = defineContractRoute(channelMessageContract.removeDraft, {
  middleware: [authMiddleware, guard({ permission: 'channel:message:publish', audit: { description: '删除草稿消息', module: '消息中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChannelMessageBeforeAudit(id));
    await deleteDeferredMessage(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

const publishDraftNow = defineContractRoute(channelMessageContract.publishDraftNow, {
  middleware: [authMiddleware, guard({ permission: 'channel:message:publish', audit: { description: '立即发送草稿', module: '消息中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChannelMessageBeforeAudit(id));
    return c.json(okBody(await publishDeferredMessageNow(id), '已发送'), 200);
  },
});

const retract = defineContractRoute(channelMessageContract.retract, {
  middleware: [authMiddleware, guard({ permission: 'channel:message:publish', audit: { description: '撤回消息', module: '消息中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChannelMessageBeforeAudit(id));
    await retractMessage(id);
    setAuditAfterData(c, await getChannelMessageBeforeAudit(id));
    return c.json(okBody(null, '已撤回'), 200);
  },
});

const dashboard = defineContractRoute(channelDashboardContract.dashboard, {
  middleware: [authMiddleware, guard({ permission: 'channel:dashboard' })],
  handler: async (c) => c.json(okBody(await getChannelDashboard()), 200),
});

// ─── 订阅者管理 ───────────────────────────────────────────────────────────────

const subscribers = defineContractRoute(channelContract.subscribers, {
  middleware: [authMiddleware, guard({ permission: 'channel:channel:list' })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { page, pageSize, keyword } = c.req.valid('query');
    return c.json(okBody(await listChannelSubscribers(id, page, pageSize, keyword)), 200);
  },
});

const addSubscribers = defineContractRoute(channelContract.addSubscribers, {
  middleware: [authMiddleware, guard({ permission: 'channel:channel:update', audit: { description: '添加订阅者', module: '消息中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await exportChannelSubscribers(id));
    await addChannelSubscribers(id, c.req.valid('json').userIds);
    setAuditAfterData(c, await exportChannelSubscribers(id));
    return c.json(okBody(null, '已添加'), 200);
  },
});

const removeSubscriber = defineContractRoute(channelContract.removeSubscriber, {
  middleware: [authMiddleware, guard({ permission: 'channel:channel:update', audit: { description: '移除订阅者', module: '消息中心' } })],
  handler: async (c) => {
    const { id, userId } = c.req.valid('param');
    setAuditBeforeData(c, await exportChannelSubscribers(id));
    await removeChannelSubscriber(id, userId);
    setAuditAfterData(c, await exportChannelSubscribers(id));
    return c.json(okBody(null, '已移除'), 200);
  },
});

// ─── 群发消息模板 ─────────────────────────────────────────────────────────────

const listTemplates = defineContractRoute(channelMessageContract.templates, {
  middleware: publisher,
  handler: async (c) => c.json(okBody(await listChannelTemplates()), 200),
});

const createTemplate = defineContractRoute(channelMessageContract.createTemplate, {
  middleware: [authMiddleware, guard({ permission: 'channel:message:publish', audit: { description: '新建群发模板', module: '消息中心' } })],
  handler: async (c) => c.json(okBody(await createChannelTemplate(c.req.valid('json')), '已创建'), 200),
});

const updateTemplate = defineContractRoute(channelMessageContract.updateTemplate, {
  middleware: [authMiddleware, guard({ permission: 'channel:message:publish', audit: { description: '编辑群发模板', module: '消息中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChannelTemplateBeforeAudit(id));
    return c.json(okBody(await updateChannelTemplate(id, c.req.valid('json')), '已保存'), 200);
  },
});

const removeTemplate = defineContractRoute(channelMessageContract.removeTemplate, {
  middleware: [authMiddleware, guard({ permission: 'channel:message:publish', audit: { description: '删除群发模板', module: '消息中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChannelTemplateBeforeAudit(id));
    await deleteChannelTemplate(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

const testSendRoute = defineContractRoute(channelMessageContract.testSend, {
  middleware: [authMiddleware, guard({
    permission: 'channel:message:publish',
    audit: { description: '测试发送频道消息', module: '消息中心' },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await testSend(id, c.req.valid('json')), '已发送测试，请在消息中心查看'), 200);
  },
});

// ─── 会话评价 / 客服绩效 ───────────────────────────────────────────────────────

const rateConv = defineContractRoute(channelContract.rate, {
  middleware: [authMiddleware],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { rating, comment } = c.req.valid('json');
    await rateConversation(id, rating, comment ?? null);
    return c.json(okBody(null, '感谢您的评价'), 200);
  },
});

const csPerformance = defineContractRoute(channelCsContract.csPerformance, {
  middleware: cs,
  handler: async (c) => c.json(okBody(await getCsPerformance()), 200),
});

const listQuickReplies = defineContractRoute(channelCsContract.quickReplies, {
  middleware: cs,
  handler: async (c) => c.json(okBody(await listChannelQuickReplies(c.req.valid('query').channelId)), 200),
});

const createQuickReply = defineContractRoute(channelCsContract.createQuickReply, {
  middleware: [authMiddleware, guard({ permission: 'channel:cs', audit: { description: '新建快捷回复', module: '消息中心' } })],
  handler: async (c) => c.json(okBody(await createChannelQuickReply(c.req.valid('json')), '已创建'), 200),
});

const updateQuickReply = defineContractRoute(channelCsContract.updateQuickReply, {
  middleware: [authMiddleware, guard({ permission: 'channel:cs', audit: { description: '编辑快捷回复', module: '消息中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChannelQuickReplyBeforeAudit(id));
    return c.json(okBody(await updateChannelQuickReply(id, c.req.valid('json')), '已保存'), 200);
  },
});

const deleteQuickReply = defineContractRoute(channelCsContract.removeQuickReply, {
  middleware: [authMiddleware, guard({ permission: 'channel:cs', audit: { description: '删除快捷回复', module: '消息中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChannelQuickReplyBeforeAudit(id));
    await deleteChannelQuickReply(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

// ─── 客服会话治理（指派/转接 · 解决 · 标签 · 客服列表） ─────────────────────────

const csAgents = defineContractRoute(channelCsContract.csAgents, {
  middleware: cs,
  handler: async (c) => c.json(okBody(await listCsAgents()), 200),
});

const csAssign = defineContractRoute(channelCsContract.assign, {
  middleware: [authMiddleware, guard({ permission: 'channel:cs', audit: { description: '指派会话', module: '消息中心' } })],
  handler: async (c) => {
    const { id, userId } = c.req.valid('param');
    const before = await getConversationBeforeAudit(id, userId);
    if (before) setAuditBeforeData(c, before);
    await assignConversation(id, userId, c.req.valid('json').assigneeId);
    const after = await getConversationBeforeAudit(id, userId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, '已指派'), 200);
  },
});

const csResolve = defineContractRoute(channelCsContract.resolve, {
  middleware: [authMiddleware, guard({ permission: 'channel:cs', audit: { description: '解决会话', module: '消息中心' } })],
  handler: async (c) => {
    const { id, userId } = c.req.valid('param');
    const before = await getConversationBeforeAudit(id, userId);
    if (before) setAuditBeforeData(c, before);
    await resolveConversation(id, userId);
    const after = await getConversationBeforeAudit(id, userId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, '已解决'), 200);
  },
});

const csTags = defineContractRoute(channelCsContract.setTags, {
  middleware: [authMiddleware, guard({ permission: 'channel:cs', audit: { description: '设置会话标签', module: '消息中心' } })],
  handler: async (c) => {
    const { id, userId } = c.req.valid('param');
    const before = await getConversationBeforeAudit(id, userId);
    if (before) setAuditBeforeData(c, before);
    await setConversationTags(id, userId, c.req.valid('json').tags);
    const after = await getConversationBeforeAudit(id, userId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, '已保存'), 200);
  },
});

// ─── 群发受众预估 ─────────────────────────────────────────────────────────────

const audienceEstimate = defineContractRoute(channelMessageContract.audienceEstimate, {
  middleware: publisher,
  handler: async (c) => c.json(okBody({ count: await estimateAudience(c.req.valid('json').audience) }), 200),
});

// 单批 openapiRoutes 超过约 30 条会触发 TS2589，按主题分三批注册
channelsRoute.openapiRoutes([
  listMine, listMessages, read, adminList, create, update, remove, publish, discoverable, subscribe, unsubscribe,
  sendMessage, listMenus, saveMenus,
  listAutoReplies, createAutoReply, updateAutoReply, removeAutoReply,
] as const);
channelsRoute.openapiRoutes([
  adminMessages, updateDraft, deleteDraft, publishDraftNow, retract, audienceEstimate, dashboard,
  subscribers, addSubscribers, removeSubscriber,
  listTemplates, createTemplate, updateTemplate, removeTemplate, testSendRoute, rateConv, csPerformance,
] as const);
channelsRoute.openapiRoutes([
  listQuickReplies, createQuickReply, updateQuickReply, deleteQuickReply,
  csChannels, csAgents, csConversations, csMessages, csReply, csAssign, csResolve, csTags,
] as const);

export default channelsRoute;
