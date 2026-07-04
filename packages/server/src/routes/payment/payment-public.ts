/**
 * 支付异步回调（公开端点，无需登录，由微信/支付宝服务器调用）。
 *
 * POST /api/public/payment/notify/{channel}
 *
 * 处理流程见 payment.service.handleNotify：读取原始 body → 逐个启用配置验签 →
 * 幂等更新订单/退款 → 落回调日志 → 发支付事件，并返回渠道要求的 ACK（微信 JSON、支付宝纯文本）。
 */
import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { validationHook } from '../../lib/openapi-schemas';
import { handleNotify } from '../../services/payment/payment.service';
import { getClientIp } from '../../lib/request-helpers';

const router = new OpenAPIHono({ defaultHook: validationHook });

const NotifyParam = z.object({
  channel: z.enum(['wechat', 'alipay', 'unionpay']).openapi({ param: { name: 'channel', in: 'path' }, example: 'wechat' }),
});

const notifyRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{channel}',
    tags: ['支付回调（公开）'],
    summary: '支付异步回调（公开，无需登录，由微信/支付宝服务器调用）',
    description: '渠道服务器在支付/退款完成后回调此端点。服务端读取原始 body 验签后幂等更新订单/退款，并返回渠道要求的 ACK（微信 JSON、支付宝纯文本）。',
    request: { params: NotifyParam },
    responses: {
      200: { description: '回调处理 ACK（渠道要求的纯文本或 JSON）', content: { 'text/plain': { schema: z.string() } } },
      401: { description: '验签失败 ACK', content: { 'text/plain': { schema: z.string() } } },
      500: { description: '业务处理失败 ACK（渠道将按其重试策略重发通知）', content: { 'text/plain': { schema: z.string() } } },
    },
  }),
  handler: async (c) => {
    const { channel } = c.req.valid('param');
    const rawBody = await c.req.raw.clone().text();
    const ip = getClientIp(c);
    const { ack } = await handleNotify(channel, rawBody, c.req.raw.headers, ip);
    return c.text(ack.body, ack.status as 200 | 401 | 500);
  },
});

router.openapiRoutes([notifyRoute] as const);

export default router;
