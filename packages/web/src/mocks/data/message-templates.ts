import type { MessageTemplate } from '@zenith/shared';

const NOW = '2026-01-01T08:00:00.000Z';

export const mockMessageTemplates: MessageTemplate[] = [
  {
    id: 1,
    name: '欢迎注册邮件',
    code: 'user_welcome_email',
    channel: 'email',
    subject: '欢迎加入 {{app_name}}',
    content: '亲爱的 {{username}}，\n\n欢迎注册 {{app_name}}！\n您的账户已成功创建，请单击以下链接完成验证：\n{{verify_link}}\n\n此链接 24 小时内有效。',
    variables: JSON.stringify({ username: '用户名', app_name: '应用名称', verify_link: '验证链接' }),
    status: 'active',
    remark: '新用户注册后发送的激活邮件',
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 2,
    name: '密码重置邮件',
    code: 'user_reset_password_email',
    channel: 'email',
    subject: '重置您的密码',
    content: '亲爱的 {{username}}，\n\n我们收到了您的密码重置申请。请单击以下链接重置密码：\n{{reset_link}}\n\n此链接 2 小时内有效。如果您未发起此请求，请忽略此邮件。',
    variables: JSON.stringify({ username: '用户名', reset_link: '重置密码链接' }),
    status: 'active',
    remark: '用户密码重置流程所用模板',
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 3,
    name: '验证码短信',
    code: 'user_verification_sms',
    channel: 'sms',
    subject: null,
    content: '【{{app_name}}】您的验证码为 {{code}}，{{expire_minutes}} 分钟内有效，请勿泄露。',
    variables: JSON.stringify({ app_name: '应用名称', code: '验证码', expire_minutes: '有效分钟数' }),
    status: 'active',
    remark: '短信验证码模板',
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 4,
    name: '系统公告',
    code: 'system_notice_in_app',
    channel: 'in_app',
    subject: '系统公告：{{title}}',
    content: '{{content}}',
    variables: JSON.stringify({ title: '公告标题', content: '公告内容' }),
    status: 'active',
    remark: '站内系统公告通知模板',
    createdAt: NOW,
    updatedAt: NOW,
  },
];

let nextMessageTemplateId = mockMessageTemplates.length + 1;
export function getNextMessageTemplateId() { return nextMessageTemplateId++; }
