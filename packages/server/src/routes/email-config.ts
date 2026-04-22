import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { emailConfigs } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import type { AuthEnv } from '../middleware/auth';
import { apiResponse, ErrorResponse, MessageResponse, jsonContent, validationHook, commonErrorResponses } from '../lib/openapi-schemas';

import { emailConfigSchema } from '@zenith/shared';

const emailConfigRouter = new OpenAPIHono<AuthEnv>({ defaultHook: validationHook });
emailConfigRouter.use('*', authMiddleware);

// ─── Schemas ───────────────────────────────────────────────────────────────
const EmailConfigDTO = z
  .object({
    id: z.number(),
    smtpHost: z.string().nullable().optional(),
    smtpPort: z.number().nullable().optional(),
    smtpUser: z.string().nullable().optional(),
    fromName: z.string().nullable().optional(),
    fromEmail: z.string().nullable().optional(),
    encryption: z.string().nullable().optional(),
    updatedAt: z.union([z.string(), z.date()]).nullable().optional(),
    createdAt: z.union([z.string(), z.date()]).nullable().optional(),
  })
  .passthrough()
  .openapi('EmailConfig');

const TestEmailBody = z.object({ email: z.string() });

// ─── Routes ────────────────────────────────────────────────────────────────
const getRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['EmailConfig'],
  summary: '获取邮件配置',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:email-config:view' })] as const,
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(EmailConfigDTO)), description: '邮件配置' },
  },
});

emailConfigRouter.openapi(getRoute, async (c) => {
  let [config] = await db.select().from(emailConfigs).limit(1);
  if (!config) {
    const [created] = await db.insert(emailConfigs).values({}).returning();
    config = created;
  }
  const { smtpPassword: _masked, ...safeConfig } = config;
  return c.json({ code: 0 as const, message: 'success', data: safeConfig }, 200);
});

const updateRoute = createRoute({
  method: 'put',
  path: '/',
  tags: ['EmailConfig'],
  summary: '更新邮件配置',
  security: [{ BearerAuth: [] }],
  middleware: [
    guard({
      permission: 'system:email-config:update',
      audit: { description: '更新邮件配置', module: '邮件配置' },
    }),
  ] as const,
  request: {
    body: { content: jsonContent(emailConfigSchema), required: true },
  },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(EmailConfigDTO)), description: '保存成功' },
  },
});

emailConfigRouter.openapi(updateRoute, async (c) => {
  const data = c.req.valid('json');
  const [config] = await db.select().from(emailConfigs).limit(1);
  if (!config) {
    const [created] = await db
      .insert(emailConfigs)
      .values({ ...data, updatedAt: new Date() })
      .returning();
    return c.json({ code: 0 as const, message: '保存成功', data: created }, 200);
  }

  const [updated] = await db
    .update(emailConfigs)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(emailConfigs.id, config.id))
    .returning();
  return c.json({ code: 0 as const, message: '保存成功', data: updated }, 200);
});

const testRoute = createRoute({
  method: 'post',
  path: '/test',
  tags: ['EmailConfig'],
  summary: '发送测试邮件',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:email-config:update' })] as const,
  request: {
    body: { content: jsonContent(TestEmailBody), required: true },
  },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(MessageResponse), description: '发送成功' },
    400: { content: jsonContent(ErrorResponse), description: '参数错误或配置不完整' },
    500: { content: jsonContent(ErrorResponse), description: '发送失败' },
  },
});

emailConfigRouter.openapi(testRoute, async (c) => {
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
      return c.json(
        { code: 500, message: 'nodemailer 模块加载失败，请检查依赖安装（npm install）', data: null },
        500,
      );
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

    return c.json({ code: 0 as const, message: '测试邮件发送成功', data: null }, 200);
  } catch (err: unknown) {
    return c.json(
      {
        code: 500,
        message: `发送失败: ${err instanceof Error ? err.message : String(err)}`,
        data: null,
      },
      500,
    );
  }
});

export default emailConfigRouter;
