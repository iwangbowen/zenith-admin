import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Coupon,
  Member,
  MemberBenefits,
  MemberCheckin,
  MemberCheckinStatus,
  MemberCoupon,
  MemberInviteSummary,
  MemberLevel,
  MemberLoginLog,
  MemberMilestoneStatus,
  MemberNotification,
  MemberPointAccount,
  MemberWallet,
  PaginatedResponse,
} from '@zenith/shared';
import { toQueryString, unwrap } from '@/lib/query';
import { memberRequest } from '../utils/member-request';

export interface MemberTransaction {
  id: number;
  type: string;
  amount: number;
  remark?: string | null;
  bizType?: string | null;
  createdAt: string;
}

export interface RechargeResult {
  orderNo: string;
  payMethod: string;
  channel: string;
  codeUrl?: string;
  payUrl?: string;
  formHtml?: string;
  expiredAt?: string;
}

export interface CheckinResult {
  consecutiveDays: number;
  points: number;
  experience: number;
  checkinDate: string;
}

interface MakeupCheckinResult {
  costPoints: number;
  pointsAwarded: number;
}

export interface MemberListParams {
  page: number;
  pageSize: number;
  [key: string]: string | number | undefined;
}

function appendQuery(url: string, params: object): string {
  const qs = toQueryString(params);
  if (!qs) return url;
  return `${url}${url.includes('?') ? `&${qs.slice(1)}` : qs}`;
}

export const memberKeys = {
  all: ['member'] as const,
  me: ['member', 'me'] as const,
  points: {
    all: ['member', 'points'] as const,
    account: ['member', 'points', 'account'] as const,
  },
  wallet: {
    all: ['member', 'wallet'] as const,
    detail: ['member', 'wallet', 'detail'] as const,
  },
  coupons: {
    all: ['member', 'coupons'] as const,
    lists: ['member', 'coupons', 'list'] as const,
    list: (params: MemberListParams) => ['member', 'coupons', 'list', params] as const,
    available: ['member', 'coupons', 'available'] as const,
    exchangeable: ['member', 'coupons', 'exchangeable'] as const,
  },
  levels: ['member', 'levels'] as const,
  loginLogs: {
    lists: ['member', 'login-logs', 'list'] as const,
    list: (params: MemberListParams) => ['member', 'login-logs', 'list', params] as const,
  },
  checkin: {
    all: ['member', 'checkin'] as const,
    status: ['member', 'checkin', 'status'] as const,
    milestones: ['member', 'checkin', 'milestones'] as const,
    historyLists: ['member', 'checkin', 'history'] as const,
    history: (params: MemberListParams) => ['member', 'checkin', 'history', params] as const,
    calendar: (month: string, dateStart: string, dateEnd: string) => ['member', 'checkin', 'calendar', month, dateStart, dateEnd] as const,
  },
  transactions: {
    lists: ['member', 'transactions', 'list'] as const,
    list: (fetchUrl: string, params: MemberListParams) => ['member', 'transactions', 'list', fetchUrl, params] as const,
  },
  benefits: ['member', 'benefits'] as const,
  notifications: {
    all: ['member', 'notifications'] as const,
    lists: ['member', 'notifications', 'list'] as const,
    list: (params: MemberListParams) => ['member', 'notifications', 'list', params] as const,
    unreadCount: ['member', 'notifications', 'unread-count'] as const,
  },
  invite: ['member', 'invite', 'summary'] as const,
};

export function useMemberMe() {
  return useQuery({
    queryKey: memberKeys.me,
    queryFn: () => memberRequest.get<Member>('/api/member/auth/me', { silent: true }).then(unwrap),
  });
}

export function useMemberPointAccount() {
  return useQuery({
    queryKey: memberKeys.points.account,
    queryFn: () => memberRequest.get<MemberPointAccount>('/api/member/points/account', { silent: true }).then(unwrap),
  });
}

export function useMemberWallet() {
  return useQuery({
    queryKey: memberKeys.wallet.detail,
    queryFn: () => memberRequest.get<MemberWallet>('/api/member/wallet', { silent: true }).then(unwrap),
  });
}

export function useMemberCouponList(params: MemberListParams) {
  return useQuery({
    queryKey: memberKeys.coupons.list(params),
    queryFn: () => memberRequest.get<PaginatedResponse<MemberCoupon>>(`/api/member/coupons${toQueryString(params)}`, { silent: true }).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useInfiniteMemberCoupons(pageSize = 10) {
  return useInfiniteQuery({
    queryKey: memberKeys.coupons.list({ page: 1, pageSize }),
    queryFn: ({ pageParam }) =>
      memberRequest
        .get<PaginatedResponse<MemberCoupon>>(`/api/member/coupons${toQueryString({ page: pageParam, pageSize })}`, { silent: true })
        .then(unwrap),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.page * lastPage.pageSize;
      return loaded < lastPage.total ? lastPage.page + 1 : undefined;
    },
  });
}

export function useAvailableCoupons() {
  return useQuery({
    queryKey: memberKeys.coupons.available,
    queryFn: () => memberRequest.get<Coupon[]>('/api/member/coupons/available', { silent: true }).then(unwrap),
  });
}

export function useExchangeableCoupons() {
  return useQuery({
    queryKey: memberKeys.coupons.exchangeable,
    queryFn: () => memberRequest.get<Coupon[]>('/api/member/coupons/exchangeable', { silent: true }).then(unwrap),
  });
}

export function useMemberLevels() {
  return useQuery({
    queryKey: memberKeys.levels,
    queryFn: () => memberRequest.get<MemberLevel[]>('/api/member/levels', { silent: true }).then(unwrap),
  });
}

export function useMemberLoginLogs(params: MemberListParams) {
  return useQuery({
    queryKey: memberKeys.loginLogs.list(params),
    queryFn: () => memberRequest.get<PaginatedResponse<MemberLoginLog>>(`/api/member/login-logs${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useMemberTransactions(fetchUrl: string, params: MemberListParams) {
  return useQuery({
    queryKey: memberKeys.transactions.list(fetchUrl, params),
    queryFn: () => memberRequest.get<PaginatedResponse<MemberTransaction>>(appendQuery(fetchUrl, params), { silent: true }).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useCheckinStatus() {
  return useQuery({
    queryKey: memberKeys.checkin.status,
    queryFn: () => memberRequest.get<MemberCheckinStatus>('/api/member/checkin/status', { silent: true }).then(unwrap),
  });
}

export function useCheckinMilestones() {
  return useQuery({
    queryKey: memberKeys.checkin.milestones,
    queryFn: () => memberRequest.get<MemberMilestoneStatus>('/api/member/checkin/milestones', { silent: true }).then(unwrap),
  });
}

export function useCheckinHistory(params: MemberListParams) {
  return useQuery({
    queryKey: memberKeys.checkin.history(params),
    queryFn: () => memberRequest.get<PaginatedResponse<MemberCheckin>>(`/api/member/checkin/history${toQueryString(params)}`, { silent: true }).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useCheckinCalendar(monthKey: string, dateStart: string, dateEnd: string) {
  return useQuery({
    queryKey: memberKeys.checkin.calendar(monthKey, dateStart, dateEnd),
    queryFn: () =>
      memberRequest
        .get<PaginatedResponse<MemberCheckin>>(
          `/api/member/checkin/history${toQueryString({ page: 1, pageSize: 31, dateStart, dateEnd })}`,
          { silent: true },
        )
        .then(unwrap),
  });
}

export function useCreateRechargeOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { amount: number; payMethod: string }) =>
      memberRequest.post<RechargeResult>('/api/member/wallet/recharge', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberKeys.wallet.all }),
  });
}

export function useReceiveCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (couponId: number) =>
      memberRequest.post<MemberCoupon>('/api/member/coupons/receive', { couponId }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberKeys.coupons.all }),
  });
}

export function useExchangeCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (couponId: number) =>
      memberRequest.post<MemberCoupon>('/api/member/coupons/exchange', { couponId }).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: memberKeys.coupons.all });
      void qc.invalidateQueries({ queryKey: memberKeys.points.all });
    },
  });
}

// ─── 权益 / 通知 / 邀请 / 注销 ────────────────────────────────────────────────
export function useMyBenefits() {
  return useQuery({
    queryKey: memberKeys.benefits,
    queryFn: () => memberRequest.get<MemberBenefits>('/api/member/benefits', { silent: true }).then(unwrap),
  });
}

export function useMyNotifications(params: MemberListParams) {
  return useQuery({
    queryKey: memberKeys.notifications.list(params),
    queryFn: () => memberRequest.get<PaginatedResponse<MemberNotification>>(`/api/member/notifications${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useUnreadNotificationCount(enabled = true) {
  return useQuery({
    queryKey: memberKeys.notifications.unreadCount,
    queryFn: () => memberRequest.get<{ count: number }>('/api/member/notifications/unread-count', { silent: true }).then(unwrap),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => memberRequest.put<null>(`/api/member/notifications/${id}/read`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberKeys.notifications.all }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => memberRequest.put<null>('/api/member/notifications/read-all', {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberKeys.notifications.all }),
  });
}

export function useInviteSummary() {
  return useQuery({
    queryKey: memberKeys.invite,
    queryFn: () => memberRequest.get<MemberInviteSummary>('/api/member/invite/summary').then(unwrap),
  });
}

export function useDeactivateAccount() {
  return useMutation({
    mutationFn: (values: { password?: string; smsCode?: string }) =>
      memberRequest.post<null>('/api/member/auth/deactivate', values).then(unwrap),
  });
}

export function useMemberCheckin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => memberRequest.post<CheckinResult>('/api/member/checkin', {}).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: memberKeys.checkin.all });
      void qc.invalidateQueries({ queryKey: memberKeys.points.all });
    },
  });
}

export function useMakeupCheckin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (date: string) =>
      memberRequest.post<MakeupCheckinResult>('/api/member/checkin/makeup', { date }).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: memberKeys.checkin.all });
      void qc.invalidateQueries({ queryKey: memberKeys.points.all });
    },
  });
}

export function useResetMemberPassword() {
  return useMutation({
    mutationFn: (values: { phone: string; smsCode: string; newPassword: string }) =>
      memberRequest.post<null>('/api/member/auth/reset-password', values, { silent: true }).then(unwrap),
  });
}

export function useChangeMemberPassword() {
  return useMutation({
    mutationFn: (values: { oldPassword?: string; newPassword: string }) =>
      memberRequest.put<null>('/api/member/auth/password', values).then(unwrap),
  });
}

export function useUpdateMemberProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { nickname: string; email: string | null; gender: string | null; avatar: string | null }) =>
      memberRequest.put<Member>('/api/member/auth/profile', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberKeys.all }),
  });
}

export function useUploadMemberAvatar() {
  return useMutation({
    mutationFn: (formData: FormData) =>
      memberRequest.post<{ url: string }>('/api/member/files/avatar', formData).then(unwrap),
  });
}
