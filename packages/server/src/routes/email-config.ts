import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { emailConfigs } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { emailConfigSchema } from '@zenith/shared';
import type { JwtPayload } from '../lib/jwt';

const emailConfigRouter = new Hono<{ Variables: { user: JwtPayload } }>();

emailConfigRouter.use('*', authMiddleware);

// GET / - get email config (create default if not exists)
emailConfigRouter.get('/', guard({ permission: 'system:email-config:view' }), async (c) => {
  let [config] = await db.select().from(emailConfigs).limit(1);
  if (!config) {
    const [created] = await db.insert(emailConfigs).values({}).returning();
    config = created;
  }
  return c.json({ code: 0, message: 'success', data: config });
});

// PUT / - update email config
emailConfigRouter.put(
  '/',
  guard({ permission: 'system:email-config:update', audit: { description: '更新邮件配置', module: '邮件配置' } }),
  async (c) => {
    const body = await c.req.json();
    const result = emailConfigSchema.safeParse(body);
    if (!result.success) {
      return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
    }

    let [config] = await db.select().from(emailConfigs).limit(1);
    if (!config) {
      const [created] = await db
        .insert(emailConfigs)
        .values({ ...result.data, updatedAt: new Date() })
        .returning();
      return c.json({ code: 0, message: '保存成功', data: created });
    }

    const [updated] = await db
      .update(emailConfigs)
      .set({ ...result.data, updatedAt: new Date() })
      .where(eq(emailConfigs.id, config.id))
      .returning();
    return c.json({ code: 0, message: '保存成功', data: updated });
  },
);

// POST /test - send test email
emailConfigRouter.post('/test', guard({ permission: 'system:email-config:update' }), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const toEmail = body?.email as string | undefined;
  if (!toEmail || !toEmail.includes('@')) {
    return c.json({ code: 400, message: '请提供有效的收件邮箱', data: null }, 400);
  }

  const [config] = await db.select().from(emailConfigs).limit(1);
  if (!config || !config.smtpHost || !config.smtpUser) {
    return c.json({ code: 400, message: '请先完整配置SMTP信息', data: null }, 400);
  }

  try {
    const nodemailer = await import('nodemailer').catch(() => null);
    if (!nodemailer) {
      return c.json({ code: 500, message: 'nodemailer 未安装，请运行 npm install 后重试', data: null }, 500);
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
      to: toEmail,
      subject: '【Zenith Admin】邮件配置测试',
      text: '这是一封来自 Zenith Admin 的测试邮件，说明您的邮件配置正确。',
      html: '<p>这是一封来自 <strong>Zenith Admin</strong> 的测试邮件，说明您的邮件配置正确。</p>',
    });

    return c.json({ code: 0, message: '测试邮件发送成功', data: null });
  } catch (err: any) {
    return c.json({ code: 500, message: `发送失败: ${err.message ?? String(err)}`, data: null }, 500);
  }
});

export default emailConfigRouter;
