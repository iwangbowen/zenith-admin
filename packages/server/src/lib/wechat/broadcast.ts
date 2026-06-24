import { wechatApiPost } from './api';
import type { MpCredential } from './api';

export interface MassSendParams {
  /** true=全部粉丝；false=按 tagId 群发 */
  isToAll: boolean;
  tagId?: number | null;
  msgType: 'text' | 'image' | 'mpnews';
  /** 文本内容（msgType=text） */
  content?: string | null;
  /** 素材 media_id（msgType=image 用图片素材；mpnews 用图文素材） */
  mediaId?: string | null;
}

interface MassSendResponse {
  errcode?: number;
  errmsg?: string;
  msg_id?: number;
  msg_data_id?: number;
}

/**
 * 按标签 / 全部粉丝群发消息（/cgi-bin/message/mass/sendall）。
 * 返回微信群发 msg_id。
 */
export async function massSend(account: MpCredential, params: MassSendParams): Promise<{ msgId: string }> {
  const filter = params.isToAll
    ? { is_to_all: true }
    : { is_to_all: false, tag_id: params.tagId ?? 0 };
  const body: Record<string, unknown> = { filter, msgtype: params.msgType };
  if (params.msgType === 'text') body.text = { content: params.content ?? '' };
  else if (params.msgType === 'image') body.image = { media_id: params.mediaId ?? '' };
  else body.mpnews = { media_id: params.mediaId ?? '' };

  const data = await wechatApiPost<MassSendResponse>(account, '/cgi-bin/message/mass/sendall', body);
  return { msgId: data.msg_id != null ? String(data.msg_id) : '' };
}
