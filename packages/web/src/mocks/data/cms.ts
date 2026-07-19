import {
  SEED_CMS_SITES, SEED_CMS_MODELS, SEED_CMS_CHANNELS, SEED_CMS_CONTENTS,
  SEED_CMS_TAGS, SEED_CMS_FRAGMENTS, SEED_CMS_FRIEND_LINKS,
} from '@zenith/shared';
import type { CmsSite, CmsModel, CmsChannel, CmsContent, CmsTag, CmsFragment, CmsFriendLink } from '@zenith/shared';

// 从共享种子数据派生（禁止重复定义静态数组）
export const mockCmsSites: CmsSite[] = SEED_CMS_SITES.map((s) => ({ ...s }));
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
