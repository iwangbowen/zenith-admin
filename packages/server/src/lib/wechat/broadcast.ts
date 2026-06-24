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

/** 群发预览：发送给单个 openid 预览（/cgi-bin/message/mass/preview） */
export async function previewMassSend(account: MpCredential, params: { msgType: 'text' | 'image' | 'mpnews'; content?: string | null; mediaId?: string | null; openid: string }): Promise<void> {
  const body: Record<string, unknown> = { touser: params.openid, msgtype: params.msgType };
  if (params.msgType === 'text') body.text = { content: params.content ?? '' };
  else if (params.msgType === 'image') body.image = { media_id: params.mediaId ?? '' };
  else body.mpnews = { media_id: params.mediaId ?? '' };
  await wechatApiPost<MassSendResponse>(account, '/cgi-bin/message/mass/preview', body);
}

export interface MassSendResult {
  msgStatus: string;
  totalCount?: number;
  filterCount?: number;
  sentCount?: number;
  errorCount?: number;
}

interface MassGetResponse {
  errcode?: number;
  errmsg?: string;
  msg_status?: string;
  total_count?: number;
  filter_count?: number;
  sent_count?: number;
  error_count?: number;
}

/** 查询群发发送结果与统计（/cgi-bin/message/mass/get） */
export async function getMassSendResult(account: MpCredential, msgId: string): Promise<MassSendResult> {
  const data = await wechatApiPost<MassGetResponse>(account, '/cgi-bin/message/mass/get', { msg_id: msgId });
  return {
    msgStatus: data.msg_status ?? 'UNKNOWN',
    totalCount: data.total_count,
    filterCount: data.filter_count,
    sentCount: data.sent_count,
    errorCount: data.error_count,
  };
}
