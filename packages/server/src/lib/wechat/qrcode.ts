import { wechatApiPost } from './api';
import type { MpCredential } from './api';

export interface CreateQrcodeParams {
  type: 'temporary' | 'permanent';
  sceneStr: string;
  /** 临时二维码有效期（秒），最长 30 天 */
  expireSeconds?: number | null;
}

interface QrcodeResponse {
  errcode?: number;
  errmsg?: string;
  ticket?: string;
  expire_seconds?: number;
  url?: string;
}

/** 展示二维码图片的标准地址（凭 ticket 换取图片） */
function showQrcodeUrl(ticket: string): string {
  return `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(ticket)}`;
}

/**
 * 创建带参数二维码（/cgi-bin/qrcode/create）。
 * - 永久二维码：QR_LIMIT_STR_SCENE
 * - 临时二维码：QR_STR_SCENE + expire_seconds
 */
export async function createWechatQrcode(
  account: MpCredential,
  params: CreateQrcodeParams,
): Promise<{ ticket: string; url: string; expireSeconds: number | null }> {
  const isTemp = params.type === 'temporary';
  const body: Record<string, unknown> = {
    action_name: isTemp ? 'QR_STR_SCENE' : 'QR_LIMIT_STR_SCENE',
    action_info: { scene: { scene_str: params.sceneStr } },
  };
  if (isTemp) body.expire_seconds = params.expireSeconds ?? 604800;

  const data = await wechatApiPost<QrcodeResponse>(account, '/cgi-bin/qrcode/create', body);
  const ticket = data.ticket ?? '';
  return {
    ticket,
    url: showQrcodeUrl(ticket),
    expireSeconds: isTemp ? (data.expire_seconds ?? params.expireSeconds ?? null) : null,
  };
}
