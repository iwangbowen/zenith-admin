import { createHash, randomBytes } from 'node:crypto';
import redis from '../redis';
import { config } from '../../config';
import { wechatApiGet } from './api';
import type { MpCredential } from './api';

const TICKET_KEY_PREFIX = `${config.redis.keyPrefix}mp:jsapi_ticket:`;
const TICKET_EXPIRY_BUFFER = 300;

function ticketKey(accountId: number): string {
  return `${TICKET_KEY_PREFIX}${accountId}`;
}

interface TicketResponse {
  errcode?: number;
  errmsg?: string;
  ticket?: string;
  expires_in?: number;
}

/** 获取 jsapi_ticket：优先读 Redis 缓存，未命中则向微信拉取（/cgi-bin/ticket/getticket）。 */
export async function getJsapiTicket(account: MpCredential & { id: number }): Promise<string> {
  const cached = await redis.get(ticketKey(account.id));
  if (cached) return cached;
  const data = await wechatApiGet<TicketResponse>(account, '/cgi-bin/ticket/getticket', { type: 'jsapi' });
  if (!data.ticket) return '';
  const ttl = Math.max((data.expires_in ?? 7200) - TICKET_EXPIRY_BUFFER, 60);
  await redis.set(ticketKey(account.id), data.ticket, 'EX', ttl);
  return data.ticket;
}

export interface JsSdkConfig {
  appId: string;
  timestamp: number;
  nonceStr: string;
  signature: string;
}

/** 生成 JS-SDK wx.config 注入参数（对 jsapi_ticket + noncestr + timestamp + url 做 sha1 签名）。 */
export async function buildJsSdkConfig(account: MpCredential & { id: number; appId: string }, url: string): Promise<JsSdkConfig> {
  const ticket = await getJsapiTicket(account);
  const nonceStr = randomBytes(8).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000);
  const raw = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
  const signature = createHash('sha1').update(raw).digest('hex');
  return { appId: account.appId, timestamp, nonceStr, signature };
}
