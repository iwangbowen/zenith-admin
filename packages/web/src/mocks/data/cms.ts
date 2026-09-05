import { SEED_CMS_SITES, SEED_CMS_MODELS, SEED_CMS_CHANNELS, SEED_CMS_CONTENTS, SEED_CMS_TAGS, SEED_CMS_FRIEND_LINK_GROUPS, SEED_CMS_FRIEND_LINKS, SEED_CMS_AD_SLOTS, SEED_CMS_ADS, SEED_CMS_FORMS, SEED_CMS_SENSITIVE_WORDS, SEED_CMS_ERROR_PRONE_WORDS, SEED_CMS_LINK_WORDS, SEED_CMS_COMMENTS, SEED_CMS_INTERACTIONS, SEED_CMS_INTERACTION_RESPONSES, SEED_CMS_INTERACTION_ANSWERS, SEED_CMS_SUBSCRIPTIONS, SEED_CMS_AD_EVENTS, SEED_CMS_PAGE_BLOCK_ACLS, SEED_CMS_RESOURCES, SEED_CMS_RESOURCE_FOLDERS, SEED_CMS_SEARCH_WORDS, SEED_CMS_HOTWORD_GROUPS, SEED_CMS_HOTWORDS, SEED_CMS_COLLECT_RULES, SEED_CMS_COLLECT_ITEMS, SEED_CMS_PAGES, SEED_CMS_WIDGETS, SEED_CMS_WIDGET_REFS, SEED_CMS_CONTENT_VERSIONS } from '@zenith/shared/seed';
import type { CmsSite, CmsModel, CmsChannel, CmsContent, CmsTag, CmsFriendLink, CmsFriendLinkGroup, CmsAdSlot, CmsAd, CmsAdEvent, CmsForm, CmsFormSubmission, CmsSensitiveWord, CmsErrorProneWord, CmsLinkWord, CmsComment, CmsRedirect, CmsPushLog, CmsContentVersion, CmsSearchWord, CmsHotKeyword, CmsContentOpLog, CmsInteraction, CmsInteractionAnswerDetail, CmsInteractionResponse, CmsMemberSubscription, CmsPageBlockAcl, CmsResource, CmsResourceFolder, CmsHotwordGroup, CmsCollectRule, CmsCollectItem, CmsPage, CmsOpenAppGrant, CmsWidget, CmsWidgetRef } from '@zenith/shared/cms';
import { nextIdFrom } from '@/mocks/utils/handlers';
import { buildTree } from '@zenith/shared/core';

// 从共享种子数据派生（禁止重复定义静态数组）
export const mockCmsSites: CmsSite[] = SEED_CMS_SITES.map((s) => ({ ...s }));
export const mockCmsModels: CmsModel[] = SEED_CMS_MODELS.map((m) => ({ ...m, fields: m.fields.map((f) => ({ ...f })) }));
export const mockCmsChannels: CmsChannel[] = SEED_CMS_CHANNELS.map((c) => ({ ...c }));
export const mockCmsContents: (CmsContent & { tagIds: number[] })[] = SEED_CMS_CONTENTS.map((c) => ({
  ...c,
  // coverThumb 由服务端从封面素材派生，Demo 数据不预置
  coverThumb: null,
  extend: { ...c.extend },
  tagIds: [...c.tagIds],
}));
export const mockCmsTags: CmsTag[] = SEED_CMS_TAGS.map((t) => ({ ...t }));
export const mockCmsFriendLinkGroups: CmsFriendLinkGroup[] = SEED_CMS_FRIEND_LINK_GROUPS.map((g) => ({ ...g }));
export const mockCmsFriendLinks: CmsFriendLink[] = SEED_CMS_FRIEND_LINKS.map((l) => ({
  ...l,
  groupName: SEED_CMS_FRIEND_LINK_GROUPS.find((g) => g.id === l.groupId)?.name ?? null,
}));

function nextIdFactory(initial: number) {
  let next = initial;
  return () => next++;
}

export const getNextCmsSiteId = nextIdFactory(nextIdFrom(mockCmsSites));
export const getNextCmsModelId = nextIdFactory(nextIdFrom(mockCmsModels));
export const getNextCmsModelFieldId = nextIdFactory(Math.max(0, ...mockCmsModels.flatMap((m) => (m.fields ?? []).map((f) => f.id))) + 1);
export const getNextCmsChannelId = nextIdFactory(nextIdFrom(mockCmsChannels));
export const getNextCmsContentId = nextIdFactory(nextIdFrom(mockCmsContents));
export const getNextCmsTagId = nextIdFactory(nextIdFrom(mockCmsTags));
export const getNextCmsFriendLinkId = nextIdFactory(nextIdFrom(mockCmsFriendLinks));
export const getNextCmsFriendLinkGroupId = nextIdFactory(nextIdFrom(mockCmsFriendLinkGroups));

/** 栏目平铺 → 树（handler 内复用） */
export function buildMockChannelTree(list: CmsChannel[]): CmsChannel[] {
  return buildTree(list);
}

// ─── P2 ───────────────────────────────────────────────────────────────────────
export const mockCmsAdSlots: CmsAdSlot[] = SEED_CMS_AD_SLOTS.map((s) => ({ ...s, adCount: SEED_CMS_ADS.filter((a) => a.slotId === s.id).length }));
export const mockCmsAds: CmsAd[] = SEED_CMS_ADS.map((a) => ({ ...a, slotName: SEED_CMS_AD_SLOTS.find((s) => s.id === a.slotId)?.name ?? null }));
export const mockCmsAdEvents: CmsAdEvent[] = SEED_CMS_AD_EVENTS.map((event) => ({
  ...event,
  siteName: SEED_CMS_SITES.find((site) => site.id === event.siteId)?.name ?? null,
  adName: SEED_CMS_ADS.find((ad) => ad.id === event.adId)?.name ?? null,
  slotName: SEED_CMS_AD_SLOTS.find((slot) => slot.id === event.slotId)?.name ?? null,
}));
export const mockCmsForms: (CmsForm & { submissionCount: number })[] = SEED_CMS_FORMS.map((f) => ({ ...f, fields: f.fields.map((x) => ({ ...x })), submissionCount: 1 }));
export const mockCmsFormSubmissions: CmsFormSubmission[] = [
  { id: 1, formId: 1, data: { name: '张三', phone: '13800000000', message: '想了解企业版报价' }, ip: '127.0.0.1', userAgent: null, createdAt: '2024-01-01 00:00:00' },
];
export const mockCmsSensitiveWords: CmsSensitiveWord[] = SEED_CMS_SENSITIVE_WORDS.map((w) => ({ ...w }));
export const mockCmsErrorProneWords: CmsErrorProneWord[] = SEED_CMS_ERROR_PRONE_WORDS.map((w) => ({ ...w }));
export const mockCmsLinkWords: CmsLinkWord[] = SEED_CMS_LINK_WORDS.map((w) => ({ ...w }));
export const mockCmsComments: CmsComment[] = SEED_CMS_COMMENTS.map((c) => ({ ...c, contentTitle: SEED_CMS_CONTENTS.find((x) => x.id === c.contentId)?.title ?? null }));
export const mockCmsRedirects: CmsRedirect[] = [];
export const mockCmsPushLogs: CmsPushLog[] = [];
export const mockCmsContentVersions: CmsContentVersion[] = SEED_CMS_CONTENT_VERSIONS.map((version) => ({ ...version, snapshot: { ...version.snapshot } }));
export const mockCmsContentOpLogs: CmsContentOpLog[] = [
  { id: 1, contentId: 1, action: 'created', actionLabel: '创建', detail: null, operatorId: 1, operatorName: 'admin', createdAt: '2024-01-01 09:00:00' },
  { id: 2, contentId: 1, action: 'published', actionLabel: '发布', detail: null, operatorId: 1, operatorName: 'admin', createdAt: '2024-01-01 10:00:00' },
];

export const getNextCmsAdSlotId = nextIdFactory(nextIdFrom(mockCmsAdSlots));
export const getNextCmsAdId = nextIdFactory(nextIdFrom(mockCmsAds));
export const getNextCmsAdEventId = nextIdFactory(nextIdFrom(mockCmsAdEvents));
export const getNextCmsFormId = nextIdFactory(nextIdFrom(mockCmsForms));
export const getNextCmsSensitiveWordId = nextIdFactory(nextIdFrom(mockCmsSensitiveWords));
export const getNextCmsErrorProneWordId = nextIdFactory(nextIdFrom(mockCmsErrorProneWords));
export const getNextCmsContentOpLogId = nextIdFactory(nextIdFrom(mockCmsContentOpLogs));
export const getNextCmsLinkWordId = nextIdFactory(nextIdFrom(mockCmsLinkWords));
export const getNextCmsCommentId = nextIdFactory(nextIdFrom(mockCmsComments));
export const getNextCmsRedirectId = nextIdFactory(1);

// ─── P3 ───────────────────────────────────────────────────────────────────────
export const mockCmsSearchWords: CmsSearchWord[] = SEED_CMS_SEARCH_WORDS.map((word) => ({ ...word }));
export const mockCmsInteractions: CmsInteraction[] = SEED_CMS_INTERACTIONS.map((interaction) => ({
  ...interaction,
  questions: interaction.questions.map((question) => ({
    ...question,
    options: question.options.map((option) => ({ ...option })),
  })),
}));
/** 由题目定义把选项 value 反查成文案，与服务端 loadAnswers 口径一致 */
export function buildMockAnswerDetails(
  interactionId: number,
  answers: Record<string, string | string[]>,
): CmsInteractionAnswerDetail[] {
  const questions = SEED_CMS_INTERACTIONS.find((item) => item.id === interactionId)?.questions ?? [];
  return [...questions]
    .sort((a, b) => a.sort - b.sort || a.id - b.id)
    .filter((question) => answers[String(question.id)] !== undefined)
    .map((question) => {
      const raw = answers[String(question.id)];
      const list = Array.isArray(raw) ? raw : [raw];
      const labelOf = new Map(question.options.map((option) => [option.value, option.label]));
      const values = question.type === 'text' ? list : list.map((value) => labelOf.get(value) ?? value);
      return {
        questionId: question.id,
        label: question.label,
        type: question.type,
        values,
        display: values.join('、'),
      };
    });
}

export const mockCmsInteractionResponses: CmsInteractionResponse[] = SEED_CMS_INTERACTION_RESPONSES.map((response) => {
  const answers = Object.fromEntries(
    SEED_CMS_INTERACTION_ANSWERS
      .filter((answer) => answer.responseId === response.id)
      .map((answer) => [String(answer.questionId), answer.value]),
  );
  const interaction = SEED_CMS_INTERACTIONS.find((item) => item.id === response.interactionId);
  return {
    id: response.id,
    interactionId: response.interactionId,
    interactionTitle: interaction?.title ?? '',
    kind: interaction?.kind ?? 'survey',
    memberId: response.memberId,
    memberDisplay: response.memberId ? '演***员' : '游客',
    visitorHash: response.visitorHash,
    ipHash: response.ipHash,
    answers,
    answerDetails: buildMockAnswerDetails(response.interactionId, answers),
    createdAt: response.createdAt,
  };
});
export const getNextCmsInteractionId = nextIdFactory(nextIdFrom(mockCmsInteractions));
export const getNextCmsInteractionResponseId = nextIdFactory(nextIdFrom(mockCmsInteractionResponses));
export const mockCmsSubscriptions: CmsMemberSubscription[] = SEED_CMS_SUBSCRIPTIONS.map((subscription) => ({
  ...subscription,
  memberDisplay: '演***员',
  siteName: SEED_CMS_SITES.find((site) => site.id === subscription.siteId)?.name ?? null,
}));
export const mockCmsHotwordGroups: CmsHotwordGroup[] = SEED_CMS_HOTWORD_GROUPS.map((group) => ({ ...group }));
export const mockCmsHotKeywords: CmsHotKeyword[] = SEED_CMS_HOTWORDS.map((word, index) => ({
  ...word,
  groupName: mockCmsHotwordGroups.find((group) => group.id === word.groupId)?.name ?? null,
  count: [42, 31][index] ?? 0,
}));
export const getNextCmsSearchWordId = nextIdFactory(nextIdFrom(mockCmsSearchWords));
export const getNextCmsHotwordGroupId = nextIdFactory(nextIdFrom(mockCmsHotwordGroups));
export const getNextCmsHotwordId = nextIdFactory(Math.max(0, ...mockCmsHotKeywords.map((x) => x.id ?? 0)) + 1);

// ─── P2 素材中心 ───────────────────────────────────────────────────────────────
export const mockCmsResources: CmsResource[] = SEED_CMS_RESOURCES.map((r) => ({ ...r }));
export const mockCmsResourceFolders: CmsResourceFolder[] = SEED_CMS_RESOURCE_FOLDERS.map((folder) => ({ ...folder }));
export const getNextCmsResourceId = nextIdFactory(nextIdFrom(mockCmsResources));
export const getNextCmsResourceFolderId = nextIdFactory(nextIdFrom(mockCmsResourceFolders));

/** 开放应用授权（Demo 预置一条，演示 Headless 写入的 fail-closed 边界） */
export const mockCmsOpenGrants: CmsOpenAppGrant[] = [
  {
    id: 1,
    clientId: 'demo-headless-app',
    appName: '演示开放应用',
    siteId: 1,
    siteName: SEED_CMS_SITES[0]?.name ?? null,
    channelIds: [],
    canPublish: false,
    status: 'enabled',
    remark: '仅可创建草稿并提交审核',
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
  },
];
export const getNextCmsOpenGrantId = nextIdFactory(nextIdFrom(mockCmsOpenGrants));

export const mockCmsCollectRules: CmsCollectRule[] = SEED_CMS_COLLECT_RULES.map((rule) => ({ ...rule }));
export const mockCmsCollectItems: CmsCollectItem[] = SEED_CMS_COLLECT_ITEMS.map((item) => ({ ...item }));
export const getNextCmsCollectRuleId = nextIdFactory(nextIdFrom(mockCmsCollectRules));
export const mockCmsPages: CmsPage[] = SEED_CMS_PAGES.map((page) => ({
  ...page,
  blocks: page.blocks.map((block) => ({
    ...block,
    props: { ...block.props },
    canManage: true,
    aclConfigured: SEED_CMS_PAGE_BLOCK_ACLS.some((acl) => acl.pageId === page.id && acl.blockId === block.id),
    disabledReason: null,
  })),
}));
export const mockCmsPageBlockAcls: CmsPageBlockAcl[] = SEED_CMS_PAGE_BLOCK_ACLS.map((acl) => ({
  ...acl,
  subjectName: acl.subjectType === 'role' ? '超级管理员' : '管理员',
}));
export const getNextCmsPageId = nextIdFactory(nextIdFrom(mockCmsPages));
export const mockCmsWidgets: CmsWidget[] = SEED_CMS_WIDGETS.map((widget) => ({
  ...widget,
  draftData: { items: widget.draftData.items.map((item) => ({ ...item })) },
  publishedData: widget.publishedData
    ? { items: widget.publishedData.items.map((item) => ({ ...item })) }
    : null,
}));
export const mockCmsWidgetRefs: CmsWidgetRef[] = SEED_CMS_WIDGET_REFS.map((ref) => ({
  ...ref,
  ownerName: ref.ownerType === 'page'
    ? mockCmsPages.find((page) => page.id === ref.ownerId)?.name ?? null
    : mockCmsSites.find((site) => site.id === ref.ownerId)?.name ?? null,
}));
export const getNextCmsWidgetId = nextIdFactory(nextIdFrom(mockCmsWidgets));
export const getNextCmsWidgetRefId = nextIdFactory(nextIdFrom(mockCmsWidgetRefs));
