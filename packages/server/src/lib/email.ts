import { db } from '../db';
import { emailConfigs } from '../db/schema';
import logger from './logger';

/**
 * 使用系统邮件配置发送邮件
 * @throws 如果未配置 SMTP 或发送失败，会抛出错误
 */
export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const [config] = await db.select().from(emailConfigs).limit(1);
  if (!config?.smtpHost || !config?.smtpUser) {
    throw new Error('邮件服务未配置，请先在系统设置中完善 SMTP 信息');
  }

  const nodemailer = await import('nodemailer').catch(() => null);
  if (!nodemailer) {
    throw new Error('nodemailer 模块加载失败，请检查依赖安装（npm install）');
  }

  const secure = config.encryption === 'ssl';
  const transporter = nodemailer.default.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPassword,
    },
    ...(config.encryption === 'tls' ? { requireTLS: true } : {}),
  });

  await transporter.sendMail({
    from: `"${config.fromName}" <${config.fromEmail || config.smtpUser}>`,
    to,
    subject,
    html,
  });

  logger.info(`[Email] Sent to ${to}, subject: ${subject}`);
}
