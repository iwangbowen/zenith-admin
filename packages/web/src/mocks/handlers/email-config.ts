import { http, HttpResponse } from 'msw';
import { mockEmailConfig } from '@/mocks/data/email-config';
import type { EmailConfig } from '@zenith/shared';

let emailConfig: EmailConfig = { ...mockEmailConfig };

export const emailConfigHandlers = [
  http.get('/api/email-config', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { smtpPassword: _masked, ...safeConfig } = emailConfig;
    return HttpResponse.json({ code: 0, message: 'success', data: safeConfig });
  }),

  http.put('/api/email-config', async ({ request }) => {
    const body = (await request.json()) as Partial<EmailConfig>;
    emailConfig = { ...emailConfig, ...body, updatedAt: new Date().toISOString() };
    return HttpResponse.json({ code: 0, message: '保存成功', data: emailConfig });
  }),

  http.post('/api/email-config/test', async ({ request }) => {
    const body = (await request.json()) as { email?: string };
    if (!body.email) {
      return HttpResponse.json({ code: 400, message: '请提供收件邮箱', data: null }, { status: 400 });
    }
    return HttpResponse.json({ code: 0, message: '测试邮件发送成功（演示模式）', data: null });
  }),
];
