import { mpMessageContract, type MpConversation, type MpMessage } from '@zenith/shared/mp';
import { mock } from '@/mocks/utils/contract';
import { mockMpMessages, getNextMpMessageId } from '@/mocks/data/mp-messages';
import { mockMpFans } from '@/mocks/data/mp-fans';
import { mockDateTime } from '@/mocks/utils/date';

export const mpMessagesHandlers = [
  mock(mpMessageContract.conversations, ({ query, ok }) => {
    const msgs = mockMpMessages.filter((m) => m.accountId === query.accountId);
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
      const fan = mockMpFans.find((f) => f.accountId === query.accountId && f.openid === openid);
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
    return ok(list);
  }),

  mock(mpMessageContract.list, ({ query, ok, paginate }) => {
    const filtered = mockMpMessages.filter((m) => {
      if (m.accountId !== query.accountId) return false;
      if (query.openid && m.openid !== query.openid) return false;
      if (query.direction && m.direction !== query.direction) return false;
      if (query.msgType && m.msgType !== query.msgType) return false;
      if (query.keyword && !(m.content ?? '').includes(query.keyword)) return false;
      return true;
    });
    return ok(paginate([...filtered].sort((a, b) => b.id - a.id)));
  }),

  mock(mpMessageContract.send, ({ body, ok }) => {
    const now = mockDateTime();
    // 与服务端一致：图文记为 text 摘要，其余类型原样落库
    const item: MpMessage = {
      id: getNextMpMessageId(),
      accountId: body.accountId,
      openid: body.openid,
      direction: 'out',
      msgType: body.msgType === 'news' ? 'text' : body.msgType,
      content: body.msgType === 'text' ? (body.content ?? '')
        : body.msgType === 'image' ? '[图片消息]'
          : body.msgType === 'voice' ? '[语音消息]'
            : body.msgType === 'video' ? (body.content ? `[视频] ${body.content}` : '[视频消息]')
              : '[图文消息]',
      mediaId: body.msgType === 'text' ? null : (body.mediaId ?? null),
      mediaUrl: null,
      event: null,
      msgId: null,
      status: 'sent',
      errorMsg: null,
      createdAt: now,
    };
    mockMpMessages.push(item);
    return ok(item, '发送成功');
  }),
];
