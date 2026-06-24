import { wechatApiPost } from './api';
import type { MpCredential } from './api';

/** 数据立方各接口最大查询跨度（天）。微信限制大多为 7 天。 */
export const DATACUBE_MAX_SPAN_DAYS = 7;

interface UserSummaryRow { ref_date: string; user_source?: number; new_user?: number; cancel_user?: number }
interface UserCumulateRow { ref_date: string; cumulate_user?: number }
interface UpstreamMsgRow { ref_date: string; msg_type?: number; msg_user?: number; msg_count?: number }
interface ArticleSummaryRow { ref_date: string; int_page_read_count?: number; ori_page_read_count?: number }

interface ListResponse<T> { errcode?: number; errmsg?: string; list?: T[] }

/** 用户增减（按日聚合各来源的 new_user / cancel_user） */
export async function getUserSummary(account: MpCredential, beginDate: string, endDate: string): Promise<{ refDate: string; newUser: number; cancelUser: number }[]> {
  const data = await wechatApiPost<ListResponse<UserSummaryRow>>(account, '/datacube/getusersummary', { begin_date: beginDate, end_date: endDate });
  const map = new Map<string, { newUser: number; cancelUser: number }>();
  for (const r of data.list ?? []) {
    const cur = map.get(r.ref_date) ?? { newUser: 0, cancelUser: 0 };
    cur.newUser += r.new_user ?? 0;
    cur.cancelUser += r.cancel_user ?? 0;
    map.set(r.ref_date, cur);
  }
  return [...map.entries()].map(([refDate, v]) => ({ refDate, ...v })).sort((a, b) => a.refDate.localeCompare(b.refDate));
}

/** 累计用户 */
export async function getUserCumulate(account: MpCredential, beginDate: string, endDate: string): Promise<{ refDate: string; cumulateUser: number }[]> {
  const data = await wechatApiPost<ListResponse<UserCumulateRow>>(account, '/datacube/getusercumulate', { begin_date: beginDate, end_date: endDate });
  return (data.list ?? []).map((r) => ({ refDate: r.ref_date, cumulateUser: r.cumulate_user ?? 0 })).sort((a, b) => a.refDate.localeCompare(b.refDate));
}

/** 消息发送概况（按日聚合各消息类型的发送人数 / 条数） */
export async function getUpstreamMsg(account: MpCredential, beginDate: string, endDate: string): Promise<{ refDate: string; msgUser: number; msgCount: number }[]> {
  const data = await wechatApiPost<ListResponse<UpstreamMsgRow>>(account, '/datacube/getupstreammsg', { begin_date: beginDate, end_date: endDate });
  const map = new Map<string, { msgUser: number; msgCount: number }>();
  for (const r of data.list ?? []) {
    const cur = map.get(r.ref_date) ?? { msgUser: 0, msgCount: 0 };
    cur.msgUser += r.msg_user ?? 0;
    cur.msgCount += r.msg_count ?? 0;
    map.set(r.ref_date, cur);
  }
  return [...map.entries()].map(([refDate, v]) => ({ refDate, ...v })).sort((a, b) => a.refDate.localeCompare(b.refDate));
}

/** 图文阅读概况（按日聚合页面阅读数） */
export async function getArticleSummary(account: MpCredential, beginDate: string, endDate: string): Promise<{ refDate: string; pageReadCount: number }[]> {
  const data = await wechatApiPost<ListResponse<ArticleSummaryRow>>(account, '/datacube/getarticlesummary', { begin_date: beginDate, end_date: endDate });
  const map = new Map<string, number>();
  for (const r of data.list ?? []) {
    map.set(r.ref_date, (map.get(r.ref_date) ?? 0) + (r.int_page_read_count ?? 0) + (r.ori_page_read_count ?? 0));
  }
  return [...map.entries()].map(([refDate, pageReadCount]) => ({ refDate, pageReadCount })).sort((a, b) => a.refDate.localeCompare(b.refDate));
}
