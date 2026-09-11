import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../db';
import { chatMessages } from '../../db/schema';
import { scheduleSendToUsers } from '../../lib/ws-manager';
import { httpGet } from '../../lib/http-client';
import { HTTPException } from 'hono/http-exception';
import type { ChatLinkPreview, ChatMessage, ChatMessageExtra, ChatMessageType } from '@zenith/shared/chat';
import { mapChatMessage, fetchUserBrief, listConversationMemberIds, touchConversation } from './chat-shared';
import { escapeRegExp } from '@zenith/shared/core';

const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i;

function isPrivateIpv4(ipv4: string): boolean {
  const parts = ipv4.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 共享地址
  return false;
}

function isPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase().replaceAll(/^\[|\]$/g, '');
  // IPv4 私网地址
  if (isPrivateIpv4(lower)) return true;
  // IPv6 loopback / 链路本地 / 唯一本地地址
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
  if (lower.startsWith('fe80:')) return true; // 链路本地 fe80::/10
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA fc00::/7
  // IPv4-mapped IPv6 (::ffff:a.b.c.d)
  if (lower.startsWith('::ffff:')) {
    const ipv4 = lower.slice(7);
    if (isPrivateIpv4(ipv4)) return true;
  }
  return false;
}

function validatePreviewUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new HTTPException(400, { message: '链接格式无效' });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new HTTPException(400, { message: '仅支持 http/https 链接' });
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost'
    || host.endsWith('.local')
    || isPrivateHost(host)
  ) {
    throw new HTTPException(400, { message: '不支持内网地址预览' });
  }

  return parsed;
}

function inferImageUrl(parsed: URL): string | null {
  return IMAGE_EXT_RE.test(parsed.pathname) ? parsed.toString() : null;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ');
}

function stripTags(input: string): string {
  return input.replaceAll(/<[^>]*>/g, '').replaceAll(/\s+/g, ' ').trim();
}

/** 转义字符串中的正则元字符，防止将外部值拼入 RegExp 时产生注入或 ReDoS */
function pickMeta(html: string, attrs: Array<{ key: string; value: string }>): string | null {
  for (const { key, value } of attrs) {
    const k = escapeRegExp(key);
    const v = escapeRegExp(value);
    const pattern = new RegExp(`<meta[^>]*${k}=["']${v}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i');
    const patternSwap = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*${k}=["']${v}["'][^>]*>`, 'i');
    const hit = pattern.exec(html) ?? patternSwap.exec(html);
    if (hit?.[1]) return decodeHtmlEntities(hit[1].trim());
  }
  return null;
}

function pickTitle(html: string): string | null {
  const hit = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!hit?.[1]) return null;
  const text = stripTags(decodeHtmlEntities(hit[1]));
  return text.length > 0 ? text : null;
}

function pickFavicon(html: string): string | null {
  const hit = /<link[^>]*rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/i.exec(html)
    ?? /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/i.exec(html);
  return hit?.[1] ? decodeHtmlEntities(hit[1].trim()) : null;
}

function pickFirstImage(html: string): string | null {
  const hit = /<img[^>]*src=["']([^"']+)["'][^>]*>/i.exec(html)
    ?? /<img[^>]*src=([^\s>]+)[^>]*>/i.exec(html);
  return hit?.[1] ? decodeHtmlEntities(hit[1].trim()) : null;
}

function toAbsUrl(raw: string | null, base: URL): string | null {
  if (!raw) return null;
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

export async function getLinkPreview(rawUrl: string): Promise<ChatLinkPreview> {
  const parsed = validatePreviewUrl(rawUrl.trim());
  const directImage = inferImageUrl(parsed);
  const fallback: ChatLinkPreview = {
    url: parsed.toString(),
    title: parsed.hostname,
    description: null,
    siteName: parsed.hostname,
    image: directImage,
    favicon: null,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const resp = await httpGet(parsed.toString(), {
      // 解析 DNS 并逐个校验解析出的 IP（私网/保留/链路本地/云元数据地址），防 SSRF 与 DNS rebinding。
      // 开启后 http-client 会强制 redirect:'error'，任何跳转都会抛错并被下方 catch 兜底为 fallback，
      // 从而堵死"重定向跳内网"这类绕过。
      ssrfProtection: true,
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'ZenithAdminLinkPreviewBot/1.0',
      },
    });

    if (!resp.ok) return fallback;
    const contentType = resp.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.startsWith('image/')) {
      return { ...fallback, image: parsed.toString(), title: parsed.pathname.split('/').pop() || parsed.hostname };
    }
    if (!contentType.includes('text/html')) return fallback;

    const htmlRaw = await resp.text();
    const html = htmlRaw.slice(0, 300_000);

    const siteName = pickMeta(html, [
      { key: 'property', value: 'og:site_name' },
      { key: 'name', value: 'application-name' },
    ]) ?? parsed.hostname;

    const title = pickMeta(html, [
      { key: 'property', value: 'og:title' },
      { key: 'name', value: 'twitter:title' },
    ]) ?? pickTitle(html) ?? parsed.hostname;

    const description = pickMeta(html, [
      { key: 'property', value: 'og:description' },
      { key: 'name', value: 'description' },
      { key: 'name', value: 'twitter:description' },
    ]);

    const image = toAbsUrl(
      pickMeta(html, [
        { key: 'property', value: 'og:image' },
        { key: 'property', value: 'og:image:url' },
        { key: 'property', value: 'og:image:secure_url' },
        { key: 'name', value: 'twitter:image' },
        { key: 'name', value: 'twitter:image:src' },
        { key: 'name', value: 'image' },
      ]),
      parsed,
    ) ?? toAbsUrl(pickFirstImage(html), parsed) ?? directImage;

    const favicon = toAbsUrl(pickFavicon(html), parsed);

    return {
      url: parsed.toString(),
      title: title.trim(),
      description: description?.trim() ?? null,
      siteName: siteName?.trim() ?? null,
      image,
      favicon,
    };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

// ─── 机器人 / 系统消息（无请求上下文，供事件订阅器与 Webhook 调用）─────────────

// ─── 以机器人/系统身份向会话投递消息 ─────────────────────────────────────────

/**
 * 以机器人/系统身份向会话投递一条消息（无上下文、不校验成员）。
 * senderId 为用户 ID 时显示该用户身份；为 null 时由 extra.bot 提供展示身份。
 */
export async function postBotMessage(
  conversationId: number,
  senderId: number | null,
  input: { type: ChatMessageType; content: string; extra?: ChatMessageExtra | null },
): Promise<ChatMessage> {
  const [row] = await db.insert(chatMessages).values({
    conversationId,
    senderId,
    type: input.type,
    content: input.content,
    extra: input.extra ?? null,
  }).returning();

  let sender: { id: number; nickname: string; avatar: string | null } | null = null;
  if (senderId) {
    const u = await fetchUserBrief(senderId);
    if (u) sender = { id: u.id, nickname: u.nickname, avatar: u.avatar ?? null };
  }

  const [, members] = await Promise.all([
    touchConversation(conversationId),
    listConversationMemberIds(conversationId),
  ]);

  const msg = mapChatMessage(row, sender);
  scheduleSendToUsers(members, { type: 'chat:message', payload: msg });
  return msg;
}

/** 将某张卡片标记为已处理（置灰按钮 + 结果文案），并广播 chat:edit 实时更新 */
export async function markCardMessageDone(messageId: number, statusText: string): Promise<void> {
  const row = await db.query.chatMessages.findFirst({ where: eq(chatMessages.id, messageId) });
  if (!row || row.type !== 'card') return;
  const extra = (row.extra as ChatMessageExtra | null) ?? {};
  if (!extra.card || extra.card.status === 'done') return;

  const newExtra: ChatMessageExtra = { ...extra, card: { ...extra.card, status: 'done', statusText } };
  const [updated] = await db.update(chatMessages).set({ extra: newExtra }).where(eq(chatMessages.id, messageId)).returning();

  let sender: { id: number; nickname: string; avatar: string | null } | null = null;
  if (updated.senderId) {
    const u = await fetchUserBrief(updated.senderId);
    if (u) sender = { id: u.id, nickname: u.nickname, avatar: u.avatar ?? null };
  }

  const members = await listConversationMemberIds(updated.conversationId);
  scheduleSendToUsers(members, { type: 'chat:edit', payload: mapChatMessage(updated, sender) });
}

/**
 * 将某个工作流任务对应的待审批卡片标记为已处理。
 *
 * 通过 jsonb 包含查询按 taskId 直接从 DB 定位卡片消息，不依赖内存映射，
 * 因此服务重启后（待办创建与审批完成之间）仍能可靠置灰卡片。
 */
export async function markTaskCardsDone(taskId: number, statusText: string): Promise<void> {
  const match = JSON.stringify({ card: { status: 'pending', actions: [{ taskId }] } });
  const rows = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(and(
      eq(chatMessages.type, 'card'),
      sql`${chatMessages.extra} @> ${match}::jsonb`,
    ));
  for (const r of rows) {
    await markCardMessageDone(r.id, statusText);
  }
}
