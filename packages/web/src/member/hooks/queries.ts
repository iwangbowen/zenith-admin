import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CmsContribSite, CmsContribution, CmsMemberComment, CmsMemberContentItem, CmsMemberSubscription } from '@zenith/shared/cms';
import { resourceKeyOf, type PaginatedResponse, type QueryOf } from '@zenith/shared/core';
import { memberAuthContract, memberRenewalContract, memberSelfContract } from '@zenith/shared/member';
import { api, apiQueryOptions, contractKey, useApiMutation, type ApiCallOptions } from '@/lib/contract-query';
import { toQueryString, unwrap } from '@/lib/query';
import { memberRequest } from '../utils/member-request';

/** 会员端一律走会员请求实例（独立 token 与刷新链路），不得混用后台 request */
const memberClient: ApiCallOptions = { client: memberRequest };
/** 静默：错误由页面自行处理（首屏 / 轮询类查询不弹全局提示） */
const silentMemberClient: ApiCallOptions = { client: memberRequest, silent: true };

export type MemberTransactionOp = typeof memberSelfContract.pointTransactions | typeof memberSelfContract.walletTransactions;
export type MemberCouponListParams = NonNullable<QueryOf<typeof memberSelfContract.coupons>>;
export type MemberCheckinHistoryParams = NonNullable<QueryOf<typeof memberSelfContract.checkinHistory>>;
export type MemberNotificationListParams = NonNullable<QueryOf<typeof memberSelfContract.notifications>>;
export type MemberLoginLogParams = NonNullable<QueryOf<typeof memberSelfContract.loginLogs>>;

export interface MemberListParams {
  page: number;
  pageSize: number;
  [key: string]: string | number | undefined;
}

export const memberKeys = {
  me: contractKey(memberAuthContract.me),
  points: {
    account: contractKey(memberSelfContract.pointAccount),
    transactions: contractKey(memberSelfContract.pointTransactions),
  },
  wallet: {
    detail: contractKey(memberSelfContract.wallet),
    transactions: contractKey(memberSelfContract.walletTransactions),
  },
  paymentOptions: contractKey(memberSelfContract.paymentOptions),
  coupons: {
    lists: contractKey(memberSelfContract.coupons),
    list: (params: MemberCouponListParams) => contractKey(memberSelfContract.coupons, { query: params }),
    available: contractKey(memberSelfContract.availableCoupons),
    exchangeable: contractKey(memberSelfContract.exchangeableCoupons),
  },
  levels: contractKey(memberSelfContract.levels),
  loginLogs: {
    lists: contractKey(memberSelfContract.loginLogs),
    list: (params: MemberLoginLogParams) => contractKey(memberSelfContract.loginLogs, { query: params }),
  },
  checkin: {
    status: contractKey(memberSelfContract.checkinStatus),
    milestones: contractKey(memberSelfContract.checkinMilestones),
    historyLists: contractKey(memberSelfContract.checkinHistory),
    history: (params: MemberCheckinHistoryParams) => contractKey(memberSelfContract.checkinHistory, { query: params }),
  },
  benefits: contractKey(memberSelfContract.benefits),
  notifications: {
    lists: contractKey(memberSelfContract.notifications),
    list: (params: MemberNotificationListParams) => contractKey(memberSelfContract.notifications, { query: params }),
    unreadCount: contractKey(memberSelfContract.unreadCount),
  },
  invite: contractKey(memberSelfContract.inviteSummary),
  renewal: {
    info: (applicationId?: number) => contractKey(memberRenewalContract.info, { query: { applicationId: applicationId ?? 0 } }),
    plans: (applicationId?: number) => contractKey(memberRenewalContract.plans, { query: { applicationId: applicationId ?? 0 } }),
  },
  subscriptions: {
    all: ['member', 'cms-subscriptions'] as const,
    lists: ['member', 'cms-subscriptions', 'list'] as const,
    list: (params: MemberListParams) => ['member', 'cms-subscriptions', 'list', params] as const,
    detail: (id: number | undefined) => ['member', 'cms-subscriptions', 'detail', id] as const,
  },
};

/** 积分 / 钱包 / 优惠券 / 签到等自助资源都挂在 /api/member 之下，资料变更后按资源根整体回源 */
const memberSelfAll = [resourceKeyOf(memberSelfContract.basePath)] as const;

// ─── 账户 / 积分 / 钱包 ──────────────────────────────────────────────────────

export function useMemberMe() {
  return useQuery(apiQueryOptions(memberAuthContract.me, { requestOptions: silentMemberClient }));
}

export function useMemberPointAccount() {
  return useQuery(apiQueryOptions(memberSelfContract.pointAccount, { requestOptions: silentMemberClient }));
}

export function useMemberWallet() {
  return useQuery(apiQueryOptions(memberSelfContract.wallet, { requestOptions: silentMemberClient }));
}

export function useMemberPaymentOptions() {
  return useQuery(apiQueryOptions(memberSelfContract.paymentOptions, { requestOptions: silentMemberClient, staleTime: 60_000 }));
}

/** 积分 / 钱包流水共用同一张表格，按契约操作切换数据源 */
export function useMemberTransactions(op: MemberTransactionOp, params: { page: number; pageSize: number }) {
  return useQuery({
    queryKey: contractKey(op, { query: params }),
    queryFn: () => api(op, { query: params }, silentMemberClient),
    placeholderData: keepPreviousData,
  });
}

export function useCreateRechargeOrder() {
  return useApiMutation(memberSelfContract.recharge, {
    requestOptions: memberClient,
    // 充值满减券在下单时锁定，钱包余额随支付回调变化
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: memberKeys.wallet.detail });
      void qc.invalidateQueries({ queryKey: memberKeys.wallet.transactions });
      void qc.invalidateQueries({ queryKey: memberKeys.coupons.lists });
    },
  });
}

// ─── 优惠券 ──────────────────────────────────────────────────────────────────

export function useMemberCouponList(params: MemberCouponListParams) {
  return useQuery(apiQueryOptions(memberSelfContract.coupons, { query: params }, { requestOptions: silentMemberClient, placeholderData: keepPreviousData }));
}

export function useInfiniteMemberCoupons(pageSize = 10) {
  return useInfiniteQuery({
    queryKey: memberKeys.coupons.list({ page: 1, pageSize }),
    queryFn: ({ pageParam }) => api(memberSelfContract.coupons, { query: { page: pageParam, pageSize } }, silentMemberClient),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.page * lastPage.pageSize;
      return loaded < lastPage.total ? lastPage.page + 1 : undefined;
    },
  });
}

export function useAvailableCoupons() {
  return useQuery(apiQueryOptions(memberSelfContract.availableCoupons, { requestOptions: silentMemberClient }));
}

export function useExchangeableCoupons() {
  return useQuery(apiQueryOptions(memberSelfContract.exchangeableCoupons, { requestOptions: silentMemberClient }));
}

/** 领券改变我的券列表与模板剩余量（可领取列表按剩余量过滤） */
function invalidateCoupons(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: memberKeys.coupons.lists });
  void qc.invalidateQueries({ queryKey: memberKeys.coupons.available });
  void qc.invalidateQueries({ queryKey: memberKeys.coupons.exchangeable });
}

export function useReceiveCoupon() {
  return useApiMutation(memberSelfContract.receiveCoupon, {
    requestOptions: memberClient,
    invalidate: invalidateCoupons,
  });
}

/** 积分兑换同时扣减积分账户并写积分流水 */
export function useExchangeCoupon() {
  return useApiMutation(memberSelfContract.exchangeCoupon, {
    requestOptions: memberClient,
    invalidate: (qc) => {
      invalidateCoupons(qc);
      void qc.invalidateQueries({ queryKey: memberKeys.points.account });
      void qc.invalidateQueries({ queryKey: memberKeys.points.transactions });
    },
  });
}

// ─── 等级 / 权益 ─────────────────────────────────────────────────────────────

export function useMemberLevels() {
  return useQuery(apiQueryOptions(memberSelfContract.levels, { requestOptions: silentMemberClient }));
}

export function useMyBenefits() {
  return useQuery(apiQueryOptions(memberSelfContract.benefits, { requestOptions: silentMemberClient }));
}

// ─── 登录历史 ────────────────────────────────────────────────────────────────

export function useMemberLoginLogs(params: MemberLoginLogParams) {
  return useQuery(apiQueryOptions(memberSelfContract.loginLogs, { query: params }, { requestOptions: memberClient, placeholderData: keepPreviousData }));
}

// ─── 签到 ────────────────────────────────────────────────────────────────────

export function useCheckinStatus() {
  return useQuery(apiQueryOptions(memberSelfContract.checkinStatus, { requestOptions: silentMemberClient }));
}

export function useCheckinMilestones() {
  return useQuery(apiQueryOptions(memberSelfContract.checkinMilestones, { requestOptions: silentMemberClient }));
}

export function useCheckinHistory(params: MemberCheckinHistoryParams) {
  return useQuery(apiQueryOptions(memberSelfContract.checkinHistory, { query: params }, { requestOptions: silentMemberClient, placeholderData: keepPreviousData }));
}

/** 日历视图：一次取整月（最多 31 条）签到记录 */
export function useCheckinCalendar(monthKey: string, dateStart: string, dateEnd: string) {
  return useQuery({
    queryKey: [...memberKeys.checkin.historyLists, 'calendar', monthKey, dateStart, dateEnd] as const,
    queryFn: () => api(memberSelfContract.checkinHistory, { query: { page: 1, pageSize: 31, dateStart, dateEnd } }, silentMemberClient),
  });
}

/** 签到 / 补签同时发放积分与经验：签到状态、历史、里程碑与积分账户一并回源 */
function invalidateCheckin(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: memberKeys.checkin.status });
  void qc.invalidateQueries({ queryKey: memberKeys.checkin.historyLists });
  void qc.invalidateQueries({ queryKey: memberKeys.checkin.milestones });
  void qc.invalidateQueries({ queryKey: memberKeys.points.account });
  void qc.invalidateQueries({ queryKey: memberKeys.points.transactions });
}

export function useMemberCheckin() {
  return useApiMutation(memberSelfContract.checkin, { requestOptions: memberClient, invalidate: invalidateCheckin });
}

export function useMakeupCheckin() {
  return useApiMutation(memberSelfContract.makeupCheckin, { requestOptions: memberClient, invalidate: invalidateCheckin });
}

// ─── 通知 / 邀请 / 注销 ─────────────────────────────────────────────────────

export function useMyNotifications(params: MemberNotificationListParams) {
  return useQuery(apiQueryOptions(memberSelfContract.notifications, { query: params }, { requestOptions: memberClient, placeholderData: keepPreviousData }));
}

export function useUnreadNotificationCount(enabled = true) {
  return useQuery(apiQueryOptions(memberSelfContract.unreadCount, { requestOptions: silentMemberClient, enabled, refetchInterval: 60_000 }));
}

function invalidateNotifications(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: memberKeys.notifications.lists });
  void qc.invalidateQueries({ queryKey: memberKeys.notifications.unreadCount });
}

export function useMarkNotificationRead() {
  return useApiMutation(memberSelfContract.markRead, { requestOptions: memberClient, invalidate: invalidateNotifications });
}

export function useMarkAllNotificationsRead() {
  return useApiMutation(memberSelfContract.markAllRead, { requestOptions: memberClient, invalidate: invalidateNotifications });
}

export function useInviteSummary() {
  return useQuery(apiQueryOptions(memberSelfContract.inviteSummary, { requestOptions: memberClient }));
}

export function useDeactivateAccount() {
  return useApiMutation(memberAuthContract.deactivate, { requestOptions: memberClient });
}

// ─── 自动续费 ─────────────────────────────────────────────────────────────────

export function useMyRenewal(applicationId?: number) {
  return useQuery(apiQueryOptions(
    memberRenewalContract.info,
    { query: { applicationId: applicationId ?? 0 } },
    { requestOptions: silentMemberClient, enabled: applicationId != null },
  ));
}

export function useRenewalPlans(applicationId?: number) {
  return useQuery(apiQueryOptions(
    memberRenewalContract.plans,
    { query: { applicationId: applicationId ?? 0 } },
    { requestOptions: silentMemberClient, enabled: applicationId != null },
  ));
}

/** 签约 / 扣款改变协议状态与 VIP 到期时间（会员资料中的 vipExpireAt） */
function invalidateRenewal(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: contractKey(memberRenewalContract.info) });
  void qc.invalidateQueries({ queryKey: memberKeys.me });
}

export function useSignRenewal() {
  return useApiMutation(memberRenewalContract.sign, { requestOptions: memberClient, invalidate: invalidateRenewal });
}

export function useTerminateRenewal() {
  return useApiMutation(memberRenewalContract.terminate, {
    requestOptions: memberClient,
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: contractKey(memberRenewalContract.info) }),
  });
}

export function useRenewNow() {
  return useApiMutation(memberRenewalContract.deduct, { requestOptions: memberClient, invalidate: invalidateRenewal });
}

// ─── 账号 ────────────────────────────────────────────────────────────────────

export function useResetMemberPassword() {
  return useApiMutation(memberAuthContract.resetPassword, { requestOptions: silentMemberClient });
}

export function useChangeMemberPassword() {
  return useApiMutation(memberAuthContract.changePassword, { requestOptions: memberClient });
}

/** 资料变更（昵称 / 头像）会出现在会员端所有展示处，整个会员端缓存回源 */
export function useUpdateMemberProfile() {
  return useApiMutation(memberAuthContract.updateProfile, {
    requestOptions: memberClient,
    invalidate: (qc, saved) => {
      qc.setQueryData(memberKeys.me, saved);
      void qc.invalidateQueries({ queryKey: memberSelfAll });
    },
  });
}

export function useUploadMemberAvatar() {
  return useMutation({
    mutationFn: (formData: FormData) =>
      memberRequest.post<{ url: string }>('/api/member/files/avatar', formData).then(unwrap),
  });
}

// ─── CMS 会员投稿（P3）────────────────────────────────────────────────────────
export const contributionKeys = {
  all: ['member', 'contributions'] as const,
  lists: ['member', 'contributions', 'list'] as const,
  list: (params: object) => ['member', 'contributions', 'list', params] as const,
  detail: (id: number | undefined) => ['member', 'contributions', 'detail', id ?? null] as const,
  channels: ['member', 'contributions', 'channels'] as const,
};

export function useContribChannels() {
  return useQuery({
    queryKey: contributionKeys.channels,
    queryFn: () => memberRequest.get<CmsContribSite[]>('/api/member/cms/channels').then(unwrap),
    staleTime: 5 * 60 * 1000,
  });
}

export function useMyContributions(params: { page: number; pageSize: number; status?: string }) {
  return useQuery({
    queryKey: contributionKeys.list(params),
    queryFn: () => memberRequest.get<PaginatedResponse<CmsContribution>>(`/api/member/cms/contributions${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useMyContribution(id: number | undefined) {
  return useQuery({
    queryKey: contributionKeys.detail(id),
    queryFn: () => memberRequest.get<CmsContribution>(`/api/member/cms/contributions/${id}`).then(unwrap),
    enabled: !!id,
  });
}

export function useSaveContribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id
        ? memberRequest.put<CmsContribution>(`/api/member/cms/contributions/${id}`, values)
        : memberRequest.post<CmsContribution>('/api/member/cms/contributions', values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: contributionKeys.all }),
  });
}

export function useDeleteContribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => memberRequest.delete<null>(`/api/member/cms/contributions/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: contributionKeys.all }),
  });
}

// ─── CMS 会员订阅 ────────────────────────────────────────────────────────────
export function useMyCmsSubscriptions(params: MemberListParams & { subjectType?: string }) {
  return useQuery({
    queryKey: memberKeys.subscriptions.list(params),
    queryFn: () => memberRequest.get<PaginatedResponse<CmsMemberSubscription>>(
      `/api/member/cms/subscriptions${toQueryString(params)}`,
    ).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useUpdateCmsSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notificationEnabled }: { id: number; notificationEnabled: boolean }) =>
      memberRequest.put<CmsMemberSubscription>(`/api/member/cms/subscriptions/${id}`, { notificationEnabled }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberKeys.subscriptions.all }),
  });
}

export function useCancelCmsSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      memberRequest.delete<CmsMemberSubscription>(`/api/member/cms/subscriptions/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: memberKeys.subscriptions.all }),
  });
}

// ─── CMS 会员互动：收藏 / 浏览历史（P3）───────────────────────────────────────
export const cmsInteractionKeys = {
  favorites: (params: object) => ['member', 'cms-favorites', params] as const,
  favoritesAll: ['member', 'cms-favorites'] as const,
  history: (params: object) => ['member', 'cms-history', params] as const,
  historyAll: ['member', 'cms-history'] as const,
};

export function useMyCmsFavorites(params: { page: number; pageSize: number }) {
  return useQuery({
    queryKey: cmsInteractionKeys.favorites(params),
    queryFn: () => memberRequest.get<PaginatedResponse<CmsMemberContentItem>>(`/api/member/cms/favorites${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useRemoveCmsFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contentId: number) => memberRequest.delete<unknown>(`/api/member/cms/contents/${contentId}/favorite`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsInteractionKeys.favoritesAll }),
  });
}

export function useMyCmsViewHistory(params: { page: number; pageSize: number }) {
  return useQuery({
    queryKey: cmsInteractionKeys.history(params),
    queryFn: () => memberRequest.get<PaginatedResponse<CmsMemberContentItem>>(`/api/member/cms/view-history${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useClearCmsViewHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => memberRequest.delete<null>('/api/member/cms/view-history').then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsInteractionKeys.historyAll }),
  });
}

// ─── CMS 我的评论（P1 评论会员化）─────────────────────────────────────────────
export const cmsMyCommentKeys = {
  all: ['member', 'cms-comments'] as const,
  list: (params: object) => ['member', 'cms-comments', params] as const,
};

export function useMyCmsComments(params: { page: number; pageSize: number }) {
  return useQuery({
    queryKey: cmsMyCommentKeys.list(params),
    queryFn: () => memberRequest.get<PaginatedResponse<CmsMemberComment>>(`/api/member/cms/comments${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useDeleteMyCmsComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => memberRequest.delete<null>(`/api/member/cms/comments/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsMyCommentKeys.all }),
  });
}
