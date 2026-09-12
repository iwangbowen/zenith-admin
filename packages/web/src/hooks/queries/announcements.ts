import { useMemo } from 'react';
import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { userContract } from '@zenith/shared/identity';
import { announcementContract } from '@zenith/shared/messaging';
import type { Announcement, AnnouncementDetail, MyAnnouncement } from '@zenith/shared/messaging';
import { LOOKUP_STALE_TIME } from '@/lib/query';
import { apiQueryOptions, contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
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

const toReadStatsInput = ({ id, tab, page, pageSize }: AnnouncementStatsParams) =>
  ({ params: { id: id ?? 0 }, query: { tab, page, pageSize } }) as const;

/** 收件人搜索固定取前 20 条匹配用户 */
const USER_SEARCH_PAGE = { page: 1, pageSize: 20 } as const;

const silent = { silent: true } as const;

/**
 * 同一资源键下挂着管理端列表 / 详情、收件箱、已读统计三组互不相干的查询。
 * 收件箱没有公共前缀（inbox / detail / unreadCount / published 是四个操作），
 * 「读者侧整体刷新」由 `invalidateMyAnnouncements` 列举，写操作按影响面精确失效。
 */
const myKeys = {
  myLists: contractKey(announcementContract.inbox),
  myList: (params: MyAnnouncementListParams) => contractKey(announcementContract.inbox, { query: params }),
  /** 收件箱详情与管理端详情是同一操作；工厂 detail 用裸 id 作段，这里用契约输入作段，互不覆盖 */
  myDetail: (id: number | undefined) => contractKey(announcementContract.detail, { params: { id: id ?? 0 } }),
  readStatsAll: contractKey(announcementContract.readStats),
  readStats: (params: AnnouncementStatsParams) => contractKey(announcementContract.readStats, toReadStatsInput(params)),
  /** 收件人用户搜索归 users 域所有（`userContract.list` 的 key），用户增删改后随 `userKeys.lists` 一起失效 */
  userSearch: (keyword: string) => contractKey(userContract.list, { query: { ...USER_SEARCH_PAGE, keyword } }),
  /** 顶栏公告铃铛未读数 */
  myUnreadCount: contractKey(announcementContract.unreadCount),
  /** 顶栏公告气泡里的已发布公告 */
  published: contractKey(announcementContract.published),
};

/**
 * 读者侧（收件箱列表 / 详情、未读数、顶栏气泡）整体标脏。
 * 发布 / 改内容 / 上下架 / WS 公告事件都会改变用户看到的公告集合；
 * 未挂载的查询只标脏不请求，代价接近零。`id` 已知时只打该条详情，否则覆盖全部收件箱详情。
 */
export function invalidateMyAnnouncements(qc: QueryClient, id?: number) {
  void qc.invalidateQueries({ queryKey: myKeys.myLists });
  void qc.invalidateQueries({ queryKey: id === undefined ? contractKey(announcementContract.detail) : myKeys.myDetail(id) });
  void qc.invalidateQueries({ queryKey: myKeys.myUnreadCount });
  void qc.invalidateQueries({ queryKey: myKeys.published });
}

const {
  keys: crudKeys,
  useList: useAnnouncementList,
  useDetail: useAnnouncementDetail,
  useSave: useSaveAnnouncement,
  useDelete: useDeleteAnnouncements,
} = createResourceQueries(announcementContract, {
  // 发布 / 改内容会改变各用户收件箱；收件箱在另一路由，未挂载时仅标脏，代价接近零。
  // 不碰 recipientOptions / userSearch：保存时弹窗尚未关闭，它们仍是活跃查询，且与本次保存无关
  onSaved: (qc, saved) => invalidateMyAnnouncements(qc, saved.id),
  onDeleted: (qc, ids) => {
    for (const id of ids) qc.removeQueries({ queryKey: myKeys.myDetail(id) });
    void qc.invalidateQueries({ queryKey: myKeys.myLists });
    void qc.invalidateQueries({ queryKey: myKeys.myUnreadCount });
    void qc.invalidateQueries({ queryKey: myKeys.published });
  },
});

export const announcementKeys = { ...crudKeys, ...myKeys };

export { useAnnouncementList, useAnnouncementDetail, useSaveAnnouncement, useDeleteAnnouncements };

/** 我的公告未读数（顶栏铃铛 badge） */
export function useMyAnnouncementUnreadCount() {
  return useQuery({
    ...apiQueryOptions(announcementContract.unreadCount, { requestOptions: silent }),
    select: (data) => data?.count ?? 0,
  });
}

/** 顶栏气泡里的最近已发布公告（含本人已读标记） */
export function usePublishedAnnouncements() {
  return useApiQuery(announcementContract.published, { requestOptions: silent });
}

export function useMyAnnouncementList(params: MyAnnouncementListParams) {
  return useApiQuery(announcementContract.inbox, { query: params }, { placeholderData: keepPreviousData });
}

/**
 * 我的公告详情。
 *
 * `silent` 供工作台等挂件场景使用：失败时不弹 toast，由调用方回退到列表数据；
 * 收件箱页是用户显式打开详情，保持默认的错误提示。
 */
export function useMyAnnouncementDetail(id: number | undefined, enabled = true, silent = false) {
  return useApiQuery(announcementContract.detail, { params: { id: id ?? 0 } }, {
    enabled: enabled && id !== undefined,
    requestOptions: { silent },
  });
}

/** 标记已读只动收件箱与已读统计；管理端的已读统计在另一路由，未挂载时仅标脏 */
export function useMarkMyAnnouncementRead() {
  return useApiMutation(announcementContract.markRead, {
    requestOptions: silent,
    invalidate: (qc, _output, { params }) => {
      invalidateMyAnnouncements(qc, params.id);
      void qc.invalidateQueries({ queryKey: announcementKeys.readStatsAll });
    },
  });
}

export function useMarkAllMyAnnouncementsRead() {
  return useApiMutation(announcementContract.markAllRead, {
    invalidate: (qc) => {
      invalidateMyAnnouncements(qc);
      void qc.invalidateQueries({ queryKey: announcementKeys.readStatsAll });
    },
  });
}

export function useAnnouncementReadStats(params: AnnouncementStatsParams, enabled = true) {
  return useApiQuery(announcementContract.readStats, toReadStatsInput(params), {
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

/** 用户列表按 keyword 匹配用户名 / 昵称 / 邮箱；选项形状由 select 派生，缓存里仍是用户列表本身 */
export function useAnnouncementUserSearch(keyword: string, enabled = true) {
  return useQuery({
    ...apiQueryOptions(userContract.list, { query: { ...USER_SEARCH_PAGE, keyword } }, { staleTime: LOOKUP_STALE_TIME }),
    select: (data) => data.list.map((u) => ({ value: u.id, label: `${u.nickname}（${u.username}）` })),
    enabled: enabled && keyword.trim().length > 0,
  });
}

/** 上下架 / 取消定时：直接决定公告是否出现在收件箱，故连带刷新读者侧 */
export function useUpdateAnnouncementStatus() {
  return useApiMutation(announcementContract.update, {
    invalidate: (qc, saved: Announcement) => {
      void qc.invalidateQueries({ queryKey: announcementKeys.detail(saved.id) });
      void qc.invalidateQueries({ queryKey: announcementKeys.lists });
      invalidateMyAnnouncements(qc, saved.id);
    },
  });
}
