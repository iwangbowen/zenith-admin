import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CheckinMilestone,
  CheckinRule,
  CheckinSettings,
  Coupon,
  Member,
  MemberCheckin,
  MemberCoupon,
  MemberLevel,
  MemberLoginLog,
  MemberPointAccount,
  MemberPointTransaction,
  MemberRecharge,
  MemberStatsCharts,
  MemberStatsOverview,
  MemberWallet,
  MemberWalletTransaction,
  PaginatedResponse,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface MemberListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
  levelId?: number;
}

export interface MemberTransactionListParams {
  page: number;
  pageSize: number;
  memberKeyword?: string;
  type?: string;
}

export interface MemberRechargeListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
  channel?: string;
  dateStart?: string;
  dateEnd?: string;
}

export interface MemberLoginLogListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
  dateStart?: string;
  dateEnd?: string;
}

export interface CouponListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
  type?: string;
}

export interface CouponRecordListParams {
  page: number;
  pageSize: number;
  memberKeyword?: string;
  couponId?: number;
  status?: string;
}

export interface CheckinLogListParams {
  page: number;
  pageSize: number;
  memberKeyword?: string;
  dateStart?: string;
  dateEnd?: string;
}

export interface MemberOverview {
  member: Member;
  points: MemberPointAccount;
  wallet: MemberWallet;
  recentPointTxs: MemberPointTransaction[];
  recentWalletTxs: MemberWalletTransaction[];
  recentLoginLogs: MemberLoginLog[];
  activeCouponCount: number;
  loginLogCount: number;
}

export const memberAdminKeys = {
  all: ['member-admin'] as const,
  members: ['member-admin', 'members'] as const,
  memberLists: ['member-admin', 'members', 'list'] as const,
  memberList: (params: MemberListParams) => ['member-admin', 'members', 'list', params] as const,
  memberOverview: (id: number | null | undefined) => ['member-admin', 'members', 'overview', id] as const,
  levels: ['member-admin', 'levels'] as const,
  points: ['member-admin', 'points'] as const,
  pointLists: ['member-admin', 'points', 'list'] as const,
  pointList: (params: MemberTransactionListParams) => ['member-admin', 'points', 'list', params] as const,
  wallets: ['member-admin', 'wallets'] as const,
  walletLists: ['member-admin', 'wallets', 'list'] as const,
  walletList: (params: MemberTransactionListParams) => ['member-admin', 'wallets', 'list', params] as const,
  recharges: ['member-admin', 'recharges'] as const,
  rechargeLists: ['member-admin', 'recharges', 'list'] as const,
  rechargeList: (params: MemberRechargeListParams) => ['member-admin', 'recharges', 'list', params] as const,
  loginLogs: ['member-admin', 'login-logs'] as const,
  loginLogLists: ['member-admin', 'login-logs', 'list'] as const,
  loginLogList: (params: MemberLoginLogListParams) => ['member-admin', 'login-logs', 'list', params] as const,
  stats: ['member-admin', 'stats'] as const,
  statsOverview: ['member-admin', 'stats', 'overview'] as const,
  statsCharts: ['member-admin', 'stats', 'charts'] as const,
  coupons: ['member-admin', 'coupons'] as const,
  couponLists: ['member-admin', 'coupons', 'list'] as const,
  couponList: (params: CouponListParams) => ['member-admin', 'coupons', 'list', params] as const,
  couponRecords: ['member-admin', 'coupon-records'] as const,
  couponRecordLists: ['member-admin', 'coupon-records', 'list'] as const,
  couponRecordList: (params: CouponRecordListParams) => ['member-admin', 'coupon-records', 'list', params] as const,
  checkins: ['member-admin', 'checkins'] as const,
  checkinRules: ['member-admin', 'checkins', 'rules'] as const,
  checkinSettings: ['member-admin', 'checkins', 'settings'] as const,
  checkinLogLists: ['member-admin', 'checkins', 'logs', 'list'] as const,
  checkinLogList: (params: CheckinLogListParams) => ['member-admin', 'checkins', 'logs', 'list', params] as const,
  checkinMilestones: ['member-admin', 'checkins', 'milestones'] as const,
};

export function useMemberList(params: MemberListParams) {
  return useQuery({
    queryKey: memberAdminKeys.memberList(params),
    queryFn: () => request.get<PaginatedResponse<Member>>(`/api/members${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useMemberLevels() {
  return useQuery({
    queryKey: memberAdminKeys.levels,
    queryFn: () => request.get<MemberLevel[]>('/api/member-levels').then(unwrap),
  });
}

export function useSaveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id ? request.put<Member>(`/api/members/${id}`, values) : request.post<Member>('/api/members', values)).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: memberAdminKeys.all });
      // 同步失效 MemberSelect 等会员下拉源缓存（members-lookup.ts）
      void qc.invalidateQueries({ queryKey: ['members'] });
    },
  });
}

export function useDeleteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/members/${id}`).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: memberAdminKeys.all });
      void qc.invalidateQueries({ queryKey: ['members'] });
    },
  });
}

export function useResetMemberPassword() {
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Record<string, unknown> }) =>
      request.post<null>(`/api/members/${id}/reset-password`, values).then(unwrap),
  });
}

export function useBatchMemberStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { ids: number[]; status: string }) => request.put<null>('/api/members/batch-status', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberAdminKeys.all }),
  });
}

export function useBatchMemberLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { ids: number[]; levelId: number | null }) => request.put<null>('/api/members/batch-level', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberAdminKeys.all }),
  });
}

export function useMemberOverview(id: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: memberAdminKeys.memberOverview(id),
    queryFn: () => request.get<MemberOverview>(`/api/members/${id}/overview`).then(unwrap),
    enabled: enabled && !!id,
  });
}

export function useSaveMemberLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id ? request.put<MemberLevel>(`/api/member-levels/${id}`, values) : request.post<MemberLevel>('/api/member-levels', values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberAdminKeys.all }),
  });
}

export function useDeleteMemberLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/member-levels/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberAdminKeys.all }),
  });
}

export function useMemberPointTransactions(params: MemberTransactionListParams) {
  return useQuery({
    queryKey: memberAdminKeys.pointList(params),
    queryFn: () =>
      request.get<PaginatedResponse<MemberPointTransaction>>(`/api/member-points/transactions${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useAdjustMemberPoints() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) => request.post<null>('/api/member-points/adjust', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberAdminKeys.all }),
  });
}

export function useMemberWalletTransactions(params: MemberTransactionListParams) {
  return useQuery({
    queryKey: memberAdminKeys.walletList(params),
    queryFn: () =>
      request.get<PaginatedResponse<MemberWalletTransaction>>(`/api/member-wallets/transactions${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useAdjustMemberWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { memberId: number; amount: number; remark?: string }) =>
      request.post<null>('/api/member-wallets/adjust', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberAdminKeys.all }),
  });
}

export function useRefundMemberWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { memberId: number; amount: number; remark?: string }) =>
      request.post<null>('/api/member-wallets/refund', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberAdminKeys.all }),
  });
}

export function useMemberRechargeList(params: MemberRechargeListParams) {
  return useQuery({
    queryKey: memberAdminKeys.rechargeList(params),
    queryFn: () => request.get<PaginatedResponse<MemberRecharge>>(`/api/member-recharges${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useMemberStatsOverview() {
  return useQuery({
    queryKey: memberAdminKeys.statsOverview,
    queryFn: () => request.get<MemberStatsOverview>('/api/member-stats/overview').then(unwrap),
  });
}

export function useMemberStatsCharts() {
  return useQuery({
    queryKey: memberAdminKeys.statsCharts,
    queryFn: () => request.get<MemberStatsCharts>('/api/member-stats/charts').then(unwrap),
  });
}

export function useMemberLoginLogList(params: MemberLoginLogListParams) {
  return useQuery({
    queryKey: memberAdminKeys.loginLogList(params),
    queryFn: () => request.get<PaginatedResponse<MemberLoginLog>>(`/api/members/login-logs${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useCouponList(params: CouponListParams) {
  return useQuery({
    queryKey: memberAdminKeys.couponList(params),
    queryFn: () => request.get<PaginatedResponse<Coupon>>(`/api/coupons${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useSaveCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id ? request.put<Coupon>(`/api/coupons/${id}`, values) : request.post<Coupon>('/api/coupons', values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberAdminKeys.all }),
  });
}

export function useDeleteCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/coupons/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberAdminKeys.all }),
  });
}

export function useIssueCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, memberId }: { id: number; memberId: number }) =>
      request.post<null>(`/api/coupons/${id}/issue`, { memberId }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberAdminKeys.all }),
  });
}

export function useCouponRecordList(params: CouponRecordListParams) {
  return useQuery({
    queryKey: memberAdminKeys.couponRecordList(params),
    queryFn: () => request.get<PaginatedResponse<MemberCoupon>>(`/api/coupons/records${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useRevokeCouponRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/coupons/records/${id}/revoke`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberAdminKeys.all }),
  });
}

export function useCheckinRules() {
  return useQuery({
    queryKey: memberAdminKeys.checkinRules,
    queryFn: () => request.get<CheckinRule[]>('/api/checkin-rules').then(unwrap),
  });
}

export function useCheckinSettings(enabled = true) {
  return useQuery({
    queryKey: memberAdminKeys.checkinSettings,
    queryFn: () => request.get<CheckinSettings>('/api/checkin-settings').then(unwrap),
    enabled,
  });
}

export function useSaveCheckinSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) => request.put<CheckinSettings>('/api/checkin-settings', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberAdminKeys.all }),
  });
}

export function useSaveCheckinRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id ? request.put<CheckinRule>(`/api/checkin-rules/${id}`, values) : request.post<CheckinRule>('/api/checkin-rules', values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberAdminKeys.all }),
  });
}

export function useDeleteCheckinRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/checkin-rules/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberAdminKeys.all }),
  });
}

export function useCheckinLogList(params: CheckinLogListParams) {
  return useQuery({
    queryKey: memberAdminKeys.checkinLogList(params),
    queryFn: () => request.get<PaginatedResponse<MemberCheckin>>(`/api/member-checkins${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useMakeupCheckin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, date }: { memberId: number; date: string }) =>
      request.post<null>(`/api/members/${memberId}/checkin/makeup`, { date }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberAdminKeys.all }),
  });
}

export function useCheckinMilestones() {
  return useQuery({
    queryKey: memberAdminKeys.checkinMilestones,
    queryFn: () => request.get<CheckinMilestone[]>('/api/checkin-milestones').then(unwrap),
  });
}

export function useSaveCheckinMilestone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id
        ? request.put<CheckinMilestone>(`/api/checkin-milestones/${id}`, values)
        : request.post<CheckinMilestone>('/api/checkin-milestones', values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberAdminKeys.all }),
  });
}

export function useDeleteCheckinMilestone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/checkin-milestones/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberAdminKeys.all }),
  });
}
