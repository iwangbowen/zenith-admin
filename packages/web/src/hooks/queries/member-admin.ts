import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { resourceKeyOf } from '@zenith/shared/core';
import {
  checkinMilestoneContract,
  checkinRuleContract,
  checkinSettingsContract,
  couponContract,
  memberCheckinContract,
  memberContract,
  memberLevelContract,
  memberPointContract,
  memberRechargeContract,
  memberStatsContract,
  memberTagContract,
  memberWalletContract,
  type CheckinMilestone,
  type CheckinRule,
  type Member,
  type MemberLevel,
  type MemberTag,
} from '@zenith/shared/member';
import { api, apiQueryOptions, contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { memberLookupKeys } from './members-lookup';

export type MemberListParams = NonNullable<QueryOf<typeof memberContract.list>>;
export type MemberLoginLogListParams = NonNullable<QueryOf<typeof memberContract.loginLogs>>;
export type MemberPointTransactionListParams = NonNullable<QueryOf<typeof memberPointContract.transactions>>;
export type MemberWalletTransactionListParams = NonNullable<QueryOf<typeof memberWalletContract.transactions>>;
export type MemberRechargeListParams = NonNullable<QueryOf<typeof memberRechargeContract.list>>;
export type CouponListParams = NonNullable<QueryOf<typeof couponContract.list>>;
export type CouponRecordListParams = NonNullable<QueryOf<typeof couponContract.records>>;
export type CheckinLogListParams = NonNullable<QueryOf<typeof memberCheckinContract.list>>;

/**
 * 会员表单载荷：编辑走 update（手机号 / 邮箱 / 头像允许置 null 清空），
 * 新增走 create（额外可填用户名与初始密码），同一表单服务两种场景。
 */
export type MemberFormValues = Partial<BodyOf<typeof memberContract.update>> & Pick<Partial<BodyOf<typeof memberContract.create>>, 'username' | 'password'>;
export type MemberTagFormValues = Partial<BodyOf<typeof memberTagContract.create>>;
export type MemberLevelFormValues = Partial<BodyOf<typeof memberLevelContract.create>>;
export type CheckinRuleFormValues = Partial<BodyOf<typeof checkinRuleContract.create>>;
export type CheckinMilestoneFormValues = Partial<BodyOf<typeof checkinMilestoneContract.create>>;

// ─── 会员（标准资源）────────────────────────────────────────────────────────

const memberResource = createResourceQueries(memberContract, {
  onDeleted: (qc, ids) => {
    for (const id of ids) qc.removeQueries({ queryKey: memberAdminKeys.memberOverview(id) });
    invalidate(qc, [memberAdminKeys.levels, memberAdminKeys.stats, memberLookupKeys.optionsRoot]);
  },
});

const couponResource = createResourceQueries(couponContract, {
  // 看板统计可用券数；领券记录随模板级联删除
  onSaved: (qc) => invalidate(qc, [memberAdminKeys.stats]),
  onDeleted: (qc) => invalidate(qc, [memberAdminKeys.couponRecords, memberAdminKeys.stats]),
});

export const memberAdminKeys = {
  members: memberResource.keys.all,
  memberLists: memberResource.keys.lists,
  memberList: memberResource.keys.list,
  memberOverviews: contractKey(memberContract.overview),
  memberOverview: (id: number | null | undefined) => contractKey(memberContract.overview, { params: { id: id ?? 0 } }),
  levels: contractKey(memberLevelContract.list),
  levelDetail: (id: number | undefined) => contractKey(memberLevelContract.detail, { params: { id: id ?? 0 } }),
  memberTags: contractKey(memberTagContract.list),
  points: [resourceKeyOf(memberPointContract.basePath)] as const,
  pointLists: contractKey(memberPointContract.transactions),
  pointList: (params: MemberPointTransactionListParams) => contractKey(memberPointContract.transactions, { query: params }),
  wallets: [resourceKeyOf(memberWalletContract.basePath)] as const,
  walletLists: contractKey(memberWalletContract.transactions),
  walletList: (params: MemberWalletTransactionListParams) => contractKey(memberWalletContract.transactions, { query: params }),
  rechargeLists: contractKey(memberRechargeContract.list),
  rechargeList: (params: MemberRechargeListParams) => contractKey(memberRechargeContract.list, { query: params }),
  loginLogLists: contractKey(memberContract.loginLogs),
  loginLogList: (params: MemberLoginLogListParams) => contractKey(memberContract.loginLogs, { query: params }),
  stats: [resourceKeyOf(memberStatsContract.basePath)] as const,
  statsOverview: contractKey(memberStatsContract.overview),
  statsCharts: contractKey(memberStatsContract.charts),
  coupons: couponResource.keys.all,
  couponLists: couponResource.keys.lists,
  couponList: couponResource.keys.list,
  couponRecords: contractKey(couponContract.records),
  couponRecordList: (params: CouponRecordListParams) => contractKey(couponContract.records, { query: params }),
  couponByCode: (code: string) => contractKey(couponContract.byCode, { params: { code } }),
  checkinRules: contractKey(checkinRuleContract.list),
  checkinSettings: contractKey(checkinSettingsContract.get),
  checkinMilestones: contractKey(checkinMilestoneContract.list),
  checkinLogs: [resourceKeyOf(memberCheckinContract.basePath)] as const,
  checkinLogLists: contractKey(memberCheckinContract.list),
  checkinLogList: (params: CheckinLogListParams) => contractKey(memberCheckinContract.list, { query: params }),
  checkinCalendar: (month: string) => contractKey(memberCheckinContract.calendar, { query: { month } }),
  checkinDayMembers: (date: string) => [resourceKeyOf(memberCheckinContract.basePath), 'day-members', date] as const,
};

/** 精准失效：只失效受影响的资源段，避免全量失效造成跨模块缓存污染 */
function invalidate(qc: QueryClient, keys: ReadonlyArray<readonly unknown[]>) {
  for (const key of keys) void qc.invalidateQueries({ queryKey: key });
}

/** 会员数据变动：列表 / 概览 / 下拉源（MemberSelect 等）一并回源 */
function invalidateMembers(qc: QueryClient) {
  invalidate(qc, [memberAdminKeys.memberLists, memberAdminKeys.memberOverviews, memberLookupKeys.optionsRoot]);
}

/** 签到规则 / 设置 / 里程碑 / 记录 / 日历互相影响（规则决定奖励、记录决定日历），整体回源 */
function invalidateCheckins(qc: QueryClient) {
  invalidate(qc, [memberAdminKeys.checkinRules, memberAdminKeys.checkinSettings, memberAdminKeys.checkinMilestones, memberAdminKeys.checkinLogs]);
}

export const useMemberList = memberResource.useList;
export const useMemberDetail = memberResource.useDetail;
/** 单个走 DELETE /{id}；同时移除概览缓存，并回源等级会员数、看板与下拉源 */
export const useDeleteMembers = memberResource.useDelete;

/** 保存会员：等级列表含各等级会员数、看板含会员总量、下拉源展示昵称 / 等级，写后一并回源 */
export function useSaveMember() {
  const qc = useQueryClient();
  return useMutation<Member, Error, { id?: number; values: MemberFormValues }>({
    mutationFn: ({ id, values }) =>
      id === undefined
        ? api(memberContract.create, { body: values as BodyOf<typeof memberContract.create> })
        : api(memberContract.update, { params: { id }, body: values }),
    onSuccess: (saved) => {
      qc.setQueryData(memberResource.keys.detail(saved.id), saved);
      invalidateMembers(qc);
      invalidate(qc, [memberAdminKeys.levels, memberAdminKeys.stats]);
    },
  });
}

export function useMemberOverview(id: number | null | undefined, enabled = true) {
  return useQuery(apiQueryOptions(memberContract.overview, { params: { id: id ?? 0 } }, { enabled: enabled && !!id }));
}

/** 密码不出现在任何已挂载的查询里，但详情 / 概览中的 hasPassword 需要回源 */
export function useResetMemberPassword() {
  return useApiMutation(memberContract.resetPassword, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: memberResource.keys.detail(params.id) });
      invalidateMembers(qc);
    },
  });
}

/** 成长值变动会自动重定级：等级会员数、看板与下拉源的等级名都需回源 */
export function useAdjustMemberGrowth() {
  return useApiMutation(memberContract.adjustGrowth, {
    invalidate: (qc, saved) => {
      qc.setQueryData(memberResource.keys.detail(saved.id), saved);
      invalidateMembers(qc);
      invalidate(qc, [memberAdminKeys.levels, memberAdminKeys.stats]);
    },
  });
}

export function useBatchMemberStatus() {
  return useApiMutation(memberContract.batchStatus, {
    invalidate: (qc, _output, { body }) => {
      for (const id of body.ids) void qc.invalidateQueries({ queryKey: memberResource.keys.detail(id) });
      invalidateMembers(qc);
      invalidate(qc, [memberAdminKeys.stats]);
    },
  });
}

export function useBatchMemberLevel() {
  return useApiMutation(memberContract.batchLevel, {
    invalidate: (qc, _output, { body }) => {
      for (const id of body.ids) void qc.invalidateQueries({ queryKey: memberResource.keys.detail(id) });
      invalidateMembers(qc);
      invalidate(qc, [memberAdminKeys.levels, memberAdminKeys.stats]);
    },
  });
}

// ─── 会员标签 ────────────────────────────────────────────────────────────────

export function useMemberTags() {
  return useApiQuery(memberTagContract.list);
}

/** 标签列表含绑定会员数，会员列表展示标签名与颜色，改名 / 换色后一并回源 */
export function useSaveMemberTag() {
  const qc = useQueryClient();
  return useMutation<MemberTag, Error, { id?: number; values: MemberTagFormValues }>({
    mutationFn: ({ id, values }) =>
      id === undefined
        ? api(memberTagContract.create, { body: values as BodyOf<typeof memberTagContract.create> })
        : api(memberTagContract.update, { params: { id }, body: values }),
    onSuccess: () => {
      invalidate(qc, [memberAdminKeys.memberTags]);
      invalidateMembers(qc);
    },
  });
}

/** 删除标签级联清除会员绑定，会员列表 / 概览的标签列需回源 */
export function useDeleteMemberTag() {
  return useApiMutation(memberTagContract.remove, {
    invalidate: (qc) => {
      invalidate(qc, [memberAdminKeys.memberTags]);
      invalidateMembers(qc);
    },
  });
}

export function useSetMemberTags() {
  return useApiMutation(memberContract.setTags, {
    invalidate: (qc, saved) => {
      qc.setQueryData(memberResource.keys.detail(saved.id), saved);
      invalidateMembers(qc);
      invalidate(qc, [memberAdminKeys.memberTags]);
    },
  });
}

export function useBatchMemberTags() {
  return useApiMutation(memberContract.batchTags, {
    invalidate: (qc, _output, { body }) => {
      for (const id of body.ids) void qc.invalidateQueries({ queryKey: memberResource.keys.detail(id) });
      invalidateMembers(qc);
      invalidate(qc, [memberAdminKeys.memberTags]);
    },
  });
}

// ─── 会员等级 ────────────────────────────────────────────────────────────────

export function useMemberLevels() {
  return useApiQuery(memberLevelContract.list);
}

/** 等级改名 / 改阈值影响会员列表的等级列与看板等级分布 */
export function useSaveMemberLevel() {
  const qc = useQueryClient();
  return useMutation<MemberLevel, Error, { id?: number; values: MemberLevelFormValues }>({
    mutationFn: ({ id, values }) =>
      id === undefined
        ? api(memberLevelContract.create, { body: values as BodyOf<typeof memberLevelContract.create> })
        : api(memberLevelContract.update, { params: { id }, body: values }),
    onSuccess: (saved) => {
      qc.setQueryData(memberAdminKeys.levelDetail(saved.id), saved);
      invalidate(qc, [memberAdminKeys.levels, memberAdminKeys.stats]);
      invalidateMembers(qc);
    },
  });
}

export function useDeleteMemberLevel() {
  return useApiMutation(memberLevelContract.remove, {
    invalidate: (qc, _output, { params }) => {
      qc.removeQueries({ queryKey: memberAdminKeys.levelDetail(params.id) });
      invalidate(qc, [memberAdminKeys.levels, memberAdminKeys.stats]);
      invalidateMembers(qc);
    },
  });
}

// ─── 积分 / 钱包 ─────────────────────────────────────────────────────────────

export function useMemberPointTransactions(params: MemberPointTransactionListParams) {
  return useQuery(apiQueryOptions(memberPointContract.transactions, { query: params }, { placeholderData: keepPreviousData }));
}

/** 会员列表的积分余额与概览的积分账户、看板积分总量随流水变化 */
export function useAdjustMemberPoints() {
  return useApiMutation(memberPointContract.adjust, {
    invalidate: (qc) => {
      invalidate(qc, [memberAdminKeys.points, memberAdminKeys.stats]);
      invalidateMembers(qc);
    },
  });
}

export function useMemberWalletTransactions(params: MemberWalletTransactionListParams) {
  return useQuery(apiQueryOptions(memberWalletContract.transactions, { query: params }, { placeholderData: keepPreviousData }));
}

export function useAdjustMemberWallet() {
  return useApiMutation(memberWalletContract.adjust, {
    invalidate: (qc) => {
      invalidate(qc, [memberAdminKeys.wallets, memberAdminKeys.stats]);
      invalidateMembers(qc);
    },
  });
}

export function useRefundMemberWallet() {
  return useApiMutation(memberWalletContract.refund, {
    invalidate: (qc) => {
      invalidate(qc, [memberAdminKeys.wallets, memberAdminKeys.stats]);
      invalidateMembers(qc);
    },
  });
}

// ─── 充值记录 / 登录日志 / 看板 ─────────────────────────────────────────────

export function useMemberRechargeList(params: MemberRechargeListParams) {
  return useQuery(apiQueryOptions(memberRechargeContract.list, { query: params }, { placeholderData: keepPreviousData }));
}

export function useMemberLoginLogList(params: MemberLoginLogListParams) {
  return useQuery(apiQueryOptions(memberContract.loginLogs, { query: params }, { placeholderData: keepPreviousData }));
}

export function useMemberStatsOverview() {
  return useApiQuery(memberStatsContract.overview);
}

export function useMemberStatsCharts() {
  return useApiQuery(memberStatsContract.charts);
}

// ─── 优惠券 ──────────────────────────────────────────────────────────────────

export const useCouponList = couponResource.useList;
export const useCouponDetail = couponResource.useDetail;
export const useSaveCoupon = couponResource.useSave;
/** 单个走 DELETE /{id}；模板删除级联清除券码，领券记录与看板一并回源 */
export const useDeleteCoupons = couponResource.useDelete;

/** 发券改变模板已发数量、会员概览持券数与看板可用券数 */
export function useIssueCoupon() {
  return useApiMutation(couponContract.issue, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: couponResource.keys.detail(params.id) });
      invalidate(qc, [memberAdminKeys.couponLists, memberAdminKeys.couponRecords, memberAdminKeys.memberOverviews, memberAdminKeys.stats]);
    },
  });
}

export function useCouponRecordList(params: CouponRecordListParams) {
  return useQuery(apiQueryOptions(couponContract.records, { query: params }, { placeholderData: keepPreviousData }));
}

export function useRevokeCouponRecord() {
  return useApiMutation(couponContract.revokeRecord, {
    invalidate: (qc) => invalidate(qc, [memberAdminKeys.couponRecords, memberAdminKeys.memberOverviews, memberAdminKeys.stats]),
  });
}

export function useCouponByCode(code: string, enabled: boolean) {
  return useQuery(apiQueryOptions(couponContract.byCode, { params: { code } }, { enabled: enabled && code.length >= 4, retry: false }));
}

export function useRedeemCoupon() {
  return useApiMutation(couponContract.redeem, {
    invalidate: (qc, redeemed) => {
      qc.setQueryData(memberAdminKeys.couponByCode(redeemed.code), redeemed);
      invalidate(qc, [memberAdminKeys.couponRecords, memberAdminKeys.memberOverviews, memberAdminKeys.stats]);
    },
  });
}

// ─── 签到 ────────────────────────────────────────────────────────────────────

export function useCheckinRules() {
  return useApiQuery(checkinRuleContract.list);
}

export function useCheckinSettings(enabled = true) {
  return useApiQuery(checkinSettingsContract.get, { enabled });
}

export function useSaveCheckinSettings() {
  return useApiMutation(checkinSettingsContract.update, {
    invalidate: (qc, saved) => {
      qc.setQueryData(memberAdminKeys.checkinSettings, saved);
      invalidateCheckins(qc);
    },
  });
}

export function useSaveCheckinRule() {
  const qc = useQueryClient();
  return useMutation<CheckinRule, Error, { id?: number; values: CheckinRuleFormValues }>({
    mutationFn: ({ id, values }) =>
      id === undefined
        ? api(checkinRuleContract.create, { body: values as BodyOf<typeof checkinRuleContract.create> })
        : api(checkinRuleContract.update, { params: { id }, body: values }),
    onSuccess: () => invalidateCheckins(qc),
  });
}

export function useDeleteCheckinRule() {
  return useApiMutation(checkinRuleContract.remove, { invalidate: invalidateCheckins });
}

export function useCheckinLogList(params: CheckinLogListParams) {
  return useQuery(apiQueryOptions(memberCheckinContract.list, { query: params }, { placeholderData: keepPreviousData }));
}

export function useCheckinCalendar(month: string, enabled = true) {
  return useQuery(apiQueryOptions(memberCheckinContract.calendar, { query: { month } }, { placeholderData: keepPreviousData, enabled }));
}

/** 日历悬浮层分页大小 */
export const CHECKIN_DAY_PAGE_SIZE = 20;

/** 某日签到会员无限分页（日历悬浮层懒加载，防止大名单全量下发） */
export function useCheckinDayMembersInfinite(date: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: memberAdminKeys.checkinDayMembers(date),
    queryFn: ({ pageParam }) =>
      api(memberCheckinContract.list, { query: { page: pageParam, pageSize: CHECKIN_DAY_PAGE_SIZE, dateStart: date, dateEnd: date } }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      (lastPage.page * lastPage.pageSize < lastPage.total ? lastPage.page + 1 : undefined),
    enabled,
  });
}

/** 补签联动签到记录、积分流水、会员概览与看板 */
export function useMakeupCheckin() {
  return useApiMutation(memberContract.makeupCheckin, {
    invalidate: (qc) => {
      invalidateCheckins(qc);
      invalidate(qc, [memberAdminKeys.points, memberAdminKeys.stats]);
      invalidateMembers(qc);
    },
  });
}

export function useCheckinMilestones() {
  return useApiQuery(checkinMilestoneContract.list);
}

export function useSaveCheckinMilestone() {
  const qc = useQueryClient();
  return useMutation<CheckinMilestone, Error, { id?: number; values: CheckinMilestoneFormValues }>({
    mutationFn: ({ id, values }) =>
      id === undefined
        ? api(checkinMilestoneContract.create, { body: values as BodyOf<typeof checkinMilestoneContract.create> })
        : api(checkinMilestoneContract.update, { params: { id }, body: values }),
    onSuccess: () => invalidateCheckins(qc),
  });
}

export function useDeleteCheckinMilestone() {
  return useApiMutation(checkinMilestoneContract.remove, { invalidate: invalidateCheckins });
}
