/**
 * 公众号消息回调（公开端点，无需登录，由微信服务器调用）。
 *
 *   GET  /api/public/mp/callback/{accountId}  — 服务器配置校验（返回 echostr）
 *   POST /api/public/mp/callback/{accountId}  — 接收消息/事件（明文或安全模式 AES 加密），落库
 *
 * 校验逻辑见 lib/wechat。账号查询不做租户过滤（回调无登录上下文）。
 */
import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createHash } from 'node:crypto';
import { validationHook } from '../lib/openapi-schemas';
import { getMpAccountForCallback } from '../services/mp-account.service';
import { storeInboundMessage, storeOutboundAutoReply } from '../services/mp-message.service';
import { resolveAutoReply } from '../services/mp-auto-reply.service';
import { incrementQrcodeScan } from '../services/mp-qrcode.service';
import { autoCreateMemberOnSubscribe } from '../services/mp-member.service';
import { verifyWechatSignature, msgSignature, timingSafeCompare, decryptWechatMessage, encryptWechatMessage, parseWechatXml, buildWechatXml, buildPassiveReplyXml, summarizePassiveReply } from '../lib/wechat';
import logger from '../lib/logger';
import type { MpMessageType } from '@zenith/shared';

const router = new OpenAPIHono({ defaultHook: validationHook });

/** 回调请求体大小上限（字节）：微信消息体很小，超限直接拒绝，避免对未验签内容做大文本解析 */
const MAX_CALLBACK_BODY = 64 * 1024;

const CallbackParam = z.object({
  accountId: z.coerce.number().int().openapi({ param: { name: 'accountId', in: 'path' }, example: 1 }),
});

const CallbackQuery = z.object({
  signature: z.string().optional(),
  msg_signature: z.string().optional(),
  timestamp: z.string().optional(),
  nonce: z.string().optional(),
  echostr: z.string().optional(),
  encrypt_type: z.string().optional(),
});

const textResponses = {
  200: { description: '处理结果（纯文本）', content: { 'text/plain': { schema: z.string() } } },
  403: { description: '签名校验失败', content: { 'text/plain': { schema: z.string() } } },
  404: { description: '公众号不存在', content: { 'text/plain': { schema: z.string() } } },
  500: { description: '服务端处理失败（触发微信重试）', content: { 'text/plain': { schema: z.string() } } },
} as const;

const ALLOWED_TYPES = new Set(['text', 'image', 'voice', 'video', 'shortvideo', 'location', 'link', 'event']);
function normalizeType(t: string): MpMessageType {
  return (ALLOWED_TYPES.has(t) ? t : 'text') as MpMessageType;
}

function extractContent(type: string, f: Record<string, string>): string | null {
  switch (type) {
    case 'text': return f.Content ?? null;
    case 'event': return f.EventKey ?? null;
    case 'link': return f.Url ?? f.Title ?? null;
    case 'location': return [f.Location_X, f.Location_Y].filter(Boolean).join(',') + (f.Label ? ` ${f.Label}` : '');
    default: return null;
  }
}

/**
 * 计算入站消息去重键：
 * - 普通消息直接用微信 MsgId（数值串）
 * - 事件消息无 MsgId，用 openid+event+eventKey+createTime 合成并 sha1（微信重试时这些字段一致），保证事件重试也能去重
 */
function dedupKey(f: Record<string, string>, msgType: MpMessageType): string | null {
  if (f.MsgId) return f.MsgId;
  if (msgType === 'event') {
    const composite = `${f.FromUserName ?? ''}|${f.Event ?? ''}|${f.EventKey ?? ''}|${f.CreateTime ?? ''}`;
    return `evt_${createHash('sha1').update(composite).digest('hex')}`;
  }
  return null;
}

const verifyRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{accountId}',
    tags: ['公众号回调（公开）'],
    summary: '微信服务器配置校验（公开，无需登录）',
    description: '微信公众平台保存「服务器配置」时回调此端点，校验 signature 通过后原样返回 echostr。',
    request: { params: CallbackParam, query: CallbackQuery },
    responses: textResponses,
  }),
  handler: async (c) => {
    const { accountId } = c.req.valid('param');
    const { signature, timestamp, nonce, echostr } = c.req.valid('query');
    const account = await getMpAccountForCallback(accountId);
    if (!account) return c.text('', 404);
    if (!verifyWechatSignature(account.token, signature, timestamp, nonce)) return c.text('', 403);
    return c.text(echostr ?? '', 200);
  },
});

const receiveRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{accountId}',
    tags: ['公众号回调（公开）'],
    summary: '接收微信消息/事件（公开，无需登录）',
    description: '验签后解析消息（安全模式自动 AES 解密）并落库；返回空串表示不被动回复。',
    request: { params: CallbackParam, query: CallbackQuery },
    responses: textResponses,
  }),
  handler: async (c) => {
    const { accountId } = c.req.valid('param');
    const { signature, msg_signature: msgSig, timestamp, nonce, encrypt_type: encryptType } = c.req.valid('query');
    const account = await getMpAccountForCallback(accountId);
    if (!account) return c.text('', 404);
    if (account.status === 'disabled') return c.text('', 200);

    const rawBody = await c.req.raw.clone().text();
    if (rawBody.length > MAX_CALLBACK_BODY) return c.text('', 403);
    const encrypted = encryptType === 'aes' || account.encryptMode !== 'plaintext';

    let plainXml: string;
    if (encrypted) {
      const encrypt = parseWechatXml(rawBody).Encrypt;
      if (!encrypt) return c.text('', 403);
      if (!timingSafeCompare(msgSignature(account.token, timestamp ?? '', nonce ?? '', encrypt), msgSig)) return c.text('', 403);
      if (!account.encodingAesKey) return c.text('', 403);
      try {
        plainXml = decryptWechatMessage(account.encodingAesKey, account.appId, encrypt);
      } catch (err) {
        logger.warn(`[mp-callback] 解密失败: ${(err as Error).message}`);
        return c.text('', 403);
      }
    } else {
      if (!verifyWechatSignature(account.token, signature, timestamp, nonce)) return c.text('', 403);
      plainXml = rawBody;
    }

    // 解析失败属不可重试错误：直接返回 200，避免微信反复重试同一条坏消息
    let f: Record<string, string>;
    try {
      f = parseWechatXml(plainXml);
    } catch (err) {
      logger.warn(`[mp-callback] 报文解析失败: ${(err as Error).message}`);
      return c.text('', 200);
    }

    const openid = f.FromUserName;
    if (!openid) return c.text('', 200);
    const msgType = normalizeType(f.MsgType ?? 'text');

    // 落库失败属可重试错误（如 DB 抖动）：返回非 200 让微信重试，避免消息永久丢失
    let isNew: boolean;
    try {
      isNew = await storeInboundMessage({
        accountId,
        tenantId: account.tenantId,
        openid,
        msgType,
        content: extractContent(msgType, f),
        mediaId: f.MediaId ?? null,
        mediaUrl: f.PicUrl ?? null,
        event: f.Event ?? null,
        msgId: dedupKey(f, msgType),
      });
    } catch (err) {
      logger.error(`[mp-callback] 入站消息落库失败，返回 500 触发微信重试: ${(err as Error).message}`);
      return c.text('', 500);
    }

    // ── 带参二维码扫码计数（仅首次去重后；SCAN=已关注扫码，subscribe+qrscene=扫码关注） ──
    if (isNew && msgType === 'event' && (f.Event === 'SCAN' || f.Event === 'subscribe')) {
      const scene = f.Event === 'SCAN' ? (f.EventKey ?? '') : (f.EventKey ?? '').replace(/^qrscene_/, '');
      if (scene) {
        try {
          await incrementQrcodeScan(accountId, scene);
        } catch (err) {
          logger.warn(`[mp-callback] 扫码计数失败: ${(err as Error).message}`);
        }
      }
    }

    // ── 关注即注册会员（账号开启 autoCreateMember 时，首次关注自动建会员） ──
    if (isNew && msgType === 'event' && f.Event === 'subscribe' && account.autoCreateMember) {
      try {
        await autoCreateMemberOnSubscribe(accountId, account.tenantId, openid, {});
      } catch (err) {
        logger.warn(`[mp-callback] 关注自动建会员失败: ${(err as Error).message}`);
      }
    }

    // 自动回复（构建/落库出站失败不影响入站已落库，返回 200 不重试）
    try {
      let reply: Awaited<ReturnType<typeof resolveAutoReply>> = null;
      if (msgType === 'event' && f.Event === 'subscribe') {
        reply = await resolveAutoReply(accountId, { event: 'subscribe' });
      } else if (msgType === 'text') {
        reply = await resolveAutoReply(accountId, { text: f.Content ?? '' });
      }

      if (reply) {
        // 仅首次落库出站回复；微信重试时仍返回被动回复，但不写重复记录
        if (isNew) {
          const outType: MpMessageType = reply.contentType === 'news' ? 'text' : reply.contentType;
          await storeOutboundAutoReply(accountId, account.tenantId, openid, {
            msgType: outType,
            content: summarizePassiveReply(reply),
            mediaId: reply.mediaId,
          });
        }
        const replyXml = buildPassiveReplyXml({ toUser: openid, fromUser: f.ToUserName ?? '' }, reply);
        if (encrypted && account.encodingAesKey) {
          const enc = encryptWechatMessage(account.encodingAesKey, account.appId, replyXml);
          const ts = timestamp ?? String(Math.floor(Date.now() / 1000));
          const nc = nonce ?? Math.random().toString(36).slice(2);
          const encXml = buildWechatXml({
            Encrypt: enc,
            MsgSignature: msgSignature(account.token, ts, nc, enc),
            TimeStamp: Number(ts),
            Nonce: nc,
          });
          return c.text(encXml, 200);
        }
        return c.text(replyXml, 200);
      }
    } catch (err) {
      logger.warn(`[mp-callback] 自动回复处理失败（入站已落库）: ${(err as Error).message}`);
    }
    return c.text('', 200);
  },
});

router.openapiRoutes([verifyRoute, receiveRoute] as const);

export default router;
