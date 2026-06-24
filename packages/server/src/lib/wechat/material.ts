import { wechatApiPost } from './api';
import type { MpCredential } from './api';
import { httpPost } from '../http-client';
import { getMpAccessToken, refreshMpAccessToken, WechatApiError } from './access-token';

const WECHAT_API_BASE = 'https://api.weixin.qq.com';
/** access_token 失效错误码：刷新后重试一次 */
const TOKEN_INVALID_CODES = new Set([40001, 40014, 42001]);

export interface WechatMaterialItem {
  media_id: string;
  name: string;
  update_time: number;
  url?: string;
}

interface BatchgetResponse {
  errcode?: number;
  errmsg?: string;
  total_count?: number;
  item_count?: number;
  item?: WechatMaterialItem[];
}

/** 批量拉取永久素材（type: image/voice/video/news） */
export async function batchGetWechatMaterials(
  account: MpCredential,
  type: 'image' | 'voice' | 'video' | 'news',
  offset = 0,
  count = 20,
): Promise<{ total: number; items: WechatMaterialItem[] }> {
  const data = await wechatApiPost<BatchgetResponse>(account, '/cgi-bin/material/batchget_material', { type, offset, count });
  return { total: data.total_count ?? 0, items: data.item ?? [] };
}

/** 删除永久素材 */
export async function deleteWechatMaterial(account: MpCredential, mediaId: string): Promise<void> {
  await wechatApiPost<{ errcode?: number; errmsg?: string }>(account, '/cgi-bin/material/del_material', { media_id: mediaId });
}

interface AddMaterialResponse {
  errcode?: number;
  errmsg?: string;
  media_id?: string;
  url?: string;
}

/**
 * 上传永久素材二进制文件到微信（/cgi-bin/material/add_material，multipart）。
 * - video 需附带 description（title + introduction）
 * - 返回 media_id（图片额外返回可外链 url）
 */
export async function uploadWechatMaterial(
  account: MpCredential,
  type: 'image' | 'voice' | 'video' | 'thumb',
  file: Blob,
  filename: string,
  videoMeta?: { title: string; introduction: string },
): Promise<{ mediaId: string; url: string | null }> {
  const doUpload = async (token: string): Promise<AddMaterialResponse> => {
    const form = new FormData();
    form.append('media', file, filename);
    if (type === 'video') {
      form.append('description', JSON.stringify({ title: videoMeta?.title ?? filename, introduction: videoMeta?.introduction ?? '' }));
    }
    const url = `${WECHAT_API_BASE}/cgi-bin/material/add_material?access_token=${encodeURIComponent(token)}&type=${type}`;
    const resp = await httpPost(url, form, { timeout: 30_000, httpLog: { level: 'off' } });
    return resp.json<AddMaterialResponse>();
  };

  let data = await doUpload(await getMpAccessToken(account));
  if (data.errcode && TOKEN_INVALID_CODES.has(data.errcode)) {
    data = await doUpload(await refreshMpAccessToken(account));
  }
  if (data.errcode && data.errcode !== 0) throw new WechatApiError(data.errcode, data.errmsg ?? '素材上传失败');
  if (!data.media_id) throw new WechatApiError(-1, '素材上传失败：未返回 media_id');
  return { mediaId: data.media_id, url: data.url ?? null };
}
