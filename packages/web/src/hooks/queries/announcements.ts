import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Announcement,
  AnnouncementAttachment,
  AnnouncementReadStats,
  AnnouncementRecipient,
  Department,
  PaginatedResponse,
  Role,
  User,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { LOOKUP_STALE_TIME, toQueryString, unwrap } from '@/lib/query';

export interface AnnouncementListParams {
  page: number;
  pageSize: number;
  title?: string;
  type?: string;
  publishStatus?: string;
  startTime?: string;
  endTime?: string;
}

export type AnnouncementDetail = Announcement & {
  recipients: AnnouncementRecipient[];
  attachments: AnnouncementAttachment[];
};

export interface AnnouncementStatsParams {
  id: number | undefined;
  tab: 'read' | 'unread';
  page: number;
  pageSize: number;
}

export type MyAnnouncement = Announcement & { isRead: boolean };

export interface MyAnnouncementListParams {
  page: number;
  pageSize: number;
  isRead?: string;
}

export const announcementKeys = {
  all: ['announcements'] as const,
  lists: ['announcements', 'list'] as const,
  list: (params: AnnouncementListParams) => ['announcements', 'list', params] as const,
  detail: (id: number | undefined) => ['announcements', 'detail', id] as const,
  my: ['announcements', 'my'] as const,
  myLists: ['announcements', 'my', 'list'] as const,
  myList: (params: MyAnnouncementListParams) => ['announcements', 'my', 'list', params] as const,
  myDetail: (id: number | undefined) => ['announcements', 'my', 'detail', id] as const,
  readStats: (params: AnnouncementStatsParams) => ['announcements', 'read-stats', params] as const,
  recipientOptions: ['announcements', 'recipient-options'] as const,
  userSearch: (keyword: string) => ['announcements', 'user-search', keyword] as const,
};

export function useAnnouncementList(params: AnnouncementListParams) {
  return useQuery({
    queryKey: announcementKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<Announcement>>(`/api/announcements${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useAnnouncementDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: announcementKeys.detail(id),
    queryFn: () => request.get<AnnouncementDetail>(`/api/announcements/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useMyAnnouncementList(params: MyAnnouncementListParams) {
  return useQuery({
    queryKey: announcementKeys.myList(params),
    queryFn: () =>
      request.get<PaginatedResponse<MyAnnouncement>>(`/api/announcements/inbox${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useMyAnnouncementDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: announcementKeys.myDetail(id),
    queryFn: () => request.get<Announcement>(`/api/announcements/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useMarkMyAnnouncementRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/announcements/${id}/read`, undefined, { silent: true }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: announcementKeys.my }),
  });
}

export function useMarkAllMyAnnouncementsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request.post<null>('/api/announcements/read-all', {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: announcementKeys.my }),
  });
}

export function useAnnouncementReadStats(params: AnnouncementStatsParams, enabled = true) {
  return useQuery({
    queryKey: announcementKeys.readStats(params),
    queryFn: () =>
      request
        .get<AnnouncementReadStats>(
          `/api/announcements/${params.id}/read-stats${toQueryString({
            tab: params.tab,
            page: params.page,
            pageSize: params.pageSize,
          })}`,
        )
        .then(unwrap),
    placeholderData: keepPreviousData,
    enabled: enabled && params.id !== undefined,
  });
}

export function useAnnouncementRecipientOptions(enabled = true) {
  return useQuery({
    queryKey: announcementKeys.recipientOptions,
    queryFn: async () => {
      const [roles, departments] = await Promise.all([
        request.get<Role[]>('/api/roles/all').then(unwrap),
        request.get<Department[]>('/api/departments/flat').then(unwrap),
      ]);
      return {
        roles: roles.map((r) => ({ value: r.id, label: r.name })),
        departments: departments.map((d) => ({ value: d.id, label: d.name })),
      };
    },
    staleTime: LOOKUP_STALE_TIME,
    enabled,
  });
}

export function useAnnouncementUserSearch(keyword: string, enabled = true) {
  return useQuery({
    queryKey: announcementKeys.userSearch(keyword),
    queryFn: () =>
      request
        .get<PaginatedResponse<User>>(`/api/users${toQueryString({ page: 1, pageSize: 20, username: keyword })}`)
        .then(unwrap)
        .then((data) => data.list.map((u) => ({ value: u.id, label: `${u.nickname}（${u.username}）` }))),
    staleTime: LOOKUP_STALE_TIME,
    enabled: enabled && keyword.trim().length > 0,
  });
}

export function useSaveAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<Announcement>('/api/announcements', values)
        : request.put<Announcement>(`/api/announcements/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: announcementKeys.all }),
  });
}

export function useDeleteAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/announcements/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: announcementKeys.all }),
  });
}

export function useBatchDeleteAnnouncements() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => request.delete<null>('/api/announcements/batch', { ids }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: announcementKeys.all }),
  });
}

export function useUpdateAnnouncementStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<Announcement> }) =>
      request.put<Announcement>(`/api/announcements/${id}`, values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: announcementKeys.all }),
  });
}
