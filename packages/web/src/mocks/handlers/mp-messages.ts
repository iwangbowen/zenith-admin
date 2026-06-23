import { http, HttpResponse } from 'msw';
import { mockMpMessages, getNextMpMessageId } from '@/mocks/data/mp-messages';
import { mockMpFans } from '@/mocks/data/mp-fans';
import { mockDateTime } from '@/mocks/utils/date';
import type { MpMessage, MpConversation } from '@zenith/shared';

export const mpMessagesHandlers = [
  http.get('/api/mp/messages/conversations', ({ request }) => {
    const url = new URL(request.url);
    const accountId = Number(url.searchParams.get('accountId') ?? '0');
    const msgs = mockMpMessages.filter((m) => m.accountId === accountId);
    const byOpenid = new Map<string, MpMessage[]>();
    for (const m of msgs) {
      const arr = byOpenid.get(m.openid) ?? [];
      arr.push(m);
      byOpenid.set(m.openid, arr);
    }
    const list: MpConversation[] = [];
    for (const [openid, arr] of byOpenid) {
      const sorted = [...arr].sort((a, b) => a.id - b.id);
      const last = sorted[sorted.length - 1];
      const fan = mockMpFans.find((f) => f.accountId === accountId && f.openid === openid);
      list.push({
        openid,
        nickname: fan?.nickname ?? null,
        avatar: fan?.avatar ?? null,
        lastContent: last.content,
        lastMsgType: last.msgType,
        lastDirection: last.direction,
        lastTime: last.createdAt,
        messageCount: arr.length,
      });
    }
    list.sort((a, b) => (a.lastTime < b.lastTime ? 1 : -1));
    return HttpResponse.json({ code: 0, message: 'ok', data: list });
  }),

  http.get('/api/mp/messages', ({ request }) => {
    const url = new URL(request.url);
    const accountId = Number(url.searchParams.get('accountId') ?? '0');
    const openid = url.searchParams.get('openid') ?? '';
    const direction = url.searchParams.get('direction') ?? '';
    const msgType = url.searchParams.get('msgType') ?? '';
    const keyword = url.searchParams.get('keyword') ?? '';
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
    const filtered = mockMpMessages.filter((m) => {
      if (m.accountId !== accountId) return false;
      if (openid && m.openid !== openid) return false;
      if (direction && m.direction !== direction) return false;
      if (msgType && m.msgType !== msgType) return false;
      if (keyword && !(m.content ?? '').includes(keyword)) return false;
      return true;
    });
    const total = filtered.length;
    const sorted = [...filtered].sort((a, b) => b.id - a.id);
    const list = sorted.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  http.post('/api/mp/messages/send', async ({ request }) => {
    const body = await request.json() as { accountId: number; openid: string; content: string };
    const now = mockDateTime();
    const item: MpMessage = {
      id: getNextMpMessageId(),
      accountId: body.accountId,
      openid: body.openid,
      direction: 'out',
      msgType: 'text',
      content: body.content,
      mediaId: null,
      mediaUrl: null,
      event: null,
      msgId: null,
      status: 'sent',
      errorMsg: null,
      createdAt: now,
    };
    mockMpMessages.push(item);
    return HttpResponse.json({ code: 0, message: '发送成功', data: item });
  }),
];
