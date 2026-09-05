import { mpStatsContract, type MpDatacube, type MpStats } from '@zenith/shared/mp';
import { mock } from '@/mocks/utils/contract';
import { badRequest } from '@/mocks/utils/handlers';
import { mockMpFans } from '@/mocks/data/mp-fans';
import { mockMpTags } from '@/mocks/data/mp-tags';
import { mockMpMessages } from '@/mocks/data/mp-messages';
import { mockMpAutoReplies } from '@/mocks/data/mp-auto-replies';
import { mockMpMaterials } from '@/mocks/data/mp-materials';
import { mockMpDrafts } from '@/mocks/data/mp-drafts';

function formatDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function last7Days(): string[] {
  const days: string[] = [];
  const today = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(formatDay(d));
  }
  return days;
}

/** 起止日期（含）之间的每一天，供数据立方按日铺数 */
function daysBetween(beginDate: string, endDate: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${beginDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  while (cursor <= end) {
    out.push(formatDay(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export const mpStatsHandlers = [
  mock(mpStatsContract.overview, ({ query, ok }) => {
    const fans = mockMpFans.filter((f) => f.accountId === query.accountId);
    const days = last7Days();
    const stats: MpStats = {
      fanTotal: fans.length,
      fanSubscribed: fans.filter((f) => f.subscribe === 'subscribed').length,
      fanUnsubscribed: fans.filter((f) => f.subscribe === 'unsubscribed').length,
      tagTotal: mockMpTags.filter((t) => t.accountId === query.accountId).length,
      materialTotal: mockMpMaterials.filter((m) => m.accountId === query.accountId).length,
      draftTotal: mockMpDrafts.filter((d) => d.accountId === query.accountId).length,
      messageIn: mockMpMessages.filter((m) => m.accountId === query.accountId && m.direction === 'in').length,
      messageOut: mockMpMessages.filter((m) => m.accountId === query.accountId && m.direction === 'out').length,
      autoReplyTotal: mockMpAutoReplies.filter((r) => r.accountId === query.accountId).length,
      fanTrend: days.map((date, i) => ({ date, count: [1, 0, 2, 1, 3, 2, 1][i] ?? 0 })),
      messageTrend: days.map((date, i) => ({ date, in: [2, 1, 3, 2, 4, 1, 2][i] ?? 0, out: [1, 1, 2, 1, 3, 1, 1][i] ?? 0 })),
    };
    return ok(stats);
  }),

  mock(mpStatsContract.datacube, ({ query, ok }) => {
    const days = daysBetween(query.beginDate, query.endDate);
    if (days.length === 0) return badRequest('日期范围无效', { status: 400 });
    if (days.length > 7) return badRequest('查询跨度不能超过 7 天', { status: 400 });
    const cube: MpDatacube = {
      beginDate: query.beginDate,
      endDate: query.endDate,
      userSummary: days.map((refDate, i) => ({ refDate, newUser: 3 + (i % 3), cancelUser: i % 2 })),
      userCumulate: days.map((refDate, i) => ({ refDate, cumulateUser: 120 + i * 3 })),
      upstreamMsg: days.map((refDate, i) => ({ refDate, msgUser: 4 + (i % 4), msgCount: 9 + i })),
      articleSummary: days.map((refDate, i) => ({ refDate, pageReadCount: 40 + i * 7 })),
      userShare: days.map((refDate, i) => ({ refDate, shareCount: 2 + (i % 3), shareUser: 1 + (i % 2) })),
      interfaceSummary: days.map((refDate, i) => ({ refDate, callbackCount: 30 + i * 2, failCount: i % 2, totalTimeCost: 1200 + i * 50, maxTimeCost: 300 + i * 10 })),
    };
    return ok(cube);
  }),
];
