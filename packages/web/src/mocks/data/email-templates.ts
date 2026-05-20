import type { EmailTemplate } from '@zenith/shared';

export const mockEmailTemplates: EmailTemplate[] = [
  {
    id: 1,
    name: '欢迎邮件',
    code: 'welcome',
    subject: '欢迎加入 {{appName}}',
    content: '<p>Hi {{nickname}}，欢迎加入 {{appName}}！</p>',
    variables: 'appName,nickname',
    status: 'enabled',
    remark: '新用户注册欢迎邮件',
    createdAt: '2025-01-01 00:00:00',
    updatedAt: '2025-01-01 00:00:00',
  },
  {
    id: 2,
    name: '密码重置',
    code: 'password_reset',
    subject: '密码重置验证码',
    content: '<p>您的验证码是 {{code}}，{{minutes}} 分钟内有效。</p>',
    variables: 'code,minutes',
    status: 'enabled',
    remark: null,
    createdAt: '2025-01-02 10:00:00',
    updatedAt: '2025-01-02 10:00:00',
  },
  {
    id: 3,
    name: '系统告警',
    code: 'system_alert',
    subject: '【告警】{{title}}',
    content: '<p>{{description}}</p>',
    variables: 'title,description',
    status: 'disabled',
    remark: '仅运维使用',
    createdAt: '2025-01-03 12:00:00',
    updatedAt: '2025-01-03 12:00:00',
  },
];

let nextId = Math.max(...mockEmailTemplates.map((t) => t.id)) + 1;
export function getNextEmailTemplateId() {
  return nextId++;
}
