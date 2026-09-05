import { emailConfigContract } from '@zenith/shared/messaging';
import type { EmailConfig } from '@zenith/shared/messaging';
import { mock } from '@/mocks/utils/contract';
import { badRequest } from '@/mocks/utils/handlers';
import { mockEmailConfig } from '@/mocks/data/email-config';
import { mockDateTime } from '@/mocks/utils/date';

let emailConfig: EmailConfig = { ...mockEmailConfig };

export const emailConfigHandlers = [
  mock(emailConfigContract.get, ({ ok }) => ok(emailConfig, 'success')),

  // 密码只写不读：接口返回的配置从不包含 smtpPassword
  mock(emailConfigContract.save, ({ body, ok }) => {
    const { smtpPassword: _password, ...patch } = body;
    emailConfig = { ...emailConfig, ...patch, updatedAt: mockDateTime() };
    return ok(emailConfig, '保存成功');
  }),

  mock(emailConfigContract.test, ({ body, ok }) => {
    if (!body.email) {
      return badRequest('请提供收件邮箱', { status: 400 });
    }
    return ok(null, '测试邮件发送成功（演示模式）');
  }),
];