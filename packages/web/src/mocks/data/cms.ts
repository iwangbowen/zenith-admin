import {
  SEED_CMS_SITES, SEED_CMS_PUBLISH_CHANNELS, SEED_CMS_MODELS, SEED_CMS_CHANNELS, SEED_CMS_CONTENTS,
  SEED_CMS_TAGS, SEED_CMS_FRAGMENTS, SEED_CMS_FRIEND_LINKS,
  SEED_CMS_AD_SLOTS, SEED_CMS_ADS, SEED_CMS_FORMS, SEED_CMS_SENSITIVE_WORDS,
  SEED_CMS_ERROR_PRONE_WORDS, SEED_CMS_LINK_WORDS, SEED_CMS_COMMENTS, SEED_CMS_SURVEYS,
  SEED_CMS_RESOURCES, SEED_CMS_POLLS,
} from '@zenith/shared';
import type {
  CmsSite, CmsPublishChannel, CmsModel, CmsChannel, CmsContent, CmsTag, CmsFragment, CmsFriendLink,
  CmsAdSlot, CmsAd, CmsForm, CmsFormSubmission, CmsSensitiveWord, CmsErrorProneWord, CmsLinkWord, CmsComment,
  CmsRedirect, CmsPushLog, CmsContentVersion, CmsSearchWord, CmsHotKeyword, CmsContentOpLog, CmsSurvey,
  CmsResource, CmsPoll,
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
export const mockCmsContentVersions: CmsContentVersion[] = [];
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
export const mockCmsSearchWords: CmsSearchWord[] = [
  { id: 1, word: '云原生', weight: 100, status: 'enabled', remark: '技术词', createdAt: '2024-01-01 00:00:00', updatedAt: '2024-01-01 00:00:00' },
  { id: 2, word: '低代码', weight: 100, status: 'enabled', remark: null, createdAt: '2024-01-01 00:00:00', updatedAt: '2024-01-01 00:00:00' },
];
export const mockCmsSurveys: CmsSurvey[] = SEED_CMS_SURVEYS.map((s) => ({ ...s, questions: s.questions.map((q) => ({ ...q, options: q.options.map((o) => ({ ...o })) })) }));
export const getNextCmsSurveyId = nextIdFactory(Math.max(0, ...mockCmsSurveys.map((x) => x.id)) + 1);
export const mockCmsHotKeywords: CmsHotKeyword[] = [
  { keyword: '产品', count: 42 },
  { keyword: '价格', count: 31 },
  { keyword: '教程', count: 18 },
];
export const getNextCmsSearchWordId = nextIdFactory(Math.max(0, ...mockCmsSearchWords.map((x) => x.id)) + 1);

// ─── P2 素材中心 ───────────────────────────────────────────────────────────────
export const mockCmsResources: CmsResource[] = SEED_CMS_RESOURCES.map((r) => ({ ...r }));
export const getNextCmsResourceId = nextIdFactory(Math.max(0, ...mockCmsResources.map((x) => x.id)) + 1);

// ─── P3 轻量投票 ───────────────────────────────────────────────────────────────
export const mockCmsPolls: CmsPoll[] = SEED_CMS_POLLS.map((p) => ({ ...p, options: p.options.map((o) => ({ ...o })) }));
export const getNextCmsPollId = nextIdFactory(Math.max(0, ...mockCmsPolls.map((x) => x.id)) + 1);
/** 选项计票（演示数据：按选项 id 递减分布） */
export const mockCmsPollVotes = new Map<number, Map<number, number>>([
  [1, new Map([[1, 3], [2, 2], [3, 1], [4, 1]])],
]);
