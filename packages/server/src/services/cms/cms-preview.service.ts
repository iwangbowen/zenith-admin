/**
 * CMS 草稿预览链接（签名 token，未发布内容可分享给审核人预览）。
 *
 * URL 形如 /__cms/{siteCode}/preview/{contentId}?exp={unix}&sig={hmac}，
 * 由后台「生成预览链接」接口签发（默认 2 小时有效），前台渲染时校验签名与有效期，
 * 无需登录即可查看，杜绝把草稿正文粘贴到聊天工具的原始流程。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { CMS_PREVIEW_PREFIX } from '@zenith/shared';
import { config } from '../../config';
import { formatDateTime } from '../../lib/datetime';
import { ensureCmsContentExists } from './cms-contents.service';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { assertChannelAccess } from './cms-channels.service';

const PREVIEW_TTL_SECONDS = 2 * 60 * 60;

function sign(contentId: number, exp: number): string {
  return createHmac('sha256', config.jwtSecret).update(`cms-preview:${contentId}:${exp}`).digest('hex');
}

export interface CmsPreviewLink {
  /** 站内相对路径（含签名参数），前端拼接当前 origin 使用 */
  url: string;
  expiresAt: string;
}

/** 签发草稿预览链接（校验站点数据权限） */
export async function createContentPreviewLink(contentId: number): Promise<CmsPreviewLink> {
  const row = await ensureCmsContentExists(contentId);
  await assertSiteAccess(row.siteId);
  await assertChannelAccess(row.channelId);
  const site = await ensureCmsSiteExists(row.siteId);
  const exp = Math.floor(Date.now() / 1000) + PREVIEW_TTL_SECONDS;
  const sig = sign(contentId, exp);
  return {
    url: `${CMS_PREVIEW_PREFIX}/${site.code}/preview/${contentId}?exp=${exp}&sig=${sig}`,
    expiresAt: formatDateTime(new Date(exp * 1000)),
  };
}

/** 校验预览签名（常量时间比较，防时序攻击） */
export function verifyContentPreviewToken(contentId: number, exp: number, sig: string): boolean {
  if (!Number.isInteger(exp) || exp * 1000 < Date.now() || !sig) return false;
  const expected = Buffer.from(sign(contentId, exp));
  const provided = Buffer.from(sig);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
