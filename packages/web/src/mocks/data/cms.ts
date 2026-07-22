import {
  SEED_CMS_SITES, SEED_CMS_PUBLISH_CHANNELS, SEED_CMS_MODELS, SEED_CMS_CHANNELS, SEED_CMS_CONTENTS,
  SEED_CMS_TAGS, SEED_CMS_FRAGMENTS, SEED_CMS_FRIEND_LINKS,
  SEED_CMS_AD_SLOTS, SEED_CMS_ADS, SEED_CMS_FORMS, SEED_CMS_SENSITIVE_WORDS,
  SEED_CMS_ERROR_PRONE_WORDS, SEED_CMS_LINK_WORDS, SEED_CMS_COMMENTS, SEED_CMS_SURVEYS,
  SEED_CMS_RESOURCES, SEED_CMS_RESOURCE_FOLDERS, SEED_CMS_SEARCH_WORDS,
  SEED_CMS_HOTWORD_GROUPS, SEED_CMS_HOTWORDS, SEED_CMS_POLLS,
  SEED_CMS_COLLECT_RULES, SEED_CMS_COLLECT_ITEMS, SEED_CMS_PAGES,
  SEED_CMS_CONTENT_VERSIONS,
  SEED_CMS_POLL_VOTES,
} from '@zenith/shared';
import type {
  CmsSite, CmsPublishChannel, CmsModel, CmsChannel, CmsContent, CmsTag, CmsFragment, CmsFriendLink,
  CmsAdSlot, CmsAd, CmsForm, CmsFormSubmission, CmsSensitiveWord, CmsErrorProneWord, CmsLinkWord, CmsComment,
  CmsRedirect, CmsPushLog, CmsContentVersion, CmsSearchWord, CmsHotKeyword, CmsContentOpLog, CmsSurvey,
  CmsResource, CmsResourceFolder, CmsHotwordGroup, CmsCollectRule, CmsCollectItem, CmsPage, CmsPoll,
} from '@zenith/shared';

// 从共享种子数据派生（禁止重复定义静态数组）
export const mockCmsSites: CmsSite[] = SEED_CMS_SITES.map((s) => ({ ...s }));
export const mockCmsPublishChannels: CmsPublishChannel[] = SEED_CMS_PUBLISH_CHANNELS.map((c) => ({ ...c }));
export const mockCmsModels: CmsModel[] = SEED_CMS_MODELS.map((m) => ({ ...m, fields: m.fields.map((f) => ({ ...f })) }));
export const mockCmsChannels: CmsChannel[] = SEED_CMS_CHANNELS.map((c) => ({ ...c }));
export const mockCmsContents: (CmsContent & { tagIds: number[] })[] = SEED_CMS_CONTENTS.map((c) => ({ ...c, extend: { ...c.extend }, tagIds: [...c.tagIds] }));
export const mockCmsTags: CmsTag[] = SEED_CMS_TAGS.map((t) => ({ ...t }));
export const mockCmsFragments: CmsFragment[] = SEED_CMS_FRAGMENTS.map((f) => ({ ...f }));
export const mockCmsFriendLinks: CmsFriendLink[] = SEED_CMS_FRIEND_LINKS.map((l) => ({ ...l }));

function nextIdFactory(initial: number) {
  let next = initial;
  return () => next++;
}

export const getNextCmsSiteId = nextIdFactory(Math.max(0, ...mockCmsSites.map((x) => x.id)) + 1);
export const getNextCmsPublishChannelId = nextIdFactory(Math.max(0, ...mockCmsPublishChannels.map((x) => x.id)) + 1);
export const getNextCmsModelId = nextIdFactory(Math.max(0, ...mockCmsModels.map((x) => x.id)) + 1);
export const getNextCmsModelFieldId = nextIdFactory(Math.max(0, ...mockCmsModels.flatMap((m) => (m.fields ?? []).map((f) => f.id))) + 1);
export const getNextCmsChannelId = nextIdFactory(Math.max(0, ...mockCmsChannels.map((x) => x.id)) + 1);
export const getNextCmsContentId = nextIdFactory(Math.max(0, ...mockCmsContents.map((x) => x.id)) + 1);
export const getNextCmsTagId = nextIdFactory(Math.max(0, ...mockCmsTags.map((x) => x.id)) + 1);
export const getNextCmsFragmentId = nextIdFactory(Math.max(0, ...mockCmsFragments.map((x) => x.id)) + 1);
export const getNextCmsFriendLinkId = nextIdFactory(Math.max(0, ...mockCmsFriendLinks.map((x) => x.id)) + 1);

/** 栏目平铺 → 树（handler 内复用） */
export function buildMockChannelTree(list: CmsChannel[]): CmsChannel[] {
  const map = new Map<number, CmsChannel>();
  const roots: CmsChannel[] = [];
  for (const item of list) map.set(item.id, { ...item, children: [] });
  for (const item of map.values()) {
    if (item.parentId && map.has(item.parentId)) {
      map.get(item.parentId)!.children!.push(item);
    } else {
      roots.push(item);
    }
  }
  const prune = (nodes: CmsChannel[]) => {
    for (const n of nodes) {
      if (n.children && n.children.length > 0) prune(n.children);
      else delete n.children;
    }
  };
  prune(roots);
  return roots;
}

// ─── P2 ───────────────────────────────────────────────────────────────────────
export const mockCmsAdSlots: CmsAdSlot[] = SEED_CMS_AD_SLOTS.map((s) => ({ ...s, adCount: SEED_CMS_ADS.filter((a) => a.slotId === s.id).length }));
export const mockCmsAds: CmsAd[] = SEED_CMS_ADS.map((a) => ({ ...a, slotName: SEED_CMS_AD_SLOTS.find((s) => s.id === a.slotId)?.name ?? null }));
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

export const getNextCmsAdSlotId = nextIdFactory(Math.max(0, ...mockCmsAdSlots.map((x) => x.id)) + 1);
export const getNextCmsAdId = nextIdFactory(Math.max(0, ...mockCmsAds.map((x) => x.id)) + 1);
export const getNextCmsFormId = nextIdFactory(Math.max(0, ...mockCmsForms.map((x) => x.id)) + 1);
export const getNextCmsSensitiveWordId = nextIdFactory(Math.max(0, ...mockCmsSensitiveWords.map((x) => x.id)) + 1);
export const getNextCmsErrorProneWordId = nextIdFactory(Math.max(0, ...mockCmsErrorProneWords.map((x) => x.id)) + 1);
export const getNextCmsContentOpLogId = nextIdFactory(Math.max(0, ...mockCmsContentOpLogs.map((x) => x.id)) + 1);
export const getNextCmsLinkWordId = nextIdFactory(Math.max(0, ...mockCmsLinkWords.map((x) => x.id)) + 1);
export const getNextCmsCommentId = nextIdFactory(Math.max(0, ...mockCmsComments.map((x) => x.id)) + 1);
export const getNextCmsRedirectId = nextIdFactory(1);

// ─── P3 ───────────────────────────────────────────────────────────────────────
export const mockCmsSearchWords: CmsSearchWord[] = SEED_CMS_SEARCH_WORDS.map((word) => ({ ...word }));
export const mockCmsSurveys: CmsSurvey[] = SEED_CMS_SURVEYS.map((s) => ({ ...s, questions: s.questions.map((q) => ({ ...q, options: q.options.map((o) => ({ ...o })) })) }));
export const getNextCmsSurveyId = nextIdFactory(Math.max(0, ...mockCmsSurveys.map((x) => x.id)) + 1);
export const mockCmsHotwordGroups: CmsHotwordGroup[] = SEED_CMS_HOTWORD_GROUPS.map((group) => ({ ...group }));
export const mockCmsHotKeywords: CmsHotKeyword[] = SEED_CMS_HOTWORDS.map((word, index) => ({
  ...word,
  groupName: mockCmsHotwordGroups.find((group) => group.id === word.groupId)?.name ?? null,
  count: [42, 31][index] ?? 0,
}));
export const getNextCmsSearchWordId = nextIdFactory(Math.max(0, ...mockCmsSearchWords.map((x) => x.id)) + 1);
export const getNextCmsHotwordGroupId = nextIdFactory(Math.max(0, ...mockCmsHotwordGroups.map((x) => x.id)) + 1);
export const getNextCmsHotwordId = nextIdFactory(Math.max(0, ...mockCmsHotKeywords.map((x) => x.id ?? 0)) + 1);

// ─── P2 素材中心 ───────────────────────────────────────────────────────────────
export const mockCmsResources: CmsResource[] = SEED_CMS_RESOURCES.map((r) => ({ ...r }));
export const mockCmsResourceFolders: CmsResourceFolder[] = SEED_CMS_RESOURCE_FOLDERS.map((folder) => ({ ...folder }));
export const getNextCmsResourceId = nextIdFactory(Math.max(0, ...mockCmsResources.map((x) => x.id)) + 1);
export const getNextCmsResourceFolderId = nextIdFactory(Math.max(0, ...mockCmsResourceFolders.map((x) => x.id)) + 1);
export const mockCmsCollectRules: CmsCollectRule[] = SEED_CMS_COLLECT_RULES.map((rule) => ({ ...rule }));
export const mockCmsCollectItems: CmsCollectItem[] = SEED_CMS_COLLECT_ITEMS.map((item) => ({ ...item }));
export const getNextCmsCollectRuleId = nextIdFactory(Math.max(0, ...mockCmsCollectRules.map((x) => x.id)) + 1);
export const mockCmsPages: CmsPage[] = SEED_CMS_PAGES.map((page) => ({ ...page, blocks: page.blocks.map((block) => ({ ...block, props: { ...block.props } })) }));
export const getNextCmsPageId = nextIdFactory(Math.max(0, ...mockCmsPages.map((x) => x.id)) + 1);

// ─── P3 轻量投票 ───────────────────────────────────────────────────────────────
export const mockCmsPolls: CmsPoll[] = SEED_CMS_POLLS.map((p) => ({ ...p, options: p.options.map((o) => ({ ...o })) }));
export const getNextCmsPollId = nextIdFactory(Math.max(0, ...mockCmsPolls.map((x) => x.id)) + 1);
/** 选项计票（演示数据：按选项 id 递减分布） */
export const mockCmsPollVotes = new Map<number, Map<number, number>>();
for (const vote of SEED_CMS_POLL_VOTES) {
  const counts = mockCmsPollVotes.get(vote.pollId) ?? new Map<number, number>();
  for (const optionId of vote.optionIds) counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
  mockCmsPollVotes.set(vote.pollId, counts);
}
