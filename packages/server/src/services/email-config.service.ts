import { eq } from 'drizzle-orm';
import { db } from '../db';
import { emailConfigs } from '../db/schema';
import { AppError } from '../lib/errors';
import { formatNullableDateTime } from '../lib/datetime';

export function mapEmailConfig(row: typeof emailConfigs.$inferSelect) {
  const { smtpPassword: _masked, ...safeConfig } = row;
  return {
    ...safeConfig,
    createdAt: formatNullableDateTime(row.createdAt),
    updatedAt: formatNullableDateTime(row.updatedAt),
  };
}

export async function getEmailConfig() {
  let [config] = await db.select().from(emailConfigs).limit(1);
  if (!config) {
    const [created] = await db.insert(emailConfigs).values({}).returning();
    config = created;
  }
  return mapEmailConfig(config);
}

export async function updateEmailConfig(data: Partial<typeof emailConfigs.$inferInsert>) {
  const [config] = await db.select().from(emailConfigs).limit(1);
  if (!config) {
    const [created] = await db.insert(emailConfigs).values({ ...data }).returning();
    return mapEmailConfig(created);
  }
  const [updated] = await db.update(emailConfigs).set({ ...data }).where(eq(emailConfigs.id, config.id)).returning();
  return mapEmailConfig(updated);
}

export async function getEmailConfigBeforeAudit() {
  const [config] = await db.select().from(emailConfigs).limit(1);
  if (!config) return null;
  return mapEmailConfig(config);
}

export async function sendTestEmail(toEmail: string) {
  if (!toEmail?.includes('@')) throw new AppError('请提供有效的收件邮箱', 400);
  const [config] = await db.select().from(emailConfigs).limit(1);
  if (!config?.smtpHost || !config?.smtpUser) throw new AppError('请先完整配置SMTP信息', 400);

  const nodemailer = await import('nodemailer').catch(() => null);
  if (!nodemailer) throw new AppError('nodemailer 模块加载失败，请检查依赖安装（npm install）', 500);
  try {
    const secure = config.encryption === 'ssl';
    const transporter = nodemailer.default.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure,
      auth: { user: config.smtpUser, pass: config.smtpPassword },
      ...(config.encryption === 'tls' ? { requireTLS: true } : {}),
    });
    await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail || config.smtpUser}>`,
      to: toEmail,
      subject: '【Zenith Admin】邮件配置测试',
      text: '这是一封来自 Zenith Admin 的测试邮件，说明您的邮件配置正确。',
      html: '<p>这是一封来自 <strong>Zenith Admin</strong> 的测试邮件，说明您的邮件配置正确。</p>',
    });
  } catch (err: unknown) {
    let msg: string;
    if (err instanceof Error) msg = err.message;
    else if (typeof err === 'string') msg = err;
    else msg = JSON.stringify(err);
    throw new AppError(`发送失败: ${msg}`, 500);
  }
}
