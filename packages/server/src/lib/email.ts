import type { Transporter } from 'nodemailer';
import { db } from '../db';
import { emailConfigs } from '../db/schema';
import logger from './logger';

type EmailConfigRow = typeof emailConfigs.$inferSelect;

/**
 * SMTP 连接池参数。
 *
 * 连接复用把每封邮件的成本从「TCP + TLS + AUTH 握手 + 发送」降到只剩发送；
 * `maxConnections` 同时是对服务商的并发上限——无论多少调用方同时发信，超出的排在池内队列，
 * 不会像逐封新建连接那样一次打开几十个 SMTP 连接被服务商拒绝。
 */
const SMTP_POOL = { pool: true as const, maxConnections: 5, maxMessages: 200 };
/** nodemailer 默认 socketTimeout 为 10 分钟：一台挂起的 SMTP 会把一次投递钉死 10 分钟，这里全部收紧 */
const SMTP_TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000 };

let cached: { fingerprint: string; transporter: Transporter } | null = null;

function fingerprintOf(config: EmailConfigRow): string {
  return JSON.stringify([config.smtpHost, config.smtpPort, config.smtpUser, config.smtpPassword, config.encryption]);
}

/** 按当前 SMTP 配置取连接池化的 transporter；配置变更（指纹变化）时关闭旧池、建新池 */
async function getTransporter(config: EmailConfigRow): Promise<Transporter> {
  const fingerprint = fingerprintOf(config);
  if (cached && cached.fingerprint === fingerprint) return cached.transporter;

  const nodemailer = await import('nodemailer').catch(() => null);
  if (!nodemailer) {
    throw new Error('nodemailer 模块加载失败，请检查依赖安装（npm install）');
  }
  cached?.transporter.close();
  const transporter = nodemailer.default.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.encryption === 'ssl',
    auth: {
      user: config.smtpUser,
      pass: config.smtpPassword,
    },
    ...(config.encryption === 'tls' ? { requireTLS: true } : {}),
    ...SMTP_POOL,
    ...SMTP_TIMEOUTS,
  });
  cached = { fingerprint, transporter };
  return transporter;
}

/**
 * 使用系统邮件配置发送邮件
 * @throws 如果未配置 SMTP 或发送失败，会抛出错误
 */
export async function sendMail(
  to: string,
  subject: string,
  html: string,
  options?: { headers?: Record<string, string> },
): Promise<void> {
  const [config] = await db.select().from(emailConfigs).limit(1);
  if (!config?.smtpHost || !config?.smtpUser) {
    throw new Error('邮件服务未配置，请先在系统设置中完善 SMTP 信息');
  }

  const transporter = await getTransporter(config);
  await transporter.sendMail({
    from: `"${config.fromName}" <${config.fromEmail || config.smtpUser}>`,
    to,
    subject,
    html,
    ...(options?.headers ? { headers: options.headers } : {}),
  });

  logger.info(`[Email] Sent to ${to}, subject: ${subject}`);
}
