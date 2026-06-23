/**
 * 公众号消息回调（公开端点，无需登录，由微信服务器调用）。
 *
 *   GET  /api/public/mp/callback/{accountId}  — 服务器配置校验（返回 echostr）
 *   POST /api/public/mp/callback/{accountId}  — 接收消息/事件（明文或安全模式 AES 加密），落库
 *
 * 校验逻辑见 lib/wechat。账号查询不做租户过滤（回调无登录上下文）。
 */
import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { validationHook } from '../lib/openapi-schemas';
import { getMpAccountForCallback } from '../services/mp-account.service';
import { storeInboundMessage } from '../services/mp-message.service';
import { verifyWechatSignature, msgSignature, decryptWechatMessage, parseWechatXml } from '../lib/wechat';
import logger from '../lib/logger';
import type { MpMessageType } from '@zenith/shared';

const router = new OpenAPIHono({ defaultHook: validationHook });

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

    const rawBody = await c.req.raw.clone().text();
    const encrypted = encryptType === 'aes' || account.encryptMode !== 'plaintext';

    let plainXml: string;
    if (encrypted) {
      const encrypt = parseWechatXml(rawBody).Encrypt;
      if (!encrypt) return c.text('', 403);
      if (msgSignature(account.token, timestamp ?? '', nonce ?? '', encrypt) !== msgSig) return c.text('', 403);
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

    try {
      const f = parseWechatXml(plainXml);
      const openid = f.FromUserName;
      if (openid) {
        const msgType = normalizeType(f.MsgType ?? 'text');
        await storeInboundMessage({
          accountId,
          tenantId: account.tenantId,
          openid,
          msgType,
          content: extractContent(msgType, f),
          mediaId: f.MediaId ?? null,
          mediaUrl: f.PicUrl ?? null,
          event: f.Event ?? null,
          msgId: f.MsgId ?? null,
        });
      }
    } catch (err) {
      logger.warn(`[mp-callback] 消息落库失败: ${(err as Error).message}`);
    }
    return c.text('', 200);
  },
});

router.openapiRoutes([verifyRoute, receiveRoute] as const);

export default router;
