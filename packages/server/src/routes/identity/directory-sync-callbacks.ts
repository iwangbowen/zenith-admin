/**
 * 通讯录同步的机器端点（公开路径，不走管理端登录态，也不进 OpenAPI 文档）：
 *
 *   callbacks/{key}          — 钉钉/企微/飞书通讯录变更回调（验签 + 触发同步）
 *   {base} = scim/{key}/v2（相对本路由根）— SCIM 2.0 Server（Bearer Token 认证）
 *     GET  {base}/ServiceProviderConfig
 *     GET  {base}/Users · POST {base}/Users
 *     GET/PUT/PATCH/DELETE {base}/Users/{userId}
 *
 * {key} 为同步源的随机 URL Key（防探测）；各端点自带平台验签或 Bearer 校验。
 * 响应状态码由平台协议决定（动态），故使用普通 Hono 路由而非 OpenAPI 类型化路由。
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import logger from '../../lib/logger';
import {
  getSourceByCallbackKey, handleDingTalkCallback, handleWeComCallback, handleWeComVerify,
  handleFeishuCallback, type CallbackHandleResult,
} from '../../services/identity/directory-sync-callbacks.service';
import {
  authenticateScimSource, ScimError, scimErrorBody, serviceProviderConfig,
  listScimUsers, getScimUser, createScimUser, replaceScimUser, patchScimUser, deleteScimUser,
} from '../../services/identity/directory-sync-scim.service';

const router = new Hono();

/** 回调请求体大小上限：通讯录事件报文很小，超限直接拒绝 */
const MAX_CALLBACK_BODY = 256 * 1024;

function respond(c: Context, result: CallbackHandleResult) {
  if (typeof result.body === 'string') return c.text(result.body, result.status);
  return c.json(result.body, result.status);
}

function callbackQuery(c: Context) {
  return {
    signature: c.req.query('signature'),
    msg_signature: c.req.query('msg_signature'),
    timestamp: c.req.query('timestamp'),
    nonce: c.req.query('nonce'),
    echostr: c.req.query('echostr'),
  };
}

// ─── 平台回调 ─────────────────────────────────────────────────────────────────
// GET：企业微信保存回调配置时的 URL 验证（验签后回显解密的 echostr）
router.get('/callbacks/:key', async (c) => {
  const source = await getSourceByCallbackKey((c.req.param('key') ?? ''));
  if (!source) return c.text('', 404);
  if (source.type === 'wechat_work') {
    return respond(c, await handleWeComVerify(source, callbackQuery(c)));
  }
  return c.text('', 404);
});

// POST：接收通讯录变更事件（含飞书 url_verification 与钉钉 check_url 握手）
router.post('/callbacks/:key', async (c) => {
  const source = await getSourceByCallbackKey((c.req.param('key') ?? ''));
  if (!source) return c.text('', 404);
  const rawBody = await c.req.raw.clone().text();
  if (rawBody.length > MAX_CALLBACK_BODY) return c.text('', 403);
  const query = callbackQuery(c);
  try {
    switch (source.type) {
      case 'dingtalk': {
        const body = JSON.parse(rawBody || '{}') as { encrypt?: string };
        return respond(c, await handleDingTalkCallback(source, query, body));
      }
      case 'wechat_work':
        return respond(c, await handleWeComCallback(source, query, rawBody));
      case 'feishu': {
        const body = JSON.parse(rawBody || '{}') as Record<string, unknown>;
        return respond(c, await handleFeishuCallback(source, body));
      }
      default:
        return c.text('', 404);
    }
  } catch (err) {
    // 报文解析失败属不可重试错误：记录后 200 确认，避免平台反复重推坏消息
    logger.warn(`[directory-sync] 回调处理失败（source ${source.id}）: ${(err as Error).message}`);
    return c.text('', 200);
  }
});

// ─── SCIM 2.0 ─────────────────────────────────────────────────────────────────
type ScimAction = (c: Context) => Promise<Response>;

/** SCIM 统一错误处理：ScimError → RFC 7644 Error 响应 */
function scim(fn: ScimAction): ScimAction {
  return async (c) => {
    try {
      return await fn(c);
    } catch (err) {
      if (err instanceof ScimError) {
        return c.json(scimErrorBody(err), err.status as ContentfulStatusCode);
      }
      logger.error('[directory-sync-scim] 处理失败', err);
      return c.json(scimErrorBody(new ScimError(500, 'Internal error')), 500);
    }
  };
}

async function scimJsonBody(c: Context): Promise<Record<string, unknown>> {
  try {
    return await c.req.json<Record<string, unknown>>();
  } catch {
    throw new ScimError(400, 'Invalid JSON body', 'invalidSyntax');
  }
}

router.get('/scim/:key/v2/ServiceProviderConfig', scim(async (c) => {
  await authenticateScimSource((c.req.param('key') ?? ''), c.req.header('authorization'));
  return c.json(serviceProviderConfig(), 200);
}));

router.get('/scim/:key/v2/Users', scim(async (c) => {
  const source = await authenticateScimSource((c.req.param('key') ?? ''), c.req.header('authorization'));
  return c.json(await listScimUsers(source, {
    filter: c.req.query('filter'),
    startIndex: c.req.query('startIndex') ? Number(c.req.query('startIndex')) : undefined,
    count: c.req.query('count') ? Number(c.req.query('count')) : undefined,
  }), 200);
}));

router.post('/scim/:key/v2/Users', scim(async (c) => {
  const source = await authenticateScimSource((c.req.param('key') ?? ''), c.req.header('authorization'));
  return c.json(await createScimUser(source, await scimJsonBody(c)), 201);
}));

router.get('/scim/:key/v2/Users/:userId', scim(async (c) => {
  const source = await authenticateScimSource((c.req.param('key') ?? ''), c.req.header('authorization'));
  return c.json(await getScimUser(source, (c.req.param('userId') ?? '')), 200);
}));

router.put('/scim/:key/v2/Users/:userId', scim(async (c) => {
  const source = await authenticateScimSource((c.req.param('key') ?? ''), c.req.header('authorization'));
  return c.json(await replaceScimUser(source, (c.req.param('userId') ?? ''), await scimJsonBody(c)), 200);
}));

router.patch('/scim/:key/v2/Users/:userId', scim(async (c) => {
  const source = await authenticateScimSource((c.req.param('key') ?? ''), c.req.header('authorization'));
  return c.json(await patchScimUser(source, (c.req.param('userId') ?? ''), await scimJsonBody(c)), 200);
}));

router.delete('/scim/:key/v2/Users/:userId', scim(async (c) => {
  const source = await authenticateScimSource((c.req.param('key') ?? ''), c.req.header('authorization'));
  await deleteScimUser(source, (c.req.param('userId') ?? ''));
  return c.body(null, 204);
}));

export default router;
