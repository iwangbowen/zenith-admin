/**
 * 会员短信验证码服务。
 *
 * - 验证码存 Redis（key `{prefix}member:smscode:{scene}:{phone}`，TTL 5 分钟）
 * - 同号码 60 秒发送间隔限频
 * - 真实短信发送为 best-effort：配置了默认短信服务商且存在含 {{code}} 的启用模板时才发送
 * - 非生产环境回传验证码（devCode），方便前后端联调；生产环境不回传
 *
 * 注意：本服务为匿名接口调用（无管理员上下文），因此不复用依赖 currentUser() 的 sendSms()，
 * 而是直接走底层 sendSmsByProvider()。
 */
import crypto from 'node:crypto';
import { and, eq, ilike } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { config } from '../../config';
import redis from '../../lib/redis';
import logger from '../../lib/logger';
import { db } from '../../db';
import { smsTemplates } from '../../db/schema';
import { findDefaultSmsConfig } from '../messaging/sms-configs.service';
import { sendSmsByProvider, renderTemplate } from '../../lib/sms-sender';

export type SmsScene = 'register' | 'login' | 'reset';

const { keyPrefix } = config.redis;
const CODE_PREFIX = `${keyPrefix}member:smscode:`;
const INTERVAL_PREFIX = `${keyPrefix}member:smscode-interval:`;
const ATTEMPT_PREFIX = `${keyPrefix}member:smscode-attempts:`;

/** 验证码有效期（秒）*/
const CODE_TTL = 5 * 60;
/** 同号码发送间隔（秒）*/
const SEND_INTERVAL = 60;
/** 单个验证码允许的最大校验尝试次数（超过即作废，防爆破）*/
const MAX_VERIFY_ATTEMPTS = 5;

function codeKey(phone: string, scene: SmsScene): string {
  return `${CODE_PREFIX}${scene}:${phone}`;
}

function attemptsKey(phone: string, scene: SmsScene): string {
  return `${ATTEMPT_PREFIX}${scene}:${phone}`;
}

/** 生成 6 位数字验证码 */
function genCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** 发送会员短信验证码 */
export async function sendMemberSmsCode(phone: string, scene: SmsScene): Promise<{ devCode?: string }> {
  const intervalKey = `${INTERVAL_PREFIX}${phone}`;
  const ttl = await redis.ttl(intervalKey);
  if (ttl > 0) {
    throw new HTTPException(429, { message: `请 ${ttl} 秒后再获取验证码` });
  }

  const code = genCode();
  await redis.set(codeKey(phone, scene), code, 'EX', CODE_TTL);
  await redis.set(intervalKey, '1', 'EX', SEND_INTERVAL);
  await redis.del(attemptsKey(phone, scene)); // 新码下发，重置校验尝试计数

  let delivered = false;
  try {
    delivered = await trySendRealSms(phone, code);
  } catch (err) {
    logger.warn('[MemberSms] 真实短信发送失败（忽略）', err);
  }
  if (!delivered) {
    logger.info(`[MemberSms] 验证码 ${code} -> ${phone}（scene=${scene}，未实际发送短信）`);
  }

  // 非生产环境回传验证码，方便联调；生产环境不回传
  return process.env.NODE_ENV === 'production' ? {} : { devCode: code };
}

/** best-effort 真实短信发送：需配置默认服务商 + 含 {{code}} 的启用模板 */
async function trySendRealSms(phone: string, code: string): Promise<boolean> {
  const smsConfig = await findDefaultSmsConfig();
  if (!smsConfig) return false;
  const [tpl] = await db
    .select()
    .from(smsTemplates)
    .where(
      and(
        eq(smsTemplates.provider, smsConfig.provider),
        eq(smsTemplates.status, 'enabled'),
        ilike(smsTemplates.content, '%{{code}}%'),
      ),
    )
    .limit(1);
  if (!tpl) return false;
  const variables = { code };
  const renderedContent = renderTemplate(tpl.content, variables);
  const result = await sendSmsByProvider({ config: smsConfig, template: tpl, phone, variables, renderedContent });
  return result.success;
}

/** 校验会员短信验证码（成功后立即删除，防重放；错误累计到上限即作废，防爆破）*/
export async function verifyMemberSmsCode(phone: string, scene: SmsScene, code: string): Promise<boolean> {
  const key = codeKey(phone, scene);
  const stored = await redis.get(key);
  if (!stored) return false;

  const aKey = attemptsKey(phone, scene);
  const attempts = await redis.incr(aKey);
  if (attempts === 1) await redis.expire(aKey, CODE_TTL);
  if (attempts > MAX_VERIFY_ATTEMPTS) {
    // 超过尝试上限：作废验证码与计数，攻击者需重新获取（受发送频率限制）
    await redis.del(key);
    await redis.del(aKey);
    return false;
  }

  if (stored !== code) return false;

  await redis.del(key);
  await redis.del(aKey);
  return true;
}
