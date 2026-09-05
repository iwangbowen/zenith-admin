import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { resourceKeyOf, type QueryOf } from '@zenith/shared/core';
import { userContract } from '@zenith/shared/identity';
import { announcementContract } from '@zenith/shared/messaging';
import type { Announcement, AnnouncementDetail, MyAnnouncement } from '@zenith/shared/messaging';
import { LOOKUP_STALE_TIME } from '@/lib/query';
import { api, createResourceQueries, useApiMutation } from '@/lib/contract-query';
import { useAllRoles } from './roles';
import { useFlatDepartments } from './departments';

export type AnnouncementListParams = NonNullable<QueryOf<typeof announcementContract.list>>;

export type MyAnnouncementListParams = NonNullable<QueryOf<typeof announcementContract.inbox>>;

export type { AnnouncementDetail, MyAnnouncement };

export interface AnnouncementStatsParams {
  id: number | undefined;
  tab: 'read' | 'unread';
  page: number;
  pageSize: number;
}

const KEY = resourceKeyOf(announcementContract.basePath);

/**
 * 同一根键下挂三棵互不相干的子树：管理端列表 / 详情、收件箱（`my`）、已读统计。
 * 写操作按影响面精确失效，不用根键广播。
 */
const myKeys = {
  my: [KEY, 'my'] as const,
  myLists: [KEY, 'my', 'inbox'] as const,
  myList: (params: MyAnnouncementListParams) => [KEY, 'my', 'inbox', params] as const,
  myDetail: (id: number | undefined) => [KEY, 'my', 'detail', id] as const,
  readStatsAll: [KEY, 'read-stats'] as const,
  readStats: (params: AnnouncementStatsParams) => [KEY, 'read-stats', params] as const,
  userSearch: (keyword: string) => [KEY, 'user-search', keyword] as const,
  /** 顶栏公告铃铛未读数 */
  myUnreadCount: [KEY, 'my', 'unread-count'] as const,
  /** 顶栏公告气泡里的已发布公告 */
  published: [KEY, 'my', 'published'] as const,
};

const {
  keys: crudKeys,
  useList: useAnnouncementList,
  useDetail: useAnnouncementDetail,
  useSave: useSaveAnnouncement,
  useDelete: useDeleteAnnouncements,
} = createResourceQueries(announcementContract, {
  // 发布 / 改内容会改变各用户收件箱；收件箱在另一路由，未挂载时仅标脏，代价接近零。
  // 不碰 recipientOptions / userSearch：保存时弹窗尚未关闭，它们仍是活跃查询，且与本次保存无关
  onSaved: (qc) => {
    void qc.invalidateQueries({ queryKey: myKeys.my });
  },
  onDeleted: (qc, ids) => {
    for (const id of ids) qc.removeQueries({ queryKey: myKeys.myDetail(id) });
    void qc.invalidateQueries({ queryKey: myKeys.my });
  },
});

export const announcementKeys = { ...crudKeys, ...myKeys };

export { useAnnouncementList, useAnnouncementDetail, useSaveAnnouncement, useDeleteAnnouncements };

/** 我的公告未读数（顶栏铃铛 badge） */
export function useMyAnnouncementUnreadCount() {
  return useQuery({
    queryKey: announcementKeys.myUnreadCount,
    queryFn: () => api(announcementContract.unreadCount, { silent: true }),
    select: (data) => data?.count ?? 0,
  });
}

/** 顶栏气泡里的最近已发布公告（含本人已读标记） */
export function usePublishedAnnouncements() {
  return useQuery({
    queryKey: announcementKeys.published,
    queryFn: () => api(announcementContract.published, { silent: true }),
  });
}

export function useMyAnnouncementList(params: MyAnnouncementListParams) {
  return useQuery({
    queryKey: announcementKeys.myList(params),
    queryFn: () => api(announcementContract.inbox, { query: params }),
    placeholderData: keepPreviousData,
  });
}

/**
 * 我的公告详情。
 *
 * `silent` 供工作台等挂件场景使用：失败时不弹 toast，由调用方回退到列表数据；
 * 收件箱页是用户显式打开详情，保持默认的错误提示。
 */
export function useMyAnnouncementDetail(id: number | undefined, enabled = true, silent = false) {
  return useQuery({
    queryKey: announcementKeys.myDetail(id),
    queryFn: () => api(announcementContract.detail, { params: { id: id ?? 0 } }, { silent }),
    enabled: enabled && id !== undefined,
  });
}

/** 标记已读只动收件箱与已读统计；管理端的已读统计在另一路由，未挂载时仅标脏 */
export function useMarkMyAnnouncementRead() {
  return useApiMutation(announcementContract.markRead, {
    requestOptions: { silent: true },
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: announcementKeys.my });
      void qc.invalidateQueries({ queryKey: announcementKeys.readStatsAll });
    },
  });
}

export function useMarkAllMyAnnouncementsRead() {
  return useApiMutation(announcementContract.markAllRead, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: announcementKeys.my });
      void qc.invalidateQueries({ queryKey: announcementKeys.readStatsAll });
    },
  });
}

export function useAnnouncementReadStats(params: AnnouncementStatsParams, enabled = true) {
  return useQuery({
    queryKey: announcementKeys.readStats(params),
    queryFn: () => api(announcementContract.readStats, {
      params: { id: params.id ?? 0 },
      query: { tab: params.tab, page: params.page, pageSize: params.pageSize },
    }),
    placeholderData: keepPreviousData,
    enabled: enabled && params.id !== undefined,
  });
}

/**
 * 收件人选项（角色 + 部门）。
 *
 * 数据实际归属 roles / departments 域，故直接复用两个域的共享 lookup，
 * 而不是在 announcementKeys 下另起炉灶——否则角色或部门被增删改后，
 * 这份缓存没有任何来源会失效它，会静默显示旧的角色/部门列表。
 */
export function useAnnouncementRecipientOptions(enabled = true) {
  const rolesQuery = useAllRoles({ enabled });
  const departmentsQuery = useFlatDepartments({ enabled });

  const data = useMemo(() => {
    if (!rolesQuery.data && !departmentsQuery.data) return undefined;
    return {
      roles: (rolesQuery.data ?? []).map((r) => ({ value: r.id, label: r.name })),
      departments: (departmentsQuery.data ?? []).map((d) => ({ value: d.id, label: d.name })),
    };
  }, [rolesQuery.data, departmentsQuery.data]);

  return {
    data,
    isFetching: rolesQuery.isFetching || departmentsQuery.isFetching,
    isSuccess: rolesQuery.isSuccess && departmentsQuery.isSuccess,
  };
}

export function useAnnouncementUserSearch(keyword: string, enabled = true) {
  return useQuery({
    queryKey: announcementKeys.userSearch(keyword),
    queryFn: () =>
      // 用户列表按 keyword 匹配用户名 / 昵称 / 邮箱
      api(userContract.list, { query: { page: 1, pageSize: 20, keyword } })
        .then((data) => data.list.map((u) => ({ value: u.id, label: `${u.nickname}（${u.username}）` }))),
    staleTime: LOOKUP_STALE_TIME,
    enabled: enabled && keyword.trim().length > 0,
  });
}

/** 上下架 / 取消定时：直接决定公告是否出现在收件箱，故连带失效 `my` */
export function useUpdateAnnouncementStatus() {
  return useApiMutation(announcementContract.update, {
    invalidate: (qc, saved: Announcement) => {
      void qc.invalidateQueries({ queryKey: announcementKeys.detail(saved.id) });
      void qc.invalidateQueries({ queryKey: announcementKeys.lists });
      void qc.invalidateQueries({ queryKey: announcementKeys.my });
    },
  });
}
