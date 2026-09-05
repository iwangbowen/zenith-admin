import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { jpushCallbackSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const pushCallbackResultSchema = z.object({
  received: z.int().meta({ example: 2, description: '本次回调携带的事件数' }),
  processed: z.int().meta({ example: 2, description: '成功写回发送记录的事件数' }),
}).meta({ id: 'PushCallbackResult' });

export type PushCallbackResult = z.infer<typeof pushCallbackResultSchema>;

// ─── 契约：供应商送达回执（公开，由推送服务商服务端调用） ─────────────────────

export const pushCallbackContract = defineContract('/api/public/push/callbacks', {
  jpush: op.post('/jpush', {
    body: jpushCallbackSchema,
    response: pushCallbackResultSchema,
    public: true,
    summary: '极光送达/点击回执回调（公开）',
    description: '极光在控制台配置回调地址后以 HTTP POST 推送送达 / 点击回执；未匹配到发送记录的事件静默忽略，对回调方始终返回 200。',
  }),
}, { tags: ['推送管理'] });
