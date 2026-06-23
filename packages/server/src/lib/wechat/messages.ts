import { wechatApiPost } from './api';
import type { MpCredential } from './api';

interface CustomSendResponse {
  errcode?: number;
  errmsg?: string;
}

/** 发送客服文本消息（需在用户最近 48 小时内有交互） */
export async function sendCustomTextMessage(account: MpCredential, openid: string, content: string): Promise<void> {
  await wechatApiPost<CustomSendResponse>(account, '/cgi-bin/message/custom/send', {
    touser: openid,
    msgtype: 'text',
    text: { content },
  });
}
